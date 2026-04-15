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
- **cmux missing**: Skip the tab rename step. Not a blocker.
- **Both present**: Continue silently.

## Phase 1: Understand Intent

Ask **one question only** via `ask_user_question`: what should this do? (free text, pre-fill with "$@" if provided)

Don't ask about acceptance criteria, constraints, size, or affected areas yet — the user doesn't know those upfront.

## Phase 2: Research the Codebase

With the user's intent, explore the codebase yourself:
- Find relevant files, models, APIs, components
- Identify constraints, dependencies, edge cases
- Understand the current architecture around this area

## Phase 3: Clarify Requirements

Based on your research, use `ask_user_question` to ask **as many questions as needed** to collect all requirements for completing the work. Focus on requirements — what the system must do, how it should behave, what the user expects.

Examples of good requirement questions:
- "X currently works like this — should it also handle the Y case?"
- "Both approach A and B are possible — which one fits?"
- "Where does this data come from? Already in the DB, or needs a new model?"
- "How should errors be shown to the user?"
- "Does this need access control? Which roles can use it?"

If the feature has a clear user flow, walk through each step of the flow and confirm it with the user. For example: "So the user clicks X → sees Y → fills Z → submits. Is that right? Anything missing?"

Goal: after this step, you should have enough information to write a complete exec plan without going back to ask more. Don't ask vague questions. Ask concrete things you discovered during research.

## Phase 4: Create Worktree

Auto-generate a short kebab-case name from the goal. Don't ask the user — just pick a good one.

```bash
wt create <name>
```

Rename cmux tab:
```bash
cmux rename-tab --tab "$(cmux identify | jq -r .caller.tab_ref)" '<name>'
```

Move into the worktree:
```bash
cd /private/tmp/wt-<name>/
```

## Phase 5: Write Exec Plan

Read `PLANS.md` for the exec plan format rules. Write the plan to:
```
docs/exec-plans/active/<name>.md
```

The plan must be:
- Self-contained (someone new to the repo can follow it)
- Have concrete steps with expected outcomes
- Include a validation section
- End with a Review Loop milestone

## Phase 6: Create Artifact HTML

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

## Phase 7: Confirm

Show the user:
1. The exec plan summary (key points, not the whole file)
2. A link to the artifact HTML
3. Ask for confirmation via `ask_user_question`: "Plan looks good?" (Approve / Revise / Cancel)

If Revise → ask what to change, update plan + artifact, re-confirm.
If Approve → commit and announce ready.
If Cancel → clean up.

## Phase 8: Commit

```bash
git add -A && git commit -m "plan: <name>"
```

Announce: worktree ready, plan written, next step is `wt send <name>` when ready.
