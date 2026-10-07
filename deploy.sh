#!/usr/bin/env bash
# Run this from your LOCAL machine:
#   bash deploy.sh
# It will push the code to your VPS and set everything up.

set -euo pipefail

VPS_USER="root"
VPS_HOST="45.143.196.245"
VPS_DIR="/root/stream-bot"
SSH_KEY="$HOME/.ssh/id_ed25519_backup"
REPO="https://github.com/Brysshmurda/stream-bot.git"
BRANCH="claude/funny-tesla-sckzf0"

SSH="ssh -i $SSH_KEY -o StrictHostKeyChecking=no $VPS_USER@$VPS_HOST"

echo "▶ Connecting to $VPS_HOST..."

$SSH bash <<REMOTE
set -euo pipefail

# ── Node.js 20 ────────────────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  echo "▶ Installing Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
echo "✔ Node $(node --version)"

# ── Git ───────────────────────────────────────────────────────────────────
apt-get install -y git 2>/dev/null || true

# ── Clone or update ───────────────────────────────────────────────────────
if [ -d "$VPS_DIR/.git" ]; then
  echo "▶ Updating existing clone..."
  cd "$VPS_DIR"
  git fetch origin
  git checkout $BRANCH
  git pull origin $BRANCH
else
  echo "▶ Cloning repo..."
  git clone -b $BRANCH $REPO $VPS_DIR
  cd "$VPS_DIR"
fi

# ── Dependencies ──────────────────────────────────────────────────────────
echo "▶ Installing npm dependencies..."
npm install --omit=dev

# ── .env file ─────────────────────────────────────────────────────────────
if [ ! -f "$VPS_DIR/.env" ]; then
  cp "$VPS_DIR/.env.example" "$VPS_DIR/.env"
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  ⚠  .env file created from template."
  echo "  Fill it in before starting the bot:"
  echo "    nano $VPS_DIR/.env"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
fi

# ── systemd service ───────────────────────────────────────────────────────
cat > /etc/systemd/system/stream-bot.service <<'EOF'
[Unit]
Description=Stream Bot
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/root/stream-bot
ExecStart=/usr/bin/node src/index.js
Restart=on-failure
RestartSec=10
EnvironmentFile=/root/stream-bot/.env

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable stream-bot

echo ""
echo "✔ Deploy complete!"
echo ""
echo "Next steps:"
echo "  1. Fill in your tokens:  nano $VPS_DIR/.env"
echo "  2. Start the bot:        systemctl start stream-bot"
echo "  3. Watch the logs:       journalctl -u stream-bot -f"
REMOTE
