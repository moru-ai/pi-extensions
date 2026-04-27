# Ralph Extension

Named simple prompt loops for Pi.

Ralph is intentionally much simpler than `exec-plan-loop`: it takes a prompt, repeats it, and stops when the assistant outputs the completion marker.

Use `exec-plan-loop` for checklist-driven, plan-backed, validation-heavy, or multi-milestone work.

## How it works

- Each Ralph loop has a namespace/name.
- If no name is provided, Ralph asks Codex Spark (`gpt-5.3-codex-spark`) to create a short slug. It includes current namespaces in the naming prompt so the model can avoid semantic collisions, with a deterministic prompt-derived fallback.
- State is stored under `.pi/ralph-loop/<name>/`.
- Each queued turn includes `RALPH_LOOP_NAME: <name>` so the extension updates the correct loop.
- After each turn, Ralph queues the next turn for that same loop unless the assistant outputs `<promise>COMPLETE</promise>`.
- Multiple named loops can coexist without sharing state.

## Commands

| Command | Description |
|---------|-------------|
| `/start-ralph-loop "prompt" [--name NAME] [--max-iterations N] [-- extra args]` | Start a prompt loop; name is auto-generated unless `--name` is passed |
| `/start-ralph-loop <name>` | Resume a persisted active loop |
| `/status-ralph-loop` | Show all loop states |
| `/stop-ralph-loop <name>` | Stop one loop |
| `/cancel-ralph-loop <name>` | Delete one loop state |
| `/cancel-ralph-loop --all` | Delete all Ralph loop state |

## Agent tool

The agent can start a loop with `ralph_start`:

```json
{
  "prompt": "Fix the small issue and keep going until done",
  "args": "optional extra context",
  "maxIterations": 50
}
```

## Completion marker

The loop stops when the assistant outputs exactly:

```xml
<promise>COMPLETE</promise>
```
