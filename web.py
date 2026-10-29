import http.server
import socketserver
import ssl
import json
import os
import urllib.request
import urllib.parse
import urllib.error
import re
import socket
import ipaddress
import html as html_lib

PORT = 8080
ROOT_DIR = os.path.dirname(os.path.abspath(__file__))

def get_settings_file():
    for candidate in (
        os.path.join(ROOT_DIR, "config.json"),
        os.path.join(ROOT_DIR, "data", "config.json"),
        os.path.join(ROOT_DIR, "data", "networks.json"),
    ):
        if os.path.exists(candidate):
            return candidate
    return os.path.join(ROOT_DIR, "config.json")

SETTINGS_FILE = get_settings_file()


_uploads_dir = os.path.join(ROOT_DIR, "data", "uploads")
os.makedirs(_uploads_dir, exist_ok=True)

_ALLOWED_PREFIXES = (
    os.path.realpath(os.path.join(ROOT_DIR, "static")) + os.sep,
    os.path.realpath(os.path.join(ROOT_DIR, "templates")) + os.sep,
    os.path.realpath(_uploads_dir) + os.sep,
)

_BLOCKED_NETS = (
    ipaddress.ip_network("0.0.0.0/8"),
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("169.254.0.0/16"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("100.64.0.0/10"),
    ipaddress.ip_network("224.0.0.0/4"),
    ipaddress.ip_network("240.0.0.0/4"),
    ipaddress.ip_network("::1/128"),
    ipaddress.ip_network("fc00::/7"),
    ipaddress.ip_network("fe80::/10"),
)

def _load_settings():
    sf = get_settings_file()
    if not os.path.exists(sf):
        return {}
    try:
        with open(sf, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return {}

def _is_local_client(ip_text):
    try:
        return ipaddress.ip_address(ip_text).is_loopback
    except ValueError:
        return False

def _http_api_allowed(client_ip):
    settings = _load_settings()
    allow_remote = bool(settings.get("bouncer", {}).get("allow_remote_http_api", False))
    return allow_remote or _is_local_client(client_ip)

def _url_is_safe(target_url):
    try:
        parsed = urllib.parse.urlparse(target_url)
        if parsed.scheme not in ("http", "https"):
            return False, "Invalid scheme", None
        hostname = parsed.hostname
        if not hostname:
            return False, "Invalid hostname", None
        infos = socket.getaddrinfo(hostname, parsed.port, proto=socket.IPPROTO_TCP)
        if not infos:
            return False, "Host resolution failed", None
        for info in infos:
            addr = ipaddress.ip_address(info[4][0])
            if any(addr.version == net.version and addr in net for net in _BLOCKED_NETS):
                return False, f"Disallowed target address: {addr}", hostname.lower()
            if addr.is_multicast or addr.is_unspecified or addr.is_reserved:
                return False, f"Disallowed target address: {addr}", hostname.lower()
        return True, "", hostname.lower()
    except Exception as e:
        return False, f"URL safety check failed: {e}", None

class _SafeRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        ok, reason, _ = _url_is_safe(newurl)
        if not ok:
            raise urllib.error.URLError(f"Blocked unsafe redirect: {reason}")
        return super().redirect_request(req, fp, code, msg, headers, newurl)

class _NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise urllib.error.URLError("Redirects are not allowed for relay targets")

_safe_opener = urllib.request.build_opener(_SafeRedirectHandler)
_no_redirect_opener = urllib.request.build_opener(_NoRedirectHandler)

def _read_content_length(headers):
    try:
        return int(headers.get('Content-Length', -1))
    except (TypeError, ValueError):
        return -1

_ACTIVE_CONTENT_EXTS = {'.html', '.htm', '.xhtml', '.shtml', '.svg', '.xml',
                        '.js', '.mjs', '.css'}
_SAFE_EXT_RE = re.compile(r'^\.[A-Za-z0-9]{1,10}$')

def _sanitize_upload_ext(filename):
    ext = os.path.splitext(filename)[1].lower()
    if not _SAFE_EXT_RE.match(ext) or ext in _ACTIVE_CONTENT_EXTS:
        return '.bin'
    return ext

def _relay_target_allowed(target_url):
    settings = _load_settings()
    bouncer_cfg = settings.get("bouncer", {})
    if not bool(bouncer_cfg.get("enable_upload_relay", False)):
        return False, "Upload relay is disabled"

    ok, reason, host = _url_is_safe(target_url)
    if not ok:
        return False, reason

    allow_hosts = bouncer_cfg.get("upload_relay_allow_hosts", [])
    if not allow_hosts:
        return False, "No upload relay allowlist configured"

    normalized = {str(h).strip().lower() for h in allow_hosts if str(h).strip()}
    if host not in normalized:
        return False, "Relay endpoint host is not allowlisted"

    return True, ""

def get_link_preview(target_url):
    ok, reason, _ = _url_is_safe(target_url)
    if not ok:
        return {"error": reason}

    try:
        req = urllib.request.Request(
            target_url,
            headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'}
        )
        with _safe_opener.open(req, timeout=3) as response:
            html_bytes = response.read(1024 * 1024)
            html_content = html_bytes.decode('utf-8', errors='ignore')
    except Exception as e:
        return {"error": f"Fetch failed: {e}"}

    title = ""
    desc = ""
    image = ""

    og_title_match = re.search(r'<meta[^>]+property=["\']og:title["\'][^>]+content=["\']([^"\']+)["\']', html_content, re.I)
    if not og_title_match:
        og_title_match = re.search(r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:title["\']', html_content, re.I)
    if og_title_match:
        title = og_title_match.group(1)
    else:
        title_match = re.search(r'<title[^>]*>(.*?)</title>', html_content, re.I | re.S)
        if title_match:
            title = title_match.group(1).strip()

    og_desc_match = re.search(r'<meta[^>]+property=["\']og:description["\'][^>]+content=["\']([^"\']+)["\']', html_content, re.I)
    if not og_desc_match:
        og_desc_match = re.search(r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:description["\']', html_content, re.I)
    if og_desc_match:
        desc = og_desc_match.group(1)
    else:
        desc_match = re.search(r'<meta[^>]+name=["\']description["\'][^>]+content=["\']([^"\']+)["\']', html_content, re.I)
        if not desc_match:
            desc_match = re.search(r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+name=["\']description["\']', html_content, re.I)
        if desc_match:
            desc = desc_match.group(1)

    og_image_match = re.search(r'<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)["\']', html_content, re.I)
    if not og_image_match:
        og_image_match = re.search(r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:image["\']', html_content, re.I)
    if og_image_match:
        image = og_image_match.group(1)
        if image and not image.startswith(('http://', 'https://')):
            image = urllib.parse.urljoin(target_url, image)

    title = html_lib.unescape(title) if title else ""
    desc = html_lib.unescape(desc) if desc else ""

    return {
        "title": title[:200],
        "description": desc[:500],
        "image": image
    }

_MEDIA_PROXY_MAX_BYTES = 20 * 1024 * 1024
_MEDIA_PROXY_ALLOWED_CTYPES = ('image/', 'video/')

def _media_proxy_enabled():
    settings = _load_settings()
    return bool(settings.get("advanced", {}).get("mediaProxy", False))

def _serve_media_proxy(handler, target_url):
    ok, reason, _ = _url_is_safe(target_url)
    if not ok:
        handler.send_error(403, f"Forbidden: {reason}")
        return
    try:
        req = urllib.request.Request(
            target_url, headers={'User-Agent': 'IRCircuit-MediaProxy/1.0'})
        with _safe_opener.open(req, timeout=10) as resp:
            ctype = resp.headers.get('Content-Type', 'application/octet-stream')
            if not ctype.lower().startswith(_MEDIA_PROXY_ALLOWED_CTYPES):
                handler.send_error(415, "Unsupported media type")
                return
            length = _read_content_length(resp.headers)
            if length > _MEDIA_PROXY_MAX_BYTES:
                handler.send_error(413, "Payload Too Large")
                return
            body = resp.read(_MEDIA_PROXY_MAX_BYTES + 1)
            if len(body) > _MEDIA_PROXY_MAX_BYTES:
                handler.send_error(413, "Payload Too Large")
                return
    except urllib.error.URLError as e:
        handler.send_error(502, f"Bad Gateway: {e}")
        return
    except Exception as e:
        handler.send_error(502, f"Bad Gateway: {e}")
        return
    handler.send_response(200)
    handler.send_header('Content-Type', ctype)
    handler.send_header('Cache-Control', 'private, max-age=3600')
    handler.end_headers()
    handler.wfile.write(body)

class CustomHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT_DIR, **kwargs)

    def end_headers(self):

        path = getattr(self, 'path', '').split('?', 1)[0]
        if path.endswith(('.js', '.css', '.html')):
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.send_header('Pragma', 'no-cache')
            self.send_header('Expires', '0')

        if getattr(self, '_sw_request', False):
            self.send_header('Service-Worker-Allowed', '/')

        self.send_header('Content-Security-Policy',
            "default-src 'self'; "
            "script-src 'self' 'unsafe-eval'; "
            "style-src 'self' 'unsafe-inline'; "
            "connect-src 'self' ws: wss:; "
            "img-src 'self' data: https:; "
            "media-src 'self' https:; "
            "font-src 'self' https://fonts.gstatic.com; "
            "object-src 'none'; "
            "base-uri 'self'; "
            "form-action 'self'")
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('X-Frame-Options', 'DENY')
        self.send_header('Referrer-Policy', 'no-referrer')
        if _ssl_active:
            self.send_header('Strict-Transport-Security', 'max-age=63072000; includeSubDomains')
        super().end_headers()

    def _path_allowed(self, req_path):
        rel = req_path.lstrip('/')
        abs_path = os.path.realpath(os.path.join(ROOT_DIR, rel))
        return any(abs_path.startswith(p) for p in _ALLOWED_PREFIXES) or \
            abs_path == os.path.join(ROOT_DIR, "templates", "index.html")

    def do_HEAD(self):
        req_path = urllib.parse.unquote(
            self.path.split('?', 1)[0].split('#', 1)[0], errors='surrogatepass')
        if req_path == '/':
            self.path = '/templates/index.html'
            req_path = '/templates/index.html'
        if not self._path_allowed(req_path):
            self.send_error(403, "Forbidden")
            return
        return super().do_HEAD()

    def do_GET(self):

        req_path = urllib.parse.unquote(
            self.path.split('?', 1)[0].split('#', 1)[0], errors='surrogatepass')

        if req_path.startswith('/api/') and not _http_api_allowed(self.client_address[0]):
            self.send_error(403, "Forbidden")
            return

        if req_path == '/':
            self.path = '/templates/index.html'
            req_path = '/templates/index.html'

        if req_path == '/sw.js':
            self.path = '/static/sw.js'
            req_path = '/static/sw.js'
            self._sw_request = True
        else:
            self._sw_request = False

        if req_path == '/api/preview':
            query = self.path.split('?', 1)[-1] if '?' in self.path else ''
            params = urllib.parse.parse_qs(query)
            url_param = params.get('url', [''])[0]
            if not url_param:
                self.send_error(400, "Missing url parameter")
                return
            preview_data = get_link_preview(url_param)
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(preview_data).encode('utf-8'))
            return

        if req_path == '/api/mediaproxy':
            if not _media_proxy_enabled():
                self.send_error(403, "Media proxy is disabled in settings")
                return
            query = self.path.split('?', 1)[-1] if '?' in self.path else ''
            params = urllib.parse.parse_qs(query)
            url_param = params.get('url', [''])[0]
            if not url_param:
                self.send_error(400, "Missing url parameter")
                return
            _serve_media_proxy(self, url_param)
            return

        if req_path.startswith('/uploads/'):
            filename = req_path.replace('/uploads/', '', 1)
            self.path = f'/data/uploads/{filename}'
            req_path = f'/data/uploads/{filename}'

        if not self._path_allowed(req_path):
            self.send_error(403, "Forbidden")
            return

        return super().do_GET()

    def do_POST(self):
        if self.path.startswith('/api/') and not _http_api_allowed(self.client_address[0]):
            self.send_error(403, "Forbidden")
            return

        if self.path.startswith('/api/upload-relay'):
            query = urllib.parse.urlsplit(self.path).query
            params = urllib.parse.parse_qs(query)
            target_url = params.get('endpoint', [''])[0].strip()
            if not target_url:
                self.send_error(400, "Bad Request: Missing endpoint parameter")
                return

            allowed, reason = _relay_target_allowed(target_url)
            if not allowed:
                self.send_error(403, f"Forbidden: {reason}")
                return

            content_type = self.headers.get('Content-Type', '')
            content_length = _read_content_length(self.headers)
            if not content_type.startswith('multipart/form-data'):
                self.send_error(400, "Bad Request: Expected multipart/form-data")
                return
            if content_length < 0:
                self.send_error(400, "Bad Request: Missing/invalid Content-Length")
                return
            if content_length > 10 * 1024 * 1024:
                self.send_error(413, "Payload Too Large")
                return

            body = self.rfile.read(content_length)
            req = urllib.request.Request(
                target_url,
                data=body,
                headers={
                    'Content-Type': content_type,
                    'User-Agent': 'IRCircuit-Upload-Relay/1.0'
                },
                method='POST'
            )
            try:
                with _no_redirect_opener.open(req, timeout=30) as upstream:
                    upstream_body = upstream.read()
                    status = getattr(upstream, 'status', 200)
                    upstream_ct = upstream.headers.get('Content-Type', 'application/json')
            except urllib.error.HTTPError as e:
                upstream_body = e.read() if hasattr(e, 'read') else b''
                status = e.code
                upstream_ct = e.headers.get('Content-Type', 'application/json') if getattr(e, 'headers', None) else 'application/json'
            except Exception as e:
                self.send_error(502, f"Bad Gateway: {e}")
                return

            self.send_response(status)
            self.send_header('Content-Type', upstream_ct)
            self.end_headers()
            self.wfile.write(upstream_body)
            return

        if self.path == '/api/upload':
            content_type = self.headers.get('Content-Type', '')
            if not content_type.startswith('multipart/form-data'):
                self.send_error(400, "Bad Request: Expected multipart/form-data")
                return

            content_length = _read_content_length(self.headers)
            if content_length < 0:
                self.send_error(400, "Bad Request: Missing/invalid Content-Length")
                return
            if content_length > 10 * 1024 * 1024:
                self.send_error(413, "Payload Too Large")
                return

            boundary = content_type.split('boundary=')[-1].encode('utf-8')
            if not boundary:
                self.send_error(400, "Bad Request: Missing boundary")
                return

            post_data = self.rfile.read(content_length)
            parts = post_data.split(b'--' + boundary)
            file_data = None
            filename = ""

            for part in parts:
                if b'filename=' in part:
                    try:
                        headers, body = part.split(b'\r\n\r\n', 1)
                        if body.endswith(b'\r\n'):
                            body = body[:-2]

                        fn_match = re.search(br'filename="([^"]+)"', headers)
                        if fn_match:
                            filename = fn_match.group(1).decode('utf-8', errors='ignore')
                            filename = os.path.basename(filename)
                            file_data = body
                            break
                    except Exception:
                        pass

            if file_data is None or not filename:
                self.send_error(400, "Bad Request: No file found")
                return

            uploads_dir = os.path.join(ROOT_DIR, "data", "uploads")
            os.makedirs(uploads_dir, exist_ok=True)

            import uuid
            unique_filename = f"{uuid.uuid4().hex}{_sanitize_upload_ext(filename)}"
            dest_path = os.path.join(uploads_dir, unique_filename)

            try:
                with open(dest_path, 'wb') as f:
                    f.write(file_data)
            except Exception as e:
                self.send_error(500, f"Internal Server Error: {e}")
                return

            res = {"url": f"/uploads/{unique_filename}"}
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(res).encode('utf-8'))
            return
        elif self.path == '/api/upload-cert':
            content_type = self.headers.get('Content-Type', '')
            if not content_type.startswith('multipart/form-data'):
                self.send_error(400, "Bad Request: Expected multipart/form-data")
                return

            content_length = _read_content_length(self.headers)
            if content_length < 0:
                self.send_error(400, "Bad Request: Missing/invalid Content-Length")
                return
            if content_length > 1 * 1024 * 1024:
                self.send_error(413, "Payload Too Large")
                return

            boundary = content_type.split('boundary=')[-1].encode('utf-8')
            if not boundary:
                self.send_error(400, "Bad Request: Missing boundary")
                return

            post_data = self.rfile.read(content_length)
            parts = post_data.split(b'--' + boundary)
            file_data = None
            filename = ""

            for part in parts:
                if b'filename=' in part:
                    try:
                        headers, body = part.split(b'\r\n\r\n', 1)
                        if body.endswith(b'\r\n'):
                            body = body[:-2]

                        fn_match = re.search(br'filename="([^"]+)"', headers)
                        if fn_match:
                            filename = fn_match.group(1).decode('utf-8', errors='ignore')
                            filename = os.path.basename(filename)
                            file_data = body
                            break
                    except Exception:
                        pass

            if file_data is None or not filename:
                self.send_error(400, "Bad Request: No file found")
                return

            certs_dir = os.path.join(ROOT_DIR, "data", "certs")
            os.makedirs(certs_dir, exist_ok=True)

            import uuid
            ext = os.path.splitext(filename)[1].lower()
            if not _SAFE_EXT_RE.match(ext):
                ext = '.pem'
            unique_filename = f"{uuid.uuid4().hex}{ext}"
            dest_path = os.path.abspath(os.path.join(certs_dir, unique_filename))

            try:
                with open(dest_path, 'wb') as f:
                    f.write(file_data)
            except Exception as e:
                self.send_error(500, f"Internal Server Error: {e}")
                return

            res = {"filepath": dest_path}
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(res).encode('utf-8'))
            return

        self.send_error(404, "Not Found")

class ThreadingHTTPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    daemon_threads = True
    allow_reuse_address = True

_ssl_active = False

def _get_ssl_ctx():
    settings_file = get_settings_file()
    if not os.path.exists(settings_file):
        return None
    try:
        with open(settings_file, encoding="utf-8") as f:
            s = json.load(f)
    except (OSError, json.JSONDecodeError):
        return None
    ssl_cfg = s.get("bouncer", {}).get("ssl", {})
    if not ssl_cfg.get("enabled"):
        return None
    cert_path = ssl_cfg.get("cert")
    key_path  = ssl_cfg.get("key")
    if not cert_path or not key_path:
        print("Warning: SSL enabled in config but cert/key paths missing — serving HTTP")
        return None
    try:
        ctx = ssl.create_default_context(ssl.Purpose.CLIENT_AUTH)
        ctx.load_cert_chain(certfile=cert_path, keyfile=key_path)
        return ctx
    except Exception as e:
        print(f"Warning: Failed to load SSL certificates: {e} — serving HTTP")
        return None

def _get_bind_host():
    settings = _load_settings()
    bnc = settings.get("bouncer", {})
    return str(bnc.get("http_bind_host", bnc.get("bind_host", settings.get("bind_host", "0.0.0.0")))).strip() or "0.0.0.0"

def _get_http_port():
    settings = _load_settings()
    bnc = settings.get("bouncer", {})
    val = bnc.get("http_port", settings.get("http_port", PORT))
    try:
        return int(val)
    except (ValueError, TypeError):
        return PORT

if __name__ == '__main__':
    ssl_ctx = _get_ssl_ctx()
    bind_host = _get_bind_host()
    port = _get_http_port()
    with ThreadingHTTPServer((bind_host, port), CustomHTTPRequestHandler) as httpd:
        if ssl_ctx:
            httpd.socket = ssl_ctx.wrap_socket(httpd.socket, server_side=True)
            _ssl_active = True
            print(f"Serving HTTPS on {bind_host}:{port}")
        else:
            print(f"Serving HTTP on {bind_host}:{port}")
        httpd.serve_forever()

