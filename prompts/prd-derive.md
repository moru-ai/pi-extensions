---
description: "Derive an ExecPlan from an approved PRD. Standalone version (kickoff-prd already chains into this). Used when regenerating an ExecPlan from an existing PRD."
---
Derive the ExecPlan for: $@

This prompt is used when you have an already-approved PRD and want to (re)generate its ExecPlan. For new workstreams, use `/kickoff-prd` which combines PRD authoring and ExecPlan derivation in one session.

## Phase 0: Preflight

Resolve the repo root:

```bash
REPO_ROOT=$(git rev-parse --show-toplevel)
```

All paths below are relative to `$REPO_ROOT`.

1. Read `PRDS.md` end to end — understand the Acceptance block contract, stable IDs (`INV-*`, `REQ-*`, `FLOW-*`, `EDGE-*`, `SURFACE-*`, `UX-*`), and the UX Rules `Follows + Overrides + Inherited + Not-applicable + Net-new` structure.
2. Read `PLANS.md` end to end — understand required sections, `Source PRD`, `Traceability`, QA Acceptance Checklist (build-time only), Review Loop with PRD-sync.
3. Read the target PRD: `docs/prds/$@.md`. Verify `status: approved`. If not approved, stop and tell the user to run `/kickoff-prd` to finish it.
4. If the PRD's `## UX Rules` section declares `Follows template: <path> v<N>`, read that template file too.
5. Verify every PRD required section for its tier is present and every `INV-*` / `FLOW-*` / `EDGE-*` / behavior-bearing `UX-*` has a complete Acceptance block. If not, stop and report the gaps.

If `PRDS.md` or `PLANS.md` is missing at the repo root, stop — the repository is not set up for this workflow.

## Phase 1: Research

Silently explore the current repository to understand where the work lands: files to edit, existing modules, dependencies, migration needs, test framework. This is the technical context the ExecPlan must absorb.

## Phase 2: Write the ExecPlan

Write to `docs/exec-plans/active/$@.md`. Follow `PLANS.md` skeleton exactly.

### `## Source PRD` (first section after Purpose)

Link the PRD path and enumerate every PRD ID this plan covers:

    ## Source PRD

    `docs/prds/<name>.md` (tier <S|M|L>, approved YYYY-MM-DD)

    Covers:
    - GOAL-001, GOAL-002
    - INV-001, INV-002
    - FLOW-001, FLOW-002
    - REQ-001, REQ-002, REQ-003
    - EDGE-001 — EDGE-005
    - UX: follows docs/prds/_templates/<domain>.md v<N> (see PRD UX Rules section for overrides and net-new)
    - SURFACE-001, SURFACE-002

### `## Traceability` (before `## Plan of Work`)

Map every behavior-bearing PRD ID to at least one milestone:

    | PRD ID | Milestone | Notes |
    |--------|-----------|-------|
    | INV-001 | M1 | Schema cascade + delete rules |
    | REQ-001 | M2 | API handler |
    | FLOW-001 | M3 | UI + integration |
    | EDGE-001 | M3 | Empty-state render |
    | UX-scroll-01 | M3 | chat.md default, applies as-is |
    | UX-input-05 | M3 | chat.md override (Cmd+Enter) |

Every `INV-*`, `REQ-*`, `FLOW-*`, `EDGE-*`, and behavior-bearing `UX-*` must have at least one milestone. An orphan is a plan gap — fix by extending the plan or, if the PRD item is out of scope, filing an Amendment on the PRD (human-authored).

### `## QA Acceptance Checklist`

Build-time mechanical checks ONLY. Do NOT duplicate flow-level QA — that runs against the PRD via the QA agent. Include:

- `npx tsc --noEmit` → exit 0
- `npx vitest --run <relevant paths>` → all pass
- `npm run build` → exit 0
- `npm run lint` → exit 0
- Migration / schema checks (`npx prisma migrate status`, `npx prisma generate`)
- Smoke API curls (status code + minimal body shape)

NO Playwright, no flow-level DOM assertions, no copy checks. Those belong to QA.

### `## Review Loop` (final milestone)

Include all five phases from `PLANS.md`:

1. Validation Gate
2. Code Review (review + perspectives)
3. Design Review (skip if no UI)
4. Layout Verification (skip if no UI)
5. PRD-sync — inspect `Decision Log` and `Surprises & Discoveries`; for each entry, evaluate: did this change PRD product behavior? If yes, append an Amendment to the PRD with `auto: true` (machine-decided) or `auto: false` (CEO-answered). Amendments that would cross an `INV-*` must be escalated to HITL via Discord and cannot be applied silently.

## Phase 3: Update PRD frontmatter

Update the PRD's frontmatter:

    derives_to:
      exec_plan: docs/exec-plans/active/<name>.md

(No `qa_plan` field — QA reads the PRD directly.)

Update `last_updated: YYYY-MM-DD`.

## Phase 4: Confirm

Show the user:

1. Path to ExecPlan.
2. Traceability coverage: `X INV / Y REQ / Z FLOW / W EDGE / V UX` mapped.
3. Review Loop phases present.
4. Next step.

Ask: "ExecPlan ready. Commit and push? Leo on worker-1 will pick up within 30 seconds."

If user confirms:

```bash
git add -A
git commit -m "exec-plan: <name>"
git push
```

## Non-negotiables

- Do not read source code while the user is reviewing — they want a fast confirm, not a second research phase.
- Do not invent QA work here. The QA agent reads the PRD.
- Do not leave any behavior-bearing PRD ID untraced.
- Do not skip PRD-sync phase in Review Loop.
- Do not skip `PLANS.md`'s Observability section for backend-affecting changes.
