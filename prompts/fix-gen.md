---
description: "Generate the next fix-plan from a failed QA report. Narrow HITL — only INV-* violations escalate; everything else is AFK + Amendment."
---
Generate the next fix-plan for: $@

This prompt is triggered when the QA session fails one or more PRD entries. It reads the latest QA report and produces a discrete fix-plan file that the Dev session can pick up. The original ExecPlan is never edited — fix-plans accumulate as `<name>-fix-1.md`, `<name>-fix-2.md`, etc.

## Phase 0: Preflight

Resolve the repo root once:

```bash
REPO_ROOT=$(git rev-parse --show-toplevel)
cd "$REPO_ROOT"
```

All paths below are relative to `$REPO_ROOT`.

1. Read the PRD: `docs/prds/$@.md` (source of truth — Acceptance blocks define what "fixed" means).
2. If the PRD's `## UX Rules` section declares `Follows template: <path> v<N>`, read that template too (needed to resolve any UX-* inherited IDs referenced in the QA report).
3. Find the latest QA report: `ls -t docs/qa-reports/$@-run-*.md | head -1`. Read it end to end.
4. Determine the next fix number:
   ```bash
   ls docs/exec-plans/active/$@-fix-*.md 2>/dev/null | wc -l | tr -d ' '
   ```
   Next N = that count + 1.
5. **Max-rounds gate**: if N > 5, do NOT generate another fix-plan. Instead, produce an escalation report (see Phase 3 escalation path).

## Phase 1: Classify each failure

For every entry in the QA report with `status: fail`, classify it using this narrow rule:

**HITL escalation (requires CEO input):**
- The failure is on an `INV-*` entry.
- The failure's root cause touches any of these (as inferred from PRD content, not code):
  - Irreversible data semantics
  - Permission / security boundary
  - Billing, payment, or financial flow
  - Legal / compliance behavior
  - An explicit `hitl_zones:` field in the PRD frontmatter that covers the affected area
- The same entry ID failed in the previous round (accumulating ambiguity — PRD is genuinely unclear).
- Resolving requires adding or modifying an `INV-*`.

**AFK (fix directly, record Amendment):**
- Every other case. The default is AFK.

For AFK failures, propose a default behavior grounded in:
- The PRD's existing Flow / Edge / UX rule patterns
- The referenced domain template's defaults
- Industry-standard UX conventions
- Repository conventions (read existing similar features)

Record the AFK decision as an auto-authored Amendment on the PRD (`auto: true`) with reasoning. The Dev session will implement accordingly.

**Default bias:** HITL should be rare. If this workstream has already triggered ≥ 2 HITL escalations, be extra critical about justifying a third — the PRD is drifting and should be refined, not re-debated.

## Phase 2: Write the fix-plan

Write to `docs/exec-plans/active/$@-fix-N.md` using this skeleton:

    ---
    depends_on:
      - $@.md
    round: N
    ---

    # Fix Round N for $@

    ## Source

    QA report: `docs/qa-reports/$@-run-<M>.md`
    PRD: `docs/prds/$@.md`
    Original ExecPlan: `docs/exec-plans/active/$@.md` (do not modify)

    ## Amendments added this round

    List any PRD Amendments authored during classification. Example:

    - PRD Amendment: SURFACE-004 empty-state copy set to "No activity yet." (auto, default from chat.md template)
    - PRD Amendment: EDGE-007 network-retry behavior set to "1 silent retry + toast" (auto, grounded in UX-rt-03)

    ## Failures to address

    ### FIX-N-001: <short title> [AFK | HITL]

    **PRD reference**: INV-001 / FLOW-003 / UX-scroll-01 (quote the exact Acceptance block from PRD or template)

    **What QA observed**:
    <copy the Observable expected vs actual observation from the QA report, including evidence path>

    **Why it failed** (diagnosis based on PRD alone, do not read code):
    <one paragraph>

    **Fix direction**:
    - AFK: <concrete guidance for the Dev session, referencing surface IDs and expected observable. "Implement UX-scroll-01 per chat.md v1: on SURFACE-001 mount, scroll message container to scrollHeight - clientHeight within 500ms.">
    - HITL: <question for the CEO; block until answered via Discord + steering.md>

    ### FIX-N-002: ...

    ## Escalations (HITL entries)

    List every HITL entry as a bullet with its question. The Dev session must not start on HITL items until these are resolved via Discord + steering.md.

    ## Validation

    When the Dev session completes these fixes, Leo re-triggers QA via qa-queue. The QA agent re-runs only the FLOW / REQ / EDGE / UX entries whose IDs appear in this fix-plan (delta mode, determined from prior qa-report status).

## Phase 3: Routing

After writing the fix-plan, dispatch based on classification:

**All AFK (no HITL entries)**:
- Commit and push:
  ```bash
  git add -A && git commit -m "fix-plan: $@ round N (AFK)"
  git push
  ```
- Announce: "Fix round N generated. Dev session will auto-pick up. No escalation."

**Any HITL entry**:
- Commit:
  ```bash
  git add -A && git commit -m "fix-plan: $@ round N (HITL escalation)"
  git push
  ```
- Send Discord ping via Leo with: the HITL questions, the PRD ID in question, a link to the fix-plan, and instructions for the CEO to reply in Discord. Leo will record the reply into `.pi/exec-plan-loop/steering.md` on the worktree so the Dev session reads it next iteration.
- Announce: "Fix round N needs CEO input. Discord pinged."

**N > 5 (max rounds exceeded)**:
- Do NOT write another fix-plan.
- Write `docs/qa-reports/$@-escalation.md` with:
  - Summary of all 5 rounds
  - Entries that never passed
  - Evidence paths
  - Root PRD IDs in question
  - Recommendation on whether to refine the PRD (if PRD drift) or reassess (if implementation is structurally wrong)
- Move the exec-plan from `active/` to `escalated/`:
  ```bash
  git mv docs/exec-plans/active/$@.md docs/exec-plans/escalated/$@.md
  ```
- Send Discord ping: "Round 5 exceeded. CEO intervention required. See $@-escalation.md."
- Announce and stop.

## Non-negotiables

- Do not modify the original ExecPlan. Fix-plans accumulate as separate files.
- Do not read source code — this is a PRD-driven fix-plan, not a code review.
- Do not merge multiple failures into one FIX-N entry unless they share a single root cause in the PRD.
- Do not escalate as HITL to avoid thinking. If you can propose a reasonable default grounded in PRD patterns, template defaults, or UX conventions, it is AFK. HITL is for genuine INV boundary decisions only.
- Do not downgrade INV-* failures to AFK. INV violations always escalate, no exceptions.
- Every AFK decision gets a PRD Amendment with `auto: true`. The CEO reviews all Amendments at the final approval gate.
