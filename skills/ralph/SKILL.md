---
name: ralph
description: Long-running iterative development loops with pacing control and verifiable progress. Use when tasks require multiple iterations, many discrete steps, or periodic reflection with clear checkpoints; avoid for simple one-shot tasks or quick fixes.
---

# Ralph - Long-Running Development Loops

Use the `ralph_start` tool to begin a loop:

```
ralph_start({
  name: "loop-name",
  taskContent: "# Task\n\n## Goals\n- Goal 1\n\n## Checklist\n- [ ] Item 1\n- [ ] Item 2",
  maxIterations: 50,        // Default: 50
  itemsPerIteration: 3,     // Optional: suggest N items per turn
  reflectEvery: 10          // Optional: reflect every N iterations
})
```

## Loop Behavior

1. Start from a clear task file or pass `taskContent` to `ralph_start`, which writes `.ralph/<name>.md`.
2. Work on the task and update the file each iteration.
3. Record verification evidence (commands run, file paths, outputs) in the task file.
4. Use specialist subagents when useful: `explorer` for read-only mapping, `architect` for design risk, `critic` for actionability, `verifier` for evidence, and `general-purpose` for isolated implementation only when file ownership is clear.
5. Call `ralph_done` to proceed to the next iteration.
6. Output `<promise>COMPLETE</promise>` when finished.
7. Stop when complete or when max iterations is reached (default 50).

## User Commands

- `/start-ralph-loop <name|path>` - Start a new loop.
- `/resume-ralph-loop <name>` - Resume loop.
- `/pause-ralph-loop` - Pause loop without completing it.
- `/stop-ralph-loop` - Stop active loop (idle only).
- `/status-ralph-loop` - Show loops.
- `/list-ralph-loop --archived` - Show archived loops.
- `/archive-ralph-loop <name>` - Move loop to archive.
- `/clean-ralph-loop [--all]` - Clean completed loops.
- `/cancel-ralph-loop <name>` - Delete loop.
- `/nuke-ralph-loop [--yes]` - Delete all .ralph data.

Press ESC to interrupt streaming, send a normal message to resume, and run `/stop-ralph-loop` when idle to end the loop.

## Task File Format

```markdown
# Task Title

Brief description.

## Goals
- Goal 1
- Goal 2

## Checklist
- [ ] Item 1
- [ ] Item 2
- [x] Completed item

## Verification
- Evidence, commands run, or file paths

## Notes
(Update with progress, decisions, blockers)
```

## Best Practices

1. Write a clear checklist with discrete items.
2. Update checklist and notes as you go.
3. Capture verification evidence for completed items.
4. Use `verifier` before final completion when the task has meaningful acceptance criteria.
5. Do not run parallel implementation agents against overlapping files.
6. Reflect when stuck to reassess approach.
7. Output the completion marker only when truly done.

## Interview and RALPLAN Handoff

For broad or ambiguous work, prefer `/deep-interview` → `/ralplan` → `/start-ralph-loop`. RALPLAN should produce `.ralph/plans/prd-<slug>.md`, `.ralph/plans/test-spec-<slug>.md`, and a concise `.ralph/<slug>.md` execution task. Start Ralph from `.ralph/<slug>.md`; the task file should link the requirements and test-spec artifacts and include checklist, verification plan, and subagent guidance.
