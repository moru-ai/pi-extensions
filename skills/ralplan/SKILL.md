---
name: ralplan
description: Consensus planning for Ralph execution. Turns a deep-interview artifact, clarified task, or concrete request into Ralph-ready planning artifacts using Planner, Architect, and Critic review. Writes requirements, test-spec, and execution task files under .ralph/ and does not execute.
---

# RALPLAN

RALPLAN is consensus planning before Ralph execution. It coordinates Planner, Architect, and Critic review until the plan is clear, testable, and ready for `/start-ralph-loop`.

This skill plans only. It does not implement. It starts Ralph only when the user explicitly asks, such as with `--start`, "start Ralph after planning", or interactive approval.

Durable outputs:

```text
.ralph/plans/prd-<slug>.md
.ralph/plans/test-spec-<slug>.md
.ralph/<slug>.md
```

The first two are the planning source of truth. The third is the Ralph execution task that links them and is passed to `/start-ralph-loop`.

## Invocation

```text
/ralplan <interview artifact path | clarified task>
```

or:

```text
/skill:ralplan <interview artifact path | clarified task>
```

Then execute from the same repository root where the artifacts were written:

```text
/start-ralph-loop <plan-path>
```

Do not start Ralph from a parent directory or different project; relative paths are resolved from the current pi session cwd.

## Flags

- `--interactive`: pause for user feedback at draft-review and final-approval points.
- `--deliberate`: force deliberate mode for high-risk work.
- `--start`: after artifacts are written and quality-gated, start Ralph automatically with `ralph_start`.

Auto-enable deliberate mode when the request signals high risk:

- auth/security
- data migration
- destructive or irreversible change
- production incident
- compliance/PII
- public API breakage

## Inputs

Accept any of:

- `.ralph/interviews/<slug>.md` from `deep-interview`.
- A clarified task in the current conversation.
- A concrete task that already has enough scope and acceptance criteria to plan.

If intent, scope, non-goals, decision boundaries, or acceptance criteria are vague, stop and ask exactly one blocking clarification question or ask the user to run `/deep-interview ...`.

## Execution policy

- Plan only; do not edit source code.
- Write requirements to `.ralph/plans/prd-<slug>.md`.
- Write verification coverage to `.ralph/plans/test-spec-<slug>.md`.
- Write the Ralph execution task to `.ralph/<slug>.md`.
- Do not use exec-plan-loop unless the user explicitly asks for legacy exec plans.
- Inspect the repo before making codebase claims.
- Never ask the user for codebase facts you can inspect.
- Plans must be evidence-backed where possible.
- Implementation step count must be right-sized to the task; do not default to exactly five steps.
- Continue through clear, low-risk planning work automatically.
- Ask only when the next step is materially branching, destructive, preference-dependent, or blocked.
- Treat newer user task updates as local overrides while preserving earlier non-conflicting constraints.
- Output the final plan by default; do not auto-execute.

## Mode selection

| Mode | Trigger | Behavior |
|---|---|---|
| Direct | `--direct`, or detailed/concrete request | Create plan directly |
| Consensus | default for broad or important work | Planner → Architect → Critic |
| Deliberate | `--deliberate`, or high-risk signal | Consensus plus pre-mortem and expanded test plan |
| Interactive | `--interactive` | Pause at draft and final approval |
| Review | `--review <plan>` | Critic-only evaluation of existing plan |

## Consensus workflow

### 1. Context intake

Before planning:

1. Derive a task slug.
2. Read the provided interview artifact or task context.
3. If brownfield, use `agent` with `subagent_type: "explorer"` for relevant repo facts.
4. Identify constraints, unknowns, likely touchpoints, and acceptance criteria.
5. If ambiguity remains high, ask exactly one clarification question or redirect to `/deep-interview`.

### 2. Planner draft

Use `agent` with `subagent_type: "planner"` for medium/high-scope plans, or draft directly for small plans.

The draft must include a compact structured deliberation summary:

- **Principles**: 3-5 guiding principles.
- **Decision Drivers**: top 3 factors.
- **Viable Options**: at least 2 options with bounded pros/cons.
- If only one viable option remains, include explicit invalidation rationale for rejected alternatives.
- In deliberate mode: include pre-mortem with 3 failure scenarios and expanded test plan covering unit / integration / e2e / observability as applicable.

### 3. User feedback, interactive only

If `--interactive`, use `ask_user_question` with:

- Proceed to review.
- Request changes.
- Skip review and finalize.

If not interactive, automatically proceed to Architect review.

### 4. Architect review

Use `agent` with `subagent_type: "architect"`.

Architect review must include:

- Strongest steelman counterargument against the favored option.
- At least one meaningful tradeoff tension.
- Synthesis path when possible.
- Principle violations in deliberate mode.

Await Architect before starting Critic. Do not run Architect and Critic in parallel.

### 5. Critic review

Use `agent` with `subagent_type: "critic"` after Architect completes.

Critic must evaluate:

- Principle-option consistency.
- Fair alternative exploration.
- Risk mitigation clarity.
- Testable acceptance criteria.
- Concrete verification steps.
- Whether an executor can proceed without guessing.

In deliberate mode, Critic must reject missing/weak pre-mortem or missing/weak expanded test plan.

### 6. Re-review loop

If Critic rejects or asks for iteration:

1. Collect Architect + Critic feedback.
2. Revise the plan.
3. Return to Architect review.
4. Return to Critic review.
5. Repeat until Critic approves or 5 iterations are reached.

If 5 iterations are reached without approval, write the best plan with a residual-risk warning and ask the user before execution.

### 7. Apply improvements

When reviewers approve with suggestions:

1. Deduplicate suggestions.
2. Merge accepted requirements/architecture improvements into `.ralph/plans/prd-<slug>.md`.
3. Merge accepted verification improvements into `.ralph/plans/test-spec-<slug>.md`.
4. Keep `.ralph/<slug>.md` as the concise execution task linking both artifacts.
5. Add a short changelog section.
6. Ensure final requirements include an ADR.
7. Ensure final task includes Ralph execution guidance and verification path.

## Final artifact formats

### Requirements artifact

Write `.ralph/plans/prd-<slug>.md`:

```markdown
# <Task>

## Purpose / Big Picture
Explain what someone gains after this change and how they can see it working.

## Requirements Summary
- Intent:
- Desired outcome:
- Scope:
- Non-goals:
- Decision boundaries:

## Context and Orientation
Describe the current relevant repo state for a reader with no prior context. Define non-obvious terms. Name key files and modules with repository-relative paths.

## Repo Evidence
- `path` — why it matters

## Principles
1. ...

## Decision Drivers
1. ...

## Options Considered
### Option A: ...
- Pros:
- Cons:

### Option B: ...
- Pros:
- Cons:

## ADR
- Decision:
- Drivers:
- Alternatives considered:
- Why chosen:
- Consequences:
- Follow-ups:

## Goals
- ...

## Acceptance Criteria
- [ ] Concrete, testable criterion

## Plan of Work
Describe the sequence of edits and additions in prose. Name files, functions, modules, and expected changes.

## Implementation Plan
1. ...

## Interfaces and Dependencies
Name libraries, modules, services, types, interfaces, commands, or APIs to use and why.

## Idempotence and Recovery
Describe safe retries, rollback/recovery options, and cleanup expectations.

## Risks / Assumptions
- ...

## Review Changelog
- ...
```

For deliberate mode, also include:

```markdown
## Pre-mortem
1. Failure scenario:
2. Failure scenario:
3. Failure scenario:
```

### Test-spec artifact

Write `.ralph/plans/test-spec-<slug>.md`:

```markdown
# Test Spec: <Task>

## Acceptance Criteria Coverage
| Criterion | Verification | Evidence Required |
|---|---|---|
| ... | ... | ... |

## Verification Commands
- `command` — what it proves

## Validation and Acceptance
Describe exact behavior to observe. Include working directory, commands, expected outputs, and how to interpret failures.

## Manual Checks
- ...

## Observability
Required when the plan affects backend, desktop, worker, agent, deployed service, or any production-affecting path. Include specific log filters, metrics, traces, or app diagnostics that corroborate success. If manual UI/E2E checks exist, include matching observability checks.

## Regression Risks
- ...

## Evidence Checklist
- [ ] ...
```

For deliberate mode, also include:

```markdown
## Expanded Test Plan
- Unit:
- Integration:
- E2E:
- Observability / logs:
```

### Ralph execution task

Write `.ralph/<slug>.md`:

```markdown
# <Task>

## Planning Artifacts
Before editing code, and at the start of each new iteration, read:

1. `.ralph/plans/prd-<slug>.md`
2. `.ralph/plans/test-spec-<slug>.md`

Treat them as the source of truth for requirements and verification.

## Purpose / Big Picture
Copy the concise user-visible purpose from the requirements artifact.

## Goals
- ...

## Acceptance Criteria
- [ ] Mirror the acceptance criteria from the requirements artifact

## Progress
Update this at every stopping point. Use timestamps.

- [ ] Small executable task
- [ ] Small executable task

## Surprises & Discoveries
- Observation:
  Evidence:

## Decision Log
- Decision:
  Rationale:
  Date/Author:

## Outcomes & Retrospective
Summarize outcomes, gaps, and lessons at major milestones and completion.

## Verification
- Follow `.ralph/plans/test-spec-<slug>.md`
- Record command output, logs, screenshots, or artifact paths here

## Ralph Execution Guidance
- Suggested `itemsPerIteration`:
- Suggested `reflectEvery`:
- When to use `explorer`:
- When to use `architect`:
- When to use `critic`:
- When to use `verifier`:
- When `general-purpose` implementation delegation is safe:

## Notes
- Additional progress notes go here during Ralph.
```

The execution task should be concise enough for Ralph to re-read every iteration while preserving links to the richer requirements and test-spec artifacts.

## Pre-execution gate

Before suggesting Ralph, verify:

- Requirements artifact exists at `.ralph/plans/prd-<slug>.md`.
- Test-spec artifact exists at `.ralph/plans/test-spec-<slug>.md`.
- Ralph execution task exists at `.ralph/<slug>.md` and links both artifacts.
- Requirements have testable acceptance criteria.
- File/path claims are grounded where possible.
- Risks have mitigations.
- No vague terms without metrics or examples.
- Non-goals are explicit.
- Decision boundaries are explicit.
- Checklist items are small enough for iterative execution.
- Verification evidence is concrete.
- Architect and Critic concerns are resolved or preserved as residual risk.

## Completion response

After writing the artifacts, respond with:

- Requirements path.
- Test-spec path.
- Ralph task path.
- Consensus verdict: approved / approved-with-risk / not-approved.
- One-sentence summary.
- Remaining risks or open questions.
- Suggested next command, with an explicit reminder to run it from the repository root where the artifacts were written:

```text
/start-ralph-loop .ralph/<slug>.md
```

If the user passed `--start`, explicitly asked to start Ralph after planning, or approved execution in interactive mode, start Ralph yourself with `ralph_start` after writing the artifacts:

```ts
ralph_start({
  name: "<slug>",
  taskContent: "<exact contents of .ralph/<slug>.md>",
  itemsPerIteration: 2,
  reflectEvery: 5,
  maxIterations: 50
})
```

Before calling `ralph_start`, verify the current pi cwd is the repository root where the `.ralph/` artifacts were written. If cwd is wrong, do not start; tell the user to restart pi from the correct repo root.

## Post-RALPLAN follow-up

After a successful `/ralplan`, if the user says a short follow-up like:

- "start it"
- "start the loop"
- "start Ralph"
- "run Ralph"
- "execute it"

then treat that as approval to start the most recently created Ralph task from this conversation. Do not re-plan. Read `.ralph/<slug>.md`, confirm it links `.ralph/plans/prd-<slug>.md` and `.ralph/plans/test-spec-<slug>.md`, then call `ralph_start` with the task content.

If there are multiple plausible recent Ralph task files or the cwd does not contain the expected artifacts, ask one clarification question with the likely paths instead of guessing.

## Scenario handling

Good:
- User says `continue` after the workflow has a clear next step: continue current planning branch.
- User changes only output shape or downstream delivery: preserve earlier constraints and apply the update locally.
- User asks to skip planning: do not implement directly from RALPLAN; ask whether to start Ralph from the current best plan.

Bad:
- Restarting discovery when a valid interview artifact already exists.
- Asking user for codebase facts that can be inspected.
- Running Architect and Critic in parallel.
- Producing a plan without acceptance criteria.
- Starting implementation directly from the planning skill.
