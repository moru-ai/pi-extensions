---
name: wt
description: "Worktree management for worker exec-plan workflow. Creates local worktrees, syncs to workers with env/deps setup. Use when asked to create a worktree, send code to a worker, sync branches, list worktrees, or clean up old worktrees."
metadata:
  author: omin
  version: "1.0.0"
---

# wt — Worktree → worker exec-plan workflow

Manages git worktrees locally and on workers (Mac minis) for exec-plan-loop execution.

## Naming Convention

| Location | Pattern | Example |
|----------|---------|---------|
| Local | `~/wt/wt-<name>/` | `~/wt/wt-agent-chat/` |
| Worker | `~/<repo>-wt/<name>/` | `~/ai-company-wt/agent-chat/` |
| Branch | `plan/<name>` (default) | `plan/agent-chat` |

The repo name is auto-detected from `git remote`. Multi-repo safe — each repo gets its own `<repo>-wt/` directory.

## Standard Workflow

```bash
# 1. Create local worktree + branch
wt create agent-chat

# 2. Write the exec plan
cd ~/wt/wt-agent-chat
# Edit docs/exec-plans/active/agent-chat.md

# 3. Commit
git add -A && git commit -m "plan: agent-chat"

# 4. Send to worker (push + worktree + env setup)
wt send agent-chat

# 5. Start execution on worker
ssh worker-1
cd ~/ai-company-wt/agent-chat
pi  # → /start-exec-plan-loop
```

> **Tip:** To send to worker-2 instead: `wt send agent-chat -w worker-2`

## Commands

### `wt create <name> [base-branch]`

Creates a local worktree at `~/wt/wt-<name>/` with branch `plan/<name>`.

- Default base: `main`
- Symlinks `.env.local` and `node_modules` from the main repo
- Creates `docs/exec-plans/active/` directory

```bash
wt create agent-chat              # branch: plan/agent-chat, base: main
wt create pod-refactor develop    # branch: plan/pod-refactor, base: develop
wt create fix-login -b fix/login  # use custom branch name
```

### `wt send <name> [-w <host>]`

Pushes the branch and sets up a worktree on the remote worker.

Setup includes:
- `git fetch` + `git worktree add` on worker
- Symlink `.env.local` from the main repo
- Symlink `node_modules` from the main repo
- `npx prisma generate`

```bash
wt send agent-chat
# → pushes plan/agent-chat
# → creates ~/ai-company-wt/agent-chat/ on worker
# → ready for pi exec-plan-loop
```

### `wt sync <name> [-w <host>]`

Quick push + pull without full setup. Use for incremental updates after the initial `send`.

```bash
wt sync agent-chat
# → git push + git reset --hard origin/branch on worker
```

### `wt list`

Shows all worktrees locally and on the remote worker. Legacy worktrees (old naming conventions) are shown separately.

```bash
wt list
# Local
#   /Users/omin/ai-company  main
#   ~/wt/wt-agent-chat  plan/agent-chat
#
# Mac-mini (ai-company-wt/)
#   agent-chat → plan/agent-chat (abc1234)
#
# Legacy (not managed):
#   ~/ai-company-cs/ → cs/context-gather-ui
```

### `wt clean <name> [local|remote|both] [-w <host>]`

Removes a worktree. Default: `both` (local + worker).

```bash
wt clean agent-chat           # remove from both local and worker
wt clean agent-chat local     # local only
wt clean agent-chat remote    # worker only
```

## Setup

The `wt` CLI is shipped via `pi-extensions`. Add to `~/.zshrc`:

```bash
# pi-extensions CLI tools
export PATH="$HOME/pi-extensions/bin:$PATH"

# wt remote sync (default worker)
export WT_REMOTE_HOST=worker-1
export WT_REMOTE_USER=vacatio
```

Worktrees are created at `~/wt/wt-<name>/` by default. Override with `WT_LOCAL_BASE`.

### Multi-worker

Use `--worker` / `-w` to target a specific worker:

```bash
wt send agent-chat                # → default (worker-1)
wt send agent-chat -w worker-2    # → worker-2
wt sync agent-chat -w worker-2
wt list -w worker-2
wt clean agent-chat -w worker-2
```

## Script Location

- Source: `~/pi-extensions/bin/wt` (via `@moru-ai/pi-extensions` package)
- PATH: `$HOME/pi-extensions/bin` must be in PATH

## Legacy Worktrees

Before `wt`, worktrees were created manually with inconsistent naming:
- `~/ai-company-<feature>/` (home directory)
- `~/ai-company-worktrees/<name>/` (worktrees directory)
- `~/worktrees/<name>/` (another directory)

These show up as "Legacy" in `wt list`. New worktrees should always use `wt create`.
