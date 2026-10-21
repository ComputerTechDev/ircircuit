__plugin_info__ = {
    "name":        "Hello Responder",
    "description": "Replies 'hi' when someone says hello in a channel",
    "author":      "ircircuit",
    "version":     "1.1",
}

def on_message(word, word_eol, ud):
    nick, text, channel, network = word
    if "hello" in text.lower():
        if nick == irc.get_info("nick", network):
            return irc.EAT_NONE
        irc.send_msg(network, channel, f"hi {nick}!")
    return irc.EAT_NONE

irc.hook_print("Channel Message", on_message)
