---
description: "Start a new workstream — gather requirements, create worktree, write exec plan, show artifact for confirmation"
---
Start a new workstream for: $@

Follow this exact flow:

## Phase 0: Preflight Check

Before anything else, check that required tools are available:

```bash
which wt && echo "wt: ok" || echo "wt: MISSING"
which cmux && echo "cmux: ok" || echo "cmux: MISSING"
```

- **wt missing**: Ask the user — "wt CLI not found. Want me to set it up?" If yes, find the binary in the pi-extensions package (`find ~/.pi -path '*/pi-extensions/bin/wt' -type f 2>/dev/null | head -1`), then `mkdir -p ~/bin && ln -sf <path> ~/bin/wt`. If pi-extensions isn't installed either, tell the user to run `pi install git:github.com/moru-ai/pi-extensions` first.
- **cmux missing**: Skip the tab rename step (Phase 2 step 3). Not a blocker.
- **Both present**: Continue silently.

## Phase 1: Gather Requirements

Use `ask_user_question` to gather structured requirements. Ask in batches (2-4 questions at a time), not all at once.

**Round 1 — Scope:**
- What's the goal? (free text, pre-fill with "$@" if provided)
- How big is this? (select: Quick fix / Small feature / Medium feature / Large feature)

**Round 2 — Details** (adapt based on Round 1):
- What are the key acceptance criteria? (free text)
- Any constraints or dependencies? (free text, optional)
- Which areas of the codebase are affected? (free text, optional)

Skip rounds that aren't needed for small tasks. Use your judgment.

## Phase 2: Create Worktree

1. Pick a short kebab-case name from the requirements. Confirm with the user.
2. `wt create <name>`
3. Rename cmux tab: `cmux rename-tab --tab "$(cmux identify | jq -r .caller.tab_ref)" '<name>'`
4. `cd /private/tmp/wt-<name>/`

## Phase 3: Write Exec Plan

Read `PLANS.md` for the exec plan format rules. Write the plan to:
```
docs/exec-plans/active/<name>.md
```

The plan must be:
- Self-contained (someone new to the repo can follow it)
- Have concrete steps with expected outcomes
- Include a validation section
- End with a Review Loop milestone

## Phase 4: Create Artifact HTML

Read `docs/exec-plans/index.md` for artifact rules. Create:
```
docs/exec-plans/artifacts/<name>-summary.html
```

This is a single-file dark-themed HTML with:
- What changes (outcome)
- Before → After diagram
- Core flow diagram
- Key decisions
- Milestones overview

## Phase 5: Confirm

Show the user:
1. The exec plan summary (key points, not the whole file)
2. A link to the artifact HTML
3. Ask for confirmation via `ask_user_question`: "Plan looks good?" (Approve / Revise / Cancel)

If Revise → ask what to change, update plan + artifact, re-confirm.
If Approve → commit and announce ready.
If Cancel → clean up.

## Phase 6: Commit

```bash
git add -A && git commit -m "plan: <name>"
```

Announce: worktree ready, plan written, next step is `wt send <name>` when ready.
