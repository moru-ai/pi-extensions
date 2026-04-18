---
description: "Start a new workstream with a PRD in one session — interview the product owner, derive the ExecPlan, push to workers."
---
Start a new workstream for: $@

One pi session owns the entire PRD authoring + ExecPlan derivation flow. It ends when both are pushed to git. Leo (Eng Manager on worker-1) picks up from there.

## Phase 0: Preflight

Resolve the repo root and read the standards from there:

```bash
REPO_ROOT=$(git rev-parse --show-toplevel)
echo "REPO_ROOT: $REPO_ROOT"
```

All paths below are relative to `$REPO_ROOT`.

Read these three files end to end before asking the user anything:

1. `PRDS.md` — the artifact standard (Invariants, Acceptance block, Surface Inventory, UX Rules, tier system, required sections)
2. `PRD_INTERVIEW.md` — the 9-phase interview process + Phase 10 ExecPlan derivation, ending at Phase 11 confirmation
3. `PLANS.md` — the downstream ExecPlan standard (so you understand what your PRD will derive into)

If any of these three files is missing at the repo root, stop and tell the user: the current repository is not set up for this workflow. Do not invent the standards from memory.

Also read `docs/prds/_templates/README.md` if it exists, and enumerate available domain templates in `docs/prds/_templates/*.md`. You'll reference a template in the PRD's UX Rules section during Phase 4.5.

Confirm `wt` is installed:

```bash
which wt && echo "wt: ok" || echo "wt: MISSING"
```

If missing, direct the user to install pi-extensions before continuing.

## Phase 1–9: Run the PRD interview

Follow `PRD_INTERVIEW.md` layer by layer. Non-negotiables:

- **Propose-first**: never ask an open-ended question. Draft a concrete flow, copy, or edge case and ask the user to confirm or adjust.
- **One decision per turn**: do not batch questions.
- **Research before proposing**: silently explore the current repository for relevant surfaces, domain models, and prior features.
- **Write incrementally**: save `docs/prds/<name>.md` after each phase so the user can read it at any point.
- **Invariants load-bearing**: Phase 4.1 is where the CEO actually makes decisions. Everything else is propose-first; CEO confirms or overrides.
- **UX via templates**: Phase 4.5 classifies the feature's domain, loads the matching template from `docs/prds/_templates/<domain>.md`, and proposes rules in category chunks of 8–12. Never copy rules into the PRD — reference the template and record overrides only.
- **Generate mockups**: for any UI-bearing feature, create HTML mockups under `docs/prds/<name>/mockup-<surface-id>.html` using the `frontend-design` skill.

## Phase 2.5: Worktree

After Phase 2 (Research) in the interview, create the worktree and move into it:

```bash
wt create <kebab-case-name>
cd ~/wt/wt-<name>/
```

All subsequent file writes go inside this worktree. The PRD lives at `docs/prds/<name>.md` inside the worktree.

## Phase 9: PRD approval

When all required sections for the chosen tier are filled, every `INV-*` has a three-field Acceptance block, every `FLOW/REQ/EDGE` has a complete Acceptance block, and the UX Rules section has a Follows/Overrides/Inherited/Not-applicable/Net-new structure:

1. Summarize for the CEO: tier · invariants in one paragraph · goal in one sentence · primary flow in two sentences · edge count · surface count · UX rules count (by category) · mockup count · any OPEN entries.
2. Link the PRD file and any mockups.
3. Ask: "Approve and flip status to `approved`? Next I'll derive the ExecPlan in this same session."

On approval:

```bash
# Flip frontmatter: status: approved, update last_updated
git add -A && git commit -m "prd: <name>"
```

Announce: PRD ready. Proceeding to ExecPlan.

If the CEO asks for revisions, loop back to the specific phase. Do not restart.

## Phase 10: Derive the ExecPlan in the same session

Do NOT end the pi session. Continue immediately.

1. Read `PLANS.md` end to end (refresh context).
2. Read the approved PRD you just wrote.
3. Research the repository for implementation context: which files, modules, migrations, tests, and dependencies this feature touches.
4. Write the ExecPlan to `docs/exec-plans/active/<name>.md` following `PLANS.md` exactly. It must:
   - Begin with `## Source PRD` listing every PRD ID covered.
   - Include a `## Traceability` table mapping every behavior-bearing PRD ID (`INV-*`, `REQ-*`, `FLOW-*`, `EDGE-*`, `UX-*`) to at least one milestone.
   - Contain a `## QA Acceptance Checklist` with build-time mechanical checks ONLY (type-check, tests, build, lint, smoke API calls). No flow-level QA — that runs against the PRD directly via the QA agent.
   - End with a Review Loop milestone including five phases: Validation Gate, Code Review, Design Review (if UI), Layout Verification (if UI), and PRD-sync.
5. During drafting, if an ambiguity appears that wasn't resolved during the interview, ask the CEO **one** question. Expected and acceptable in Phase 10; the PRD gap gets recorded as an Amendment (`auto: false`, human-answered) and reflected in the ExecPlan.
6. Update the PRD's frontmatter `derives_to.exec_plan` to the ExecPlan filename.

## Phase 11: ExecPlan confirmation and handoff

Show the CEO:

1. ExecPlan filename and milestone count.
2. Traceability summary (how many INV/FLOW/REQ/EDGE/UX are covered, estimated duration).
3. Any Amendments added to the PRD during Phase 10.

Ask one question:

> "ExecPlan ready. Scan / Send to worker / Edit?"

- **Send**: commit and push both PRD and ExecPlan:

  ```bash
  git add -A
  git commit -m "exec-plan: <name>"
  git push -u origin plan/<name>
  ```

  Announce: "Pushed. Leo on worker-1 will pick up within 30 seconds."

- **Scan**: output the ExecPlan path for the CEO, wait for their go-ahead, then commit and push.

- **Edit**: apply the specific change the CEO requests, show the diff, loop back to this phase.

## Non-negotiables

- Do not write any code here. That is Dev pi's job on worker-1.
- Do not leave `OPEN-*` that would change an INV, FLOW, REQ, EDGE, SURFACE, or UX rule if resolved differently. Resolve them before approval.
- Do not invent copy silently — every user-facing string is proposed and approved.
- Do not batch multiple questions per turn. One decision per turn.
- Do not skip the template for features that have a matching domain template. Skipping means Dev pi guesses and QA pi flags `prd-ambiguous`.
