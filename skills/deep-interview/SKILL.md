---
name: deep-interview
description: Socratic deep interview with ambiguity gating before planning or implementation. Use when the user says deep interview, interview me, ask me questions, don't assume, clarify requirements, clarify this, or when a request is broad, vague, missing acceptance criteria, missing non-goals, or likely to produce misaligned execution.
argument-hint: "[--quick|--standard|--deep] <idea or vague description>"
metadata:
  author: moru-ai
  version: "1.1.3"
  inspired_by: "Yeachan-Heo/oh-my-codex deep-interview and Q00/ouroboros interview workflows"
---

# Deep Interview

<Purpose>
Deep Interview is an intent-first Socratic clarification loop before planning or implementation. It lowers ambiguity by asking targeted questions about why the user wants a change, how far it should go, what should stay out of scope, and what the agent may decide without confirmation.
</Purpose>

<Use_When>
- The request is broad, ambiguous, or missing concrete acceptance criteria.
- The user says "deep interview", "interview me", "ask me everything", "don't assume", or "clarify requirements".
- The user wants to avoid misaligned implementation from underspecified requirements.
- You need an ambiguity-reduced transcript before planning, implementation, or a longer execution loop.
</Use_When>

<Do_Not_Use_When>
- The request already has concrete file/symbol targets and clear acceptance criteria.
- The user explicitly asks to skip planning/interview and execute immediately.
- The user asks for lightweight brainstorming only.
- A complete clarified brief or plan already exists and execution should start.
</Do_Not_Use_When>

<Why_This_Exists>
Execution quality is usually bottlenecked by intent clarity, not implementation detail. A single expansion pass often misses why the user wants a change, where the scope should stop, which tradeoffs are unacceptable, and which decisions still require user approval. This workflow applies Socratic pressure plus ambiguity scoring so the next step begins from a clarified, testable, intent-aligned transcript.
</Why_This_Exists>

<Depth_Profiles>
- **Quick (`--quick`)**: fast pre-plan pass; target threshold `<= 0.30`; max rounds 5.
- **Standard (`--standard`, default)**: full requirements interview; target threshold `<= 0.20`; max rounds 12.
- **Deep (`--deep`)**: high-rigor exploration; target threshold `<= 0.15`; max rounds 20.

If no flag is provided, use **Standard**.
</Depth_Profiles>

<Execution_Policy>
- Ask ONE question per round. Never batch a long questionnaire.
- Ask about intent and boundaries before implementation detail.
- Target the weakest clarity dimension each round after applying the stage-priority rules below.
- Treat every answer as a claim to pressure-test before moving on. The next question should usually demand evidence or examples, expose a hidden assumption, force a tradeoff or boundary, or reframe root cause versus symptom.
- Do not rotate to a new clarity dimension just for coverage when the current answer is still vague. Stay on the same thread until one layer deeper, one assumption clearer, or one boundary tighter.
- Before closing the interview, complete at least one explicit pressure pass that revisits an earlier answer with a deeper, assumption-focused, or tradeoff-focused follow-up.
- Gather codebase facts with available read/search tools before asking the user about internals.
- For brownfield work, do a real repository reconnaissance pass before the first question: map likely touchpoints, relevant conventions, tests, docs, and analogous implementations. Start broad enough to avoid missing adjacent systems, then narrow to evidence directly relevant to the interview.
- When the `agent` tool is available and brownfield context is uncertain, cross-cutting, or likely to span multiple directories/modules, delegate repository exploration to one or more child agents before questioning. Prefer `explorer` for fast codebase reconnaissance and `general-purpose` for deeper synthesis. Use agents only to collect/summarize evidence; keep the Socratic interview with the user in the main thread.
- Reduce user effort: ask only the highest-leverage unresolved question, and never ask the user for codebase facts that can be discovered directly.
- For brownfield work, prefer evidence-backed confirmation questions such as: "I found X in Y. Should this change follow that pattern?"
- Re-score ambiguity after each answer and show progress transparently.
- Do not recommend execution while ambiguity remains above threshold unless the user explicitly opts to proceed with a warning.
- Be conservative when lowering ambiguity: prefer to keep the score higher until answers are concrete, evidence-backed, and bounded. Do not treat plausible inference, polite agreement, or a single shallow answer as clarity.
- Avoid large ambiguity drops: do not reduce total ambiguity by more than `0.20` after a single answer unless the user provides unusually complete, testable requirements covering intent, scope, non-goals, decision boundaries, and success criteria.
- Do not score any clarity dimension above `0.80` based on inference alone; require explicit user confirmation, concrete examples, evidence, or testable criteria.
- Do not close the interview while `Non-goals` or `Decision Boundaries` remain unresolved, even if the weighted ambiguity threshold is met, unless the user explicitly accepts the residual risk.
- Do not close the interview merely because the weighted threshold is met; close only when readiness gates are explicit, context confidence is adequate, and remaining unknowns are low-risk or accepted by the user.
- Treat early exit as a safety valve, not the default success path.
- Save the interview transcript under the current repository's `.pi/deep-interview/` directory. The transcript is the only required artifact; this skill focuses on lowering ambiguity, not managing runtime state.
</Execution_Policy>

<Steps>

## Phase 0: Preflight Context Intake

1. Parse the user's arguments and derive a short task slug.
2. Detect whether the task is **greenfield** or **brownfield**:
   - Greenfield: no existing codebase or existing behavior is relevant.
   - Brownfield: existing code, docs, deployed behavior, conventions, or compatibility constraints matter.
3. If brownfield, collect relevant codebase context before questioning:
   - Run a repository reconnaissance pass that is broad enough to identify likely touchpoints, naming patterns, architecture boundaries, existing tests, docs, and analogous implementations.
   - Then narrow to the files, symbols, behaviors, and conventions most relevant to the user's request.
   - If the likely touchpoints are unknown, cross-cutting, or spread across multiple areas, use the `agent` tool when available to delegate exploration before asking the first interview question. Example child-agent assignments: "map relevant modules", "find analogous implementations", "inspect tests/docs/contracts".
   - Record evidence-backed findings and uncertainty in the interview ledger; do not ask the user to provide facts that repo exploration can discover.
4. If the initial context is too large for safe prompt use, ask for a concise summary first. This is a blocking gate: do not score ambiguity, continue normal interview rounds, close the interview, or recommend execution until the summary is captured. The summary must preserve goals, constraints, success criteria, non-goals, decision boundaries, and references to any full source documents.
5. Initialize an interview ledger with:
   - task statement
   - desired outcome
   - stated solution, if any
   - probable intent hypothesis
   - known facts/evidence
   - constraints
   - unknowns/open questions
   - decision-boundary unknowns
   - likely codebase touchpoints, if brownfield

## Phase 1: Initialize

1. Parse depth profile (`--quick`, `--standard`, or `--deep`).
2. Set threshold and max rounds:
   - quick: threshold `0.30`, max rounds `5`
   - standard: threshold `0.20`, max rounds `12`
   - deep: threshold `0.15`, max rounds `20`
3. Announce kickoff with profile, threshold, and the current ambiguity assumption.
4. Start with `current_ambiguity = 1.0` unless enough context already exists to score lower.
5. For brownfield work, do not score Context Clarity above `0.60` until repository reconnaissance has found concrete files/symbols/patterns, and do not score it above `0.80` until likely tests/docs/contracts or analogous implementations have been checked or explicitly marked irrelevant.

## Phase 2: Socratic Interview Loop

Repeat until ambiguity `<= threshold`, the pressure pass is complete, readiness gates are explicit, minimum interview depth is satisfied, the user exits with warning, or max rounds are reached.

Minimum interview depth: Quick requires at least 4 rounds; Standard requires at least 8 rounds; Deep requires at least 12 rounds. Treat these as floors, not targets: continue past the floor whenever ambiguity, readiness gates, context confidence, or acceptance criteria remain weak. Only bypass this minimum when the user explicitly stops/exits with residual-risk warning, or when the initial brief already includes explicit intent, outcome, scope, non-goals, decision boundaries, constraints, acceptance criteria, and brownfield evidence if applicable.

### 2a) Generate next question

If the initial context is oversized and no prompt-safe summary has been recorded yet, the next question must only request that summary. Do not score ambiguity, run readiness gates, close the interview, or recommend execution until the summary answer is captured.

Use:
- original idea
- prior Q&A rounds
- current dimension scores
- brownfield context, if any
- activated challenge mode injection from Phase 3

Target the lowest-scoring dimension, but respect stage priority:

- **Stage 1 — Intent-first:** Intent, Outcome, Scope, Non-goals, Decision Boundaries.
- **Stage 2 — Feasibility:** Constraints, Success Criteria.
- **Stage 3 — Brownfield grounding:** Context Clarity, if brownfield.

Follow-up pressure ladder after each answer:

1. Ask for a concrete example, counterexample, or evidence signal behind the latest claim.
2. Probe the hidden assumption, dependency, or belief that makes the claim true.
3. Force a boundary or tradeoff: what would you explicitly not do, defer, or reject?
4. If the answer still describes symptoms, reframe toward essence/root cause before moving on.

Prefer staying on the same thread for multiple rounds when it has the highest leverage. Breadth without pressure is not progress.

Detailed dimensions:

- Intent Clarity — why the user wants this.
- Outcome Clarity — what end state they want.
- Scope Clarity — how far the change should go.
- Constraint Clarity — technical or business limits that must hold.
- Success Criteria Clarity — how completion will be judged.
- Context Clarity — existing codebase understanding, for brownfield work only.

`Non-goals` and `Decision Boundaries` are mandatory readiness gates. Ask about them early and keep revisiting them until they are explicit.

### 2b) Ask the question

Use a structured user-question tool when available. In pi, prefer `ask_user_question` for user decisions. Present:

    Round {n} | Target: {weakest_dimension} | Ambiguity: {score}

    {question}

Question-shape guidance:

- Use a single-choice question when exactly one answer should drive the next branch.
- Use a multi-select question when multiple constraints, non-goals, risks, or acceptance checks can all be true at once.
- Keep options bounded and concrete.
- Always include a custom-answer option such as `Type something else…` when presenting fixed choices.
- If choosing one option would immediately require a follow-up to disambiguate the others, ask a single-choice question now and follow up next round.

### 2c) Score ambiguity

Score each weighted dimension in `[0.0, 1.0]` with a brief justification and a gap.

Greenfield:

    ambiguity = 1 - (intent × 0.30 + outcome × 0.25 + scope × 0.20 + constraints × 0.15 + success × 0.10)

Brownfield:

    ambiguity = 1 - (intent × 0.25 + outcome × 0.20 + scope × 0.20 + constraints × 0.15 + success × 0.10 + context × 0.10)

Readiness gate:

- `Non-goals` must be explicit.
- `Decision Boundaries` must be explicit.
- A pressure pass must be complete: at least one earlier answer has been revisited with an evidence, assumption, or tradeoff follow-up.
- Brownfield context confidence must be explicit: likely touchpoints, relevant conventions, and tests/docs/contracts are either identified or explicitly ruled out.
- At least two concrete acceptance signals must be recorded, unless the user explicitly accepts a looser exploratory outcome.
- Minimum interview depth must be satisfied for the selected profile; treat the floor as a guardrail against premature closure, not as a reason to close.
- If any gate is unresolved, the pressure pass is incomplete, or minimum depth is unmet, continue interviewing even when weighted ambiguity is below threshold.

### 2d) Report progress

Show a concise weighted breakdown, readiness-gate status (`Non-goals`, `Decision Boundaries`, `Pressure pass`), and the next focus dimension.

Example:

    Ambiguity: 0.24 / target 0.20
    Weakest: non-goals, success criteria
    Gates: Non-goals unresolved; Decision boundaries partial; Pressure pass complete
    Next focus: define what first pass must not include

### 2e) Round controls

- Do not offer early exit before the first explicit assumption probe and one persistent follow-up have happened.
- Round 4+: allow explicit early exit with a risk warning.
- Soft warning at profile midpoint.
- Hard cap at profile max rounds.

## Phase 3: Challenge Modes

Use each mode once when applicable. These are normal escalation tools, not rare rescue moves.

- **Contrarian**: round 2+ or immediately when an answer rests on an untested assumption. Challenge core assumptions.
- **Simplifier**: round 4+ or when scope expands faster than outcome clarity. Probe minimal viable scope.
- **Ontologist**: round 5+ and ambiguity > 0.25, or when the user keeps describing symptoms. Ask for essence-level reframing.

Track used modes to prevent repetition.

## Phase 4: Save Interview Transcript

When threshold is met, the user exits with warning, or the hard cap is reached, save the interview transcript. Do not create a separate requirements file by default. This skill's job is to lower ambiguity and preserve the clarified conversation.

Create a project-local run directory when needed:

- `.pi/deep-interview/{slug}/`

Write one required artifact:

- `.pi/deep-interview/{slug}/transcript.md`

The transcript should include:

- Metadata: profile, rounds, final ambiguity, threshold, context type.
- Initial context summary, especially when oversized context was provided.
- Clarity breakdown table.
- Intent: why the user wants this.
- Desired Outcome.
- In-Scope.
- Out-of-Scope / Non-goals.
- Decision Boundaries: what the agent may decide without confirmation.
- Constraints.
- Testable acceptance criteria.
- Assumptions exposed and resolutions.
- Pressure-pass findings: which answer was revisited and what changed.
- Brownfield evidence versus inference notes for repository-grounded confirmation questions.
- Technical context findings.
- Full or condensed Q&A transcript.

Create directories recursively. Overwrite `transcript.md` safely when refining the same interview slug, or create a new slug if the task meaning changes materially.

## Phase 5: Close the Interview

After saving the transcript, summarize the final ambiguity score, the remaining weakest dimensions if any, and the recommended next step. Do not implement directly inside Deep Interview.

If the interview ended by early exit, hard-cap completion, or above-threshold proceed-with-warning, explicitly preserve that residual-risk status in the transcript and final response.

</Steps>

<Tool_Usage>
- Use available read/search tools for codebase fact gathering.
- Use the `agent` tool for brownfield repository exploration when the relevant context is uncertain, cross-cutting, or likely to span multiple directories/modules.
- Use `ask_user_question` for structured user decisions when available.
- Save the transcript under `.pi/deep-interview/{slug}/transcript.md`.
- Record whether oversized initial context summary is not needed, pending, or satisfied before scoring or closeout.
</Tool_Usage>

<Escalation_And_Stop_Conditions>
- User says stop/cancel/abort: save a partial transcript if useful and stop.
- Ambiguity stalls for 3 rounds (+/- 0.05): force Ontologist mode once.
- Max rounds reached: proceed only with explicit residual-risk warning.
- All dimensions >= 0.9: allow early closeout only if readiness gates are explicit, context confidence is adequate, acceptance signals are concrete, and remaining unknowns are low-risk or accepted by the user.
</Escalation_And_Stop_Conditions>

<Final_Checklist>
- [ ] Ambiguity score shown each round after scoring begins.
- [ ] Intent-first stage priority used before implementation detail.
- [ ] Weakest-dimension targeting used within the active stage.
- [ ] Non-goals are explicit.
- [ ] Decision boundaries are explicit.
- [ ] At least one explicit assumption probe happened before closeout.
- [ ] At least one persistent follow-up / pressure pass deepened a prior answer.
- [ ] Challenge modes triggered at thresholds when applicable.
- [ ] Transcript written to `.pi/deep-interview/{slug}/transcript.md`.
- [ ] Brownfield preflight explored the repository deeply enough to identify likely touchpoints, conventions, tests/docs/contracts, and analogous implementations before asking user questions about internals.
- [ ] Child agents were used for brownfield exploration when context was uncertain, cross-cutting, or multi-module and the `agent` tool was available.
- [ ] Brownfield questions use evidence-backed confirmation when applicable.
- [ ] Final response summarizes ambiguity reduction and recommended next step.
- [ ] No direct implementation performed in this mode.
</Final_Checklist>

<Advanced>

## Suggested Config

    [deepInterview]
    defaultProfile = "standard"
    quickThreshold = 0.30
    standardThreshold = 0.20
    deepThreshold = 0.15
    quickMaxRounds = 5
    standardMaxRounds = 12
    deepMaxRounds = 20
    enableChallengeModes = true

## Resume

If interrupted, rerun the skill and resume from `.pi/deep-interview/{slug}/transcript.md` when available.

## Recommended Pipeline

    deep-interview -> next-step recommendation

Deep Interview owns the clarity gate. Later planning, execution, QA, and validation happen outside this skill.

</Advanced>

Task: {{ARGUMENTS}}
