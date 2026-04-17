# Worker Setup Guide

Complete guide to set up 2 Mac mini workers for the exec-plan-loop workflow.

## Architecture

```
┌─────────────────┐     SSH      ┌──────────────┐
│   Your Mac       │────────────▶│   worker-1    │  ← moruclaw (Discord bot)
│   (dev machine)  │────────┐    │   (Mac mini)  │  ← runs exec-plan-loops
└─────────────────┘        │    └──────────────┘
                           │
                           │    ┌──────────────┐
                           └───▶│   worker-2    │  ← runs exec-plan-loops
                                │   (Mac mini)  │
                                └──────────────┘

Workflow:
  1. Local: wt create <name> → write plan → wt send <name>
  2. Discord: tell your bot "run exec-plan-loop on <name>"
  3. Bot runs the loop on the worker, reports every 10 min
  4. When done, branch is pushed → you review
```

## What You Need

- 2 Mac minis (Apple Silicon, 16GB+ RAM)
- Your dev Mac (MacBook / iMac / etc)
- Tailscale account (all 3 machines on same tailnet)
- GitHub account with SSH key
- Discord bot token (create your own bot)
- Shared Bedrock token (ask the team)

---

## Part 1: Tailscale (All Machines)

Install Tailscale on all 3 machines so they can reach each other.

```bash
# On each machine
brew install tailscale

# Start and authenticate
sudo tailscale up
```

After all machines are on Tailscale, note the IPs:
```bash
tailscale status
# e.g. 100.x.x.x  worker-1
#      100.y.y.y  worker-2
```

---

## Part 2: Local Mac Setup

### 2.1 SSH Config

Edit `~/.ssh/config` and add your workers:

```
Host worker-1
  HostName <TAILSCALE_IP_1>
  User <YOUR_USERNAME>
  IdentityFile ~/.ssh/id_ed25519
  IdentitiesOnly yes

Host worker-2
  HostName <TAILSCALE_IP_2>
  User <YOUR_USERNAME>
  IdentityFile ~/.ssh/id_ed25519
  IdentitiesOnly yes
```

### 2.2 Copy SSH Key to Workers

```bash
# For each worker — enter the worker's password when prompted
ssh-copy-id -i ~/.ssh/id_ed25519 worker-1
ssh-copy-id -i ~/.ssh/id_ed25519 worker-2

# Verify
ssh worker-1 "hostname"
ssh worker-2 "hostname"
```

### 2.3 Install Pi + Extensions

```bash
# Install pi (requires Node.js 22+)
npm install -g @mariozechner/pi-coding-agent

# Install shared extensions
pi install git:github.com/moru-ai/pi-extensions

# Add wt to PATH — add these to ~/.zshrc
export PATH="$HOME/pi-extensions/bin:$PATH"
export WT_REMOTE_HOST=worker-1
export WT_REMOTE_USER=<YOUR_USERNAME>
```

### 2.4 Pi Auth

```bash
pi auth
```

---

## Part 3: Worker Setup

Run these steps on **both** workers. SSH in from your local Mac:

```bash
ssh worker-1   # then repeat for worker-2
```

### 3.1 Enable Passwordless Sudo (for setup)

```bash
sudo bash -c 'echo "<YOUR_USERNAME> ALL=(ALL) NOPASSWD: ALL" > /etc/sudoers.d/myuser && chmod 0440 /etc/sudoers.d/myuser'
```

### 3.2 Homebrew

```bash
NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

echo >> ~/.zprofile
echo 'eval "$(/opt/homebrew/bin/brew shellenv zsh)"' >> ~/.zprofile
eval "$(/opt/homebrew/bin/brew shellenv)"
```

### 3.3 Node.js + tmux

```bash
brew install node tmux
```

### 3.4 SSH Key for GitHub

Option A — Generate new key on the worker:
```bash
ssh-keygen -t ed25519 -C "your@email.com"
cat ~/.ssh/id_ed25519.pub
# → Add this to GitHub: Settings → SSH Keys → New SSH Key
```

Option B — Copy existing key from your local Mac:
```bash
# Run from your LOCAL Mac
scp ~/.ssh/id_ed25519 worker-1:~/.ssh/
scp ~/.ssh/id_ed25519.pub worker-1:~/.ssh/
ssh worker-1 "chmod 600 ~/.ssh/id_ed25519"
```

Verify:
```bash
ssh-keyscan github.com >> ~/.ssh/known_hosts 2>/dev/null
ssh -T git@github.com
# → "Hi <username>! You've successfully authenticated..."
```

### 3.5 Git Config

```bash
git config --global user.name "Your Name"
git config --global user.email "your@email.com"
git config --global push.autosetupremote true
git config --global url."git@github.com:".insteadOf "https://github.com/"
```

### 3.6 Claude CLI + Bedrock

```bash
curl -fsSL https://claude.ai/install.sh | sh
export PATH="$HOME/.local/bin:$PATH"

mkdir -p ~/.claude
cat > ~/.claude/settings.json << 'EOF'
{
  "env": {
    "CLAUDE_CODE_USE_BEDROCK": "1",
    "AWS_REGION": "ap-northeast-2",
    "AWS_BEARER_TOKEN_BEDROCK": "<ASK_TEAM_FOR_TOKEN>"
  },
  "permissions": {
    "defaultMode": "bypassPermissions"
  },
  "sandbox": {
    "enabled": false
  },
  "effortLevel": "high",
  "skipDangerousModePermissionPrompt": true,
  "model": "global.anthropic.claude-opus-4-6-v1"
}
EOF
```

### 3.7 Pi CLI + Extensions

```bash
npm install -g @mariozechner/pi-coding-agent
npm install -g @openai/codex

pi auth
pi install git:github.com/moru-ai/pi-extensions
```

Pi settings:
```bash
mkdir -p ~/.pi/agent
cat > ~/.pi/agent/settings.json << 'EOF'
{
  "defaultThinkingLevel": "high",
  "defaultProvider": "anthropic",
  "defaultModel": "claude-sonnet-4-20250514",
  "retry": {
    "enabled": true,
    "maxRetries": 5,
    "baseDelayMs": 2000,
    "maxDelayMs": 60000
  },
  "packages": [
    "git:github.com/moru-ai/pi-extensions"
  ]
}
EOF
```

Bedrock env:
```bash
mkdir -p ~/.config/pi-secrets
cat > ~/.config/pi-secrets/bedrock.env << 'EOF'
export AWS_REGION=ap-northeast-2
export AWS_BEARER_TOKEN_BEDROCK=<ASK_TEAM_FOR_TOKEN>
EOF
```

### 3.8 Zsh Setup (optional but recommended)

```bash
sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)" "" --unattended

git clone https://github.com/zsh-users/zsh-syntax-highlighting ${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/zsh-syntax-highlighting
git clone https://github.com/zsh-users/zsh-autosuggestions ${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/zsh-autosuggestions
```

```bash
cat > ~/.zshrc << 'ZSHRC'
export PATH="$HOME/.local/bin:$HOME/bin:$PATH"

export ZSH="$HOME/.oh-my-zsh"
ZSH_THEME="robbyrussell"
plugins=(git zsh-syntax-highlighting zsh-autosuggestions)
source $ZSH/oh-my-zsh.sh

eval "$(/opt/homebrew/bin/brew shellenv)"

alias g="git"
alias n="npm"

[ -f "$HOME/.config/pi-secrets/bedrock.env" ] && source "$HOME/.config/pi-secrets/bedrock.env"
ZSHRC

source ~/.zshrc
```

### 3.9 Prevent Sleep

```bash
sudo pmset -a sleep 0 displaysleep 0 disksleep 0
```

### 3.10 Enable Screen Sharing

```bash
sudo /System/Library/CoreServices/RemoteManagement/ARDAgent.app/Contents/Resources/kickstart \
  -activate -configure -access -on -users $(whoami) -privs -all -restart -agent -menu
```

Access via `vnc://<TAILSCALE_IP>` from your Mac.

---

## Part 4: MoruClaw (Discord Bot)

Set up on **one** worker. The bot orchestrates exec-plan-loops and reports progress via Discord.

### 4.1 Create a Discord Bot

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. New Application → name it
3. Bot → Reset Token → copy the token
4. Bot → enable **MESSAGE CONTENT INTENT**
5. OAuth2 → URL Generator → select `bot` → select permissions → copy invite URL
6. Open the URL to invite bot to your server

### 4.2 Clone and Build

```bash
cd ~
git clone git@github.com:moru-ai/moruclaw.git
cd moruclaw
npm install
npm run build
```

### 4.3 Configure

```bash
cat > ~/moruclaw/.env << 'EOF'
DISCORD_BOT_TOKEN=<YOUR_DISCORD_BOT_TOKEN>
ASSISTANT_NAME="<YOUR_BOT_NAME>"
EOF
chmod 600 ~/moruclaw/.env
mkdir -p ~/moruclaw/logs
```

### 4.4 Launchd Service (auto-start on boot)

```bash
cat > ~/Library/LaunchAgents/com.nanoclaw.plist << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.nanoclaw</string>
    <key>ProgramArguments</key>
    <array>
        <string>/opt/homebrew/bin/node</string>
        <string>$HOME/moruclaw/dist/index.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$HOME/moruclaw</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/opt/homebrew/sbin:$HOME/.local/bin:$HOME/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
        <key>HOME</key>
        <string>$HOME</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>$HOME/moruclaw/logs/moruclaw-launchd.log</string>
    <key>StandardErrorPath</key>
    <string>$HOME/moruclaw/logs/moruclaw-launchd.log</string>
</dict>
</plist>
EOF

launchctl load ~/Library/LaunchAgents/com.nanoclaw.plist

# Verify
sleep 3
tail -20 ~/moruclaw/logs/moruclaw-launchd.log
```

### 4.5 Managing MoruClaw

```bash
# Update + restart
cd ~/moruclaw && git pull origin main && npm run build
launchctl kickstart -k gui/$(id -u)/com.nanoclaw

# Stop / Start
launchctl unload ~/Library/LaunchAgents/com.nanoclaw.plist
launchctl load ~/Library/LaunchAgents/com.nanoclaw.plist

# Logs
tail -f ~/moruclaw/logs/moruclaw-launchd.log
```

---

## Part 5: Daily Workflow

### 1. Plan locally

```bash
cd ~/your-repo
wt create my-feature
cd ~/wt/wt-my-feature

# Write your exec plan
# Edit docs/exec-plans/active/my-feature.md

git add -A && git commit -m "plan: my-feature"
```

### 2. Send to worker

```bash
wt send my-feature                  # default worker
wt send my-feature -w worker-2     # specific worker
```

### 3. Tell the bot

In your Discord channel, tell your bot:
> run exec-plan-loop on my-feature

The bot will:
- Start `pi` in the worktree on the worker
- Run `/start-exec-plan-loop`
- Report progress every 10 minutes
- Push the branch when done

### 4. Review

```bash
git pull origin plan/my-feature
# Review the changes, merge when ready
```

---

## Verification Checklist

Run on each worker:

```bash
echo "=== Node ===" && node --version
echo "=== Git ===" && git config user.name && ssh -T git@github.com 2>&1 | head -1
echo "=== Claude ===" && claude --version 2>&1 | head -1
echo "=== Pi ===" && pi --version 2>&1 | head -1
echo "=== Codex ===" && codex --version 2>&1 | head -1
echo "=== tmux ===" && tmux -V
echo "=== Sleep ===" && pmset -g | grep "sleep "
echo "=== Bedrock ===" && [ -n "$AWS_BEARER_TOKEN_BEDROCK" ] && echo "✅" || echo "❌ MISSING"
```

Expected:
```
Node    v25+
Git     Hi <user>! You've successfully authenticated...
Claude  2.x.x (Claude Code)
Pi      0.6x.x
Codex   codex-cli 0.1xx.x
tmux    tmux 3.6+
Sleep   sleep 0
Bedrock ✅
```

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Worker sleeps | `sudo pmset -a sleep 0 displaysleep 0 disksleep 0` |
| Tailscale disconnects | `sudo tailscale up` on the worker |
| Pi auth expired | `pi auth` on the worker |
| Bedrock 403 | Ask team for fresh `AWS_BEARER_TOKEN_BEDROCK` |
| MoruClaw crashes | `tail -50 ~/moruclaw/logs/moruclaw-launchd.log` |
| `wt send` fails | Ensure worker has the repo cloned at `~/your-repo` |
| SSH timeout | Check Tailscale: `tailscale status` |
