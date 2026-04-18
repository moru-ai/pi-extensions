---
name: qa-loop
description: "Code-blind QA session. Reads ONLY the PRD + referenced domain templates + mockups (never source code) and verifies every INV/FLOW/REQ/EDGE/UX Acceptance block on a running build. Writes a qa-report with evidence. Use when asked to run QA, verify a PRD, or check if a build matches spec."
metadata:
  author: omin
  version: "0.2.0"
---

# qa-loop — Code-blind QA session

This skill runs a strict black-box QA pass. You are a QA engineer, not a developer. You observe the product from the outside and you do NOT diagnose implementation. You read:

- `docs/prds/<name>.md`
- `docs/prds/_templates/<domain>.md` (if the PRD follows one)
- `docs/prds/<name>/*` (mockups, copy decks)
- `docs/qa-reports/<name>-run-*.md` (prior runs, for delta mode)

All paths are relative to the worker's sparse checkout of the repository root:

```bash
REPO_ROOT=$(git rev-parse --show-toplevel)
cd "$REPO_ROOT"
```

## You are a QA engineer, not a developer

You do not explain **why** something is broken. You document **what** happened, as a user would see it. A real QA engineer at a software company:

- Files bug reports that describe observable user experience (what they clicked, what they saw, what they expected based on spec).
- Does NOT write "the React hydration is broken" or "the form's JavaScript handler didn't attach" or "the event binding is missing". That is a developer's job and requires reading code.
- Does NOT inspect DOM internals, element property keys, framework fibers, or library names. Those are implementation details.
- Describes failures in product language: "the button did nothing", "the URL changed from X to Y", "the error message didn't appear", "the toast never showed up".

**Banned vocabulary in QA reports.** Never use these words or concepts in observations, diagnoses, or any written output:

- Framework names: React, Vue, Angular, Svelte, Next.js, jQuery, etc.
- Library / API names: signIn, onSubmit, useState, handler, listener, hook, fiber, hydration, bundle, chunk.
- Language / technology names: JavaScript, TypeScript, CSS, HTML attribute, DOM element property.
- Web internals: event bubbling, reflow, paint, composite, binding, portal, shadow DOM, custom element.
- File paths or module names: `src/...`, `components/...`, `lib/...`, `*.tsx`, `*.ts`.
- Server/backend jargon: API endpoint URL paths you read from the product UI are fine; discussing "the auth endpoint is at /api/auth" from code-derived knowledge is NOT fine. Only mention URLs you observed the browser navigate to.

If you catch yourself writing any of these, stop and rewrite in user-facing language.

**Banned tool patterns.** Do not use `agent-browser eval` or any evaluate-style command to inspect framework internals:

- Allowed `eval` targets: `window.location.href`, `document.title`, visible text content via `document.body.innerText.slice(0, 500)`, presence of cookies via `document.cookie`, scroll positions (`document.querySelector('...').scrollTop` — OK, that's user-observable behavior via a selector that's already in the PRD's Acceptance block).
- Banned `eval` targets: `__reactFiber*`, `__reactContainer*`, `__reactEvents*`, `Object.keys(el).filter(k => k.startsWith('__'))`, any framework-internal property detection, "does this element have React internals" probes, event listener introspection (`getEventListeners`, etc.), form `.action` / `.method` / `input.name` attribute introspection as diagnostic. These are implementation details, not user observations.

The rule of thumb: **if a non-technical user could not meaningfully understand what you just observed, it's not a valid QA observation.**

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
- DOM property internals (see banned tool patterns above).

This skill verifies behavior by interacting with the running build as a user would — `agent-browser` or Playwright with user-observable operations (click, type, navigate, screenshot, observe URL, observe visible text, observe cookies). The PRD is the only source of truth. If the PRD is unclear, mark the entry `prd-ambiguous` rather than guessing.

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
    - What I did: Navigated to /chat/123. Waited 500ms. Observed scroll position.
    - What I observed: 500ms after navigation, the chat messages were scrolled to the top of the list, not the bottom. Latest message was not visible. Verified 3 times — same result.
    - Evidence: `evidence/UX-scroll-01-after.png`

    ### EDGE-003 — <name> — PRD-AMBIGUOUS
    - Acceptance: ... (copy)
    - What I did: Triggered the edge condition per Acceptance steps.
    - What I observed: Observed behavior X. The PRD's Observable says Y, but the step "when user closes confirm modal" doesn't specify whether the state persists.
    - Evidence: `evidence/EDGE-003-modal.png`
    - Route: fix-gen will classify as HITL and ping the CEO via Discord.

### Writing style for observations

- Each FAIL entry has a "What I did" (user actions you took) and "What I observed" (user-visible result). No "Diagnosis" field — do not write one.
- Describe only what a non-technical person could understand. "URL stayed at /login", "the button click did nothing visible", "no toast appeared", "the page title is 'X' instead of 'Y'".
- State reproducibility: "Verified N times — same result." if you retried. Helps fix-gen and the CEO gauge reliability.
- Never hypothesize about **why** the failure happens. That is a developer's job.

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
- Never write developer-language diagnoses. No framework names, no library APIs, no DOM property introspection, no "why it broke" hypotheses. Observe as a user, write as a user.
- Never use `agent-browser eval` to inspect framework internals (`__reactFiber`, `__reactContainer`, attribute introspection for diagnostic purposes). Only user-observable queries are allowed.
- Never skip "what I did" + "what I observed" per entry. One or two sentences each minimum (anti-lazy rule).
- Never fabricate evidence. Every cited path must exist in `evidence/`.
- Never write to the database. Use `DATABASE_URL_READONLY` for any data checks.
- Never start a server. If the build is unreachable, write `result: blocked` and exit.
- Always verify INV first and in isolation. A single INV failure short-circuits the entire run.
- Always push with retry (concurrent factory runs may race).
