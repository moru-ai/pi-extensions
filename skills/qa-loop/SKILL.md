---
name: qa-loop
description: "Code-blind QA session. Reads ONLY the PRD + referenced domain templates + mockups (never source code) and verifies every INV/FLOW/REQ/EDGE/UX Acceptance block on a running build. Writes a qa-report with evidence. Use when asked to run QA, verify a PRD, or check if a build matches spec."
metadata:
  author: omin
  version: "0.2.0"
---

# qa-loop — Code-blind QA session

This skill runs a strict black-box QA pass driven entirely by the PRD and its referenced domain templates. It never reads source code, ExecPlans, or commit history — only:

- `docs/prds/<name>.md`
- `docs/prds/_templates/<domain>.md` (if the PRD follows one)
- `docs/prds/<name>/*` (mockups, copy decks)
- `docs/qa-reports/<name>-run-*.md` (prior runs, for delta mode)

All paths are relative to the worker's sparse checkout of the repository root:

```bash
REPO_ROOT=$(git rev-parse --show-toplevel)
cd "$REPO_ROOT"
```

## When to run

- After Leo (Eng Manager on worker-1) writes `docs/qa-queue/<name>.yml`, signaling that a `qa-ready/` exec-plan is built and the freeze server is up.
- After a fix round ships (same trigger — Leo re-writes qa-queue with the next round's signal).

Leo2 (QA Manager on worker-2) invokes this skill via `/start-qa-loop <name>`.

## Inputs

- `$@` — the PRD slug (e.g. `agent-chat`)

Delta mode is inferred automatically: if a prior qa-report exists with `result: fail`, re-run only the entries that failed last time.

## What this skill reads vs does not read

**Reads:**

- The PRD file (source of product truth).
- The domain template referenced in the PRD's `## UX Rules` section, if any.
- Any mockups in `docs/prds/<name>/`.
- Prior qa-reports for delta-mode filtering and baseline comparison.

**Does NOT read:**

- Source code (`src/`, `app/`, `lib/`, `components/`, `prisma/`). The sparse checkout ensures these don't exist on worker-2's filesystem, but even on a misconfigured environment this skill must refuse to read them.
- The ExecPlan (`docs/exec-plans/`). The worker-2 sparse checkout excludes this path.
- Git history (`git log -p`, `git show` on source files).
- Test files (`*.test.*`, `*.spec.*`).

This skill verifies behavior by interacting with the running build — `agent-browser` or Playwright for UI, `curl` for HTTP, `psql $DATABASE_URL_READONLY` for read-only data checks. The PRD is the only source of truth. If the PRD is unclear, mark the entry `prd-ambiguous` rather than guessing.

## Phase 1: Load the contract

1. Read `docs/prds/$@.md` end to end.
2. If the PRD's `## UX Rules` section declares `Follows template: <path> v<N>`, read that template file too.
3. List every `INV-*`, `FLOW-*`, behavior-bearing `REQ-*`, `EDGE-*`, and `UX-*` entry.
4. For UX rules:
   - Overrides and Net-new → use PRD's Acceptance block.
   - Inherited IDs → look up each ID in the referenced template and use its Acceptance block.
   - Not-applicable → skip.

Compute the next run number:

```bash
N=$(ls docs/qa-reports/$@-run-*.md 2>/dev/null | wc -l | tr -d ' ')
N=$((N + 1))
```

Determine mode: `full` if N == 1 or the latest prior report shows `result: pass`; `delta` if the latest shows `result: fail` (re-verify only entries with status `fail` in the prior report).

## Phase 2: Check the running build

Read `docs/qa-queue/$@.yml`:

```bash
cat docs/qa-queue/$@.yml
```

Key fields: `base_url`, `build_sha`.

Ping the build:

```bash
BASE_URL=$(grep '^base_url:' docs/qa-queue/$@.yml | awk '{print $2}')
curl -sf "$BASE_URL/" -o /dev/null && echo "reachable" || echo "unreachable"
```

If unreachable, write a `result: blocked` report with reason "build unreachable" and exit. Do not try to start a server yourself — Leo on worker-1 owns freeze-server lifecycle.

## Phase 3: Auth

Use the repository's standard test account. For `ai-company`:

- Email: `admin@test.com`
- Password: `testpass123`

Log in once via `agent-browser` against `$BASE_URL/login`. Save the cookie state. Reuse for all subsequent interactions.

Use `.env.qa`'s `DATABASE_URL_READONLY` for any post-state data verification. Never write to the database.

## Phase 4: Verify Invariants first

Run every `INV-*` Acceptance block. Invariants are the strongest product contract — if any fails, the rest of the run is moot.

If any `INV-*` fails:

1. Write the qa-report with `result: blocked` and the failed INV listed.
2. Do NOT verify remaining entries.
3. Exit with Phase 7 IPC callback → Leo2's `/verify-qa` will escalate to the CEO via Discord.

## Phase 5: Verify remaining entries (in mode-appropriate order)

For each entry (FLOW / REQ / EDGE / UX), run the Acceptance block literally:

1. **Precondition**: establish state via navigation or seed API calls. Screenshot: `docs/qa-reports/$@-run-N/evidence/<entry-id>-pre.png`.
2. **Steps** (for four-field blocks): execute one at a time via `agent-browser` / Playwright. Snapshot after each.
3. **Observable expected**: assert every listed observable:
   - For literal copy: check exact text match.
   - For URL transitions: check `page.url()`.
   - For UX-* measurements (scrollTop, ms, CSS): use `page.evaluate()`.
   - For DOM state: use CSS selectors or ARIA roles.
4. **Post-state** (for four-field blocks): verify via UI or API. Screenshot.

Record status per entry: `pass | fail | blocked | prd-ambiguous`.

### `prd-ambiguous` vs `fail`

- `fail`: the Acceptance block is clear, but observed behavior didn't match.
- `prd-ambiguous`: the Acceptance block itself is unclear about expected behavior. This is an input-quality bug, not a code bug.

Both propagate to `/fix-gen` via the qa-report, but fix-gen treats them differently: `fail` → typically AFK fix; `prd-ambiguous` → often HITL escalation to refine the PRD.

### Evidence tiering

- **Interactive entries** (FLOW, EDGE with steps): before + after + DOM snapshot diff.
- **Static entries** (REQ rules, UX rules, INV rules): single annotated screenshot or API response log.

## Phase 6: Write the qa-report

Write `docs/qa-reports/$@-run-N.md` with the structure below. Commit and push with retry.

    ---
    prd: docs/prds/$@.md
    run: N
    date: YYYY-MM-DD
    mode: full | delta
    result: pass | fail | blocked
    base_url: <from qa-queue>
    build_sha: <from qa-queue>
    ---

    # QA Run N for $@

    ## Summary

    | Category | Total | Pass | Fail | Blocked | Prd-ambiguous |
    |----------|-------|------|------|---------|---------------|
    | Invariants | ... |
    | Flows | ... |
    | Edges | ... |
    | UX | ... |
    | Reqs | ... |

    ## Entries

    ### INV-001 — <name> — PASS
    - Evidence: `evidence/INV-001-pre.png`
    - Verified: <1-2 sentences, mandatory even on pass>

    ### UX-scroll-01 — <inherited from chat.md v1> — FAIL
    - Acceptance (resolved from template):
      - Precondition: ...
      - Trigger: ...
      - Observable: scrollTop >= scrollHeight - clientHeight - 50px within 500ms.
    - What happened: scrollTop was 0 after 500ms.
    - Evidence: `evidence/UX-scroll-01-after.png`
    - Diagnosis (PRD-only): implementation likely skipped auto-scroll on mount.

    ### EDGE-003 — <name> — PRD-AMBIGUOUS
    - Acceptance: ... (copy)
    - What happened: observed behavior X. PRD says Y, but the step "when user closes confirm modal" is unclear about state persistence.
    - Evidence: `evidence/EDGE-003-modal.png`
    - Route: fix-gen will classify as HITL and ping the CEO via Discord.

    ## Baseline

        {
          "run": N,
          "result": "fail",
          "invariants": {"pass": 3, "fail": 0},
          "flows": {"pass": 2, "fail": 1},
          "edges": {"pass": 5, "fail": 0, "prd_ambiguous": 1},
          "ux": {"pass": 40, "fail": 1},
          "duration_seconds": 412
        }

Commit and push with retry:

```bash
git add docs/qa-reports/$@-run-*.md docs/qa-reports/$@-run-*/
git commit -m "qa: $@ run N <result>"

for i in 1 2 3; do
  git pull --rebase --autostash && git push && break
  sleep $((i * 10))
done
```

## Phase 7: IPC callback to Leo2

Signal Leo2 that this run is done:

```bash
IPC_INPUT="$MORUCLAW_IPC_DIR/input"
echo '{"type":"message","text":"[$@] QA run '"$N"' <result>. Report: docs/qa-reports/$@-run-'"$N"'.md"}' \
  > "$IPC_INPUT/done-$(date +%s)-$(head -c4 /dev/urandom | xxd -p).json"
```

Exit. Leo2 wakes on the IPC event and invokes `/verify-qa` to route to the next action (pass → done, fail → fix-gen on worker-1, blocked → Discord escalation).

## Non-negotiables

- Never read source code. `src/`, `app/`, `lib/`, `components/`, `prisma/` do not exist on worker-2 (sparse checkout), but even if they did, this skill must refuse.
- Never skip "what I verified" description on a pass. One or two sentences minimum (anti-lazy rule).
- Never fabricate evidence. Every cited path must exist in `evidence/`.
- Never write to the database. Use `DATABASE_URL_READONLY` for any data checks.
- Never start a server. If the build is unreachable, write `result: blocked` and exit.
- Always verify INV first and in isolation. A single INV failure short-circuits the entire run.
- Always push with retry (concurrent factory runs may race).
