# Stream Bot — Full Command Reference

---

## TWITCH CHAT COMMANDS

### Public Commands (anyone can use)

| Command | Description |
|---|---|
| `!game` | Shows the game currently being played |
| `!uptime` | Shows how long the stream has been live |
| `!viewers` | Shows the current viewer count |
| `!followage` | Shows how long YOU have been following the channel |
| `!stats` | Shows peak viewers and average viewers from the last stream |
| `!title` | Shows the current stream title |
| `!commands` | Lists all available commands |

---

### Mod Commands (moderators + broadcaster only)

| Command | Example | Description |
|---|---|---|
| `!ban <user> [reason]` | `!ban toxicuser spamming` | Permanently bans a user from chat |
| `!unban <user>` | `!unban toxicuser` | Removes a ban from a user |
| `!timeout <user> [duration] [reason]` | `!timeout spammer 10m being rude` | Times out a user. Duration can be seconds (300), minutes (10m), or hours (1h). Default is 5 minutes |
| `!purge <user>` | `!purge spammer` | 1-second timeout — effectively clears a user's recent messages |
| `!warn <user> [reason]` | `!warn username stop spamming` | Adds a strike to a user (see strike system below). At 3 strikes they are auto-banned |
| `!permit <user>` | `!permit friendlyuser` | Allows a specific user to post one link in the next 60 seconds (bypasses link filter) |
| `!slow <seconds>` | `!slow 30` | Enables slow mode — users can only chat every X seconds |
| `!slowoff` | `!slowoff` | Disables slow mode |
| `!subonly` | `!subonly` | Enables subscriber-only chat mode |
| `!suboff` | `!suboff` | Disables subscriber-only mode |
| `!emoteonly` | `!emoteonly` | Enables emote-only chat mode |
| `!emoteoff` | `!emoteoff` | Disables emote-only mode |
| `!clear` | `!clear` | Clears the entire chat for everyone |

---

### Broadcaster-Only Commands (channel owner only)

| Command | Example | Description |
|---|---|---|
| `!addword <word> [action] [seconds]` | `!addword badword timeout 300` | Adds a word to the banned word list. Action can be `delete`, `timeout`, or `ban`. Seconds only applies to timeout action |
| `!removeword <word>` | `!removeword badword` | Removes a word from the banned word list |

---

### Twitch Auto-Mod (runs automatically, no command needed)

Auto-mod silently watches all non-mod messages and enforces rules automatically.
Moderators and the broadcaster are **never** affected by auto-mod.

| Filter | What it catches | Default action |
|---|---|---|
| **Banned word filter** | Any message containing a word from your banned list | Configurable per word (delete / timeout / ban) |
| **Link filter** | Any message containing a URL or link | Deletes the message. Use `!permit <user>` to allow someone to post a link |
| **Caps filter** | Messages over 10 characters where more than 75% are capital letters | Adds a strike |
| **Spam/repeat filter** | Sending the same message 4+ times within 10 seconds | Adds a strike |

**Strike system (progressive punishment):**
- Strike 1 → 60-second timeout + message deleted
- Strike 2 → 10-minute timeout + message deleted
- Strike 3 → Permanent ban

Strikes are stored in the database and persist across streams.
Manual mod strikes (`!warn`) also count toward the same strike total.

---

## DISCORD SLASH COMMANDS

### Stream Stats (anyone can use)

| Command | Description |
|---|---|
| `/stats` | If stream is live: shows current game, uptime, viewer count and peak. If offline: shows last stream's duration, peak viewers and average viewers |
| `/history [count]` | Shows your last X streams (up to 10). Displays date, duration, peak viewers and average viewers for each |
| `/topgames [count]` | Shows your most-played games ranked by total hours. Shows number of streams and total time per game |

---

### Account Linking (anyone can use)

| Command | Description |
|---|---|
| `/link twitch <username>` | Links your Discord account to your Twitch username. If you're already a follower or subscriber, the matching role is assigned to you immediately |
| `/link status` | Shows which Twitch account is currently linked to your Discord |
| `/link remove` | Unlinks your Twitch account from your Discord |

Linking your account is required to receive auto-roles for following or subscribing on Twitch.

---

### Moderation Commands (moderators only)

| Command | Example | Description |
|---|---|---|
| `/mod warn <user> [reason]` | `/mod warn @user spamming` | Issues a warning to a Discord member. The user receives a DM with the reason and their warning count. All warnings are logged |
| `/mod warnings <user>` | `/mod warnings @user` | Shows all warnings on record for a member, with dates and reasons |
| `/mod clearwarn <user>` | `/mod clearwarn @user` | Clears ALL warnings for a member |
| `/mod mute <user> <duration> [reason]` | `/mod mute @user 1h being disruptive` | Puts a Discord timeout on a member. Duration format: `30s`, `10m`, `2h`, `1d`. Maximum is 28 days |
| `/mod unmute <user>` | `/mod unmute @user` | Removes a timeout from a member early |
| `/mod kick <user> [reason]` | `/mod kick @user rule violation` | Kicks a member from the server. They can rejoin with a new invite |
| `/mod ban <user> [reason] [delete_days]` | `/mod ban @user harassment 7` | Bans a member. `delete_days` (0–7) deletes their recent messages |
| `/mod unban <user_id>` | `/mod unban 123456789` | Unbans a user by their Discord user ID |

All `/mod` actions are posted to your mod log channel and the user receives a DM explaining what happened.

---

### Admin Setup Commands (server admins only)

| Command | Description |
|---|---|
| `/setup show` | Shows all current bot settings |
| `/setup announce #channel` | Sets the channel where stream live/offline announcements, new followers, subs, gifts and cheers are posted |
| `/setup modlog #channel` | Sets the channel where ALL mod actions are logged — both Discord mod actions (/mod commands) and Twitch chat mod actions (!ban, !timeout, etc.) |
| `/setup follower-role @role` | Role automatically assigned to users who link their Discord account AND are already following on Twitch |
| `/setup subscriber-role @role` | Role automatically assigned to users who link their Discord account AND subscribe on Twitch |
| `/setup live-role @role` | Role given to everyone in the server when the stream goes live, removed when it ends |
| `/setup automod` | Toggles individual auto-mod filters on or off (master switch, link filter, caps filter, spam filter) |

---

## AUTO EVENTS (no command needed)

These happen automatically without any command:

| Event | What gets posted |
|---|---|
| Stream goes live | Announcement embed with title, game and link to watch |
| Stream ends | Summary embed with duration, peak viewers and average viewers |
| New Twitch follower | "❤️ username just followed!" message in announce channel |
| New Twitch subscriber | "⭐ username just subscribed (Tier X)!" message |
| Gift subs | "🎁 username gifted X subs!" message |
| Bits cheer | "💎 username cheered X bits!" message |
| Any mod action (Twitch or Discord) | Full embed in mod log channel with action, target, moderator and reason |

---

## PLATFORMS COVERED

| Feature | Twitch | Discord |
|---|---|---|
| Auto-mod (word filter, links, caps, spam) | ✅ | ❌ (Discord has built-in auto-mod) |
| Mod commands (ban, timeout, etc.) | ✅ chat commands | ✅ slash commands |
| Warning system with history | ✅ strike system | ✅ /mod warn |
| Mod log (all actions logged) | ✅ relayed to Discord | ✅ logged directly |
| Stream announcements | — | ✅ |
| Auto-roles for followers/subs | — | ✅ (requires /link) |
| Stream stats and history | — | ✅ |

---

## REQUIRED TWITCH TOKEN SCOPES

Make sure your Twitch token has all of these scopes for every feature to work:

```
channel:read:subscriptions
moderator:read:followers
moderator:manage:banned_users
moderator:manage:chat_messages
moderator:manage:chat_settings
bits:read
channel:read:redemptions
chat:read
chat:edit
```

Get/regenerate your token at: https://twitchtokengenerator.com
