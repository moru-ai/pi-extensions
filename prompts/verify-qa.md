---
description: "Verify a QA run's report after Leo2 receives the IPC callback. Dispatches next action (completed, fix-gen, escalation)."
---
Verify the QA run for: $@

This prompt runs on Leo2 (worker-2 QA Manager) immediately after the QA pi IPC callback fires. It inspects the just-written qa-report and routes to the next step: mark completed, trigger fix-gen, or escalate to the CEO.

## Phase 0: Preflight

```bash
REPO_ROOT=$(git rev-parse --show-toplevel)
cd "$REPO_ROOT"
git pull --rebase --autostash
```

Find the latest report for this PRD:

```bash
REPORT=$(ls -t docs/qa-reports/$@-run-*.md | head -1)
echo "Latest report: $REPORT"
```

If no report exists, the QA run failed to write one. Ping Leo on worker-1 with:

> "[$@] QA worker finished but wrote no report. Investigation needed."

Mark the exec-plan as `escalated/` (via Leo) and stop.

## Phase 1: Parse the report

Read the frontmatter `result:` field:

- `pass` → proceed to Phase 2 (mark complete)
- `fail` → proceed to Phase 3 (fix-gen handoff)
- `blocked` → proceed to Phase 4 (CEO escalation)

## Phase 2: All pass — complete

Delete the qa-queue entry (QA is done for this PRD):

```bash
git rm docs/qa-queue/$@.yml
```

Post to Discord (via send_message MCP):

> "[$@] QA run N all pass. Awaiting CEO final approval before merge.
>   Report: docs/qa-reports/$@-run-N.md
>   Amendments auto-added: X (CEO review required)"

Do NOT move the exec-plan to `completed/` yourself — that's Leo's job on worker-1 (since Leo owns the exec-plan folder). Instead, commit and push the qa-queue deletion so Leo's scheduled task sees the pass:

```bash
git add -A
git commit -m "qa: $@ run N pass — queue cleared"
for i in 1 2 3; do
  git pull --rebase --autostash && git push && break
  sleep $((i * 10))
done
```

Exit. Leo's scheduled task polls `docs/qa-queue/` and `docs/qa-reports/`; seeing qa-queue empty + latest report `result: pass`, Leo moves the exec-plan from `qa-ready/` to `completed/` and posts the "awaiting CEO approval" message.

## Phase 3: Some fails — fix-gen handoff

Post to Discord:

> "[$@] QA run N fail. N_FAIL entries failed.
>   Report: docs/qa-reports/$@-run-N.md
>   Leo will invoke fix-gen."

Write a handoff signal for Leo. The signal is a small file in qa-queue indicating the next action:

```bash
# Update the qa-queue yml with a retry signal
cat > docs/qa-queue/$@.yml <<EOF
prd: $@
status: awaiting-fix
qa_report: $(basename $REPORT)
base_url: $(yq -r .base_url docs/qa-queue/$@.yml 2>/dev/null || echo "")
build_sha: $(yq -r .build_sha docs/qa-queue/$@.yml 2>/dev/null || echo "")
EOF

git add -A
git commit -m "qa: $@ run N fail — awaiting fix-gen"
for i in 1 2 3; do
  git pull --rebase --autostash && git push && break
  sleep $((i * 10))
done
```

Exit. Leo's scheduled task on worker-1 picks up the `status: awaiting-fix` flag and invokes `/fix-gen $@` to produce `docs/exec-plans/active/$@-fix-M.md`. The Dev pi then runs the next round.

## Phase 4: Blocked — CEO escalation

A blocked report means either:
- An `INV-*` failed (severe: product boundary violated)
- The build was unreachable
- The PRD is too ambiguous to proceed on any entries
- QA sandbox / tooling failure

Post to Discord:

> "[$@] QA run N blocked. CEO attention required.
>   Reason: <from report frontmatter or first blocked entry>
>   Report: docs/qa-reports/$@-run-N.md
>   Evidence: docs/qa-reports/$@-run-N/evidence/
>
>   Waiting for your reply. Any answer will be written to steering.md and will guide the next iteration."

Update qa-queue to reflect the escalation:

```bash
cat > docs/qa-queue/$@.yml <<EOF
prd: $@
status: blocked
qa_report: $(basename $REPORT)
reason: <paste the first blocked reason>
awaiting_ceo_input: true
EOF

git add -A
git commit -m "qa: $@ run N blocked — CEO input required"
for i in 1 2 3; do
  git pull --rebase --autostash && git push && break
  sleep $((i * 10))
done
```

Watch for a CEO reply in Discord. When one arrives (see Leo2's CLAUDE.md for how messages route), write the CEO's answer to the worker-1 worktree's `.pi/exec-plan-loop/steering.md` file via Leo. Leo is responsible for the cross-worker write since worker-2 has no access to worker-1's worktree filesystem.

Exit after writing the queue update.

## Non-negotiables

- Do not read the source code of the build. The QA isolation constraint applies to this verify step too.
- Do not invoke `/fix-gen` directly from worker-2 — fix-gen needs access to `docs/exec-plans/active/` which Leo on worker-1 owns.
- Do not move exec-plan files. Leo owns `docs/exec-plans/*`; you own `docs/qa-queue/` and `docs/qa-reports/`.
- Do not escalate minor fails to the CEO. Use the `blocked` state only when:
  - An Invariant was violated, OR
  - The run couldn't meaningfully execute (build unreachable, tooling broken), OR
  - The fix-gen max-round was exceeded (N > 5), but that check is Leo's.
- Always push with retry. Concurrent factory runs will race; use the 3-retry rebase pattern.
