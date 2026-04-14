1. Follow any operator steering shown above (injected from `.pi/exec-plan-loop/steering.md`). Do NOT read the steering file yourself — its contents are already included in this prompt. If steering conflicts with a newer direct user instruction, the user instruction wins.
2. Re-read the active exec plans and their Validation / Acceptance sections. The plans and repo state are the source of truth — not your memory.
3. If a dependency in docs/exec-plans/completed/ is not actually complete and its unfinished scope was not deferred to an active plan, reopen it by moving it back to active/.
4. Validate with concrete evidence: passing tests, lint, typecheck, build commands, expected runtime behavior, expected state changes, expected files/artifacts, and relevant logs. If the plan requires real infrastructure validation, local-only evidence is not enough.
5. Before declaring any milestone complete, run the QA Acceptance Checklist from the active plan. Execute each item literally and check the exit code. If the plan has test commands (vitest, playwright), run them and confirm exit code 0. Do not judge results by visual inspection or subjective assessment — only exit codes and command output determine pass or fail. If any item fails, fix the issue and re-run. A milestone with failing QA items is not complete.
6. Commit at valid checkpoints with a detailed message explaining what was completed and validated.
7. Work on the earliest dependency-unblocked ready plan first; treat blocked plans as context only.
8. Preserve local changes by default. If the state is not recoverable, decide whether to fix forward or revert — checking for already-applied migrations or infra side effects first.
9. Update stale checklists or plan notes as you go.
10. Move a plan to docs/exec-plans/completed/ only after validated implementation with no stranded scope.
