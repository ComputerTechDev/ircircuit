import sys
import os

ROOT_DIR = os.path.dirname(os.path.abspath(__file__))
_VENV_DIR = os.path.join(ROOT_DIR, ".venv")
_VENV_PY = os.path.join(_VENV_DIR, "bin", "python")
if (os.path.exists(_VENV_PY) and os.access(_VENV_PY, os.X_OK) and
        os.path.abspath(sys.prefix) != os.path.abspath(_VENV_DIR)):
    os.execv(_VENV_PY, [_VENV_PY] + sys.argv)

import asyncio
import websockets
import json
import ssl
import base64
import hmac
import hashlib
import secrets
import os
import time
import signal
import logging
import collections
import re
import sys
import importlib.util
from http import HTTPStatus
from datetime import datetime, timezone
from parser import parse_irc
import store

from pywebpush import webpush, WebPushException
from py_vapid import Vapid
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

EAT_NONE = 0
EAT_ALL  = 2

_LOG_FMT = '%(asctime)s [%(levelname)s] %(message)s'
logging.basicConfig(level=logging.INFO, format=_LOG_FMT)
log = logging.getLogger(__name__)

def _setup_rotating_log():
    import sys
    from logging.handlers import RotatingFileHandler
    root = logging.getLogger()
    root.handlers.clear()
    process_log_dir = os.path.join(ROOT_DIR, 'data', 'logs')
    os.makedirs(process_log_dir, exist_ok=True)
    fh = RotatingFileHandler(
        os.path.join(process_log_dir, 'bouncer.log'),
        maxBytes=5 * 1024 * 1024,
        backupCount=3,
        encoding='utf-8',
    )
    fh.setFormatter(logging.Formatter(_LOG_FMT))
    root.addHandler(fh)
    if sys.stderr.isatty():
        sh = logging.StreamHandler(sys.stderr)
        sh.setFormatter(logging.Formatter(_LOG_FMT))
        root.addHandler(sh)

if '--debug' in sys.argv:
    logging.getLogger().setLevel(logging.DEBUG)

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

PUSH_SUB_FILE = os.path.join(ROOT_DIR, "data", "push_subscriptions.json")
HIGHLIGHTS_FILE = os.path.join(ROOT_DIR, "data", "highlights.json")
BACKLOG_DIR = os.path.join(ROOT_DIR, "data", "backlog")
MAX_HIGHLIGHTS = 500
BNC_CACHE_TTL = 5
IRC_LOG_BASE = os.path.join(ROOT_DIR, "data", "logs", "irc")
DEFAULTS = {
    "reconnectBase": 5,
    "reconnectMax": 300,
    "floodRate": 4,
    "floodBurst": 5,
    "pingInterval": 60,
    "pongTimeout": 120,
    "connectTimeout": 15
}

_LOCAL_ECHO_DELAY_SECS = 0.35
_LOCAL_ECHO_DEDUPE_SECS = 5.0

def _pack_command_lines(prefix, tokens, sep=" ", limit=450):
    lines, cur = [], []
    for tok in tokens:
        if cur and len(f"{prefix} {sep.join(cur + [tok])}".encode("utf-8")) > limit:
            lines.append(f"{prefix} {sep.join(cur)}")
            cur = [tok]
        else:
            cur.append(tok)
    if cur:
        lines.append(f"{prefix} {sep.join(cur)}")
    return lines

clients = set()
networks = {}

_IRC_ERRORS = {

    "401": "No such nick/channel",
    "402": "No such server",
    "403": "No such channel",
    "404": "Cannot send to channel",
    "405": "You have joined too many channels",
    "406": "There was no such nickname",
    "407": "Too many targets",
    "408": "No such service",
    "409": "No origin specified",

    "411": "No recipient given",
    "412": "No text to send",
    "413": "No toplevel domain specified",
    "414": "Wildcard in every part of domain mask",
    "415": "Bad server/host mask",

    "421": "Unknown command",
    "422": "MOTD file is missing",
    "423": "No administrative info available",
    "424": "File error on server",
    "431": "No nickname given",

    "441": "That user isn't on that channel",
    "442": "You're not on that channel",
    "443": "User is already on channel",
    "444": "User not logged in",
    "445": "SUMMON has been disabled",
    "446": "USERS has been disabled",

    "451": "You have not registered",
    "461": "Not enough parameters",
    "462": "You may not re-register",
    "463": "Your host isn't among the privileged",
    "464": "Password incorrect",
    "465": "You are banned from this server",
    "466": "You will be banned from this server",

    "467": "Channel key already set",
    "468": "Invalid username",
    "469": "Link channel",
    "470": "You were redirected to a different channel",
    "472": "Unknown mode character",
    "476": "Bad channel mask",
    "478": "Channel ban list is full",
    "479": "Illegal channel name",
    "480": "Cannot knock on channel",

    "481": "Permission denied — you're not an IRC operator",
    "482": "You're not a channel operator",
    "483": "You can't kill a server",
    "484": "Your connection is restricted",
    "485": "You're not the original channel operator",
    "486": "You must be identified to join this channel",
    "487": "CTCP messages not accepted from unidentified users",
    "488": "Secure connection required to join this channel",
    "491": "No O-lines for your host",
    "492": "User does not accept private messages",
    "493": "You must be a member of the channel to invite",
    "494": "Your invitation was not delivered",

    "501": "Unknown mode flag",
    "502": "Cannot change mode for other users",

    "511": "Too many SLINES",
    "512": "Too many connections from your host",
    "513": "You need to type /QUOTE PONG to use this server",
}

def load_push_subscriptions():
    if os.path.exists(PUSH_SUB_FILE):
        try:
            with open(PUSH_SUB_FILE, encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return []
    return []

def save_push_subscriptions(subs):
    try:
        os.makedirs(os.path.dirname(PUSH_SUB_FILE), exist_ok=True)
        tmp = PUSH_SUB_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(subs, f, indent=2)
        os.replace(tmp, PUSH_SUB_FILE)
    except Exception as e:
        log.error(f"[push] Failed to save push subscriptions: {e}")

def add_push_subscription(sub):
    subs = load_push_subscriptions()
    subs = [s for s in subs if s.get("endpoint") != sub.get("endpoint")]
    subs.append(sub)
    save_push_subscriptions(subs)

def remove_push_subscription(endpoint):
    subs = load_push_subscriptions()
    subs = [s for s in subs if s.get("endpoint") != endpoint]
    save_push_subscriptions(subs)

def load_highlights():
    if os.path.exists(HIGHLIGHTS_FILE):
        try:
            with open(HIGHLIGHTS_FILE, encoding="utf-8") as f:
                data = json.load(f)
                return data if isinstance(data, list) else []
        except Exception:
            return []
    return []

def save_highlights():
    try:
        os.makedirs(os.path.dirname(HIGHLIGHTS_FILE), exist_ok=True)
        tmp = HIGHLIGHTS_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(highlights_log[-MAX_HIGHLIGHTS:], f)
        os.replace(tmp, HIGHLIGHTS_FILE)
    except Exception as e:
        log.error(f"[highlights] Failed to save highlights: {e}")

async def add_highlight(rec):
    highlights_log.append(rec)
    if len(highlights_log) > MAX_HIGHLIGHTS:
        del highlights_log[:-MAX_HIGHLIGHTS]
    save_highlights()
    await broadcast({"type": "highlight", **rec})

highlights_log = load_highlights()

def _backlog_path(net_id):
    safe = net_id.replace("/", "_").replace("\\", "_")
    return os.path.join(BACKLOG_DIR, f"backlog_{safe}.json")

def load_backlog(net_id, max_per_chan):
    path = _backlog_path(net_id)
    if not os.path.exists(path):
        return {}
    try:
        with open(path, encoding="utf-8") as f:
            raw = json.load(f)
        if not isinstance(raw, dict):
            return {}

        return {ch: msgs[-max_per_chan:] for ch, msgs in raw.items()
                if isinstance(ch, str) and isinstance(msgs, list)}
    except Exception as e:
        log.warning(f"[{net_id}] Failed to load persisted backlog: {e}")
        return {}

def save_backlog(net_id, backlog):
    try:
        os.makedirs(BACKLOG_DIR, exist_ok=True)
        path = _backlog_path(net_id)
        tmp = path + ".tmp"
        data = {ch: list(msgs) for ch, msgs in backlog.items()}
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f)
        os.replace(tmp, path)
    except Exception as e:
        log.warning(f"[{net_id}] Failed to persist backlog: {e}")

def send_push_notification(title, body, tag=None, url="/", channel=None, network=None):
    subs = load_push_subscriptions()
    if not subs:
        return

    settings = load_settings()
    vapid_cfg = settings.get("vapid", {})
    private_key = vapid_cfg.get("private_key")
    if not private_key:
        log.error("[push] No VAPID private key in settings")
        return

    vapid_sub = vapid_cfg.get("contact") or "mailto:admin@ircircuit.local"

    payload = {
        "title": title,
        "body": body,
        "tag": tag or "webirc-notification",
        "url": url,
        "channel": channel,
        "network": network
    }

    payload_str = json.dumps(payload)

    async def do_send():
        loop = asyncio.get_running_loop()
        expired_endpoints = []
        for sub in subs:
            try:
                def run_push(s=sub):
                    return webpush(
                        subscription_info=s,
                        data=payload_str,
                        vapid_private_key=private_key,
                        vapid_claims={"sub": vapid_sub}
                    )
                await loop.run_in_executor(None, run_push)
            except WebPushException as ex:
                log.warning(f"[push] {sub.get('endpoint')}: {ex}")
                if ex.response is not None and ex.response.status_code in (404, 410):
                    expired_endpoints.append(sub.get("endpoint"))
            except Exception as e:
                log.error(f"[push] {sub.get('endpoint')}: {e}")

        if expired_endpoints:
            current_subs = load_push_subscriptions()
            filtered_subs = [s for s in current_subs if s.get("endpoint") not in expired_endpoints]
            save_push_subscriptions(filtered_subs)
            log.info(f"[push] Removed {len(expired_endpoints)} expired subscription(s)")

    try:
        asyncio.get_running_loop().create_task(do_send())
    except RuntimeError:
        asyncio.run(do_send())

_settings_cache = {"data": None, "ts": 0}

def load_settings():
    now = time.monotonic()
    if _settings_cache["data"] and (now - _settings_cache["ts"]) < BNC_CACHE_TTL:
        return _settings_cache["data"]

    sf = get_settings_file()
    if os.path.exists(sf):
        try:
            with open(sf, encoding="utf-8") as f:
                data = json.load(f)
        except (json.JSONDecodeError, OSError) as e:
            log.error(f"Failed to load settings from {sf}: {e}")
            data = {"networks": [], "identity": {"nick": "WebUser", "username": "webuser", "realname": "Web IRC Client"}}
    else:
        data = {"networks": [], "identity": {"nick": "WebUser", "username": "webuser", "realname": "Web IRC Client"}}

    if "vapid" not in data or not data["vapid"].get("public_key") or not data["vapid"].get("private_key") or not data["vapid"].get("public_key_raw"):
        try:
            v = Vapid()
            v.generate_keys()
            raw_pub = v.public_key.public_bytes(Encoding.X962, PublicFormat.UncompressedPoint)
            data["vapid"] = {
                "public_key": v.public_pem().decode("utf-8"),
                "private_key": v.private_pem().decode("utf-8"),
                "public_key_raw": base64.urlsafe_b64encode(raw_pub).decode("utf-8").rstrip("=")
            }
            tmp = sf + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)
            os.replace(tmp, sf)
            log.info("[push] Generated VAPID keys")
        except Exception as e:
            log.error(f"[push] Failed to generate VAPID keys: {e}")

    _settings_cache["data"] = data
    _settings_cache["ts"] = now
    return data

def bnc_cfg():
    settings = load_settings()
    b = settings.get("bouncer", {})
    return {
        "reconnect":      b.get("reconnect", True),
        "reconnectBase":  b.get("reconnectBase", DEFAULTS["reconnectBase"]),
        "reconnectMax":   b.get("reconnectMax", DEFAULTS["reconnectMax"]),
        "flood":          b.get("flood", True),
        "floodRate":      b.get("floodRate", DEFAULTS["floodRate"]),
        "floodBurst":     b.get("floodBurst", DEFAULTS["floodBurst"]),
        "ping":           b.get("ping", True),
        "pingInterval":   b.get("pingInterval", DEFAULTS["pingInterval"]),
        "pongTimeout":    b.get("pongTimeout", DEFAULTS["pongTimeout"]),
        "connectTimeout": b.get("connectTimeout", DEFAULTS["connectTimeout"]),
    }

_HASH_PREFIX = "pbkdf2sha256"
_HASH_ITERS  = 260_000

def _is_local_bind_host(host: str) -> bool:
    h = (host or "").strip().lower()
    return h in ("127.0.0.1", "localhost", "::1")

def _hash_password(plaintext: str) -> str:
    salt = secrets.token_bytes(16)
    dk   = hashlib.pbkdf2_hmac("sha256", plaintext.encode(), salt, _HASH_ITERS)
    return f"{_HASH_PREFIX}:{_HASH_ITERS}:{base64.b64encode(salt).decode()}:{base64.b64encode(dk).decode()}"

def _verify_password(plaintext: str, stored: str) -> bool:
    if not stored:
        return False
    if not stored.startswith(_HASH_PREFIX + ":"):

        return hmac.compare_digest(plaintext, stored)
    try:
        _, iters, b64salt, b64dk = stored.split(":", 3)
        salt  = base64.b64decode(b64salt)
        dk    = base64.b64decode(b64dk)
        check = hashlib.pbkdf2_hmac("sha256", plaintext.encode(), salt, int(iters))
        return hmac.compare_digest(check, dk)
    except Exception:
        return False

def save_settings(data):
    sf = get_settings_file()
    tmp = sf + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    os.replace(tmp, sf)

def _scrub_settings(settings):
    import copy
    s = copy.deepcopy(settings)

    if isinstance(s.get("auth"), dict):
        s["auth"]["password"] = ""

    for net in s.get("networks", []):
        if isinstance(net.get("sasl"), dict):
            net["sasl"]["password"] = ""

    if isinstance(s.get("vapid"), dict):
        s["vapid"]["private_key"] = ""
    return s

_auth_failures: dict = {}
_AUTH_MAX_ATTEMPTS = 5
_AUTH_WINDOW_SECS  = 60
_AUTH_MAX_IPS      = 10_000

def _auth_rate_ok(ip: str) -> bool:
    now = time.time()
    attempts = [t for t in _auth_failures.get(ip, []) if now - t < _AUTH_WINDOW_SECS]

    if attempts:
        _auth_failures[ip] = attempts
    else:
        _auth_failures.pop(ip, None)
    return len(attempts) < _AUTH_MAX_ATTEMPTS

def _record_auth_failure(ip: str) -> None:

    if len(_auth_failures) >= _AUTH_MAX_IPS and ip not in _auth_failures:
        oldest = next(iter(_auth_failures))
        del _auth_failures[oldest]
    _auth_failures.setdefault(ip, []).append(time.time())

_LOG_LINE_RE    = re.compile(r'^\[(\d{2}:\d{2}:\d{2})\] (.+)$')
_LOG_PRIVMSG_RE = re.compile(r'^<([^>]+)> (.*)$')
_LOG_ACTION_RE  = re.compile(r'^\* (\S+)(?: (.*))?$')
_LOG_NOTICE_RE  = re.compile(r'^-(\S+?)- (.*)$')

def _fmt_log_line(time_str, nick, message, msg_type):
    t = time_str[11:19]
    if msg_type in ('privmsg', 'message'):
        return f"[{t}] <{nick}> {message}"
    elif msg_type == 'action':
        return f"[{t}] * {nick} {message}"
    elif msg_type == 'notice':
        return f"[{t}] -{nick}- {message}"
    else:

        return f"[{t}] {nick} {message}"

def _net_log_name(nid):
    conn = networks.get(nid)
    name = conn.name if conn else nid
    return name.replace("/", "_").replace("\\", "_").replace(" ", "_")

def _parse_log_line(line, date_str):
    line = line.rstrip('\r\n')
    if not line:
        return None

    if line.startswith('{'):
        try:
            return json.loads(line)
        except json.JSONDecodeError:
            return None
    m = _LOG_LINE_RE.match(line)
    if not m:
        return None
    time_s, rest = m.group(1), m.group(2)
    time_full = f"{date_str} {time_s}"
    try:

        fmt = "%d-%m-%Y %H:%M:%S" if len(date_str) == 10 and date_str[2] == '-' else "%Y-%m-%d %H:%M:%S"
        dt = datetime.strptime(time_full, fmt)
        ts = dt.timestamp()
    except ValueError:
        ts = 0.0
    pm = _LOG_PRIVMSG_RE.match(rest)
    if pm:
        return {"type": "privmsg", "nick": pm.group(1), "text": pm.group(2), "ts": ts, "time": time_full}
    am = _LOG_ACTION_RE.match(rest)
    if am:
        return {"type": "action",  "nick": am.group(1), "text": am.group(2) or "", "ts": ts, "time": time_full}
    nm = _LOG_NOTICE_RE.match(rest)
    if nm:
        return {"type": "notice",  "nick": nm.group(1), "text": nm.group(2), "ts": ts, "time": time_full}
    return {"type": "status", "nick": "", "text": rest, "ts": ts, "time": time_full}

def _get_log_index(log_path):
    idx_path = log_path + ".idx"
    try:
        if (os.path.exists(idx_path) and os.path.exists(log_path) and
                os.path.getmtime(idx_path) >= os.path.getmtime(log_path)):
            with open(idx_path, "r", encoding="utf-8") as f:
                return [int(l) for l in f if l.strip()]
    except (ValueError, OSError):
        pass

    offsets = []
    try:
        with open(log_path, "rb") as f:
            while True:
                pos = f.tell()
                line = f.readline()
                if not line:
                    break
                if line.strip():
                    offsets.append(pos)
        with open(idx_path, "w", encoding="utf-8") as f:
            if offsets:
                f.write("\n".join(str(o) for o in offsets) + "\n")
    except OSError:
        pass
    return offsets

async def broadcast(msg, debug_only=False):

    authenticated_clients = [c for c in clients if getattr(c, "authenticated", False)]
    if debug_only:
        authenticated_clients = [c for c in authenticated_clients if getattr(c, "debug_mode", False)]

    if not authenticated_clients:
        return

    payload = msg if isinstance(msg, str) else json.dumps(msg)

    results = await asyncio.gather(*[c.send(payload) for c in authenticated_clients], return_exceptions=True)

    for c, exc in zip(authenticated_clients, results):
        if isinstance(exc, Exception):
            clients.discard(c)

_py_plugins      = {}
_py_metadata     = {}
_py_hook_print   = {}
_py_hook_command = {}
_py_hook_server  = {}
_py_hook_unload  = {}
_py_timers       = {}

class PluginStore:
    def __init__(self, plugin_name):
        self._path = os.path.join(ROOT_DIR, "data", "bouncer_plugins",
                                  f"{plugin_name}.store.json")
        self._data: dict = {}
        self._load()

    def _load(self):
        try:
            if os.path.exists(self._path):
                with open(self._path, 'r', encoding='utf-8') as f:
                    self._data = json.load(f)
        except Exception:
            self._data = {}

    def _save(self):
        try:
            with open(self._path, 'w', encoding='utf-8') as f:
                json.dump(self._data, f, ensure_ascii=False, indent=2)
        except Exception as e:
            log.warning(f"PluginStore save failed for {self._path}: {e}")

    def get(self, key, default=None):
        return self._data.get(key, default)

    def set(self, key, value):
        self._data[key] = value
        self._save()

    def delete(self, key):
        if key in self._data:
            del self._data[key]
            self._save()

    def keys(self):
        return list(self._data.keys())

    def all(self):
        return dict(self._data)

    def clear(self):
        self._data = {}
        self._save()

    def __contains__(self, key):        return key in self._data
    def __getitem__(self, key):         return self._data[key]
    def __setitem__(self, key, value):  self.set(key, value)
    def __delitem__(self, key):         self.delete(key)
    def __repr__(self):                 return f"PluginStore({self._data!r})"

class PluginAPI:

    EAT_NONE = 0
    EAT_ALL  = 2

    def __init__(self, plugin_name: str):
        self._name = plugin_name
        self.store = PluginStore(plugin_name)

    def hook_print(self, event: str, cb, userdata=None):
        _py_hook_print.setdefault(event, []).append((self._name, cb, userdata))

    def hook_command(self, cmd: str, cb, help: str = '', userdata=None):
        key = cmd.lower().lstrip('/')
        _py_hook_command.setdefault(key, []).append((self._name, cb, userdata))

    def hook_server(self, command: str, cb, userdata=None):
        _py_hook_server.setdefault(command.upper(), []).append((self._name, cb, userdata))

    def hook_timer(self, timeout_ms: int, cb, repeat: bool = True, userdata=None) -> dict:
        handle: dict = {'cancelled': False, 'task': None}
        delay = max(int(timeout_ms), 50) / 1000.0

        async def _run():
            while not handle['cancelled']:
                await asyncio.sleep(delay)
                if handle['cancelled']:
                    break
                try:
                    if asyncio.iscoroutinefunction(cb):
                        res = await cb(userdata)
                    else:
                        res = cb(userdata)
                    if res == PluginAPI.EAT_ALL or not repeat:
                        break
                except Exception as exc:
                    _plugin_error(self._name, f"hook_timer: {exc}")
                    break
            handle['cancelled'] = True

        task = asyncio.create_task(_run())
        handle['task'] = task
        _py_timers.setdefault(self._name, []).append(task)
        return handle

    def hook_unload(self, cb):
        _py_hook_unload.setdefault(self._name, []).append(cb)

    def unhook(self, handle: dict):
        handle['cancelled'] = True
        task = handle.get('task')
        if task and not task.done():
            task.cancel()

    def prnt(self, text: str, network=None, channel=None):
        payload: dict = {"type": "server_log", "message": str(text),
                         "verbose": False, "ts": time.time()}
        if network:  payload["network"] = network
        if channel:  payload["channel"] = channel
        asyncio.create_task(broadcast(payload))

    def emit(self, event_type: str, data=None):
        asyncio.create_task(broadcast({
            "type": "plugin_event", "event_type": str(event_type),
            "plugin": self._name, "data": data or {}, "ts": time.time(),
        }))

    def notify(self, title: str, body: str = '', network=None, channel=None):
        asyncio.create_task(broadcast({
            "type": "plugin_notify", "title": str(title), "body": str(body),
            "network": network, "channel": channel,
            "plugin": self._name, "ts": time.time(),
        }))

    def log(self, *args, level: str = 'info'):
        msg = ' '.join(str(a) for a in args)
        getattr(log, level, log.info)(f"[Plugin:{self._name}] {msg}")

    def command(self, network_id: str, raw_line: str):
        conn = networks.get(network_id)
        if conn: conn.send(raw_line)

    def send_msg(self, network_id: str, target: str, text: str):
        conn = networks.get(network_id)
        if conn: conn.send(f"PRIVMSG {target} :{text}")

    def send_notice(self, network_id: str, target: str, text: str):
        conn = networks.get(network_id)
        if conn: conn.send(f"NOTICE {target} :{text}")

    def kick(self, network_id: str, channel: str, nick: str, reason: str = ''):
        conn = networks.get(network_id)
        if conn: conn.send(f"KICK {channel} {nick} :{reason}" if reason
                           else f"KICK {channel} {nick}")

    def ban(self, network_id: str, channel: str, mask: str):
        conn = networks.get(network_id)
        if conn: conn.send(f"MODE {channel} +b {mask}")

    def kickban(self, network_id: str, channel: str, nick: str,
                mask: str, reason: str = ''):
        self.ban(network_id, channel, mask)
        self.kick(network_id, channel, nick, reason)

    def join(self, network_id: str, channel: str, key: str = ''):
        conn = networks.get(network_id)
        if conn: conn.send(f"JOIN {channel} {key}".strip())

    def part(self, network_id: str, channel: str, reason: str = ''):
        conn = networks.get(network_id)
        if conn: conn.send(f"PART {channel} :{reason}" if reason
                           else f"PART {channel}")

    def set_topic(self, network_id: str, channel: str, topic: str):
        conn = networks.get(network_id)
        if conn: conn.send(f"TOPIC {channel} :{topic}")

    def set_mode(self, network_id: str, target: str, modes: str):
        conn = networks.get(network_id)
        if conn: conn.send(f"MODE {target} {modes}")

    def whois(self, network_id: str, nick: str):
        conn = networks.get(network_id)
        if conn: conn.send(f"WHOIS {nick} {nick}")

    def get_networks(self) -> list:
        return list(networks.keys())

    def get_info(self, key: str, network_id: str = None):
        if not network_id:
            network_id = next(iter(networks.keys()), None)
        conn = networks.get(network_id)
        if not conn: return None
        return {'nick': conn.nick, 'name': conn.name, 'server': conn.id,
                'network': conn.name, 'status': conn.status,
                'channels': list(conn.channels.keys())}.get(key)

    def get_channels(self, network_id: str) -> list:
        conn = networks.get(network_id)
        return list(conn.channels.keys()) if conn else []

    def get_nicks(self, network_id: str, channel: str) -> dict:
        conn = networks.get(network_id)
        return dict(conn.channels.get(channel, {})) if conn else {}

    def is_op(self, network_id: str, channel: str, nick: str) -> bool:
        pfx = self.get_nicks(network_id, channel).get(nick, '')
        return any(p in pfx for p in ('~', '&', '@'))

    def is_voiced(self, network_id: str, channel: str, nick: str) -> bool:
        pfx = self.get_nicks(network_id, channel).get(nick, '')
        return any(p in pfx for p in ('~', '&', '@', '%', '+'))

def _plugin_error(plugin_name: str, message: str):
    log.error(f"[Plugin:{plugin_name}] {message}")
    asyncio.create_task(broadcast({
        "type": "server_log",
        "message": f"\x02[Plugin Error: {plugin_name}]\x02 {message}",
        "verbose": False, "ts": time.time(),
    }))

def _clear_plugin_hooks(name: str):

    for d in (_py_hook_print, _py_hook_command, _py_hook_server):
        for key in list(d.keys()):
            d[key] = [e for e in d[key] if e[0] != name]

    _py_hook_unload.pop(name, None)
    for task in _py_timers.pop(name, []):
        if not task.done():
            task.cancel()

def load_py_plugin(name: str) -> bool:
    plugin_dir = os.path.join(ROOT_DIR, "data", "bouncer_plugins")
    path = os.path.join(plugin_dir, f"{name}.py")
    if not os.path.exists(path):
        return False

    for cb in _py_hook_unload.get(name, []):
        try: cb()
        except Exception as e: log.error(f"[Plugin:{name}] unload hook: {e}")
    _clear_plugin_hooks(name)

    try:
        api  = PluginAPI(name)
        spec = importlib.util.spec_from_file_location(name, path)
        mod  = importlib.util.module_from_spec(spec)
        mod.webirc = api
        mod.irc    = api
        spec.loader.exec_module(mod)
        _py_plugins[name] = mod

        info = getattr(mod, '__plugin_info__', {}) or {}
        _py_metadata[name] = {
            "name":        info.get("name", name),
            "description": info.get("description", ""),
            "author":      info.get("author", ""),
            "version":     info.get("version", ""),
            "type":        "python",
        }
        log.info(f"Loaded plugin: {name}")
        return True
    except Exception as e:
        _plugin_error(name, f"Load error: {e}")
        return False

def unload_py_plugin(name: str):
    if name not in _py_plugins:
        return
    for cb in _py_hook_unload.get(name, []):
        try: cb()
        except Exception as e: log.error(f"[Plugin:{name}] unload hook: {e}")
    _clear_plugin_hooks(name)
    del _py_plugins[name]
    _py_metadata.pop(name, None)
    log.info(f"Unloaded plugin: {name}")

def init_py_plugins():
    plugin_dir = os.path.join(ROOT_DIR, "data", "bouncer_plugins")
    os.makedirs(plugin_dir, exist_ok=True)
    s = load_settings()
    plugins_cfg = s.get("plugins", {})

    enabled    = plugins_cfg.get("enabled", [])
    py_enabled = plugins_cfg.get("py_enabled", [])
    if py_enabled:
        enabled = list(set(enabled + py_enabled))
        s["plugins"]["enabled"] = enabled
        s["plugins"].pop("py_enabled", None)
        save_settings(s)
        _settings_cache["data"] = None
    for name in enabled:
        load_py_plugin(name)

def _plugin_list_payload(plugin_dir: str, enabled: list) -> list:
    py_names = sorted(f[:-3] for f in os.listdir(plugin_dir) if f.endswith(".py"))
    js_names = sorted(f[:-3] for f in os.listdir(plugin_dir) if f.endswith(".js"))
    plugins = []
    for name in py_names:
        meta = _py_metadata.get(name, {})
        plugins.append({"name": name, "type": "python",
                        "display": meta.get("name", name),
                        "description": meta.get("description", ""),
                        "author": meta.get("author", ""),
                        "version": meta.get("version", ""),
                        "enabled": name in enabled})
    for name in js_names:
        plugins.append({"name": name, "type": "js",
                        "display": name, "description": "", "author": "", "version": "",
                        "enabled": name in enabled})
    return plugins

async def _js_plugins_for_client(enabled: list) -> list:
    plugin_dir = os.path.join(ROOT_DIR, "data", "bouncer_plugins")
    result = []
    for name in enabled:
        path = os.path.join(plugin_dir, f"{name}.js")
        if os.path.exists(path):
            try:
                with open(path, 'r', encoding='utf-8') as f:
                    result.append({"name": name, "code": f.read()})
            except Exception:
                pass
    return result

async def fire_py_print(event: str, word: list) -> bool:
    listeners = list(_py_hook_print.get(event, []))
    word_eol  = [' '.join(word[i:]) for i in range(len(word))]
    for plugin_name, cb, ud in listeners:
        try:
            res = await cb(word, word_eol, ud) if asyncio.iscoroutinefunction(cb) \
                  else cb(word, word_eol, ud)
            if res == EAT_ALL: return True
        except Exception as e:
            _plugin_error(plugin_name, f"hook_print({event}): {e}")
    return False

async def fire_py_server(cmd: str, word: list) -> bool:
    listeners = list(_py_hook_server.get(cmd.upper(), []))
    if not listeners: return False
    word_eol = [' '.join(word[i:]) for i in range(len(word))]
    for plugin_name, cb, ud in listeners:
        try:
            res = await cb(word, word_eol, ud) if asyncio.iscoroutinefunction(cb) \
                  else cb(word, word_eol, ud)
            if res == EAT_ALL: return True
        except Exception as e:
            _plugin_error(plugin_name, f"hook_server({cmd}): {e}")
    return False

async def fire_py_command(cmd: str, word: list) -> bool:
    listeners = list(_py_hook_command.get(cmd.lower(), []))
    if not listeners: return False
    word_eol = [' '.join(word[i:]) for i in range(len(word))]
    for plugin_name, cb, ud in listeners:
        try:
            res = await cb(word, word_eol, ud) if asyncio.iscoroutinefunction(cb) \
                  else cb(word, word_eol, ud)
            if res == EAT_ALL: return True
        except Exception as e:
            _plugin_error(plugin_name, f"hook_command({cmd}): {e}")
    return False

class NetworkConnection:
    def __init__(self, config):
        self.config = config
        self.id = config["id"]
        self.name = config.get("name", self.id)
        self.nick = config.get("nick", "WebUser")
        self.username = config.get("username", "webuser")
        self.realname = config.get("realname", "Web IRC Client")
        self.channels = {}
        self._names_temp = {}
        self.away = set()
        self._who_away_temp = {}
        self.bots = set()
        self._who_bots_temp = {}
        self.status = "disconnected"
        self.reader = None
        self.writer = None
        self._registered = False
        self._cap_negotiating = False
        self.capabilities = set()
        self._max_backlog = load_settings().get("bouncer", {}).get("backlogSize", 200)
        self.backlog = collections.defaultdict(lambda: collections.deque(maxlen=self._max_backlog))

        for ch, msgs in load_backlog(self.id, self._max_backlog).items():
            dq = collections.deque(msgs, maxlen=self._max_backlog)
            self.backlog[ch] = dq

        try:
            imported = store.migrate_backlog_json(self.id, {ch: list(dq) for ch, dq in self.backlog.items()})
            if imported:
                log.info(f"[{self.id}] Migrated {imported} legacy backlog messages into the SQLite store")
        except Exception as e:
            log.warning(f"[{self.id}] Backlog->SQLite migration failed: {e}")

        self._chathistory_batches = {}
        self._chathistory_waiters = {}

        self._send_queue = asyncio.Queue(maxsize=1000)
        self._connect_task = None
        self._send_task = None
        self._ping_task = None
        self._reconnect_task = None
        self._backlog_flush_task = None
        self._backlog_dirty = False
        self._intentional_quit = False
        self._cap_timer = None
        self._cap_offered = set()
        self._list_buf = []
        self._whois_temp = {}
        self._last_msg = {}
        self._ban_temp = {}
        self._invite_temp = {}
        self._except_temp = {}
        self._isupport = {}
        self._whowas_pending = set()
        self._chan_modes = {}
        self._current_ssl = False
        self.latency_ms = None
        self._ping_sent_at = 0.0
        self._desired_nick = ''
        self._nick_retries = 0
        self._pending_local_echo = collections.defaultdict(list)
        self._recent_local_echo = {}

        bc = bnc_cfg()
        self._tokens = bc.get("floodBurst", DEFAULTS["floodBurst"])
        self._last_token_ts = time.monotonic()
        self._last_pong = time.monotonic()
        self._reconnect_delay = bc.get("reconnectBase", DEFAULTS["reconnectBase"])

    def check_highlight(self, text):
        import re
        own_nick = self.nick
        if own_nick:
            if re.search(r'(?<![a-zA-Z0-9_\-])' + re.escape(own_nick) + r'(?![a-zA-Z0-9_\-])',
                         text, re.IGNORECASE):
                return True
        settings = load_settings()
        highlight_words = settings.get("highlightWords", [])
        for w in highlight_words:
            if w and w.lower() in text.lower():
                return True
        return False

    def _sasl_mechanism(self):
        sasl = self.config.get("sasl", {})
        return str(sasl.get("mechanism", "PLAIN")).strip().upper()

    def _is_me(self, other):
        return bool(other) and other.lower() == (self.nick or "").lower()

    def _resolve_channel_key(self, channel):
        if channel in self.channels or channel in self._names_temp:
            return channel
        low = (channel or "").lower()
        for k in list(self.channels) + list(self._names_temp):
            if k.lower() == low:
                return k
        return channel

    def _add_backlog(self, channel, msg):
        self.backlog[channel].append(msg)
        self._backlog_dirty = True
        try:
            store.insert_message(self.id, channel, msg, ts=msg.get("ts") or time.time())
        except Exception as e:
            log.warning(f"[{self.id}] Failed to persist message to store: {e}")

    _LOG_MAX_BYTES = 10 * 1024 * 1024

    def _log_to_file(self, channel, nick, message, type='message'):
        if not self.config.get("logging"):
            return

        exclude = [c.lower() for c in self.config.get("logExcludeChannels", [])]
        if channel.lower() in exclude:
            return

        safe_net  = self.name.replace("/", "_").replace("\\", "_").replace(" ", "_")
        safe_chan  = channel.replace("/", "_").replace("\\", "_")
        base_logs = os.path.abspath(IRC_LOG_BASE)
        log_dir = os.path.realpath(os.path.join(base_logs, safe_net, safe_chan))

        if not log_dir.startswith(base_logs + os.sep):
            log.warning(f"[{self.id}] Rejected log path outside base: {log_dir}")
            return

        now = datetime.now()
        time_str = now.strftime("%Y-%m-%d %H:%M:%S")
        date_str = now.strftime("%d-%m-%Y")
        line_bytes = (_fmt_log_line(time_str, nick, message, type) + "\n").encode("utf-8")
        max_bytes = self._LOG_MAX_BYTES

        def _write():
            try:
                os.makedirs(log_dir, exist_ok=True)

                base_name = f"{date_str}.log"
                file_path = os.path.join(log_dir, base_name)
                suffix = 0
                while os.path.exists(file_path) and os.path.getsize(file_path) >= max_bytes:
                    suffix += 1
                    file_path = os.path.join(log_dir, f"{date_str}.{suffix}.log")
                offset = os.path.getsize(file_path) if os.path.exists(file_path) else 0
                with open(file_path, "ab") as f:
                    f.write(line_bytes)
                idx_path = file_path + ".idx"
                with open(idx_path, "a", encoding="utf-8") as f:
                    f.write(f"{offset}\n")
            except OSError as e:
                log.warning(f"[{self.id}] Log write failed for {log_dir}: {e}")

        asyncio.get_running_loop().run_in_executor(None, _write)

    async def emit_log(self, message, verbose=False, is_whois=False, whois_nick=None,
                       whois_data=None, channel=None, is_whowas=False):
        payload = {
            "type": "server_log",
            "network": self.id,
            "message": message,
            "verbose": verbose,
            "is_whois": is_whois,
            "whois_nick": whois_nick,
            "ts": time.time()
        }
        if whois_data is not None:
            payload["whois_data"] = whois_data
        if channel is not None:
            payload["channel"] = channel
        if is_whowas:
            payload["is_whowas"] = True
        await broadcast(payload)

    async def connect(self):
        if not self.config.get("servers"):
            log.error(f"[{self.id}] No servers configured")
            await self.emit_log("* Error: No servers configured for this network.")
            return

        self.status = "connecting"
        self._intentional_quit = False

        self.nick = self.config.get("nick", "WebUser")
        self._desired_nick = self.nick
        self._nick_retries = 0
        bc = bnc_cfg()

        if self._reconnect_task and not self._reconnect_task.done():
            self._reconnect_task.cancel()
            self._reconnect_task = None

        await self._emit_status()
        last_error = "Unknown error"

        try:
            for server in self.config["servers"]:
                host, port = server["host"], server.get("port", 6667)
                use_ssl = server.get("ssl", False)
                sasl_cfg = self.config.get("sasl", {})
                sasl_mech = self._sasl_mechanism()

                ssl_ctx = None
                if use_ssl:
                    ssl_ctx = ssl.create_default_context()
                    if not server.get("verify_ssl", True):
                        ssl_ctx.check_hostname = False
                        ssl_ctx.verify_mode = ssl.CERT_NONE

                    if sasl_cfg.get("enabled") and sasl_mech == "EXTERNAL":
                        cert_path = sasl_cfg.get("cert", "")
                        key_path = sasl_cfg.get("key", "")
                        if not cert_path:
                            last_error = "SASL EXTERNAL requires a client certificate"
                            await self.emit_log(f"* {last_error}")
                            continue
                        try:
                            ssl_ctx.load_cert_chain(certfile=cert_path, keyfile=key_path or None)
                        except Exception as e:
                            last_error = f"SASL EXTERNAL failed to load client certificate: {e}"
                            log.error(f"[{self.id}] {last_error}")
                            await self.emit_log(f"* {last_error}")
                            continue
                elif sasl_cfg.get("enabled") and sasl_mech == "EXTERNAL":
                    last_error = "SASL EXTERNAL requires SSL/TLS"
                    await self.emit_log(f"* {last_error}")
                    continue

                await self.emit_log(f"* Connecting to {host}:{port} ({'SSL' if use_ssl else 'plain'})...")

                try:
                    self.reader, self.writer = await asyncio.wait_for(
                        asyncio.open_connection(host, port, ssl=ssl_ctx),
                        timeout=bc["connectTimeout"]
                    )
                    self._current_ssl = use_ssl
                    log.info(f"[{self.id}] Connected to {host}:{port} ssl={use_ssl}")
                    await self.emit_log(f"* Connected. Logging in as {self.nick}...")

                    self._send_task = asyncio.create_task(self._send_loop())
                    self.status = "connected"
                    self._cap_negotiating = True

                    if self._cap_timer: self._cap_timer.cancel()
                    async def cap_timeout():
                        await asyncio.sleep(10)
                        if self._cap_negotiating:
                            log.warning(f"[{self.id}] CAP negotiation timed out")
                            await self.emit_log("* CAP negotiation timed out; proceeding.")
                            self._cap_negotiating = False
                            self._queue("CAP END")
                    self._cap_timer = asyncio.create_task(cap_timeout())

                    self._queue("CAP LS 302")
                    self._queue(f"NICK {self.nick}")
                    self._queue(f"USER {self.username} 0 * :{self.realname}")

                    await self._read_loop()
                    return
                except asyncio.TimeoutError:
                    last_error = f"Connection timed out after {bc['connectTimeout']}s"
                    await self.emit_log(f"* {last_error}")
                except Exception as e:
                    last_error = str(e)
                    await self.emit_log(f"* Connection error: {e}")

            self.status = "error"
            await self.emit_log(f"* Error: All connection attempts failed. Last error: {last_error}")

        except asyncio.CancelledError:
            pass
        finally:
            await self._cleanup()
            await self._emit_status()

            rc = bnc_cfg()
            if not self._intentional_quit and self.config.get("mode", "direct") == "bouncer" and rc.get("reconnect", True):
                delay = self._reconnect_delay
                self._reconnect_delay = min(self._reconnect_delay * 2, rc.get("reconnectMax", DEFAULTS["reconnectMax"]))
                await self.emit_log(f"* Reconnecting in {delay}s...")
                if self._reconnect_task and not self._reconnect_task.done():
                    self._reconnect_task.cancel()
                self._reconnect_task = asyncio.create_task(self._reconnect(delay))

    async def _reconnect(self, delay):
        try:
            for remaining in range(delay, 0, -1):
                await broadcast({
                    "type": "reconnect_countdown",
                    "network": self.id,
                    "name": self.name,
                    "seconds": remaining,
                })
                await asyncio.sleep(1)
            await self.connect()
        except asyncio.CancelledError:
            pass

    async def _cleanup(self):
        if self.status == "disconnected" and self.reader is None and self.writer is None:
            return
        current = asyncio.current_task()
        for task_attr in ('_connect_task', '_send_task', '_ping_task', '_backlog_flush_task', '_reconnect_task', '_cap_timer'):
            task = getattr(self, task_attr)
            if task and task != current and not task.done():
                task.cancel()
                try:
                    await task
                except (asyncio.CancelledError, Exception):
                    pass
            setattr(self, task_attr, None)

        if self.writer and not self.writer.is_closing():
            try:
                self.writer.close()

                await asyncio.wait_for(self.writer.wait_closed(), timeout=2.0)
            except (asyncio.TimeoutError, Exception):
                pass
        self.writer = None
        self.reader = None
        self.status = "disconnected"
        self.channels = {}
        self._names_temp = {}
        self._list_buf = []
        self._ban_temp = {}
        self._invite_temp = {}
        self._except_temp = {}
        self._whowas_pending = set()
        self._chan_modes = {}
        self._cap_offered = set()
        self._cap_negotiating = False
        self._registered = False
        for key, tasks in list(self._pending_local_echo.items()):
            for task in tasks:
                if task and not task.done():
                    task.cancel()
        self._pending_local_echo.clear()
        self._recent_local_echo.clear()
        self.away = set()
        self._who_away_temp = {}
        self.bots = set()
        self._who_bots_temp = {}
        await self.emit_log(f"* Disconnected from {self.name}.")
        await self._emit_status()

    async def disconnect(self):
        self._intentional_quit = True
        if self.writer and not self.writer.is_closing():
            try:
                self.writer.write(b"QUIT :Disconnecting\r\n")
                await self.writer.drain()
            except Exception:
                pass
        await self._cleanup()

    def _queue(self, line):
        try:
            self._send_queue.put_nowait(line)
        except asyncio.QueueFull:
            log.warning(f"[{self.id}] Send queue full — dropping line: {line[:80]!r}")

    async def _send_loop(self):
        try:
            bc = bnc_cfg()
            while True:
                line = await self._send_queue.get()

                if self._send_queue.empty():
                    bc = bnc_cfg()

                if bc["flood"]:
                    now = time.monotonic()
                    elapsed = now - self._last_token_ts
                    self._tokens = min(bc["floodBurst"], self._tokens + elapsed * bc["floodRate"])
                    self._last_token_ts = now

                    if self._tokens < 1:
                        await asyncio.sleep((1 - self._tokens) / bc["floodRate"])
                        self._tokens = 0
                        self._last_token_ts = time.monotonic()
                    else:
                        self._tokens -= 1

                if self.writer and not self.writer.is_closing():
                    try:
                        safe_line = line.replace('\r', '').replace('\n', '')
                        log.debug(f"[{self.id}] >> {safe_line}")
                        self.writer.write(f"{safe_line}\r\n".encode("utf-8"))
                        await asyncio.wait_for(self.writer.drain(), timeout=30)
                    except (OSError, ConnectionError, asyncio.TimeoutError):
                        log.warning(f"[{self.id}] Send failed — closing socket")
                        if self.writer and not self.writer.is_closing():
                            self.writer.close()
                        break
        except asyncio.CancelledError:
            pass
        except Exception as e:
            log.error(f"[{self.id}] Send loop error: {e}")

    def send(self, line):
        self._queue(line)

        if "echo-message" not in self.capabilities:
            try:
                p = parse_irc(line)
                if p:
                    cmd = p["command"]
                    tgt = p["target"]
                    msg_text = p["message"]
                    if cmd == "PRIVMSG":
                        if msg_text.startswith("\x01ACTION ") and msg_text.endswith("\x01"):
                            payload = {
                                "type": "action", "network": self.id, "channel": tgt,
                                "nick": self.nick, "message": msg_text[8:-1],
                                "self": True, "ts": time.time()
                            }
                        else:
                            payload = {
                                "type": "message", "network": self.id, "channel": tgt,
                                "nick": self.nick, "message": msg_text,
                                "self": True, "ts": time.time(), "tags": p.get("tags", {})
                            }
                        self._schedule_local_echo("PRIVMSG", tgt, msg_text, payload)
                    elif cmd == "NOTICE":
                        ch = tgt if (tgt.startswith("#") or tgt.startswith("&")) else "Status"
                        payload = {
                            "type": "notice", "network": self.id, "channel": ch,
                            "nick": self.nick, "message": msg_text, "ts": time.time()
                        }
                        self._schedule_local_echo("NOTICE", tgt, msg_text, payload)
            except Exception as e:
                log.error(f"Error in manual echo: {e}")

    def _echo_key(self, cmd: str, target: str, message: str) -> str:
        return f"{cmd}|{target}|{message}"

    def _prune_recent_local_echo(self):
        now = time.monotonic()
        stale = [k for k, ts in self._recent_local_echo.items() if now - ts > _LOCAL_ECHO_DEDUPE_SECS]
        for k in stale:
            self._recent_local_echo.pop(k, None)

    def _schedule_local_echo(self, cmd: str, target: str, message: str, payload: dict):
        key = self._echo_key(cmd, target, message)

        async def _emit_pending():
            try:
                await asyncio.sleep(_LOCAL_ECHO_DELAY_SECS)
                self._prune_recent_local_echo()
                self._recent_local_echo[key] = time.monotonic()

                p = dict(payload)
                channel = p.get("channel", target)
                if p.get("type") == "action":
                    self._log_to_file(channel, self.nick, p.get("message", ""), type='action')
                elif p.get("type") == "message":
                    self._log_to_file(channel, self.nick, p.get("message", ""), type='privmsg')
                elif p.get("type") == "notice":
                    self._log_to_file(channel, self.nick, p.get("message", ""), type='notice')

                self._add_backlog(channel, p)
                await broadcast(p)
            except asyncio.CancelledError:
                pass
            finally:
                tasks = self._pending_local_echo.get(key, [])
                cur = asyncio.current_task()
                if cur in tasks:
                    tasks.remove(cur)
                if not tasks:
                    self._pending_local_echo.pop(key, None)

        task = asyncio.create_task(_emit_pending())
        self._pending_local_echo[key].append(task)

    def _cancel_pending_local_echo(self, cmd: str, target: str, message: str) -> bool:
        key = self._echo_key(cmd, target, message)
        tasks = self._pending_local_echo.get(key, [])
        if tasks:
            task = tasks.pop(0)
            if task and not task.done():
                task.cancel()
            if not tasks:
                self._pending_local_echo.pop(key, None)
            return True
        return False

    def _should_drop_as_recent_local_echo(self, cmd: str, target: str, message: str) -> bool:
        key = self._echo_key(cmd, target, message)
        ts = self._recent_local_echo.get(key)
        if ts is None:
            return False
        if (time.monotonic() - ts) <= _LOCAL_ECHO_DEDUPE_SECS:
            self._recent_local_echo.pop(key, None)
            return True
        self._recent_local_echo.pop(key, None)
        return False

    async def _keepalive_loop(self):
        try:
            while True:
                bc = bnc_cfg()
                if not bc["ping"]:
                    await asyncio.sleep(60)
                    continue

                await asyncio.sleep(bc["pingInterval"])
                if time.monotonic() - self._last_pong > bc["pongTimeout"]:
                    log.warning(f"[{self.id}] PONG timeout")
                    await self.emit_log("* Connection timed out (no PONG received).")
                    if self.writer and not self.writer.is_closing():
                        self.writer.close()
                    return
                self._ping_sent_at = time.monotonic()
                self._queue(f"PING :{self.id}")
        except asyncio.CancelledError:
            pass

    async def _backlog_flush_loop(self):
        try:
            while True:
                await asyncio.sleep(60)
                if self._backlog_dirty:
                    save_backlog(self.id, self.backlog)
                    self._backlog_dirty = False
        except asyncio.CancelledError:
            pass

    async def _read_loop(self):
        try:
            while True:
                try:

                    data = await asyncio.wait_for(self.reader.readline(), timeout=300)
                except asyncio.TimeoutError:
                    log.warning(f"[{self.id}] Read stalled (no data for 5 min) — dropping")
                    await self.emit_log("* Read stalled — dropping connection.")
                    break
                if not data:
                    break
                raw = data.decode("utf-8", errors="replace").strip()
                if raw:
                    log.debug(f"[{self.id}] << {raw}")
                    await self._handle(raw)
        except Exception as e:
            log.error(f"[{self.id}] Read error: {e}")

    async def _fire_plugin_events(self, cmd, nick, target, message, raw):

        is_self = self._is_me(nick)
        is_dm = target and not target.startswith("#") and not target.startswith("&")
        event = None
        word = []

        if cmd == "PRIVMSG":
            if message.startswith("\x01ACTION ") and message.endswith("\x01"):
                event = "Your Action" if is_self else "Channel Action"
                word = [nick, message[8:-1], target, self.id]
            else:
                event = ("Your Private Message" if is_self else "Private Message") if is_dm else \
                        ("Your Message" if is_self else "Channel Message")
                word = [nick, message, target, self.id]
        elif cmd == "NOTICE":
            event = "Channel Notice"
            word = [nick, message, target, self.id]
        elif cmd == "JOIN":
            event = "Join"
            word = [nick, target, self.id]
        elif cmd == "PART":
            event = "Part"
            word = [nick, target, message, self.id]
        elif cmd == "QUIT":
            event = "Quit"
            word = [nick, message, self.id]
        elif cmd == "NICK":
            event = "Nick"
            word = [nick, target, self.id]
        elif cmd == "KICK":

            kick_raw = raw.split(None, 4)
            kicked = kick_raw[3] if len(kick_raw) > 3 else ""
            event = "Kick"
            word = [nick, kicked, target, message, self.id]
        elif cmd == "MODE":
            event = "Mode Change"
            word = [nick, message, target, self.id]
        elif cmd == "TOPIC":
            event = "Topic Change"
            word = ["", message, target, self.id]
        elif cmd == "INVITE":

            invite_raw = raw.split(None, 4)
            channel_name = message or (invite_raw[3].lstrip(':') if len(invite_raw) > 3 else "")
            event = "Invite"
            word = [nick, channel_name, self.id]

        if event:
            await fire_py_print(event, word)

    async def _finish_chathistory_batch(self, batch):
        target = batch["target"]
        records = []
        for tags, cmd, nick, ntarget, message in batch["lines"]:
            ts = time.time()
            if "time" in tags:
                try:
                    ts = datetime.fromisoformat(tags["time"].replace("Z", "+00:00")).timestamp()
                except ValueError:
                    pass
            is_self = self._is_me(nick)
            ch = nick if self._is_me(ntarget) else ntarget
            if cmd == "PRIVMSG":
                if message.startswith("\x01ACTION ") and message.endswith("\x01"):
                    m = {"type": "action", "network": self.id, "channel": ch, "nick": nick,
                         "message": message[8:-1], "self": is_self, "ts": ts}
                else:
                    m = {"type": "message", "network": self.id, "channel": ch, "nick": nick,
                         "message": message, "self": is_self, "ts": ts}
            else:
                m = {"type": "notice", "network": self.id, "channel": ch, "nick": nick,
                     "message": message, "ts": ts}
            records.append(m)

        records.sort(key=lambda r: r.get("ts", 0))

        key = target.lower()
        waiter = self._chathistory_waiters.get(key)
        if waiter and not waiter.done():

            for m in records:
                try:
                    store.insert_message(self.id, m["channel"], m, ts=m.get("ts") or time.time())
                except Exception as e:
                    log.warning(f"[{self.id}] Failed to persist history to store: {e}")
            waiter.set_result(records)
        else:

            for m in records:
                self._add_backlog(m["channel"], m)
            if records:
                await broadcast({"type": "history", "network": self.id, "channel": target, "messages": records})
        self._chathistory_waiters.pop(key, None)

    async def request_history(self, channel, before_ts, ws):
        messages = []
        if "draft/chathistory" in self.capabilities and self._registered:
            key = channel.lower()
            fut = self._chathistory_waiters.get(key)
            if fut is None or fut.done():
                fut = asyncio.get_event_loop().create_future()
                self._chathistory_waiters[key] = fut
                if before_ts:
                    ts_str = datetime.fromtimestamp(before_ts, tz=timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.%f')[:-3] + 'Z'
                    self._queue(f"CHATHISTORY BEFORE {channel} timestamp={ts_str} 100")
                else:
                    self._queue(f"CHATHISTORY LATEST {channel} * 100")
                try:
                    messages = await asyncio.wait_for(fut, timeout=8)
                except asyncio.TimeoutError:
                    self._chathistory_waiters.pop(key, None)
                    messages = []
        if not messages:
            messages = store.get_history_before(self.id, channel, before_ts, limit=100)
        try:
            await ws.send(json.dumps({"type": "history", "network": self.id, "channel": channel, "messages": messages}))
        except Exception:
            clients.discard(ws)

    async def _handle(self, raw):

        asyncio.create_task(broadcast({"type": "raw_traffic", "network": self.id, "line": raw, "ts": time.time()}, debug_only=True))

        parsed = parse_irc(raw)
        if not parsed:
            return

        cmd = parsed["command"]
        nick = parsed["nick"]
        target = parsed["target"]
        message = parsed["message"]
        tags = parsed.get("tags", {})

        batch_ref = tags.get("batch")
        if batch_ref and batch_ref in self._chathistory_batches and cmd in ("PRIVMSG", "NOTICE"):
            self._chathistory_batches[batch_ref]["lines"].append((tags, cmd, nick, target, message))
            return

        if cmd == "BATCH":
            bparams = parsed.get("params", [])
            if bparams:
                ref_token = bparams[0]
                if ref_token.startswith("+"):
                    ref = ref_token[1:]
                    btype = bparams[1] if len(bparams) > 1 else ""
                    if btype == "chathistory":
                        batch_target = bparams[2] if len(bparams) > 2 else ""
                        self._chathistory_batches[ref] = {"target": batch_target, "lines": []}
                elif ref_token.startswith("-"):
                    ref = ref_token[1:]
                    batch = self._chathistory_batches.pop(ref, None)
                    if batch is not None:
                        asyncio.create_task(self._finish_chathistory_batch(batch))
            return

        if cmd not in ('PING', 'PONG'):
            p_word = [nick, cmd] + parsed.get("params", [])
            if await fire_py_server(cmd, p_word):
                return

        asyncio.create_task(self._fire_plugin_events(cmd, nick, target, message, raw))

        if cmd == "PING":
            srv = message or target or self.id
            self._queue(f"PONG :{srv}")
            return

        if cmd == "PONG":
            now = time.monotonic()
            if self._ping_sent_at:
                self.latency_ms = int((now - self._ping_sent_at) * 1000)
                self._ping_sent_at = 0.0
                await self._emit_status()
            self._last_pong = now
            return

        msg_ts = time.time()
        if "time" in tags:
            try:

                ts_str = tags["time"].replace("Z", "+00:00")
                dt = datetime.fromisoformat(ts_str)
                msg_ts = dt.timestamp()
            except ValueError:
                pass

        if cmd == "PRIVMSG" and message.startswith("\x01") and message.endswith("\x01"):
            ctcp = message[1:-1].split(None, 1)
            if ctcp and ctcp[0].upper() != "ACTION":
                ctcp_cmd = ctcp[0].upper()
                ctcp_args = ctcp[1] if len(ctcp) > 1 else ""

                if ctcp_cmd == "VERSION":
                    self._queue(f"NOTICE {nick} :\x01VERSION IRCircuit  v0.1\x01")
                elif ctcp_cmd == "TIME":
                    self._queue(f"NOTICE {nick} :\x01TIME {time.ctime()}\x01")
                elif ctcp_cmd == "PING":
                    self._queue(f"NOTICE {nick} :\x01PING {ctcp_args}\x01")
                elif ctcp_cmd == "FINGER":
                    self._queue(f"NOTICE {nick} :\x01FINGER {self.realname}\x01")
                elif ctcp_cmd == "USERINFO":
                    self._queue(f"NOTICE {nick} :\x01USERINFO {self.realname}\x01")
                elif ctcp_cmd == "SOURCE":
                    self._queue(f"NOTICE {nick} :\x01SOURCE https://github.com/webirc\x01")

                _auto_handled = {"VERSION", "TIME", "PING", "FINGER", "USERINFO", "SOURCE"}
                if ctcp_cmd not in _auto_handled:
                    ch = nick if self._is_me(target) else target
                    disp = f"CTCP {ctcp_cmd} from {nick}" + (f": {ctcp_args}" if ctcp_args else "")
                    notice_m = {"type": "notice", "network": self.id, "channel": ch,
                                "nick": nick, "message": disp, "ts": msg_ts}
                    self._add_backlog(ch, notice_m)
                    await broadcast(notice_m)
                return

        if cmd == "CAP":
            parts = raw.split()
            sub = parts[3] if len(parts) > 3 else ""
            if sub == "LS":

                for cap in (message.split() if message else []):
                    self._cap_offered.add(cap)
                multi_line = len(parts) > 4 and parts[4] == "*"
                if not multi_line:

                    offered = self._cap_offered
                    self._cap_offered = set()
                    reqs = []
                    for cap in ("server-time", "message-tags", "echo-message",
                                "away-notify", "account-notify", "chghost",
                                "extended-join", "multi-prefix", "batch",
                                "draft/chathistory"):
                        if cap in offered:
                            reqs.append(cap)

                    sasl = self.config.get("sasl", {})
                    if sasl.get("enabled") and "sasl" in offered:
                        reqs.append("sasl")

                    if reqs:
                        self._queue(f"CAP REQ :{' '.join(reqs)}")
                    else:
                        self._cap_negotiating = False
                        self._queue("CAP END")

            elif sub == "ACK":
                acked = message.split() if message else []
                for cap in acked:
                    self.capabilities.add(cap.lstrip('-='))

                if "sasl" in acked:
                    mech = self._sasl_mechanism()
                    self._queue(f"AUTHENTICATE {mech}")
                else:
                    self._cap_negotiating = False
                    self._queue("CAP END")

            elif sub == "NAK":
                self._cap_negotiating = False
                self._queue("CAP END")

        elif cmd == "AUTHENTICATE":
            if target == "+" or message == "+":
                sasl = self.config.get("sasl", {})
                mech = self._sasl_mechanism()

                if mech == "EXTERNAL":

                    self._queue("AUTHENTICATE +")

                else:
                    u, p = sasl.get("username", ""), sasl.get("password", "")
                    if not u or not p:
                        log.error(f"[{self.id}] SASL enabled but username/password missing")
                        await self.emit_log("* SASL error: Username or password not configured.")
                        self._queue("CAP END")
                        return

                    auth_str = f"\0{u}\0{p}"
                    blob = base64.b64encode(auth_str.encode()).decode()
                    chunk_size = 400
                    if not blob:
                        self._queue("AUTHENTICATE +")
                    else:
                        for i in range(0, len(blob), chunk_size):
                            self._queue(f"AUTHENTICATE {blob[i:i+chunk_size]}")
                        if len(blob) % chunk_size == 0:
                            self._queue("AUTHENTICATE +")
            else:
                log.warning(f"[{self.id}] Received AUTHENTICATE {target} {message} (expected +)")

        elif cmd == "903":
            await self.emit_log("* SASL authentication successful.", verbose=True)
            self._cap_negotiating = False
            self._queue("CAP END")
        elif cmd in ("904", "905"):
            await self.emit_log("* SASL authentication failed.")
            await broadcast({"type": "notice", "network": self.id, "channel": "Status",
                             "nick": "SASL", "message": "SASL authentication failed. Check your username/password.", "ts": time.time()})
            self._cap_negotiating = False
            self._queue("CAP END")

        elif cmd == "001":
            self.status = "connected"
            self._registered = True
            self._reconnect_delay = bnc_cfg()["reconnectBase"]
            self._last_pong = time.monotonic()

            if self._ping_task and not self._ping_task.done():
                self._ping_task.cancel()
            self._ping_task = asyncio.create_task(self._keepalive_loop())
            if self._backlog_flush_task and not self._backlog_flush_task.done():
                self._backlog_flush_task.cancel()
            self._backlog_flush_task = asyncio.create_task(self._backlog_flush_loop())

            await self.emit_log(f"* {message}")
            await self._emit_status()

            if self._cap_timer:
                self._cap_timer.cancel()
                self._cap_timer = None

            perform = self.config.get("perform", [])
            if perform:
                await self.emit_log("* Executing perform commands...", verbose=True)
                for line in perform:
                    if line.strip():

                        cmd_line = line.strip().lstrip('/')
                        self._queue(cmd_line)

            chans = [c.strip() for c in self.config.get("channels", []) if c and c.strip()]
            plain = [c for c in chans if " " not in c]
            keyed = [c for c in chans if " " in c]
            for line in _pack_command_lines("JOIN", plain, sep=","):
                self._queue(line)
            for c in keyed:
                self._queue(f"JOIN {c}")

            watched = load_settings().get("watchedNicks", [])
            targets = [f"+{wn}" for wn in watched if wn]
            for line in _pack_command_lines("WATCH", targets, sep=" "):
                self._queue(line)

        elif cmd == "005":
            p5 = parsed.get("params", [])[1:]
            tokens = [t for t in p5 if not t.startswith(":")]
            for tok in tokens:
                if "=" in tok:
                    k, v = tok.split("=", 1)
                    self._isupport[k] = v
                elif tok.startswith("-"):
                    self._isupport.pop(tok[1:], None)
                else:
                    self._isupport[tok] = True
            if "NETWORK" in self._isupport and isinstance(self._isupport["NETWORK"], str):
                net_name = self._isupport["NETWORK"]
                if self.name == self.id:
                    self.name = net_name
                    await self._emit_status()
            await self.emit_log(f"* Supported: {' '.join(tokens)}", verbose=True)

        elif cmd == "433":
            if self._registered:

                bad = parsed.get("params", ["", ""])[1] if len(parsed.get("params", [])) > 1 else ""
                await self.emit_log(f"* Nickname {bad or 'requested'} is already in use.")
            elif self._nick_retries >= 8:
                await self.emit_log("* Nickname in use. Giving up after too many attempts.")
            else:
                self._nick_retries += 1
                self.nick += "_"
                await self.emit_log(f"* Nickname in use. Trying {self.nick}...")
                self._queue(f"NICK {self.nick}")
                await self._emit_status()

        elif cmd in ("372", "375"):
            m = {"type": "server_log", "network": self.id, "message": message,
                 "verbose": False, "ts": time.time()}
            self._add_backlog("Status", m)
            await broadcast(m)
        elif cmd == "376":
            await self.emit_log("* End of MOTD.", verbose=True)

        elif cmd == "TOPIC":
            channel = target
            self.channels.setdefault(channel, {})
            self._log_to_file(channel, nick, f"changed topic to: {message}", type='topic')
            m = {"type": "topic", "network": self.id, "channel": channel, "topic": message, "setter": nick}
            self._add_backlog(channel, m)
            await broadcast(m)

        elif cmd == "332":
            _p = parsed.get("params", [])
            channel = _p[1] if len(_p) > 1 else target
            self._log_to_file(channel, "Server", f"Topic for {channel} is: {message}", type='topic')
            await self.emit_log(f"* Topic for {channel} is: {message}", channel=channel)
            m = {"type": "topic", "network": self.id, "channel": channel, "topic": message}
            self._add_backlog(channel, m)
            await broadcast(m)

        elif cmd == "333":
            _p = parsed.get("params", [])
            if len(_p) > 3:
                channel = _p[1]
                setter = _p[2]
                try:
                    st = int(_p[3])
                    dt_str = datetime.fromtimestamp(st).strftime('%a %b %d %H:%M:%S %Y')
                except (ValueError, OSError):
                    dt_str = _p[3]
                await self.emit_log(f"* Topic for {channel} set by {setter} ({dt_str})", channel=channel)

        elif cmd == "353":
            # params: <me> [<symbol>] <channel>  :names  (symbol is optional on some ircds)
            _p = parsed.get("params", [])
            channel = _p[-1] if len(_p) >= 2 else target
            channel = self._resolve_channel_key(channel)

            if channel not in self._names_temp:
                self._names_temp[channel] = {}
            for n in message.split():
                full = n.lstrip("~&@%+!.*")
                prefixes = n[:len(n) - len(full)]
                # userhost-in-names: nick!user@host
                bare = full.split("!", 1)[0]
                if not bare:
                    continue
                self._names_temp[channel][bare] = prefixes + bare
        elif cmd == "366":
            _p = parsed.get("params", [])
            channel = _p[1] if len(_p) > 1 else target
            channel = self._resolve_channel_key(channel)

            if channel in self._names_temp:
                # Merge: keep ourselves even if the server omitted us from NAMES
                _new = self._names_temp.pop(channel)
                for _k, _v in self.channels.get(channel, {}).items():
                    if self._is_me(_k) and _k not in _new:
                        _new[_k] = _v
                self.channels[channel] = _new
            users = sorted(self.channels.get(channel, {}).values(), key=lambda n: n.lstrip("~&@%+!.*").lower())
            await broadcast({"type": "names", "network": self.id, "channel": channel, "users": users})

            if len(self.channels.get(channel, {})) <= 300:
                self._queue(f"WHO {channel}")

        elif cmd == "PRIVMSG":
            channel = nick if self._is_me(target) else target
            is_self = self._is_me(nick)

            if is_self:
                if not self._cancel_pending_local_echo("PRIVMSG", target, message):
                    if self._should_drop_as_recent_local_echo("PRIVMSG", target, message):
                        return

            if not is_self:
                nick_key = nick.lower()
                if len(self._last_msg) >= 5000 and nick_key not in self._last_msg:
                    try:
                        self._last_msg.pop(next(iter(self._last_msg)))
                    except StopIteration:
                        pass
                self._last_msg[nick_key] = msg_ts

            if message.startswith("\x01ACTION ") and message.endswith("\x01"):
                action_text = message[8:-1]
                self._log_to_file(channel, nick, action_text, type='action')
                m = {"type": "action", "network": self.id, "channel": channel,
                     "nick": nick, "message": action_text, "self": is_self, "ts": msg_ts,
                     "mask": parsed.get("mask", "")}
                self._add_backlog(channel, m)
                await broadcast(m)
            else:
                self._log_to_file(channel, nick, message, type='privmsg')
                m = {"type": "message", "network": self.id, "channel": channel,
                     "nick": nick, "message": message, "self": is_self, "ts": msg_ts,
                     "mask": parsed.get("mask", "")}
                self._add_backlog(channel, m)
                await broadcast(m)

            if not is_self:
                is_dm = not target.startswith(('#', '&'))
                msg_body = message
                if message.startswith("\x01ACTION ") and message.endswith("\x01"):
                    msg_body = message[8:-1]

                is_hl = self.check_highlight(msg_body)

                if is_hl:
                    is_action = message.startswith("\x01ACTION ") and message.endswith("\x01")
                    await add_highlight({
                        "network": self.id,
                        "channel": channel,
                        "nick": nick,
                        "text": msg_body,
                        "ts": msg_ts,
                        "type": "action" if is_action else "privmsg",
                    })

                if is_dm or is_hl:
                    authenticated_clients = [c for c in clients if getattr(c, "authenticated", False)]
                    if len(authenticated_clients) == 0:
                        notif_channel = nick if is_dm else target
                        notif_title = nick if is_dm else f"{nick} in {target}"
                        notif_title += f" ({self.name})"

                        notif_body = msg_body
                        if message.startswith("\x01ACTION ") and message.endswith("\x01"):
                            notif_body = f"* {nick} {msg_body}"

                        url = f"/#{self.id}/{notif_channel}"

                        send_push_notification(
                            title=notif_title,
                            body=notif_body,
                            tag=f"{self.id}/{notif_channel}",
                            url=url,
                            channel=notif_channel,
                            network=self.id
                        )
        elif cmd == "NOTICE":
            if self._is_me(nick):
                if not self._cancel_pending_local_echo("NOTICE", target, message):
                    if self._should_drop_as_recent_local_echo("NOTICE", target, message):
                        return

            if message.startswith("\x01") and message.endswith("\x01"):
                ctcp = message[1:-1].split(None, 1)
                ctcp_cmd = ctcp[0].upper() if ctcp else "UNKNOWN"
                ctcp_args = ctcp[1] if len(ctcp) > 1 else ""
                ch = nick if not target.startswith(("#", "&")) else target
                disp = f"CTCP {ctcp_cmd} reply from {nick}" + (f": {ctcp_args}" if ctcp_args else "")
                notice_m = {"type": "notice", "network": self.id, "channel": ch,
                            "nick": nick, "message": disp, "ts": msg_ts}
                self._add_backlog(ch, notice_m)
                await broadcast(notice_m)
                return
            ch = target if (target.startswith("#") or target.startswith("&")) else "Status"

            if not self._registered and not target.startswith(("#", "&")):
                await self.emit_log(f"* {message}")
            else:
                self._log_to_file(ch, nick, message, type='notice')
                m = {"type": "notice", "network": self.id, "channel": ch,
                     "nick": nick, "message": message, "ts": msg_ts,
                     "mask": parsed.get("mask", "")}
                self._add_backlog(ch, m)
                await broadcast(m)

        elif cmd == "JOIN":
            channel = target if (target.startswith("#") or target.startswith("&")) else message
            if self._is_me(nick):
                self.channels[channel] = {nick: nick}
                await self.emit_log(f"* Now talking on {channel}", channel=channel)
                await self._emit_status()

                self._queue(f"MODE {channel}")

                if "draft/chathistory" in self.capabilities and not self.backlog.get(channel):
                    self._queue(f"CHATHISTORY LATEST {channel} * 100")
            else:
                self.channels.setdefault(channel, {})[nick] = nick

            self._log_to_file(channel, nick, f"joined {channel}", type='join')
            m = {"type": "join", "network": self.id, "channel": channel, "nick": nick}
            self._add_backlog(channel, m)
            await broadcast(m)

        elif cmd == "PART":
            if self._is_me(nick):
                self.channels.pop(target, None)
                await self._emit_status()
            elif target in self.channels:
                self.channels[target].pop(nick, None)

            self._log_to_file(target, nick, f"left {target} {message if message else ''}", type='part')
            m = {"type": "part", "network": self.id, "channel": target,
                 "nick": nick, "message": message}
            self._add_backlog(target, m)
            await broadcast(m)

        elif cmd == "QUIT":
            common_channels = []
            for ch, ch_users in self.channels.items():
                if nick in ch_users:
                    common_channels.append(ch)
                    ch_users.pop(nick, None)
                    self._log_to_file(ch, nick, f"quit {message if message else ''}", type='quit')

            quit_msg = {"type": "quit", "network": self.id, "nick": nick, "message": message, "channels": common_channels}
            for ch in common_channels:

                self._add_backlog(ch, dict(quit_msg))
            await broadcast(quit_msg)

            if (nick.lower() == (self._desired_nick or "").lower()
                    and self.nick.lower() != (self._desired_nick or "").lower() and self._registered):
                self._queue(f"NICK {self._desired_nick}")
            self.away.discard(nick)

        elif cmd == "NICK":
            new_nick = message or target
            was_away = nick in self.away
            if self._is_me(nick):
                self.nick = new_nick
                await self._emit_status()
            common_channels = []
            for ch, ch_users in self.channels.items():
                if nick in ch_users:
                    common_channels.append(ch)

                    old_prefixed = ch_users.pop(nick)
                    if new_nick:

                        if nick and len(old_prefixed) >= len(nick) and old_prefixed.endswith(nick):
                            pfx = old_prefixed[:-len(nick)]
                        else:
                            pfx = ''
                        ch_users[new_nick] = pfx + new_nick
                    self._log_to_file(ch, nick, f"is now known as {new_nick}", type='nick')
            m = {"type": "nick_change", "network": self.id,
                             "old_nick": nick, "new_nick": new_nick, "channels": common_channels}
            for ch in common_channels:

                self._add_backlog(ch, dict(m))
            await broadcast(m)

            if was_away:
                self.away.discard(nick)
                self.away.add(new_nick)

        elif cmd == "KICK":
            parts = raw.split(None, 4)
            channel = parts[2] if len(parts) > 2 else target
            kicked = parts[3] if len(parts) > 3 else ""
            if channel in self.channels:
                self.channels[channel].pop(kicked, None)
            if self._is_me(kicked):
                self.channels.pop(channel, None)
                await self._emit_status()
                if self.config.get("autoRejoin"):
                    delay = float(self.config.get("autoRejoinDelay", 3))
                    async def _rejoin(_ch=channel):
                        await asyncio.sleep(delay)
                        if self._registered:
                            self._queue(f"JOIN {_ch}")
                    asyncio.create_task(_rejoin())
            self._log_to_file(channel, nick, f"kicked {kicked} {message if message else ''}", type='kick')
            m = {"type": "kick", "network": self.id, "channel": channel,
                 "nick": nick, "kicked": kicked, "message": message}
            self._add_backlog(channel, m)
            await broadcast(m)

        elif cmd == "MODE":

            mode_parts = parsed["params"][1:]
            if message:
                mode_parts = mode_parts + [message]
            full_mode = " ".join(mode_parts)
            if target.startswith("#") and full_mode:
                parts = full_mode.split()
                if parts:
                    mode_str = parts[0]
                    mode_args = parts[1:]
                    add = True
                    mode_to_prefix = {"o": "@", "v": "+", "h": "%", "a": "&", "q": "~"}

                    non_pfx_arg = frozenset("beIk")
                    arg_idx = 0
                    for mc in mode_str:
                        if mc == "+": add = True
                        elif mc == "-": add = False
                        elif mc in mode_to_prefix:
                            if arg_idx < len(mode_args):
                                pfx = mode_to_prefix[mc]
                                tn = mode_args[arg_idx]
                                arg_idx += 1
                                if target in self.channels and tn in self.channels[target]:
                                    old = self.channels[target][tn]
                                    old_pfx = old[:len(old) - len(tn)]
                                    if add:
                                        if pfx not in old_pfx:

                                            ordered = ''.join(
                                                ch for ch in "~&@%+" if ch == pfx or ch in old_pfx
                                            )
                                            self.channels[target][tn] = ordered + tn
                                    else:
                                        self.channels[target][tn] = old_pfx.replace(pfx, "", 1) + tn
                        elif mc in non_pfx_arg:
                            arg_idx += 1
                        elif mc == 'l' and add:
                            arg_idx += 1
            self._log_to_file(target, nick, f"sets mode {full_mode}", type='mode')
            m = {"type": "mode", "network": self.id, "channel": target,
                 "nick": nick, "mode": full_mode}
            self._add_backlog(target, m)
            await broadcast(m)

        elif cmd == "INVITE":

            inv_raw = raw.split(None, 4)
            invite_chan = message or (inv_raw[3].lstrip(':') if len(inv_raw) > 3 else '')
            if invite_chan:
                await self.emit_log(f"* {nick} has invited you to {invite_chan}")
                await broadcast({"type": "invite", "network": self.id,
                                 "from": nick, "channel": invite_chan, "ts": time.time()})

        elif cmd == "AWAY":

            if nick and not self._is_me(nick):
                if message:
                    self.away.add(nick)
                else:
                    self.away.discard(nick)

                for ch, ch_nicks in self.channels.items():
                    if nick in ch_nicks:
                        away_in = [n for n in ch_nicks if n in self.away]
                        await broadcast({"type": "away_update", "network": self.id,
                                         "channel": ch, "away": away_in})

        elif cmd == "ACCOUNT":

            acct = target
            for ch, ch_nicks in self.channels.items():
                if nick in ch_nicks:
                    if acct == "*":
                        msg_a = f"* {nick} has logged out of their account"
                    else:
                        msg_a = f"* {nick} is now identified as {acct}"
                    await self.emit_log(msg_a, channel=ch)

        elif cmd == "CHGHOST":

            chg_params = parsed.get("params", [])
            new_user = chg_params[0] if chg_params else ''
            new_host = chg_params[1] if len(chg_params) > 1 else ''
            if new_user and new_host:
                for ch, ch_nicks in self.channels.items():
                    if nick in ch_nicks:
                        await self.emit_log(f"* {nick} changed host to {new_user}@{new_host}",
                                            channel=ch)

        elif cmd.isdigit():

            p = parsed.get("params", [])

            details = " ".join(p[1:])

            if cmd == "311":
                wnick = p[1] if len(p) > 1 else ''
                if wnick:
                    self._whois_temp[wnick.lower()] = {
                        "nick":     wnick,
                        "user":     (p[2] if len(p) > 2 else '') + '@' + (p[3] if len(p) > 3 else ''),
                        "realname": message or '',
                        "server":   '',
                        "account":  'Unknown',
                        "idle":     None,
                        "channels": [],
                        "oper":     False,
                        "away":     None,
                        "secure":   False,
                        "extra":    []
                    }
                await self.emit_log(f"* [{wnick}] ({p[2] if len(p)>2 else ''}@{p[3] if len(p)>3 else ''}): {message}", is_whois=True, whois_nick=wnick,
                                    whois_data={"nick": wnick, "host": f"{p[2] if len(p)>2 else ''}@{p[3] if len(p)>3 else ''}", "msg": message})
            elif cmd == "312":
                wnick = p[1] if len(p) > 1 else ''
                srv = p[2] if len(p) > 2 else ''
                wt = self._whois_temp.get(wnick.lower())
                if wt: wt['server'] = srv
                await self.emit_log(f"* [{wnick}] {srv} :{message}", is_whois=True, whois_nick=wnick,
                                    whois_data={"nick": wnick, "host": srv, "msg": message})
            elif cmd in ("313", "308", "309", "689"):

                wnick = p[1] if len(p) > 1 else ''
                wt = self._whois_temp.get(wnick.lower())
                if wt:
                    wt['oper'] = True
                    wt['extra'].append(message)
                await self.emit_log(f"* [{wnick}] {message}", is_whois=True, whois_nick=wnick,
                                    whois_data={"nick": wnick, "msg": message})
            elif cmd in ("310", "335", "336", "617"):

                wnick = p[1] if len(p) > 1 else ''
                if cmd != "310" and wnick:
                    self.bots.add(wnick)
                wt = self._whois_temp.get(wnick.lower())
                if wt:
                    wt['extra'].append(message)
                await self.emit_log(f"* [{wnick}] {message}", is_whois=True, whois_nick=wnick,
                                    whois_data={"nick": wnick, "msg": message})
            elif cmd == "317":
                wnick = p[1] if len(p) > 1 else ''
                idle_str = ''
                signon_str = ''
                try:
                    idle_s = int(p[2]) if len(p) > 2 else 0
                    h, rem = divmod(idle_s, 3600); mn, s2 = divmod(rem, 60)
                    idle_str = (f"{h}h " if h else '') + f"{mn}m {s2}s"

                    if len(p) > 3:
                        ts = int(p[3])
                        signon_str = datetime.fromtimestamp(ts).strftime('%Y-%m-%d %H:%M:%S')
                except (ValueError, IndexError, OSError): pass

                wt = self._whois_temp.get(wnick.lower())
                if wt:
                    wt['idle'] = idle_str
                    if signon_str:
                        wt['extra'].append(f"connected since {signon_str}")

                await self.emit_log(f"* [{wnick}] idle: {idle_str}", is_whois=True, whois_nick=wnick,
                                    whois_data={"nick": wnick, "msg": f"idle: {idle_str}"})
                if signon_str:
                    await self.emit_log(f"* [{wnick}] connected since {signon_str}", is_whois=True, whois_nick=wnick,
                                        whois_data={"nick": wnick, "msg": f"connected since {signon_str}"})
            elif cmd == "318":
                wnick = p[1] if len(p) > 1 else ''
                data = self._whois_temp.pop(wnick.lower(), None)
                if data:
                    data['last_msg'] = self._last_msg.get(data['nick'].lower())
                    await broadcast({"type": "whois_info", "network": self.id, **data})
                else:

                    self._whowas_pending.add(wnick.lower())
                    self._queue(f"WHOWAS {wnick} 1")
                await self.emit_log(f"* [{wnick}] {message}", is_whois=True, whois_nick=wnick,
                                    whois_data={"nick": wnick, "msg": message})
            elif cmd == "319":
                wnick = p[1] if len(p) > 1 else ''
                chans = message.split() if message else []
                wt = self._whois_temp.get(wnick.lower())
                if wt: wt['channels'] = chans
                await self.emit_log(f"* [{wnick}] channels: {message}", is_whois=True, whois_nick=wnick,
                                    whois_data={"nick": wnick, "msg": f"channels: {message}"})
            elif cmd == "330":
                wnick = p[1] if len(p) > 1 else ''
                acct = p[2] if len(p) > 2 else ''
                wt = self._whois_temp.get(wnick.lower())
                if wt: wt['account'] = acct
                await self.emit_log(f"* [{wnick}] {message}", is_whois=True, whois_nick=wnick,
                                    whois_data={"nick": wnick, "msg": message})
            elif cmd == "307":
                wnick = p[1] if len(p) > 1 else ''
                wt = self._whois_temp.get(wnick.lower())
                if wt: wt['account'] = wt['nick']
                await self.emit_log(f"* [{wnick}] {message}", is_whois=True, whois_nick=wnick,
                                    whois_data={"nick": wnick, "msg": message})
            elif cmd in ("671", "275", "276"):
                wnick = p[1] if len(p) > 1 else ''
                wt = self._whois_temp.get(wnick.lower())
                if wt:
                    wt['secure'] = True
                    wt['extra'].append(message)
                await self.emit_log(f"* [{wnick}] {message}", is_whois=True, whois_nick=wnick,
                                    whois_data={"nick": wnick, "msg": message})
            elif cmd in (
                "316",
                "320",
                "325",
                "326",
                "327",
                "338",
                "343",
                "350",
                "378",
                "379",
                "615",
                "616",
                "672",
                "674",
                "690",
            ):
                wnick = p[1] if len(p) > 1 else ''
                info = message
                host_info = None
                if cmd == "338" and len(p) > 3:

                    host_info = f"{p[2]} ({p[3]})"
                wt = self._whois_temp.get(wnick.lower())
                if wt: wt['extra'].append(info)
                await self.emit_log(f"* [{wnick}] {info}", is_whois=True, whois_nick=wnick,
                                    whois_data={"nick": wnick, "host": host_info, "msg": info})
            elif cmd in ("716", "717"):

                wnick = p[1] if len(p) > 1 else ''
                wt = self._whois_temp.get(wnick.lower())
                if wt:
                    wt['extra'].append(message)
                await self.emit_log(f"* [{wnick}] {message}", is_whois=True, whois_nick=wnick,
                                    whois_data={"nick": wnick, "msg": message})
            elif cmd == "301":
                wnick = p[1] if len(p) > 1 else ''
                wt = self._whois_temp.get(wnick.lower())
                if wt: wt['away'] = message
                await self.emit_log(f"* [{wnick}] is away: {message}", is_whois=True, whois_nick=wnick,
                                    whois_data={"nick": wnick, "msg": f"is away: {message}"})
            elif cmd == "352":

                if len(p) >= 7:
                    who_chan = p[1]
                    who_nick = p[5]
                    who_flags = p[6]
                    if who_chan not in self._who_away_temp:
                        self._who_away_temp[who_chan] = set()
                    if 'G' in who_flags:
                        self._who_away_temp[who_chan].add(who_nick)
                    if who_chan not in self._who_bots_temp:
                        self._who_bots_temp[who_chan] = set()
                    if 'B' in who_flags or 'b' in who_flags:
                        self._who_bots_temp[who_chan].add(who_nick)
            elif cmd == "315":

                who_chan = p[1] if len(p) > 1 else ''
                away_updated = False
                away_in_chan = []
                bots_in_chan = []
                if who_chan in self._who_away_temp:
                    for n in self.channels.get(who_chan, {}):
                        self.away.discard(n)
                    for n in self._who_away_temp.pop(who_chan):
                        self.away.add(n)
                    away_in_chan = [n for n in self.channels.get(who_chan, {}) if n in self.away]
                    away_updated = True
                if who_chan in self._who_bots_temp:
                    for n in self.channels.get(who_chan, {}):
                        self.bots.discard(n)
                    for n in self._who_bots_temp.pop(who_chan):
                        self.bots.add(n)
                    bots_in_chan = [n for n in self.channels.get(who_chan, {}) if n in self.bots]
                    away_updated = True
                if away_updated:
                    await broadcast({"type": "away_update", "network": self.id,
                                     "channel": who_chan, "away": away_in_chan, "bots": bots_in_chan})
            elif cmd in ("321", "322", "323"):
                if cmd == "322":
                    channel = p[1] if len(p) > 1 else ''
                    count = int(p[2]) if len(p) > 2 and p[2].isdigit() else 0
                    self._list_buf.append({"channel": channel, "users": count, "topic": message or ''})
                elif cmd == "323":
                    await broadcast({"type": "list_channels", "network": self.id, "channels": self._list_buf})
                    self._list_buf = []

            elif cmd == "324":
                chan = p[1] if len(p) > 1 else ''
                modes = " ".join(p[2:]) if len(p) > 2 else message or ''
                self._chan_modes[chan] = modes
                await self.emit_log(f"* Mode for {chan} is {modes}", channel=chan)
                await broadcast({"type": "chan_modes", "network": self.id,
                                 "channel": chan, "modes": modes})

            elif cmd == "329":
                chan = p[1] if len(p) > 1 else ''
                try:
                    ts_dt = datetime.fromtimestamp(int(p[2])).strftime('%a %b %d %H:%M:%S %Y')
                    await self.emit_log(f"* Channel {chan} created {ts_dt}", channel=chan)
                except (ValueError, IndexError, OSError):
                    pass

            elif cmd == "331":
                chan = p[1] if len(p) > 1 else ''
                m_notopic = {"type": "topic", "network": self.id, "channel": chan, "topic": ""}
                self._add_backlog(chan, m_notopic)
                await broadcast(m_notopic)
                await self.emit_log(f"* No topic is set for {chan}", channel=chan)

            elif cmd == "367":
                chan = p[1] if len(p) > 1 else ''
                mask = p[2] if len(p) > 2 else ''
                setter = p[3] if len(p) > 3 else ''
                try: ts_s = datetime.fromtimestamp(int(p[4])).strftime('%Y-%m-%d %H:%M') if len(p) > 4 else ''
                except (ValueError, OSError): ts_s = ''
                self._ban_temp.setdefault(chan, []).append({"mask": mask, "setter": setter, "time": ts_s})
                label = f"{mask}"
                if setter: label += f"  set by {setter}"
                if ts_s:   label += f"  on {ts_s}"
                await self.emit_log(f"* Ban: {label}", channel=chan)

            elif cmd == "368":
                chan = p[1] if len(p) > 1 else ''
                entries = self._ban_temp.pop(chan, [])
                await broadcast({"type": "ban_list", "network": self.id, "channel": chan, "bans": entries})
                await self.emit_log(f"* End of ban list for {chan}", channel=chan)

            elif cmd == "346":
                chan = p[1] if len(p) > 1 else ''
                mask = p[2] if len(p) > 2 else ''
                setter = p[3] if len(p) > 3 else ''
                try: ts_s = datetime.fromtimestamp(int(p[4])).strftime('%Y-%m-%d %H:%M') if len(p) > 4 else ''
                except (ValueError, OSError): ts_s = ''
                self._invite_temp.setdefault(chan, []).append({"mask": mask, "setter": setter, "time": ts_s})
                label = f"{mask}"
                if setter: label += f"  set by {setter}"
                if ts_s:   label += f"  on {ts_s}"
                await self.emit_log(f"* Invite: {label}", channel=chan)

            elif cmd == "347":
                chan = p[1] if len(p) > 1 else ''
                entries = self._invite_temp.pop(chan, [])
                await broadcast({"type": "invite_list", "network": self.id, "channel": chan, "invites": entries})
                await self.emit_log(f"* End of invite list for {chan}", channel=chan)

            elif cmd == "348":
                chan = p[1] if len(p) > 1 else ''
                mask = p[2] if len(p) > 2 else ''
                setter = p[3] if len(p) > 3 else ''
                try: ts_s = datetime.fromtimestamp(int(p[4])).strftime('%Y-%m-%d %H:%M') if len(p) > 4 else ''
                except (ValueError, OSError): ts_s = ''
                self._except_temp.setdefault(chan, []).append({"mask": mask, "setter": setter, "time": ts_s})
                label = f"{mask}"
                if setter: label += f"  set by {setter}"
                if ts_s:   label += f"  on {ts_s}"
                await self.emit_log(f"* Except: {label}", channel=chan)

            elif cmd == "349":
                chan = p[1] if len(p) > 1 else ''
                entries = self._except_temp.pop(chan, [])
                await broadcast({"type": "except_list", "network": self.id, "channel": chan, "excepts": entries})
                await self.emit_log(f"* End of exception list for {chan}", channel=chan)

            elif cmd == "314":
                wnick = p[1] if len(p) > 1 else ''
                user_host = f"{p[2] if len(p)>2 else ''}@{p[3] if len(p)>3 else ''}"
                await self.emit_log(
                    f"* [{wnick}] was ({user_host}): {message}",
                    is_whois=True, whois_nick=wnick,
                    whois_data={"nick": wnick, "host": user_host, "msg": message},
                    is_whowas=True)

            elif cmd == "369":
                wnick = p[1] if len(p) > 1 else ''
                self._whowas_pending.discard(wnick.lower())
                await self.emit_log(
                    f"* [{wnick}] {message}",
                    is_whois=True, whois_nick=wnick,
                    whois_data={"nick": wnick, "msg": message},
                    is_whowas=True)

            elif cmd == "432":
                bad = p[1] if len(p) > 1 else ''
                await self.emit_log(f"* {bad}: Erroneous nickname")

            elif cmd == "436":
                if self._registered:
                    await self.emit_log("* Nick collision.")
                elif self._nick_retries >= 8:
                    await self.emit_log("* Nick collision. Giving up after too many attempts.")
                else:
                    self._nick_retries += 1
                    self.nick += "_"
                    await self.emit_log(f"* Nick collision. Trying {self.nick}...")
                    self._queue(f"NICK {self.nick}")
                    await self._emit_status()

            elif cmd == "437":
                target_r = p[1] if len(p) > 1 else ''
                await self.emit_log(f"* {target_r}: Nick/channel temporarily unavailable")

            elif cmd in ("471", "473", "474", "475", "477", "489", "495"):
                chan = p[1] if len(p) > 1 else ''
                reasons = {
                    "471": "Cannot join — channel is full (+l)",
                    "473": "Cannot join — invite only (+i)",
                    "474": "Cannot join — you are banned (+b)",
                    "475": "Cannot join — wrong channel key (+k)",
                    "477": "Cannot join — you need to be identified/registered",
                    "489": "Cannot join — channel is secure only (+z)",
                    "495": "Cannot join — too many channel joins",
                }
                reason = reasons.get(cmd, message or "Cannot join channel")
                await self.emit_log(f"* {chan}: {reason}", channel=chan)

                await self.emit_log(f"* {chan}: {reason}")

            elif cmd in ("002", "003", "004", "008", "250",
                         "251", "252", "253", "254", "255",
                         "256", "257", "258", "259",
                         "261", "262", "263",
                         "265", "266",
                         "290", "292", "294",
                         "351", "364", "365",
                         "371", "374", "375.5"):

                await self.emit_log(f"* {message}", verbose=True)

            elif cmd in ("210", "211", "212", "213", "214", "215",
                         "216", "217", "218", "219", "240", "241",
                         "242", "243", "244", "245", "246", "247",
                         "248", "249"):
                await self.emit_log(f"* {message}", verbose=True)

            elif cmd == "302":
                await self.emit_log(f"* Userhost: {message}")

            elif cmd == "303":
                await self.emit_log(f"* Online: {message}" if message.strip() else "* None of those nicks are online")

            elif cmd == "305":
                await self.emit_log("* You are no longer marked as away")
                await broadcast({"type": "self_away", "network": self.id, "away": False})

            elif cmd == "306":
                await self.emit_log("* You have been marked as away")
                await broadcast({"type": "self_away", "network": self.id, "away": True})

            elif cmd == "341":
                invited = p[1] if len(p) > 1 else ''
                chan = p[2] if len(p) > 2 else ''
                await self.emit_log(f"* Inviting {invited} to {chan}", channel=chan)

            elif cmd == "351":
                await self.emit_log(f"* Server version: {message}", verbose=True)

            elif cmd == "391":
                srv = p[1] if len(p) > 1 else 'server'
                await self.emit_log(f"* Time on {srv}: {message}")

            elif cmd in ("364", "365"):
                await self.emit_log(f"* {message}", verbose=True)

            elif cmd in ("371", "374"):
                await self.emit_log(f"* {message}", verbose=True)

            elif cmd in ("600", "604"):
                wnick = p[1] if len(p) > 1 else ''
                user  = p[2] if len(p) > 2 else ''
                host  = p[3] if len(p) > 3 else ''
                info  = f" ({user}@{host})" if user and host else ''
                await self.emit_log(f"* {wnick}{info} is now online")
                await broadcast({"type": "watch_status", "network": self.id,
                                 "nick": wnick, "online": True})

            elif cmd in ("601", "605"):
                wnick = p[1] if len(p) > 1 else ''
                await self.emit_log(f"* {wnick} has signed off")
                await broadcast({"type": "watch_status", "network": self.id,
                                 "nick": wnick, "online": False})

            elif cmd in ("602", "606", "732"):
                await self.emit_log(f"* Watch list: {message}", verbose=True)

            elif cmd in ("603", "607", "733"):
                await self.emit_log(f"* {message}", verbose=True)

            elif cmd == "730":
                for entry in message.split(","):
                    entry = entry.strip()
                    wnick = entry.split("!")[0] if "!" in entry else entry
                    if wnick:
                        await self.emit_log(f"* {wnick} is now online")
                        await broadcast({"type": "watch_status", "network": self.id,
                                         "nick": wnick, "online": True})

            elif cmd == "731":
                for wnick in message.split(","):
                    wnick = wnick.strip()
                    if wnick:
                        await self.emit_log(f"* {wnick} has signed off")
                        await broadcast({"type": "watch_status", "network": self.id,
                                         "nick": wnick, "online": False})

            elif cmd == "734":
                await self.emit_log("* Monitor list is full")

            elif cmd in _IRC_ERRORS:
                fallback = _IRC_ERRORS[cmd]
                tgt = p[1] if len(p) > 1 else ''

                display = message if message and message not in (tgt, 'me') else fallback
                is_chan = tgt.startswith(('#', '&', '+', '!'))
                if is_chan:
                    await self.emit_log(f"* {tgt}: {display}", channel=tgt)
                    await self.emit_log(f"* {tgt}: {display}")
                elif tgt and not self._is_me(tgt):
                    await self.emit_log(f"* {tgt}: {display}")
                else:
                    await self.emit_log(f"* {display}")

            else:
                await self.emit_log(f"* {details} {message}")

    async def _emit_status(self):
        await broadcast({"type": "network_status", "network": self.id, "name": self.name,
                         "nick": self.nick, "status": self.status,
                         "channels": list(self.channels.keys()),
                         "latency": self.latency_ms, "ssl": self._current_ssl})

async def ws_handler(ws):
    clients.add(ws)

    ws.authenticated = False
    ws.debug_mode = False

    s = load_settings()
    auth_cfg = s.get("auth", {"enabled": False})
    if not auth_cfg.get("enabled"):
        ws.authenticated = True

        net_states = []
        for n in s.get("networks", []):
            nid = n["id"]
            conn = networks.get(nid)
            net_states.append({"id": nid, "name": n.get("name", nid),
                               "nick": conn.nick if conn else n.get("nick", "WebUser"),
                               "status": conn.status if conn else "disconnected",
                               "channels": list(conn.channels.keys()) if conn else []})
        try:
            enabled_plugins = s.get("plugins", {}).get("enabled", [])
            js_plugins = await _js_plugins_for_client(enabled_plugins)
            await ws.send(json.dumps({"type": "init", "networks": net_states,
                                      "settings": _scrub_settings(s),
                                      "highlights": highlights_log,
                                      "js_plugins": js_plugins}))
        except Exception:
            clients.discard(ws)
            return

        backlog_batch = []
        for nid, conn in list(networks.items()):
            if conn.config.get("mode") == "bouncer":
                for chan, msgs in list(conn.backlog.items()):
                    backlog_batch.extend(list(msgs))
        if backlog_batch:
            try:
                await ws.send(json.dumps({"type": "backlog", "messages": backlog_batch}))
            except Exception:
                clients.discard(ws)
                return

    else:
        try:
            await ws.send(json.dumps({"type": "auth_required"}))
        except Exception:
            clients.discard(ws)
            return

    try:
        async for raw_msg in ws:
            try:
                msg = json.loads(raw_msg)
            except json.JSONDecodeError:
                continue
            t = msg.get("type")

            if not ws.authenticated:
                if t == "auth":
                    client_ip = ws.remote_address[0] if ws.remote_address else "unknown"
                    if not _auth_rate_ok(client_ip):
                        await ws.send(json.dumps({"type": "auth_error", "message": "Too many failed attempts. Try again later."}))
                        continue
                    user, pw = msg.get("username"), msg.get("password")
                    if not isinstance(user, str): user = ""
                    if not isinstance(pw, str): pw = ""
                    stored_user = auth_cfg.get("username") or ""
                    stored_pass = auth_cfg.get("password") or ""
                    if hmac.compare_digest(user or "", stored_user) and _verify_password(pw or "", stored_pass):
                        ws.authenticated = True

                        if stored_pass and not stored_pass.startswith(_HASH_PREFIX + ":"):
                            log.info("[auth] Upgrading plaintext password to PBKDF2 hash")
                            _up = load_settings()
                            if isinstance(_up.get("auth"), dict):
                                _up["auth"]["password"] = _hash_password(stored_pass)
                                save_settings(_up)
                                _settings_cache["data"] = None
                        await ws.send(json.dumps({"type": "auth_success"}))

                        s = current_settings = load_settings()
                        await ws.send(json.dumps({"type": "settings", "settings": _scrub_settings(current_settings)}))

                        net_states = []
                        for n in current_settings.get("networks", []):
                            nid = n["id"]
                            conn = networks.get(nid)
                            net_states.append({
                                "id": nid, "name": n.get("name", nid),
                                "nick": conn.nick if conn else n.get("nick", "WebUser"),
                                "status": conn.status if conn else "disconnected",
                                "channels": list(conn.channels.keys()) if conn else []
                            })
                        enabled_plugins2 = current_settings.get("plugins", {}).get("enabled", [])
                        js_plugins2 = await _js_plugins_for_client(enabled_plugins2)
                        await ws.send(json.dumps({"type": "init", "networks": net_states,
                                                   "settings": _scrub_settings(current_settings),
                                                   "highlights": highlights_log,
                                                   "js_plugins": js_plugins2}))

                        backlog_batch = []
                        for nid, conn in list(networks.items()):
                            if conn.config.get("mode") == "bouncer":
                                for chan, msgs in list(conn.backlog.items()):
                                    backlog_batch.extend(list(msgs))
                        if backlog_batch:
                            await ws.send(json.dumps({"type": "backlog", "messages": backlog_batch}))
                    else:
                        _record_auth_failure(client_ip)
                        await ws.send(json.dumps({"type": "auth_error", "message": "Invalid username or password"}))
                continue

            if t == "connect":
                nid = msg.get("network_id")
                s = load_settings()
                cfg = next((n for n in s.get("networks", []) if n["id"] == nid), None)
                if cfg:
                    if nid in networks:
                        existing = networks[nid]
                        if existing.status in ("connecting", "connected") or (
                            existing._connect_task and not existing._connect_task.done()
                        ):
                            log.info(f"[{nid}] Connect requested but network is already active; reusing existing connection")
                            continue

                        try:
                            await asyncio.wait_for(existing.disconnect(), timeout=3.0)
                        except asyncio.TimeoutError:
                            log.warning(f"[{nid}] Disconnect timed out during reconnect request")
                        except Exception as e:
                            log.error(f"[{nid}] Error during disconnect: {e}")

                    conn = NetworkConnection(cfg)
                    networks[nid] = conn
                    conn._connect_task = asyncio.create_task(conn.connect())

            elif t == "disconnect":
                nid = msg.get("network_id")
                if nid in networks:
                    asyncio.create_task(networks[nid].disconnect())

            elif t == "privmsg":
                nid, tgt, text = msg.get("network"), msg.get("target"), msg.get("message", "")
                if not nid or not tgt or text is None:
                    continue
                conn = networks.get(nid)
                if conn:

                    conn.send(f"PRIVMSG {tgt} :{text}")

            elif t == "join":
                chan = msg.get("channel")
                conn = networks.get(msg.get("network"))
                if conn and chan:
                    conn.send(f"JOIN {chan}")

            elif t == "part":
                chan = msg.get("channel")
                conn = networks.get(msg.get("network"))
                if conn and chan:
                    conn.send(f"PART {chan} :{msg.get('reason', 'Leaving')}")

            elif t == "nick":
                new_nick = msg.get("nick")
                conn = networks.get(msg.get("network"))
                if conn and new_nick:
                    conn.send(f"NICK {new_nick}")

            elif t == "raw":
                nid  = msg.get("network_id") or msg.get("network")
                conn = networks.get(nid)
                if conn:
                    conn.send(msg.get("line", ""))

            elif t == "plugin_command":

                cmd_name = str(msg.get("command", "")).lower().lstrip("/")
                args     = msg.get("args", [])
                if cmd_name:
                    word = [cmd_name] + [str(a) for a in args]
                    await fire_py_command(cmd_name, word)

            elif t == "save_settings":
                new_s = msg.get("settings")
                if new_s:

                    existing_s = load_settings()

                    if isinstance(new_s.get("auth"), dict):
                        new_pw = new_s["auth"].get("password", "")
                        if not new_pw:
                            new_s["auth"]["password"] = existing_s.get("auth", {}).get("password", "")
                        elif not new_pw.startswith(_HASH_PREFIX + ":"):
                            new_s["auth"]["password"] = _hash_password(new_pw)

                    existing_nets = {n["id"]: n for n in existing_s.get("networks", [])}
                    for net in new_s.get("networks", []):
                        nid_net = net.get("id")
                        if nid_net in existing_nets:
                            if isinstance(net.get("sasl"), dict) and not net["sasl"].get("password"):
                                net["sasl"]["password"] = existing_nets[nid_net].get("sasl", {}).get("password", "")

                    if "vapid" not in new_s and "vapid" in existing_s:
                        new_s["vapid"] = existing_s["vapid"]
                    elif isinstance(new_s.get("vapid"), dict):
                        if not new_s["vapid"].get("private_key"):
                            new_s["vapid"]["private_key"] = existing_s.get("vapid", {}).get("private_key", "")

                    save_settings(new_s)

                    _settings_cache["data"] = None

                    new_nids = {n_cfg.get("id") for n_cfg in new_s.get("networks", [])}

                    for n_cfg in new_s.get("networks", []):
                        nid = n_cfg.get("id")
                        if nid in networks:
                            networks[nid].config = n_cfg
                        else:
                            conn = NetworkConnection(n_cfg)
                            networks[nid] = conn
                            if n_cfg.get("autoconnect"):
                                conn._connect_task = asyncio.create_task(conn.connect())

                    for nid in list(networks.keys()):
                        if nid not in new_nids:
                            log.info(f"[{nid}] Network removed from config — disconnecting")
                            asyncio.create_task(networks[nid].disconnect())
                            del networks[nid]

                    await ws.send(json.dumps({"type": "settings_saved"}))

                    await broadcast({"type": "settings", "settings": _scrub_settings(new_s)})

            elif t == "get_settings":
                await ws.send(json.dumps({"type": "settings", "settings": _scrub_settings(load_settings())}))

            elif t == "request_history":
                nid = msg.get("network")
                channel = msg.get("channel")
                before_ts = msg.get("before_ts")
                conn = networks.get(nid)
                if conn and channel:
                    try:
                        before_ts = float(before_ts) if before_ts is not None else None
                    except (TypeError, ValueError):
                        before_ts = None
                    asyncio.create_task(conn.request_history(channel, before_ts, ws))

            elif t == "push_subscribe":
                subscription = msg.get("subscription")
                if subscription:
                    add_push_subscription(subscription)
                    log.info("[push] Registered subscription")

            elif t == "push_unsubscribe":
                endpoint = msg.get("endpoint")
                if endpoint:
                    remove_push_subscription(endpoint)
                    log.info("[push] Unregistered subscription")

            elif t == "get_log_dates":
                nid, channel = str(msg.get("network", "")), str(msg.get("channel", ""))
                safe_net  = _net_log_name(nid)
                safe_chan  = channel.replace("/", "_").replace("\\", "_")
                base_logs = os.path.abspath(IRC_LOG_BASE)
                log_dir = os.path.abspath(os.path.join(base_logs, safe_net, safe_chan))
                if not log_dir.startswith(base_logs + os.sep) and log_dir != base_logs: continue
                dates = []
                if os.path.exists(log_dir):
                    dates = [f.replace(".log", "") for f in os.listdir(log_dir) if f.endswith(".log")]
                await ws.send(json.dumps({"type": "log_dates", "network": nid, "channel": channel, "dates": sorted(dates, reverse=True)}))

            elif t == "get_log":
                nid, channel, date = str(msg.get("network", "")), str(msg.get("channel", "")), str(msg.get("date", ""))
                try:
                    limit = min(max(int(msg.get("limit", 300)), 1), 1000)
                except (TypeError, ValueError):
                    limit = 300
                _bl_raw = msg.get("before_line")
                try:
                    before_line = int(_bl_raw) if _bl_raw is not None else None
                except (TypeError, ValueError):
                    before_line = None
                if not re.match(r'^(\d{2}-\d{2}-\d{4}|\d{4}-\d{2}-\d{2})$', date): continue
                safe_net  = _net_log_name(nid)
                safe_chan  = channel.replace("/", "_").replace("\\", "_")
                base_logs = os.path.abspath(IRC_LOG_BASE)
                log_dir = os.path.abspath(os.path.join(base_logs, safe_net, safe_chan))
                if not log_dir.startswith(base_logs + os.sep) and log_dir != base_logs: continue
                log_path = os.path.join(log_dir, f"{date}.log")
                offsets = _get_log_index(log_path) if os.path.exists(log_path) else []
                total = len(offsets)
                if before_line is None:
                    start_idx = max(0, total - limit)
                else:
                    start_idx = max(0, int(before_line) - limit)
                end_idx = min(start_idx + limit, total)
                lines = []
                if offsets and start_idx < total:
                    try:
                        with open(log_path, "rb") as f:
                            f.seek(offsets[start_idx])
                            chunk = (f.read(offsets[end_idx] - offsets[start_idx])
                                     if end_idx < total else f.read())
                        for raw in chunk.decode("utf-8", errors="replace").splitlines():
                            rec = _parse_log_line(raw, date)
                            if rec:
                                lines.append(rec)
                    except OSError:
                        pass
                await ws.send(json.dumps({
                    "type": "log_content", "network": nid, "channel": channel,
                    "date": date, "total": total, "from": start_idx, "lines": lines
                }))

            elif t == "search_logs":
                nid     = str(msg.get("network", ""))
                channel = str(msg.get("channel", ""))
                query   = str(msg.get("query", "")).lower()
                all_channels = (channel == "*" or channel == "")
                if not query: continue

                safe_net  = _net_log_name(nid)
                base_logs = os.path.abspath(IRC_LOG_BASE)
                net_dir   = os.path.abspath(os.path.join(base_logs, safe_net))
                if not net_dir.startswith(base_logs + os.sep) and net_dir != base_logs: continue

                _SEARCH_CAP = 200
                results = []
                total_scanned = 0
                truncated = False

                if all_channels:
                    search_dirs = []
                    if os.path.isdir(net_dir):
                        for entry in sorted(os.listdir(net_dir)):
                            candidate = os.path.join(net_dir, entry)
                            if os.path.isdir(candidate) and candidate.startswith(net_dir + os.sep):
                                search_dirs.append((entry, candidate))
                else:
                    safe_chan = channel.replace("/", "_").replace("\\", "_")
                    log_dir  = os.path.abspath(os.path.join(net_dir, safe_chan))
                    if not log_dir.startswith(base_logs + os.sep) and log_dir != base_logs: continue
                    search_dirs = [(channel, log_dir)]

                for chan_name, log_dir in search_dirs:
                    if not os.path.exists(log_dir): continue
                    files = sorted([f for f in os.listdir(log_dir) if f.endswith(".log")], reverse=True)
                    for f_name in files:
                        date   = f_name.replace(".log", "")
                        f_path = os.path.join(log_dir, f_name)
                        try:
                            fh = open(f_path, "r", encoding="utf-8")
                        except OSError:
                            continue
                        with fh as f:
                            for line in f:
                                total_scanned += 1
                                data = _parse_log_line(line, date)
                                if not data: continue
                                if query in data.get("text", "").lower() or query in data.get("nick", "").lower():
                                    data["date"]    = date
                                    data["channel"] = chan_name
                                    results.append(data)
                                    if len(results) >= _SEARCH_CAP:
                                        truncated = True
                                        break
                        if truncated: break
                    if truncated: break

                await ws.send(json.dumps({
                    "type": "search_results", "network": nid, "channel": channel,
                    "query": query, "results": results, "total_scanned": total_scanned,
                    "truncated": truncated, "all_channels": all_channels
                }))

            elif t == "plugin_list":
                plugin_dir = os.path.join(ROOT_DIR, "data", "bouncer_plugins")
                os.makedirs(plugin_dir, exist_ok=True)
                s = load_settings()
                enabled = s.get("plugins", {}).get("enabled", [])
                await ws.send(json.dumps({
                    "type": "plugin_list",
                    "plugins": _plugin_list_payload(plugin_dir, enabled),
                }))

            elif t == "plugin_get":
                raw_name = str(msg.get("name", ""))
                lang     = str(msg.get("lang", "python"))
                if not re.match(r'^[\w\-]+$', raw_name): continue
                plugin_dir = os.path.abspath(os.path.join(ROOT_DIR, "data", "bouncer_plugins"))
                ext  = ".js" if lang == "js" else ".py"
                path = os.path.abspath(os.path.join(plugin_dir, f"{raw_name}{ext}"))
                if not path.startswith(plugin_dir + os.sep): continue
                code = ""
                if os.path.exists(path):
                    with open(path, "r", encoding="utf-8") as f: code = f.read()
                await ws.send(json.dumps({"type": "plugin_code", "name": raw_name,
                                          "lang": lang, "code": code}))

            elif t == "plugin_save":
                raw_name = str(msg.get("name", ""))
                code     = str(msg.get("code", ""))
                lang     = str(msg.get("lang", "python"))
                if not re.match(r'^[\w\-]+$', raw_name): continue
                if len(code.encode("utf-8", errors="replace")) > 524288:
                    await ws.send(json.dumps({"type": "error", "message": "Plugin code exceeds 512 KiB"}))
                    continue
                plugin_dir = os.path.abspath(os.path.join(ROOT_DIR, "data", "bouncer_plugins"))
                os.makedirs(plugin_dir, exist_ok=True)
                ext  = ".js" if lang == "js" else ".py"
                path = os.path.abspath(os.path.join(plugin_dir, f"{raw_name}{ext}"))
                if not path.startswith(plugin_dir + os.sep): continue
                with open(path, "w", encoding="utf-8") as f: f.write(code)
                await ws.send(json.dumps({"type": "plugin_saved", "name": raw_name, "lang": lang}))

                s = load_settings()
                enabled = s.get("plugins", {}).get("enabled", [])
                if lang == "python" and raw_name in enabled:
                    load_py_plugin(raw_name)

                if lang == "js" and raw_name in enabled:
                    await broadcast({"type": "js_plugin_reload",
                                     "name": raw_name, "code": code})

            elif t == "plugin_delete":
                raw_name = str(msg.get("name", ""))
                lang     = str(msg.get("lang", "python"))
                if not re.match(r'^[\w\-]+$', raw_name): continue
                plugin_dir = os.path.abspath(os.path.join(ROOT_DIR, "data", "bouncer_plugins"))
                ext  = ".js" if lang == "js" else ".py"
                path = os.path.abspath(os.path.join(plugin_dir, f"{raw_name}{ext}"))
                if not path.startswith(plugin_dir + os.sep): continue
                if os.path.exists(path): os.remove(path)
                if lang == "python":
                    unload_py_plugin(raw_name)
                s = load_settings()
                enabled = s.get("plugins", {}).get("enabled", [])
                if raw_name in enabled:
                    enabled.remove(raw_name)
                    s["plugins"]["enabled"] = enabled
                    save_settings(s)
                    _settings_cache["data"] = None
                await ws.send(json.dumps({"type": "plugin_deleted", "name": raw_name, "lang": lang}))

            elif t == "plugin_set_enabled":
                raw_name = str(msg.get("name", ""))
                lang     = str(msg.get("lang", "python"))
                flag     = bool(msg.get("enabled", False))
                if not re.match(r'^[\w\-]+$', raw_name): continue
                s = load_settings()
                if "plugins" not in s: s["plugins"] = {}
                enabled = s["plugins"].get("enabled", [])
                if flag:
                    if raw_name not in enabled: enabled.append(raw_name)
                    if lang == "python":
                        load_py_plugin(raw_name)
                    else:

                        plugin_dir = os.path.join(ROOT_DIR, "data", "bouncer_plugins")
                        js_path = os.path.join(plugin_dir, f"{raw_name}.js")
                        if os.path.exists(js_path):
                            with open(js_path, 'r', encoding='utf-8') as f:
                                js_code = f.read()
                            await broadcast({"type": "js_plugin_run",
                                             "name": raw_name, "code": js_code})
                else:
                    if raw_name in enabled: enabled.remove(raw_name)
                    if lang == "python":
                        unload_py_plugin(raw_name)
                    else:
                        await broadcast({"type": "js_plugin_unload", "name": raw_name})
                s["plugins"]["enabled"] = enabled
                save_settings(s)
                _settings_cache["data"] = None
                plugin_dir = os.path.join(ROOT_DIR, "data", "bouncer_plugins")
                await ws.send(json.dumps({
                    "type": "plugin_list",
                    "plugins": _plugin_list_payload(plugin_dir, enabled),
                }))

            elif t == "toggle_debug":
                ws.debug_mode = bool(msg.get("enabled", False))
                log.info(f"Client debug mode: {ws.debug_mode}")

    finally:
        clients.discard(ws)

async def shutdown(sig, stop_event):
    log.info(f"Received {sig.name}, shutting down gracefully...")

    for nid, conn in networks.items():
        save_backlog(nid, conn.backlog)
        log.info(f"[{nid}] Backlog persisted ({sum(len(v) for v in conn.backlog.values())} messages).")

    tasks = []
    for nid, conn in networks.items():
        tasks.append(asyncio.create_task(conn.disconnect()))
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)

    stop_event.set()

async def main():
    settings = load_settings()
    stop_event = asyncio.Event()

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, lambda s=sig: asyncio.create_task(shutdown(s, stop_event)))

    _setup_rotating_log()
    init_py_plugins()

    bnc_settings = settings.get("bouncer", {})
    security_cfg = bnc_settings.get("security", {})
    ssl_cfg = bnc_settings.get("ssl", {})
    bind_host = str(bnc_settings.get("bind_host", settings.get("bind_host", "0.0.0.0"))).strip() or "0.0.0.0"
    ws_port = int(bnc_settings.get("port", bnc_settings.get("ws_port", 8765)))

    auth_enabled = bool(settings.get("auth", {}).get("enabled"))
    allow_no_auth = bool(security_cfg.get("allow_no_auth", False))
    if not auth_enabled and not allow_no_auth:
        log.error("Refusing to start: auth is disabled and bouncer.security.allow_no_auth is false.")
        log.error(f"Enable auth in {get_settings_file()} or set allow_no_auth=true explicitly (not recommended).")
        return

    ssl_ctx = None
    if ssl_cfg.get("enabled"):
        cert_path = ssl_cfg.get("cert")
        key_path = ssl_cfg.get("key")
        if cert_path and key_path:
            try:
                ssl_ctx = ssl.create_default_context(ssl.Purpose.CLIENT_AUTH)
                ssl_ctx.load_cert_chain(certfile=cert_path, keyfile=key_path)
                log.info(f"Bouncer SSL enabled using {cert_path}")
            except Exception as e:
                log.error(f"Failed to load SSL certificates: {e}")
        else:
            log.warning("Bouncer SSL enabled but cert/key paths missing")

    if not settings.get("auth", {}).get("enabled"):
        log.warning("SECURITY WARNING: WebSocket authentication is disabled.")
        log.warning(f"Anyone who can reach port {ws_port} has full control of your IRC session.")

    for cfg in settings.get("networks", []):
        if cfg.get("autoconnect"):
            conn = NetworkConnection(cfg)
            networks[cfg["id"]] = conn
            conn._connect_task = asyncio.create_task(conn.connect())

    _allowed_origins_cfg = bnc_settings.get("allowed_origins", [])

    async def _check_origin(connection, request):
        from urllib.parse import urlparse as _up
        origin = request.headers.get("Origin", "")
        host_hdr = request.headers.get("Host", "")
        req_host = (host_hdr.split(":", 1)[0] if host_hdr else "").lower()
        if not origin:
            return None
        origin_host = (_up(origin).hostname or "").lower()

        _local = {"localhost", "127.0.0.1", "::1"}
        if origin_host in _local:
            return None

        if req_host and origin_host == req_host:
            return None

        if _allowed_origins_cfg:
            allowed_hosts = {(_up(o).hostname or o).lower() for o in _allowed_origins_cfg}
            if origin_host not in allowed_hosts:
                log.warning(f"WebSocket: rejected connection from disallowed Origin: {origin}")
                return connection.respond(HTTPStatus.FORBIDDEN, "Forbidden: disallowed origin\n")
        return None

    if _is_local_bind_host(bind_host):
        log.info(f"WebSocket bind host set to loopback-only: {bind_host}")
    else:
        log.warning(f"WebSocket bind host is non-local ({bind_host}). Ensure firewall/reverse-proxy protection is in place.")

    async with websockets.serve(ws_handler, bind_host, ws_port, ssl=ssl_ctx,
                                max_size=1_048_576, process_request=_check_origin,
                                reuse_address=True):
        log.info(f"Bouncer listening on {bind_host}:{ws_port} {'(SSL enabled)' if ssl_ctx else ''}")
        await stop_event.wait()

if __name__ == "__main__":
    asyncio.run(main())