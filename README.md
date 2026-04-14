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

### Prompts

| Prompt | Description |
|--------|-------------|
| `perspectives` | Perspectives deliberation prompt template |
| `kickoff` | Start a new workstream — gather requirements, create worktree, write exec plan |

### CLI Tools

| Tool | Description |
|------|-------------|
| `wt` | Worktree management with optional remote sync |

**Setup:** Run `/setup-wt` in pi, or manually:
```bash
ln -sf $(pi resolve @moru-ai/pi-extensions)/bin/wt ~/bin/wt

# For remote sync (optional):
export WT_REMOTE_HOST=mac-mini
export WT_REMOTE_USER=vacatio
```

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
