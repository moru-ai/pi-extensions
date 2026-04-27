# pi-extensions

Shared [pi](https://github.com/mariozechner/pi-coding-agent) extensions, agents, and prompts for the Moru team.

## Install

```bash
# Project-local (committed to repo, shared with team)
pi install -l git:github.com/moru-ai/pi-extensions

# Global (your machine only)
pi install git:github.com/moru-ai/pi-extensions
```

## Update

```bash
pi update
```

## What's included

### Extensions

| Extension | Description |
|-----------|-------------|
| `agent` | Child agent delegation tool with concurrent task execution |
| `ask-user-question` | Tool for the LLM to ask the user clarifying questions |
| `audit-plan` | Audit plan review |
| `commit-push` | Git commit and push automation |
| `enable-all-tools` | Enable all available tools |
| `exec-plan-loop` | Execution plan loop for structured task execution |
| `perspectives` | Multi-model structured deliberation (investigate → critique → synthesize) |
| `review` | Code review tool |
| `websearch` | Web search tool |

### Agents (used by `agent` extension)

| Agent | Description |
|-------|-------------|
| `explorer` | Read-only codebase exploration and search |
| `general-purpose` | Multi-step research and implementation |

### Skills

| Skill | Description |
|-------|-------------|
| `deep-interview` | Socratic interview that lowers ambiguity and saves a clarified transcript |
| `wt` | Worktree management with optional remote sync |

### Prompts

| Prompt | Description |
|--------|-------------|
| `prd` | Write a PRD through a lightweight interview |

### CLI Tools

| Tool | Description |
|------|-------------|
| `wt` | Worktree management with optional remote sync |

**Setup:** Add to `~/.zshrc`:
```bash
# pi-extensions CLI tools
export PATH="$HOME/pi-extensions/bin:$PATH"

# wt remote sync (default worker)
export WT_REMOTE_HOST=worker-1
export WT_REMOTE_USER=vacatio
```

Worktrees are created at `~/wt/wt-<name>/` by default. Override with `WT_LOCAL_BASE`.

Target a specific worker with `-w`: `wt send my-feature -w worker-2`

## Structure

```
pi-extensions/
├── package.json
├── bin/                  ← CLI tools (wt)
├── extensions/           ← pi loads these as extensions
├── agents/               ← read by agent extension (relative path)
├── perspectives-prompts/ ← read by perspectives extension (relative path)
└── prompts/              ← pi loads these as prompt templates
```

## Adding project-specific extensions

This package contains team-shared extensions. For project-specific extensions (e.g., `go-lint-after-format`, `openapi-codegen-on-write`), keep them in the project's `.pi/extensions/` directory.
