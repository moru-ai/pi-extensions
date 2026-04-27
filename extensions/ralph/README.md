# Ralph Extension

Long-running agent loops for iterative development in Pi. Best for verifiable tasks that need multiple passes, a persisted checklist, and optional reflection checkpoints.

This extension is adapted from Thomas Mustier's `pi-ralph-wiggum`, which is based on Geoffrey Huntley's Ralph Wiggum approach.

## How it works

- Ralph stores loop task files and state under `.ralph/` in the current project.
- Each loop has a name, task markdown file, state JSON file, iteration counter, and status.
- The agent works one iteration at a time, updates the task file, then calls `ralph_done` to queue the next iteration.
- The loop stops when the agent emits `<promise>COMPLETE</promise>`, reaches max iterations, or you stop it.

## Commands

| Command | Description |
|---------|-------------|
| `/start-ralph-loop <name\|path>` | Start a new loop |
| `/resume-ralph-loop <name>` | Resume a paused loop |
| `/pause-ralph-loop` | Pause current loop without completing it |
| `/stop-ralph-loop` | Stop active loop (idle only) |
| `/status-ralph-loop` | Show all loops |
| `/list-ralph-loop --archived` | Show archived loops |
| `/archive-ralph-loop <name>` | Move loop to archive |
| `/clean-ralph-loop [--all]` | Clean completed loops |
| `/cancel-ralph-loop <name>` | Delete a loop |
| `/nuke-ralph-loop [--yes]` | Delete all `.ralph` data |

### Options for `/start-ralph-loop`

| Option | Description |
|--------|-------------|
| `--max-iterations N` | Stop after N iterations (default 50) |
| `--items-per-iteration N` | Suggest N items per turn |
| `--reflect-every N` | Reflect every N iterations |

## Agent tools

The agent can self-start loops using `ralph_start`:

```json
{
  "name": "refactor-auth",
  "taskContent": "# Task\n\n## Checklist\n- [ ] Item 1",
  "maxIterations": 50,
  "itemsPerIteration": 3,
  "reflectEvery": 10
}
```

The agent advances an active loop with `ralph_done` after making real progress.

## Persistence

For a loop named `fix-tests`, Ralph writes:

```text
.ralph/fix-tests.md
.ralph/fix-tests.state.json
```

The markdown file is the human/agent-editable checklist and notes. The JSON file stores runtime state such as iteration, status, and limits.
