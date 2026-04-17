# Worker Setup Guide

이 가이드를 Claude Code 또는 pi에 붙여넣으면, AI가 질문하면서 단계별로 셋업을 진행합니다.

## 시작하기

Claude Code나 pi에서 이렇게 입력하세요:

```
아래 가이드를 보고 나한테 질문하면서 단계별로 워커 셋업을 진행해줘.
https://raw.githubusercontent.com/moru-ai/pi-extensions/main/docs/worker-setup.md
```

---

## Agent Instructions

You are setting up 2 Mac mini workers for the exec-plan-loop workflow.
Walk the user through each step interactively. **Ask questions before executing commands.**
Do not skip steps. Do not assume values — always confirm with the user first.

### Architecture

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

---

## Step 1: Gather Info

Ask the user these questions before doing anything:

1. **워커 2대의 Tailscale IP가 뭐야?**
   - worker-1 IP: ___
   - worker-2 IP: ___
2. **워커의 유저 이름이 뭐야?** (SSH 접속용, 예: `vacatio`)
3. **워커의 비밀번호가 뭐야?** (초기 SSH 키 복사용)
4. **Bedrock 토큰 있어?** (`AWS_BEARER_TOKEN_BEDROCK` 값)
5. **GitHub SSH 키가 로컬에 있어?** (`~/.ssh/id_ed25519`)
   - 없으면 먼저 생성해야 함
6. **Discord 봇 토큰 있어?** (moruclaw 셋업할 경우)

Collect all answers, then proceed step by step.

---

## Step 2: SSH Config (Local Mac)

After getting the IPs and username, create the SSH config:

```bash
# ~/.ssh/config 에 추가
cat >> ~/.ssh/config << 'EOF'

Host worker-1
  HostName <TAILSCALE_IP_1>
  User <USERNAME>
  IdentityFile ~/.ssh/id_ed25519
  IdentitiesOnly yes

Host worker-2
  HostName <TAILSCALE_IP_2>
  User <USERNAME>
  IdentityFile ~/.ssh/id_ed25519
  IdentitiesOnly yes
EOF
```

Replace `<TAILSCALE_IP_1>`, `<TAILSCALE_IP_2>`, `<USERNAME>` with the user's answers.

Then copy SSH key to both workers:
```bash
# sshpass가 없으면 먼저 설치
brew install sshpass 2>/dev/null || brew install hudochenkov/sshpass/sshpass

sshpass -p '<PASSWORD>' ssh-copy-id -i ~/.ssh/id_ed25519 -o StrictHostKeyChecking=accept-new <USERNAME>@<TAILSCALE_IP_1>
sshpass -p '<PASSWORD>' ssh-copy-id -i ~/.ssh/id_ed25519 -o StrictHostKeyChecking=accept-new <USERNAME>@<TAILSCALE_IP_2>
```

Verify:
```bash
ssh worker-1 "hostname"
ssh worker-2 "hostname"
```

**Ask the user:** "SSH 연결 됐어? 두 워커 다 hostname 나와?"

---

## Step 3: Worker Base Setup

Run on **both** workers. Ask the user: "worker-1부터 시작할게. 준비됐어?"

### 3.1 Passwordless Sudo

```bash
ssh worker-1 "echo '<PASSWORD>' | sudo -S bash -c 'echo \"<USERNAME> ALL=(ALL) NOPASSWD: ALL\" > /etc/sudoers.d/myuser && chmod 0440 /etc/sudoers.d/myuser'"
```

### 3.2 Homebrew

```bash
ssh worker-1 "NONINTERACTIVE=1 /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
```

If this fails with "need sudo" or times out, the worker may have rebooted.
**Ask the user:** "혹시 worker-1이 꺼졌거나 재부팅됐어? 확인해줘."

After Homebrew installs:
```bash
ssh worker-1 "echo >> ~/.zprofile && echo 'eval \"\$(/opt/homebrew/bin/brew shellenv zsh)\"' >> ~/.zprofile"
```

### 3.3 Node.js + tmux

```bash
ssh worker-1 "eval \"\$(/opt/homebrew/bin/brew shellenv)\" && brew install node tmux"
```

Verify:
```bash
ssh worker-1 "eval \"\$(/opt/homebrew/bin/brew shellenv)\" && node --version && tmux -V"
```

### 3.4 SSH Key for GitHub

**Ask the user:** "워커에서 쓸 GitHub SSH 키를 로컬에서 복사할까, 아니면 워커에서 새로 만들까?"

Option A — Copy from local:
```bash
scp ~/.ssh/id_ed25519 worker-1:~/.ssh/
scp ~/.ssh/id_ed25519.pub worker-1:~/.ssh/
ssh worker-1 "chmod 600 ~/.ssh/id_ed25519 && ssh-keyscan github.com >> ~/.ssh/known_hosts 2>/dev/null"
```

Option B — Generate new on worker:
```bash
ssh worker-1 "ssh-keygen -t ed25519 -C '<EMAIL>' -N '' -f ~/.ssh/id_ed25519 && cat ~/.ssh/id_ed25519.pub"
```
Then tell the user: "이 공개키를 GitHub Settings → SSH Keys에 추가해."

Verify:
```bash
ssh worker-1 "ssh -o StrictHostKeyChecking=accept-new -T git@github.com 2>&1 | head -1"
```

### 3.5 Git Config

```bash
ssh worker-1 "git config --global user.name '<GIT_NAME>' && git config --global user.email '<GIT_EMAIL>' && git config --global push.autosetupremote true && git config --global url.'git@github.com:'.insteadOf 'https://github.com/'"
```

**Ask the user:** "Git 이름이랑 이메일 뭐야?" (if not already known)

### 3.6 Claude CLI + Bedrock

```bash
ssh worker-1 "curl -fsSL https://claude.ai/install.sh | sh"
```

Create Claude settings with the Bedrock token:
```bash
ssh worker-1 "mkdir -p ~/.claude && cat > ~/.claude/settings.json" << EOF
{
  "env": {
    "CLAUDE_CODE_USE_BEDROCK": "1",
    "AWS_REGION": "ap-northeast-2",
    "AWS_BEARER_TOKEN_BEDROCK": "<BEDROCK_TOKEN>"
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
ssh worker-1 "eval \"\$(/opt/homebrew/bin/brew shellenv)\" && npm install -g @mariozechner/pi-coding-agent @openai/codex"
```

Pi auth — **tell the user:** "워커에서 pi auth 해야 해. SSH로 접속해서 `pi auth` 실행하고 브라우저에서 인증해."
```bash
# User must run interactively:
ssh worker-1
pi auth
```

Pi system prompt:
```bash
ssh worker-1 "mkdir -p ~/.pi && curl -fsSL https://raw.githubusercontent.com/moru-ai/pi-extensions/main/docs/APPEND_SYSTEM.worker.md -o ~/.pi/APPEND_SYSTEM"
```

Pi settings:
```bash
ssh worker-1 "mkdir -p ~/.pi/agent && cat > ~/.pi/agent/settings.json" << 'EOF'
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
ssh worker-1 "mkdir -p ~/.config/pi-secrets && cat > ~/.config/pi-secrets/bedrock.env" << EOF
export AWS_REGION=ap-northeast-2
export AWS_BEARER_TOKEN_BEDROCK=<BEDROCK_TOKEN>
EOF
```

### 3.8 Zsh + Oh My Zsh

```bash
ssh worker-1 'sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)" "" --unattended'

ssh worker-1 'git clone https://github.com/zsh-users/zsh-syntax-highlighting ${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/zsh-syntax-highlighting && git clone https://github.com/zsh-users/zsh-autosuggestions ${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/zsh-autosuggestions'
```

```bash
ssh worker-1 "cat > ~/.zshrc" << 'ZSHRC'
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
```

### 3.9 Prevent Sleep + Screen Sharing

```bash
ssh worker-1 "sudo pmset -a sleep 0 displaysleep 0 disksleep 0"

ssh worker-1 "sudo /System/Library/CoreServices/RemoteManagement/ARDAgent.app/Contents/Resources/kickstart -activate -configure -access -on -users \$(whoami) -privs -all -restart -agent -menu"
```

### 3.10 Repeat for worker-2

**Ask the user:** "worker-1 끝났어. worker-2도 똑같이 진행할게. 준비됐어?"

Then repeat Steps 3.1–3.9 replacing `worker-1` with `worker-2`.

---

## Step 4: MoruClaw (Discord Bot)

**Ask the user:** "Discord 봇도 셋업할 거야? 봇 토큰 있어?"

If yes, set up on one worker (ask which one):

```bash
ssh worker-1 "eval \"\$(/opt/homebrew/bin/brew shellenv)\" && cd ~ && git clone git@github.com:moru-ai/moruclaw.git && cd moruclaw && npm install && npm run build"
```

```bash
ssh worker-1 "cat > ~/moruclaw/.env" << EOF
DISCORD_BOT_TOKEN=<DISCORD_TOKEN>
ASSISTANT_NAME="<BOT_NAME>"
EOF

ssh worker-1 "chmod 600 ~/moruclaw/.env && mkdir -p ~/moruclaw/logs"
```

**Ask the user:** "봇 이름 뭘로 할 거야?"

Launchd service:
```bash
ssh worker-1 "cat > ~/Library/LaunchAgents/com.nanoclaw.plist" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.nanoclaw</string>
    <key>ProgramArguments</key>
    <array>
        <string>/opt/homebrew/bin/node</string>
        <string>dist/index.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/Users/<USERNAME>/moruclaw</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/opt/homebrew/sbin:/Users/<USERNAME>/.local/bin:/Users/<USERNAME>/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
        <key>HOME</key>
        <string>/Users/<USERNAME></string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/Users/<USERNAME>/moruclaw/logs/moruclaw-launchd.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/<USERNAME>/moruclaw/logs/moruclaw-launchd.log</string>
</dict>
</plist>
EOF
```

Start:
```bash
ssh worker-1 "launchctl load ~/Library/LaunchAgents/com.nanoclaw.plist && sleep 3 && tail -20 ~/moruclaw/logs/moruclaw-launchd.log"
```

---

## Step 5: Local Mac (Pi + wt)

Back on the user's local Mac:

```bash
npm install -g @mariozechner/pi-coding-agent
pi install git:github.com/moru-ai/pi-extensions
pi auth
```

Pi system prompt:
```bash
mkdir -p ~/.pi/agent
curl -fsSL https://raw.githubusercontent.com/moru-ai/pi-extensions/main/docs/APPEND_SYSTEM.md \
  -o ~/.pi/agent/APPEND_SYSTEM.md
```

Add to `~/.zshrc`:
```bash
export PATH="$HOME/pi-extensions/bin:$PATH"
export WT_REMOTE_HOST=worker-1
export WT_REMOTE_USER=<USERNAME>
```

---

## Step 6: Verify Everything

Run on each worker:
```bash
ssh worker-1 bash << 'EOF'
export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:$HOME/.local/bin:$HOME/bin:$PATH"
echo "=== Node ===" && node --version
echo "=== Git ===" && ssh -o StrictHostKeyChecking=accept-new -T git@github.com 2>&1 | head -1
echo "=== Claude ===" && claude --version 2>&1 | head -1
echo "=== Pi ===" && pi --version 2>&1 | head -1
echo "=== Codex ===" && codex --version 2>&1 | head -1
echo "=== tmux ===" && tmux -V
echo "=== Sleep ===" && pmset -g | grep "sleep "
echo "=== Bedrock ===" && source ~/.config/pi-secrets/bedrock.env 2>/dev/null && [ -n "$AWS_BEARER_TOKEN_BEDROCK" ] && echo "✅" || echo "❌ MISSING"
EOF
```

**Show the results to the user and ask:** "다 ✅ 나와? 문제 있는 거 있어?"

If all good:
```
🎉 셋업 완료!

워크플로우:
  1. wt create <name>     → 로컬에서 플랜 작성
  2. wt send <name>       → 워커로 전송
  3. Discord 봇한테 명령   → exec-plan-loop 실행
  4. 봇이 10분마다 보고    → 완료되면 브랜치 push
  5. git pull              → 리뷰 & 머지
```

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Worker sleeps | `sudo pmset -a sleep 0 displaysleep 0 disksleep 0` |
| Tailscale disconnects | `sudo tailscale up` on the worker |
| Pi auth expired | `pi auth` on the worker (interactive) |
| Bedrock 403 | Ask team for fresh `AWS_BEARER_TOKEN_BEDROCK` |
| MoruClaw crashes | `tail -50 ~/moruclaw/logs/moruclaw-launchd.log` |
| `wt send` fails | Ensure worker has the repo cloned at `~/your-repo` |
| SSH timeout | Check Tailscale: `tailscale status` |
| Homebrew install fails | Worker may need reboot — ask user to check physically |
