import asyncio

def on_kick(word, word_eol, userdata):
    kicker = word[0]
    kicked = word[1]
    channel = word[2]
    network = word[4]

    own_nick = webirc.get_info("nick", network) or ""
    if kicked.lower() == own_nick.lower():
        async def rejoin():
            await asyncio.sleep(5)
            webirc.command(network, f"JOIN {channel}")
            webirc.prnt(f"Autojoin: Rejoined {channel} after kick by {kicker}.")
        
        asyncio.create_task(rejoin())

def on_invite(word, word_eol, userdata):
    inviter = word[0]
    channel = word[1]
    network = word[2]

    webirc.command(network, f"JOIN {channel}")
    webirc.prnt(f"Autojoin: Accepted invitation to {channel} from {inviter}.")

webirc.hook_print("Kick", on_kick)
webirc.hook_print("Invite", on_invite)
