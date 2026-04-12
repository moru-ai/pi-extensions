1. If `.pi/exec-plan-loop/steering.md` exists, follow it unless it conflicts with a newer direct user instruction.
2. Re-read the active exec plans and their Validation / Acceptance sections. The plans and repo state are the source of truth — not your memory.
3. If a dependency in docs/exec-plans/completed/ is not actually complete and its unfinished scope was not deferred to an active plan, reopen it by moving it back to active/.
4. Validate with concrete evidence: passing tests, lint, typecheck, build commands, expected runtime behavior, expected state changes, expected files/artifacts, and relevant logs. If the plan requires real infrastructure validation, local-only evidence is not enough.
5. Commit at valid checkpoints with a detailed message explaining what was completed and validated.
6. Work on the earliest dependency-unblocked ready plan first; treat blocked plans as context only.
7. Preserve local changes by default. If the state is not recoverable, decide whether to fix forward or revert — checking for already-applied migrations or infra side effects first.
8. Update stale checklists or plan notes as you go.
9. Move a plan to docs/exec-plans/completed/ only after validated implementation with no stranded scope.
