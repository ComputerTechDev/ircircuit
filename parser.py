import re

_IRC_PATTERN = re.compile(
    r'^(?::(?P<source>[^ ]+) +)?(?P<command>[^ ]+)(?P<params>(?: +[^ :][^ ]*)*)(?: +:(?P<trailing>.*))?$'
)

_TAG_UNESCAPE = {'\\': '\\', ':': ';', 's': ' ', 'r': '\r', 'n': '\n'}

# Commands whose final parameter is free text, mapped to the minimum number of
# params required for that final param to be the text. RFC 1459/2812 allow the
# ':' prefix to be omitted when the text is a single word without spaces, and
# some ircds do exactly that (e.g. ":nick PRIVMSG #chan hello").
_TEXT_LAST_PARAM_MIN = {
    'PRIVMSG': 2, 'NOTICE': 2, 'TOPIC': 2, 'PART': 2, 'KICK': 3,
    'QUIT': 1, 'AWAY': 1, 'ERROR': 1, 'WALLOPS': 1,
    '332': 3, '372': 2,
}


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
    command = data['command']
    message = data['trailing']

    if message is None:
        message = ""
        min_params = _TEXT_LAST_PARAM_MIN.get(command.upper())
        if min_params is not None and len(params) >= min_params:
            message = params[-1]
            params = params[:-1]

    return {
        "tags": tags,
        "nick": nick,
        "mask": data['source'] if data['source'] and '!' in data['source'] else "",
        "command": command,
        "params": params,
        "target": params[0] if params else "",
        "message": message,
        "raw": original_raw
    }