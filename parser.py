import re

_IRC_PATTERN = re.compile(
    r'^(?::(?P<source>[^ ]+) +)?(?P<command>[^ ]+)(?P<params>(?: +[^ :][^ ]*)*)(?: +:(?P<trailing>.*))?$'
)

_TAG_UNESCAPE = {'\\': '\\', ':': ';', 's': ' ', 'r': '\r', 'n': '\n'}


def _unescape_tag_value(v):
    return re.sub(r'\\(.)', lambda m: _TAG_UNESCAPE.get(m.group(1), m.group(1)), v)


def parse_irc(raw):
    tags = {}
    original_raw = raw
    if raw.startswith('@'):
        parts = raw[1:].split(' ', 1)
        if len(parts) == 2:
            tags_str, raw = parts
            for tag in tags_str.split(';'):
                if '=' in tag:
                    k, v = tag.split('=', 1)
                    tags[k] = _unescape_tag_value(v)
                else:
                    tags[tag] = True

    match = _IRC_PATTERN.match(raw)
    if not match:
        return None

    data = match.groupdict()
    nick = data['source'].split('!')[0] if data['source'] else "System"
    params = data['params'].strip().split() if data['params'] else []

    return {
        "tags": tags,
        "nick": nick,
        "mask": data['source'] if data['source'] and '!' in data['source'] else "",
        "command": data['command'],
        "params": params,
        "target": params[0] if params else "",
        "message": data['trailing'] or "",
        "raw": original_raw
    }