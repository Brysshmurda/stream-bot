# Stream Bot

A Twitch + Discord bot that tracks your stream stats and manages your community.

## Features

### Stream Tracking
- Records every stream: title, start/end time, duration
- Tracks which games you played and for how long per stream
- Viewer count snapshots every 60 seconds → peak and average viewers
- Full history stored in SQLite

### Discord Bot
| Command | Description |
|---|---|
| `/stats` | Current stream stats (live) or last stream summary |
| `/history [count]` | Recent stream history (up to 10) |
| `/topgames [count]` | Most-played games ranked by total time |
| `/link twitch <username>` | Link your Discord to your Twitch account |
| `/link status` | Check your current link |
| `/link remove` | Unlink your account |
| `/setup announce #channel` | Set the stream announcement channel |
| `/setup follower-role @role` | Role given when a follower links their account |
| `/setup subscriber-role @role` | Role given when a subscriber links their account |
| `/setup live-role @role` | Role given to everyone when stream goes live |
| `/setup show` | Show current bot configuration |

**Auto events posted to announce channel:**
- 🔴 Stream goes live (with title + game)
- 📴 Stream ends (with duration, peak, avg viewers)
- ❤️ New follower
- ⭐ New subscriber / gift subs
- 💎 Cheers (bits)

### Twitch Chat Commands
| Command | Description |
|---|---|
| `!game` | Current game being played |
| `!uptime` | How long the stream has been live |
| `!viewers` | Current viewer count |
| `!followage` | How long you've been following |
| `!stats` | Quick stats from the last stream |
| `!title` | Current stream title |
| `!commands` | List all commands |

---

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Create a Twitch app
Go to https://dev.twitch.tv/console/apps and create an app.  
Set the OAuth redirect URL to `http://localhost`.

### 3. Get a Twitch user token
Go to https://twitchtokengenerator.com, enter your Client ID + Secret,  
and request these scopes:
- `channel:read:subscriptions`
- `moderator:read:followers`
- `bits:read`
- `channel:read:redemptions`
- `chat:read`
- `chat:edit`

Copy the **Access Token** and **Refresh Token**.

Find your numeric Twitch User ID at:  
https://www.streamweasels.com/tools/convert-twitch-username-to-user-id/

### 4. Create a Discord bot
1. Go to https://discord.com/developers/applications
2. Create a new application → Bot → copy the token
3. Enable **Server Members Intent** and **Message Content Intent**
4. Invite the bot with scopes: `bot applications.commands`  
   Permissions: `Manage Roles`, `Send Messages`, `View Channels`

### 5. Configure .env
```bash
cp .env.example .env
# Fill in all required values
```

### 6. Start the bot
```bash
npm start
```

### 7. Configure in Discord
Run `/setup show` to see current config, then use the other `/setup` subcommands  
to set your announcement channel and roles.

---

## Running on a VPS (systemd)

Create `/etc/systemd/system/stream-bot.service`:
```ini
[Unit]
Description=Stream Bot
After=network.target

[Service]
Type=simple
User=youruser
WorkingDirectory=/home/youruser/stream-bot
ExecStart=/usr/bin/node src/index.js
Restart=on-failure
RestartSec=10
EnvironmentFile=/home/youruser/stream-bot/.env

[Install]
WantedBy=multi-user.target
```

Then:
```bash
sudo systemctl enable stream-bot
sudo systemctl start stream-bot
sudo journalctl -u stream-bot -f
```
