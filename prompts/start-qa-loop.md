---
description: "Start a QA run for a named PRD. Reads PRD + templates (not source code), runs flow-level QA against a live build, writes qa-report."
---
Start a QA run for: $@

This prompt launches a one-shot QA session. Each run spawns fresh and exits after writing a qa-report. The QA Manager (Leo2) loops by dispatching new runs after each fix.

## Phase 0: Preflight and isolation check

This pi session is the QA agent. It is code-blind by design. Before doing anything, confirm the isolation:

```bash
# This directory must NOT contain src/, app/, prisma/, or any source code.
# If it does, stop immediately — you are running in the wrong location.
ls src app prisma 2>&1 | head -5
```

Expected output: `ls: cannot access 'src': No such file or directory` (and similar). If those directories exist, abort with: "QA worker filesystem contains source code — isolation violated. Stopping."

Resolve working paths:

```bash
REPO_ROOT=$(git rev-parse --show-toplevel)
cd "$REPO_ROOT"
```

## Phase 1: Load the contract

1. Read `docs/prds/$@.md` end to end. This is the source of truth.
2. If the PRD's `## UX Rules` section declares `Follows template: <path> v<N>`, read that template file end to end.
3. Read any mockups in `docs/prds/$@/` (`*.html`).
4. Read prior QA reports: `ls -t docs/qa-reports/$@-run-*.md`. The latest one's `result:` frontmatter tells you whether this is a first run or a retry after a fix.

Determine the next run number:

```bash
N=$(ls docs/qa-reports/$@-run-*.md 2>/dev/null | wc -l | tr -d ' ')
N=$((N + 1))
```

Determine the mode:

- **Full mode**: N == 1, or no prior report has `result: fail`.
- **Delta mode**: N > 1 AND the previous report has `result: fail`. Re-run only the entries whose status was `fail` in the prior report.

Enumerate the entries to verify:

1. Every `INV-*` from the PRD (always verified first, any order).
2. Every `FLOW-*` from the PRD.
3. Every behavior-bearing `REQ-*`.
4. Every `EDGE-*`.
5. Every `UX-*` from the PRD's `## UX Rules` section:
   - Overrides (use PRD's Acceptance block)
   - Inherited (resolve from template's Acceptance block for that ID)
   - Net-new (use PRD's Acceptance block)
   - Not-applicable → skip

In delta mode, filter this list to entries whose IDs appeared with `status: fail` in the prior report.

## Phase 2: Start the running build

Read the qa-queue entry for this PRD:

```bash
cat docs/qa-queue/$@.yml
```

Expected fields:
- `prd: $@`
- `base_url: http://worker-1.local:34XX`
- `build_sha: <abc123>`

Verify the build is reachable:

```bash
curl -sf "$BASE_URL/" -o /dev/null && echo "OK" || echo "UNREACHABLE"
```

If unreachable, write an immediate blocked report (see Phase 6) and stop. Do NOT attempt to start a server yourself — that's Leo's responsibility.

## Phase 3: Auth and seed

Use the repository's standard test account. In `ai-company`, this is:

- Email: `admin@test.com`
- Password: `testpass123`

Log in once via `agent-browser` against the live build URL. Save the cookie state to a variable/file; reuse across all Playwright-style interactions.

If a PRD Precondition requires non-admin accounts, use the documented test users (consult `AGENTS.md` or the standard test account section of the repo). Never mutate the database directly for seeding — use API calls via the live build.

## Phase 4: Verify Invariants FIRST

Run every `INV-*` Acceptance block. If ANY `INV-*` fails, stop the entire run immediately:

1. Write a report with `result: blocked` and the failed INV entries (see Phase 6 format).
2. Do not proceed to FLOW/REQ/EDGE/UX entries.
3. Invariant failures escalate directly to the CEO via Leo2's Discord message — they are never auto-fixed by fix-gen.

## Phase 5: Verify remaining entries

For each remaining entry (FLOW / REQ / EDGE / UX), execute the Acceptance block literally:

1. **Precondition**: set up state via UI navigation or seed API calls. Take a screenshot. Store at `docs/qa-reports/$@-run-N/evidence/<entry-id>-pre.png`.
2. **Steps** (for FLOW / EDGE four-field blocks): execute each step via `agent-browser` or Playwright. One action at a time. After each, capture a DOM snapshot.
3. **Observable expected**: assert every listed observable. For copy, check literal text. For URL transitions, check `page.url()`. For toast/error messages, check visible text. For UX-* observable measurements (scrollTop, ms, CSS values), use `page.evaluate()` or equivalent.
4. **Post-state** (for four-field blocks): verify via UI or API call. Take a screenshot.

Evidence storage:

- **Interactive entries**: screenshot before + screenshot after + DOM snapshot diff.
- **Static / readonly entries**: single annotated screenshot.

Record status per entry: `pass | fail | blocked | prd-ambiguous`.

**`prd-ambiguous` rule**: if the PRD Acceptance block is genuinely unclear about expected behavior, mark the entry `prd-ambiguous` (not `fail`). This propagates through fix-gen as a potential HITL rather than an AFK fix.

## Phase 6: Write the report

Write `docs/qa-reports/$@-run-N.md`:

    ---
    prd: docs/prds/$@.md
    run: N
    date: YYYY-MM-DD
    mode: full | delta
    result: pass | fail | blocked
    base_url: <base_url from qa-queue>
    build_sha: <build_sha from qa-queue>
    ---

    # QA Run N for $@

    ## Summary

    | Category | Total | Pass | Fail | Blocked | Prd-ambiguous |
    |----------|-------|------|------|---------|---------------|
    | Invariants | X | Y | Z | W | V |
    | Flows | ... |
    | Edges | ... |
    | UX | ... |
    | Reqs | ... |

    ## Entries

    ### INV-001 — <name> — PASS

    - Evidence: `evidence/INV-001-pre.png`, `evidence/INV-001-post.png`
    - What I verified (1-2 sentences, mandatory even on pass): <concrete description>

    ### UX-scroll-01 — <name> — FAIL

    - Source: inherited from docs/prds/_templates/chat.md v1 (or "PRD net-new")
    - Acceptance (resolved):
      - Precondition: ...
      - Trigger: ...
      - Observable: Within 500ms, scrollTop >= scrollHeight - clientHeight - 50px.
    - What happened: 500ms after navigation, scrollTop was 0 (top of list).
    - Evidence: `evidence/UX-scroll-01-after.png`, `evidence/UX-scroll-01-console.log`
    - Diagnosis (PRD-only, no code): implementation likely renders messages without auto-scroll on mount.

    ### EDGE-003 — <name> — PRD-AMBIGUOUS

    - Acceptance: ... (copy the block)
    - What happened: Observed behavior X. PRD says Y, but the step "when the user closes the confirm modal" is ambiguous about whether the state persists.
    - Evidence: `evidence/EDGE-003-modal.png`
    - Escalation path: fix-gen will classify this as HITL and escalate to the CEO via Discord.

    ## Baseline

    Inline JSON summary for regression comparison by the next run:

        {
          "run": N,
          "result": "fail",
          "invariants": { "pass": 3, "fail": 0, "blocked": 0 },
          "flows": { "pass": 2, "fail": 1 },
          "edges": { "pass": 5, "fail": 0, "prd_ambiguous": 1 },
          "ux": { "pass": 40, "fail": 1 },
          "duration_seconds": 412
        }

Commit and push the report:

```bash
git add docs/qa-reports/$@-run-*.md docs/qa-reports/$@-run-*/
git commit -m "qa: $@ run N <result>"

# Push with retry (in case another worker is pushing concurrently)
for i in 1 2 3; do
  git pull --rebase --autostash && git push && break
  sleep $((i * 10))
done
```

## Phase 7: Signal Leo2 via IPC callback

Report completion to Leo2 via the IPC callback mechanism. Compute the callback path from the environment:

```bash
IPC_INPUT="$MORUCLAW_IPC_DIR/input"
# e.g., /Users/vacatio/moruclaw/data/ipc/discord_qa_manager/input
```

Write a completion JSON:

    {"type":"message","text":"[$@] QA run N <result>. Report: docs/qa-reports/$@-run-N.md"}

```bash
echo '{"type":"message","text":"[$@] QA run N <result>. Report: ..."}' > "$IPC_INPUT/done-$(date +%s)-$(head -c4 /dev/urandom | xxd -p).json"
```

Exit. Leo2 will pick up the signal and dispatch the next action (pass → mark completed, fail → invoke fix-gen on worker-1 side, blocked → Discord escalation to CEO).

## Non-negotiables

- No reading source code. The sparse checkout prevents it, but even if somehow available, never `grep src/`, `cat app/`, `cat prisma/schema.prisma`, or similar.
- No "no issues found" without stating what was verified in 1-2 sentences per entry (anti-lazy rule).
- No judgment calls on code ("the component probably ...") — you cannot see it.
- No fabricated evidence — every pass cites a screenshot or log path that actually exists in the evidence directory.
- No skipping entries. If something can't be run, mark `blocked` with reason.
- PRD-ambiguous entries are NEVER silent-pass. They go in the report as `prd-ambiguous` and propagate to fix-gen.
- No starting a server yourself. If the build is unreachable, write blocked report and stop.
- Invariants always verified first and always in isolation from other entries.
