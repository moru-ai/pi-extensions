---
name: deep-interview
description: Socratic requirements interview with ambiguity gating before planning or implementation. Use for broad, ambiguous, risky, or multi-step work where intent, scope, non-goals, decision boundaries, and acceptance criteria are not yet explicit.
---

# Deep Interview

Deep Interview is an intent-first Socratic clarification loop before planning or implementation. It turns vague ideas into execution-ready specifications by asking targeted questions about why the user wants a change, how far it should go, what should stay out of scope, and what the agent may decide without confirmation.

Use pi-native surfaces:

| Need | Use |
|---|---|
| Structured user choices | `ask_user_question` |
| Free-form interview question | Plain text, one question only |
| Repository exploration | `agent` with `subagent_type: "explorer"` |
| Interview artifact | `.ralph/interviews/<slug>.md` |
| Planning handoff | `/ralplan <artifact>` |
| Execution handoff | `/start-ralph-loop <plan>` |

Do not implement in this mode. Do not create PRDs.

## Invocation

```text
/deep-interview <rough task>
```

or:

```text
/skill:deep-interview <rough task>
```

## Depth profiles

- `--quick`: threshold `<= 0.30`, max rounds 5
- `--standard`: threshold `<= 0.20`, max rounds 12; default
- `--deep`: threshold `<= 0.15`, max rounds 20

## Execution policy

- Ask exactly one question per round.
- Never batch questions.
- Never ask the user to answer a numbered list.
- Ask about intent and boundaries before implementation detail.
- Target the weakest clarity dimension each round after applying stage priority.
- Treat every answer as a claim to pressure-test before moving on.
- The next question should usually demand an example/evidence signal, expose a hidden assumption, force a tradeoff/boundary, or reframe symptom vs root cause.
- Do not rotate to a new clarity dimension just for coverage when the current answer is still vague.
- Complete at least one pressure pass that revisits an earlier answer with an evidence, assumption, or tradeoff follow-up.
- Gather codebase facts with `explorer` before asking the user about internals.
- Reduce user effort: ask only the highest-leverage unresolved question.
- For brownfield work, prefer evidence-backed confirmation questions: "I found X in Y. Should this change follow that pattern?"
- Re-score ambiguity after each answer and show progress briefly when useful.
- Do not hand off to planning while ambiguity remains above threshold unless the user explicitly opts to proceed with warning.
- Do not hand off while `Non-goals` or `Decision Boundaries` remain unresolved, even if the weighted ambiguity threshold is met.

## Phase 0: Preflight context intake

1. Parse the rough task and derive a short slug.
2. Classify context as **brownfield** or **greenfield**.
3. If brownfield, launch `explorer` for narrow read-only repository context before asking codebase questions.
4. If initial context is oversized, first ask for a prompt-safe summary. The summary must preserve goals, constraints, success criteria, non-goals, decision boundaries, and references to source documents.
5. Keep retained history compact; preserve newest/highest-signal answers.

## Phase 1: Initialize

Announce:

- Profile and threshold.
- Current ambiguity: start at `1.0` unless the request is already partially specified.
- Whether this is brownfield or greenfield.
- Where the artifact will be written: `.ralph/interviews/<slug>.md`.

## Phase 2: Socratic interview loop

Repeat until ambiguity is under threshold, readiness gates are explicit, pressure pass is complete, user exits with warning, or max rounds are reached.

### 2a. Generate next question

Use:

- Original idea.
- Prior Q&A rounds.
- Current dimension scores.
- Brownfield evidence, if any.
- Any active challenge mode.

Stage priority:

1. **Intent-first:** Intent, Outcome, Scope, Non-goals, Decision Boundaries
2. **Feasibility:** Constraints, Success Criteria
3. **Brownfield grounding:** Context Clarity, only for brownfield work

Follow-up pressure ladder:

1. Ask for a concrete example, counterexample, or evidence signal behind the latest claim.
2. Probe the hidden assumption, dependency, or belief that makes the claim true.
3. Force a boundary or tradeoff: what should be rejected, deferred, or explicitly not done?
4. If the answer still describes symptoms, reframe toward essence/root cause before moving on.

Mandatory readiness gates:

- Non-goals must be explicit.
- Decision boundaries must be explicit.
- At least one pressure pass must be complete.

### 2b. Ask the question

Use `ask_user_question` when the question has bounded options. Use one question only.

Good shape:

```text
Round {n} | Target: {dimension} | Ambiguity: {score}%

{one question}
```

For multi-select only use it when multiple options can all be true. Otherwise use a single-choice question.

### 2c. Score ambiguity

Score dimensions in `[0.0, 1.0]` with a short justification and gap.

Greenfield:

```text
ambiguity = 1 - (intent * 0.30 + outcome * 0.25 + scope * 0.20 + constraints * 0.15 + success * 0.10)
```

Brownfield:

```text
ambiguity = 1 - (intent * 0.25 + outcome * 0.20 + scope * 0.20 + constraints * 0.15 + success * 0.10 + context * 0.10)
```

If either readiness gate is unresolved, continue interviewing even when the weighted threshold is met.

### 2d. Report progress

Briefly report:

- Ambiguity score.
- Weakest dimension.
- Gate status for Non-goals, Decision Boundaries, Pressure pass.

### 2e. Persist transcript mentally until artifact write

Do not create a new artifact every round unless useful. At crystallization, write the final interview artifact.

## Phase 3: Challenge modes

Use each at most once when applicable:

- **Contrarian:** round 2+ or when an answer rests on an untested assumption.
- **Simplifier:** round 4+ or when scope expands faster than outcome clarity.
- **Ontologist:** round 5+ and ambiguity > 0.25, or when the user keeps describing symptoms.

## Phase 4: Crystallize artifact

Write:

```text
.ralph/interviews/<slug>.md
```

Required artifact sections:

```markdown
# Interview: <Task>

## Metadata
- Profile:
- Rounds:
- Final ambiguity:
- Threshold:
- Context type: greenfield|brownfield
- Residual risk: none|low|medium|high

## Task
<rough task>

## Intent
- ...

## Desired Outcome
- ...

## In Scope
- ...

## Out of Scope / Non-goals
- ...

## Decision Boundaries
Agent may decide:
- ...

Ask user before:
- ...

## Constraints
- ...

## Testable Acceptance Criteria
- [ ] ...

## Assumptions Exposed + Resolutions
- ...

## Pressure-pass Findings
- Revisited answer:
- What changed:

## Brownfield Evidence vs Inference
- `path` — evidence
- Inference:

## Technical Context Findings
- ...

## Verification Expectations
- ...

## Open Questions
- ...

## Transcript
Condensed Q&A transcript.

## Planning Handoff
Recommended next command:
`/ralplan .ralph/interviews/<slug>.md`
```

## Phase 5: Execution bridge

Present handoff options after artifact generation. Recommended:

1. `/ralplan <artifact>` — consensus planning and Ralph-ready artifact creation.
2. Refine further — continue the interview loop.
3. `/start-ralph-loop .ralph/<slug>.md` — only after RALPLAN creates the Ralph execution task.

RALPLAN should produce:

```text
.ralph/plans/prd-<slug>.md
.ralph/plans/test-spec-<slug>.md
.ralph/<slug>.md
```

Residual-risk rule: if the interview ended early, at max rounds, or above threshold, explicitly preserve that residual-risk state in the artifact so planning knows it inherited a partially clarified brief.

## Stop conditions

- User says stop/cancel/abort: write current transcript if useful, then stop.
- Ambiguity stalls for 3 rounds: use Ontologist mode once.
- Max rounds reached: write artifact with residual-risk warning.
- All dimensions >= 0.9 and gates satisfied: crystallize early.

## Final checklist

- [ ] One question per round.
- [ ] Brownfield questions used evidence-backed confirmation when applicable.
- [ ] Ambiguity score tracked.
- [ ] Intent-first stage priority used.
- [ ] Non-goals explicit.
- [ ] Decision boundaries explicit.
- [ ] At least one assumption/pressure pass happened.
- [ ] Artifact written to `.ralph/interviews/<slug>.md`.
- [ ] No direct implementation performed.
- [ ] Next command suggested: `/ralplan <artifact>`.
