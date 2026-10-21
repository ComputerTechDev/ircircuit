import re
import socket
import ipaddress
import asyncio
import aiohttp
from yarl import URL
from html import unescape
from urllib.parse import urlparse

URL_RE = re.compile(r'https?://[^\s<>"]+[^\s<>",.]')

_BLOCKED_NETS = [
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("169.254.0.0/16"),
    ipaddress.ip_network("100.64.0.0/10"),
    ipaddress.ip_network("0.0.0.0/8"),
    ipaddress.ip_network("::1/128"),
    ipaddress.ip_network("fc00::/7"),
    ipaddress.ip_network("fe80::/10"),
]


async def _is_safe_url(url: str) -> bool:
    try:
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https"):
            return False
        hostname = parsed.hostname
        if not hostname:
            return False
        loop = asyncio.get_event_loop()
        infos = await loop.run_in_executor(
            None,
            lambda: socket.getaddrinfo(hostname, None, proto=socket.IPPROTO_TCP),
        )
        for info in infos:
            addr = ipaddress.ip_address(info[4][0])
            for net in _BLOCKED_NETS:
                if addr.version == net.version and addr in net:
                    return False
        return True
    except (socket.gaierror, ValueError, OSError):
        return False


async def get_title(url):
    if not await _is_safe_url(url):
        return None
    try:
        headers = {'User-Agent': 'WebIRC/1.0 (Title Crawler)'}
        timeout = aiohttp.ClientTimeout(total=5)
        async with aiohttp.ClientSession(headers=headers, timeout=timeout) as session:
            for _hop in range(5):
                async with session.get(url, allow_redirects=False) as resp:
                    if resp.status in (301, 302, 303, 307, 308):
                        loc = resp.headers.get('Location')
                        if not loc:
                            return None
                        url = str(resp.url.join(URL(loc)))
                        if not await _is_safe_url(url):
                            return None
                        continue

                    ctype = resp.headers.get('Content-Type', '').lower()
                    if 'text/html' not in ctype:
                        return None

                    content = await resp.content.read(65536)
                    text = content.decode('utf-8', errors='ignore')

                    m = re.search(r'<title>(.*?)</title>', text, re.IGNORECASE | re.DOTALL)
                    if m:
                        title = unescape(m.group(1).strip())
                        title = " ".join(title.split())
                        if len(title) > 200:
                            title = title[:197] + "..."
                        return title
                    return None
    except Exception:
        pass
    return None

def on_message(word, word_eol, userdata):
    nick = word[0]
    message = word[1]
    target = word[2]
    network = word[3]

    if nick == webirc.get_info("nick", network):
        return webirc.EAT_NONE

    urls = URL_RE.findall(message)
    if not urls:
        return webirc.EAT_NONE

    async def process_urls():
        for url in urls:
            title = await get_title(url)
            if title:
                webirc.send_msg(network, target, f"\x0310[ Title: {title} ]\x0F")
                await asyncio.sleep(0.5)

    asyncio.create_task(process_urls())
    return webirc.EAT_NONE

webirc.hook_print("Channel Message", on_message)
webirc.hook_print("Private Message", on_message)
webirc.hook_print("Your Message", on_message)
webirc.hook_print("Your Private Message", on_message)
