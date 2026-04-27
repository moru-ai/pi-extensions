---
name: ralph
description: Named simple prompt loops. Use only when the user wants one prompt repeated until the model says it is done. Use exec-plan-loop for complex checklist, planning, validation, or multi-file execution workflows.
---

# Ralph - Named Simple Prompt Loops

Ralph is intentionally small: it repeats one prompt until the assistant says it is complete.

Each loop is namespaced by name, so multiple loops can coexist without state collisions. If no name is provided, Ralph asks the Codex Spark naming model for a short slug, passes the current namespaces so it can avoid semantic collisions, and falls back to a prompt-derived slug if needed.

Use `ralph_start` for simple persistence:

```ts
ralph_start({
  prompt: "Fix the small issue and keep going until done",
  args: "optional extra context",
  maxIterations: 50
})
```

Pass `name` only when the user gave a stable namespace:

```ts
ralph_start({ name: "small-fix", prompt: "Fix the small issue and keep going until done" })
```

## Behavior

1. Ralph stores each loop under `.pi/ralph-loop/<name>/`.
2. It sends the loop prompt with a hidden-visible marker: `RALPH_LOOP_NAME: <name>`.
3. After that agent turn ends, Ralph updates only that named loop state.
4. If not complete, Ralph queues the next iteration for the same loop.
5. The loop stops when the assistant outputs exactly:

```xml
<promise>COMPLETE</promise>
```

6. The loop also stops at `maxIterations`, `/stop-ralph-loop <name>`, or `/cancel-ralph-loop <name>`.

## Commands

- `/start-ralph-loop "prompt" [--name NAME] [--max-iterations N] [-- extra args]` - Start a prompt loop. Name is auto-generated unless `--name` is passed.
- `/start-ralph-loop <name>` - Resume a persisted active named loop.
- `/status-ralph-loop` - Show all Ralph loop states.
- `/stop-ralph-loop <name>` - Stop one named loop.
- `/cancel-ralph-loop <name>` - Delete one named loop state.
- `/cancel-ralph-loop --all` - Delete all Ralph loop state.

## Use exec-plan-loop instead when

- There is a checklist or execution plan.
- The work needs durable task files.
- Verification/acceptance criteria matter.
- Multiple milestones or dependencies are involved.
- You need richer recovery, validation, commits, or active plan handling.
