/**
 * Perspectives — structured multi-model deliberation.
 *
 * Phase 0: deterministic decision card (host-side)
 * Phase 1: blind parallel investigation
 * Phase 2: blind parallel critique (fast-path skips on unanimous high-confidence agreement)
 * Phase 3: editor memo synthesis
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { Message } from "@mariozechner/pi-ai";
import { getAgentDir, type ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";

const DEFAULT_MODELS = [
	"openai-codex/gpt-5.5:high",
	"openai-codex/gpt-5.4:high",
	"openai-codex/gpt-5.5:high",
];
const PERSPECTIVES_TOOLS = "read,bash,grep,find,ls";

function getExtensionDir(): string {
	return path.dirname(fileURLToPath(import.meta.url));
}
function getPromptsDir(): string {
	return path.resolve(getExtensionDir(), "..", "..", "perspectives-prompts");
}

const INVESTIGATOR_SYSTEM_PROMPT = () => path.join(getPromptsDir(), "investigator.md");
const CRITIC_SYSTEM_PROMPT = () => path.join(getPromptsDir(), "critic.md");
const EDITOR_SYSTEM_PROMPT = () => path.join(getPromptsDir(), "editor.md");
const WEBSEARCH_EXTENSION = path.resolve(getExtensionDir(), "..", "websearch", "index.ts");

// ── Types ──────────────────────────────────────────────────────────

type Signal =
	| { type: "propose"; proposal: string }
	| { type: "accept" }
	| { type: "reject" }
	| { type: "none" };

type CallState = "queued" | "running" | "completed" | "failed" | "skipped";
type ConfidenceLevel = "high" | "medium" | "low" | "unknown";
type SupportStatus = "unanimous" | "leaning" | "split" | "unknown";
type PerspectivesPhase = "decision-card" | "phase1" | "phase2" | "phase3" | "done";

interface DecisionCard {
	decision: string;
	topicSummary: string;
	investigatorAEmphasis: string;
	investigatorBEmphasis: string;
}

interface PhaseCallDetails {
	participant: string;
	model: string;
	prompt: string;
	text: string;
	state: CallState;
	liveStatus?: string;
	error?: string;
	sessionDir?: string;
	sessionFile?: string;
}

interface InvestigationDetails extends PhaseCallDetails {
	phase: 1;
	recommendation: string;
	counterargument: string;
	unknowns: string;
	confidence: ConfidenceLevel;
}

interface CritiqueDetails extends PhaseCallDetails {
	phase: 2;
	changeSummary: string;
	unresolvedQuestions: string;
}

interface EditorMemoDetails extends PhaseCallDetails {
	phase: 3;
	recommendation: string;
	supportStatus: SupportStatus;
	confidence: ConfidenceLevel;
}

interface PerspectivesDetails {
	models: string[];
	investigatorModels: string[];
	editorModel: string;
	sessionDir?: string;
	phase: PerspectivesPhase;
	decisionCard: DecisionCard;
	investigations: InvestigationDetails[];
	critiques: CritiqueDetails[];
	phase2Skipped: boolean;
	editorMemo?: EditorMemoDetails;
	finalMemo?: string;
	finalRecommendation?: string;
	supportStatus?: SupportStatus;
	confidence?: ConfidenceLevel;
}

// ── Session directories ────────────────────────────────────────────

function createPerspectivesSessionDir(): string {
	const baseDir = path.join(getAgentDir(), "perspectives-sessions");
	fs.mkdirSync(baseDir, { recursive: true });
	const ts = new Date().toISOString().replace(/[:.]/g, "-");
	const dir = path.join(baseDir, `perspectives-${ts}`);
	fs.mkdirSync(dir, { recursive: true });
	return dir;
}

function createTurnSessionDir(perspectivesDir: string, turnIndex: number, model: string): string {
	const safeModel = model.replace(/[^\w.-]+/g, "_");
	const dir = path.join(perspectivesDir, `turn-${turnIndex}-${safeModel}`);
	fs.mkdirSync(dir, { recursive: true });
	return dir;
}

function findSessionFile(dir: string): string | undefined {
	if (!fs.existsSync(dir)) return undefined;
	const stack = [dir];
	while (stack.length > 0) {
		const current = stack.pop();
		if (!current) continue;
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(current, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			const entryPath = path.join(current, entry.name);
			if (entry.isDirectory()) {
				stack.push(entryPath);
			} else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
				return entryPath;
			}
		}
	}
	return undefined;
}

// ── Helpers ────────────────────────────────────────────────────────

function truncate(text: string, max = 120): string {
	const normalized = text.replace(/\s+/g, " ").trim();
	if (!normalized) return "";
	return normalized.length > max ? `${normalized.slice(0, max)}…` : normalized;
}

function getPiInvocation(args: string[]): { command: string; args: string[] } {
	const currentScript = process.argv[1];
	if (currentScript && fs.existsSync(currentScript)) {
		return { command: process.execPath, args: [currentScript, ...args] };
	}
	if (
		!/^(node|bun)(\.exe)?$/.test(
			path.basename(process.execPath).toLowerCase(),
		)
	) {
		return { command: process.execPath, args };
	}
	return { command: "pi", args };
}

function getFinalText(messages: Message[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i].role === "assistant") {
			for (const part of messages[i].content) {
				if (typeof part === "object" && part.type === "text" && "text" in part) return (part as { type: "text"; text: string }).text;
			}
		}
	}
	return "";
}

function parseToolArgs(args: unknown): Record<string, unknown> | null {
	if (args && typeof args === "object" && !Array.isArray(args)) {
		return args as Record<string, unknown>;
	}
	if (typeof args !== "string") return null;
	try {
		const parsed = JSON.parse(args);
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
	} catch {}
	return null;
}

function summarizeChildTool(toolName: string, args: unknown): string {
	const params = parseToolArgs(args) ?? {};
	const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
	switch (toolName) {
		case "read":
			return truncate(`Reading ${str(params.path) || "file"}`);
		case "bash":
			return truncate(`Running ${str(params.command) || "command"}`);
		case "grep":
			return truncate(
				`Searching for "${str(params.pattern)}"${str(params.path) ? ` in ${str(params.path)}` : ""}`,
			);
		case "find":
			return truncate(
				`Finding ${str(params.pattern) || "files"}${str(params.path) ? ` in ${str(params.path)}` : ""}`,
			);
		case "ls":
			return truncate(`Listing ${str(params.path) || "directory"}`);
		case "websearch":
			return truncate(`Web search: ${str(params.query) || "query"}`);
		default:
			return truncate(`Running ${toolName}`);
	}
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractSection(
	text: string,
	labels: string[],
	nextLabels: string[],
): string {
	const labelPattern = labels.map(escapeRegExp).join("|");
	const nextPattern = nextLabels.length
		? nextLabels.map(escapeRegExp).join("|")
		: "__NO_NEXT_LABEL__";
	const blockPattern = new RegExp(
		String.raw`(?:^|\n)\s*(?:#{1,6}\s*)?(?:\d+\s*[.)-]\s*)?(?:\*\*)?(?:${labelPattern})(?:\*\*)?\s*:?\s*(?:\n|$)([\s\S]*?)(?=\n\s*(?:#{1,6}\s*)?(?:\d+\s*[.)-]\s*)?(?:\*\*)?(?:${nextPattern})(?:\*\*)?\s*:?\s*(?:\n|$)|$)`,
		"i",
	);
	const blockMatch = text.match(blockPattern);
	if (blockMatch?.[1]?.trim()) return blockMatch[1].trim();

	const inlinePattern = new RegExp(
		String.raw`(?:^|\n)\s*(?:#{1,6}\s*)?(?:\d+\s*[.)-]\s*)?(?:\*\*)?(?:${labelPattern})(?:\*\*)?\s*:\s*([^\n]+)`,
		"i",
	);
	const inlineMatch = text.match(inlinePattern);
	if (inlineMatch?.[1]?.trim()) return inlineMatch[1].trim();

	return "";
}

function firstParagraph(text: string): string {
	const trimmed = text.trim();
	if (!trimmed) return "";
	return trimmed.split(/\n\s*\n/)[0]?.trim() || trimmed;
}

function firstLine(text: string): string {
	const trimmed = text.trim();
	if (!trimmed) return "";
	return trimmed.split("\n")[0]?.trim() || trimmed;
}

function extractRecommendation(text: string): string {
	const section = extractSection(
		text,
		["Recommendation"],
		[
			"Evidence table",
			"Strongest counterargument against your own recommendation",
			"Strongest counterargument",
			"Unknowns / open questions",
			"Unknowns",
			"Confidence level",
			"Confidence",
			"Support status",
			"Decisive evidence",
		],
	);
	return section || firstParagraph(text);
}

function extractCounterargument(text: string): string {
	return (
		extractSection(
			text,
			[
				"Strongest counterargument against your own recommendation",
				"Strongest counterargument",
			],
			["Unknowns / open questions", "Unknowns", "Confidence level", "Confidence"],
		) || ""
	);
}

function extractUnknowns(text: string): string {
	return (
		extractSection(
			text,
			["Unknowns / open questions", "Unknowns", "Remaining unresolved questions", "Unresolved risks"],
			["Confidence level", "Confidence", "Next action"],
		) || ""
	);
}

function normalizeConfidence(value: string): ConfidenceLevel {
	const lower = value.toLowerCase();
	if (lower.includes("high")) return "high";
	if (lower.includes("medium")) return "medium";
	if (lower.includes("low")) return "low";
	return "unknown";
}

function extractConfidence(text: string): ConfidenceLevel {
	const section =
		extractSection(
			text,
			["Confidence level", "Confidence"],
			["Decisive evidence", "Strongest dissent", "Unresolved risks", "Next action"],
		) || text;
	return normalizeConfidence(section);
}

function normalizeSupportStatus(value: string): SupportStatus {
	const lower = value.toLowerCase();
	if (lower.includes("unanimous")) return "unanimous";
	if (lower.includes("leaning")) return "leaning";
	if (lower.includes("split")) return "split";
	return "unknown";
}

function extractSupportStatus(text: string): SupportStatus {
	const section =
		extractSection(
			text,
			["Support status"],
			["Confidence", "Decisive evidence", "Strongest dissent", "Unresolved risks", "Next action"],
		) || text;
	return normalizeSupportStatus(section);
}

function extractChangeSummary(text: string): string {
	return (
		extractSection(
			text,
			["Whether your own recommendation changes", "Whether their own recommendation changes"],
			["Remaining unresolved questions", "Unresolved risks", "Confidence"],
		) || firstParagraph(text)
	);
}

function normalizeRecommendation(value: string): string {
	return firstLine(value)
		.toLowerCase()
		.replace(/[*_`>#:[\]()]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function recommendationsMatch(a: string, b: string): boolean {
	const left = normalizeRecommendation(a);
	const right = normalizeRecommendation(b);
	if (!left || !right) return false;
	if (left === right) return true;
	if (left.length > 40 && right.includes(left)) return true;
	if (right.length > 40 && left.includes(right)) return true;
	return false;
}

function buildDecisionCard(topic: string): DecisionCard {
	const lines = topic
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);
	const decision = lines[0] || truncate(topic, 180);
	const summarySource = lines.slice(0, 8).join(" ") || topic;
	return {
		decision,
		topicSummary: truncate(summarySource, 500),
		investigatorAEmphasis:
			"current implementation, invariants, tests, migration/blast radius",
		investigatorBEmphasis:
			"alternatives, callers, ops/performance, prior art/docs",
	};
}

function formatDecisionCard(card: DecisionCard): string {
	return [
		"## Decision card",
		`- Decision: ${card.decision}`,
		`- Topic summary: ${card.topicSummary}`,
		`- Investigator A emphasis: ${card.investigatorAEmphasis}`,
		`- Investigator B emphasis: ${card.investigatorBEmphasis}`,
	].join("\n");
}

function buildInvestigatorPrompt(
	topic: string,
	card: DecisionCard,
	participant: string,
	emphasis: string,
): string {
	return `${formatDecisionCard(card)}

## Phase
Phase 1 — blind parallel investigation.

## Topic
${topic}

## Your role
You are Investigator ${participant}. Your soft emphasis is: ${emphasis}

This emphasis is guidance, not a restriction. Investigate whatever matters.
You cannot see the other investigator's work.

## Required output
Return a structured brief with exactly these sections:
1. Recommendation
2. Evidence table (claim → file:line or URL)
3. Strongest counterargument against your own recommendation
4. Unknowns / open questions
5. Confidence level (high/medium/low)

Be concrete, cite evidence, and make the recommendation actionable.`;
}

function buildCritiquePrompt(
	topic: string,
	card: DecisionCard,
	participant: string,
	ownBrief: string,
	otherBrief: string,
): string {
	return `${formatDecisionCard(card)}

## Phase
Phase 2 — blind parallel critique.

## Topic
${topic}

## Your role
You are Investigator ${participant} reviewing two investigation briefs.
Use tools to verify or disprove claims before you challenge them.

## Your brief
${ownBrief || "(no brief available)"}

## Other investigator brief
${otherBrief || "(no brief available)"}

## Required output
Return a challenge brief with exactly these sections:
1. Top 1-3 disputed claims in the other brief with counter-evidence
2. Blocker vs non-blocker classification for each dispute
3. Whether your own recommendation changes
4. Remaining unresolved questions

Focus on flaws, unsupported claims, missed evidence, and material risks.`;
}

function buildEditorPrompt(
	topic: string,
	card: DecisionCard,
	investigations: InvestigationDetails[],
	critiques: CritiqueDetails[],
	phase2Skipped: boolean,
): string {
	const investigationBlock = investigations
		.map(
			(inv) =>
				`### ${inv.participant} — ${inv.model}\nState: ${inv.state}\n\n${inv.text || inv.error || "(no brief available)"}`,
		)
		.join("\n\n---\n\n");
	const critiqueBlock = phase2Skipped
		? "Phase 2 was skipped because both Phase 1 investigators recommended the same option with high confidence."
		: critiques
				.map(
					(crit) =>
						`### ${crit.participant} — ${crit.model}\nState: ${crit.state}\n\n${crit.text || crit.error || "(no critique available)"}`,
				)
				.join("\n\n---\n\n");

	return `${formatDecisionCard(card)}

## Topic
${topic}

## Phase 1 briefs
${investigationBlock}

## Phase 2 critiques
${critiqueBlock}

## Required output
Return an advisory memo with exactly these sections:
- Recommendation (clear, actionable)
- Support status: unanimous | leaning | split
- Confidence: high | medium | low
- Decisive evidence (with file:line citations)
- Strongest dissent
- Unresolved risks
- Next action: implement | gather more evidence | escalate

Do not use tools. Synthesize only from the provided material.`;
}

function buildFallbackEditorMemo(details: PerspectivesDetails): string {
	const invA = details.investigations[0];
	const invB = details.investigations[1];
	const sameRecommendation =
		invA && invB
			? recommendationsMatch(invA.recommendation, invB.recommendation)
			: false;
	const support: SupportStatus = sameRecommendation
		? invA.confidence === "high" && invB.confidence === "high"
			? "unanimous"
			: "leaning"
		: "split";
	const recommendation =
		(sameRecommendation ? invA.recommendation : invA?.recommendation || invB?.recommendation) ||
		"Gather more evidence before implementing changes.";
	const confidence: ConfidenceLevel = sameRecommendation
		? invA.confidence === invB.confidence
			? invA.confidence
			: "medium"
		: "low";
	const strongestDissent =
		details.critiques.find((crit) => crit.state === "completed")?.changeSummary ||
		invA?.counterargument ||
		invB?.counterargument ||
		"No synthesized dissent available because the editor memo failed.";
	const unresolvedRisks = [invA?.unknowns, invB?.unknowns]
		.filter(Boolean)
		.map((value) => `- ${truncate(value || "", 300)}`)
		.join("\n");
	const nextAction =
		support === "unanimous" && confidence !== "low"
			? "implement"
			: "gather more evidence";

	return `Recommendation
${recommendation}

Support status
${support}

Confidence
${confidence}

Decisive evidence
- Investigator A: ${truncate(invA?.recommendation || "no brief", 240)}
- Investigator B: ${truncate(invB?.recommendation || "no brief", 240)}

Strongest dissent
${strongestDissent}

Unresolved risks
${unresolvedRisks || "- Editor synthesis failed; review the investigation briefs directly."}

Next action
${nextAction}`;
}

function cloneInvestigation(inv: InvestigationDetails): InvestigationDetails {
	return { ...inv };
}

function cloneCritique(crit: CritiqueDetails): CritiqueDetails {
	return { ...crit };
}

function cloneEditor(editor: EditorMemoDetails | undefined): EditorMemoDetails | undefined {
	return editor ? { ...editor } : undefined;
}

function buildContentText(details: PerspectivesDetails): string {
	const lines: string[] = [];

	if (details.phase === "decision-card") {
		lines.push("Perspectives: Phase 0/4 — building decision card");
		lines.push("");
		lines.push(`Decision: ${truncate(details.decisionCard.decision, 160)}`);
		return lines.join("\n");
	}

	if (details.phase === "phase1") {
		lines.push("Perspectives: Phase 1/4 — blind investigation running");
		lines.push("");
		for (const inv of details.investigations) {
			const icon = inv.state === "completed" ? "✓" : inv.state === "failed" ? "✗" : "⏳";
			const status =
				inv.state === "completed"
					? truncate(inv.recommendation || inv.text || "Completed", 100)
					: inv.state === "failed"
						? `Failed: ${truncate(inv.error || "unknown", 90)}`
						: inv.liveStatus || "Working…";
			lines.push(`${icon} ${inv.participant} (${inv.model}) — ${status}`);
		}
		return lines.join("\n");
	}

	if (details.phase === "phase2") {
		lines.push("Perspectives: Phase 2/4 — critique running");
		lines.push("");
		for (const crit of details.critiques) {
			const icon = crit.state === "completed" ? "✓" : crit.state === "failed" ? "✗" : "⏳";
			const status =
				crit.state === "completed"
					? truncate(crit.changeSummary || crit.text || "Completed", 100)
					: crit.state === "failed"
						? `Failed: ${truncate(crit.error || "unknown", 90)}`
						: crit.liveStatus || "Working…";
			lines.push(`${icon} ${crit.participant} (${crit.model}) — ${status}`);
		}
		return lines.join("\n");
	}

	if (details.phase === "phase3") {
		lines.push("Perspectives: Phase 3/4 — editor memo running");
		lines.push("");
		const editor = details.editorMemo;
		if (editor) {
			const icon = editor.state === "completed" ? "✓" : editor.state === "failed" ? "✗" : "⏳";
			const status =
				editor.state === "completed"
					? truncate(editor.recommendation || editor.text || "Completed", 100)
					: editor.state === "failed"
						? `Failed: ${truncate(editor.error || "unknown", 90)}`
						: editor.liveStatus || "Working…";
			lines.push(`${icon} Editor (${editor.model}) — ${status}`);
		}
		return lines.join("\n");
	}

	lines.push("Perspectives: 4 phases, advisory memo ready");
	lines.push("");
	lines.push("✓ Phase 0: Decision card");
	lines.push("✓ Phase 1: Investigation (2 models, parallel)");
	for (const inv of details.investigations) {
		lines.push(`  ${inv.participant}: ${truncate(inv.recommendation || inv.text || inv.error || "(no brief)", 100)}`);
	}
	lines.push(
		details.phase2Skipped
			? "✓ Phase 2: Critique (skipped — unanimous high-confidence agreement)"
			: "✓ Phase 2: Critique (2 models, parallel)",
	);
	if (!details.phase2Skipped) {
		for (const crit of details.critiques) {
			lines.push(`  ${crit.participant}: ${truncate(crit.changeSummary || crit.text || crit.error || "(no critique)", 100)}`);
		}
	}
	lines.push("✓ Phase 3: Editor memo");
	lines.push(`  Recommendation: ${truncate(details.finalRecommendation || details.editorMemo?.recommendation || "(missing)", 100)}`);
	lines.push(`  Support: ${details.supportStatus || details.editorMemo?.supportStatus || "unknown"}`);
	lines.push(`  Confidence: ${details.confidence || details.editorMemo?.confidence || "unknown"}`);
	return lines.join("\n");
}

// ── callPi ─────────────────────────────────────────────────────────

async function callPi(
	model: string,
	systemPromptPath: string,
	task: string,
	cwd: string,
	sessionDir?: string,
	signal?: AbortSignal,
	onStream?: (delta: string, accumulated: string) => void,
	onToolUse?: (toolName: string, args: unknown) => void,
): Promise<{ text: string; signal: Signal; error?: string; sessionFile?: string }> {
	const sessionArgs = sessionDir
		? ["--session-dir", sessionDir]
		: ["--no-session"];
	const args = [
		"--mode",
		"json",
		"-p",
		...sessionArgs,
		"--no-extensions",
		"-e",
		WEBSEARCH_EXTENSION,
		"--model",
		model,
		"--tools",
		PERSPECTIVES_TOOLS,
		"--append-system-prompt",
		systemPromptPath,
		task,
	];
	const invocation = getPiInvocation(args);

	return new Promise((resolve) => {
		const proc = spawn(invocation.command, invocation.args, {
			cwd,
			shell: false,
			stdio: ["ignore", "pipe", "pipe"],
		});

		const messages: Message[] = [];
		let buffer = "";
		let stderr = "";
		let accumulated = "";
		const detectedSignal: Signal = { type: "none" };

		const processLine = (line: string) => {
			if (!line.trim()) return;
			try {
				const event = JSON.parse(line);
				if (event.type === "tool_execution_start") {
					onToolUse?.(event.toolName, event.args);
				}
				if (
					event.type === "message_update" &&
					event.assistantMessageEvent?.type === "text_delta"
				) {
					accumulated += event.assistantMessageEvent.delta;
					onStream?.(event.assistantMessageEvent.delta, accumulated);
				}
				if (event.type === "message_end" && event.message) {
					messages.push(event.message as Message);
				}
			} catch {}
		};

		proc.stdout.on("data", (d: Buffer) => {
			buffer += d.toString();
			const lines = buffer.split("\n");
			buffer = lines.pop() || "";
			for (const line of lines) processLine(line);
		});
		proc.stderr.on("data", (d: Buffer) => {
			stderr += d.toString();
		});
		proc.on("close", (code) => {
			if (buffer.trim()) processLine(buffer);
			const text = getFinalText(messages);
			const sessionFile = sessionDir ? findSessionFile(sessionDir) : undefined;
			if (code !== 0 && !text)
				resolve({
					text: "",
					signal: detectedSignal,
					error: stderr.slice(0, 500) || `exit ${code}`,
					sessionFile,
				});
			else resolve({ text, signal: detectedSignal, sessionFile });
		});
		proc.on("error", (e) =>
			resolve({ text: "", signal: detectedSignal, error: e.message }),
		);

		if (signal) {
			const kill = () => {
				proc.kill("SIGTERM");
				setTimeout(() => {
					if (!proc.killed) proc.kill("SIGKILL");
				}, 5000);
			};
			if (signal.aborted) kill();
			else signal.addEventListener("abort", kill, { once: true });
		}
	});
}

// ── Extension ──────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	/*
	pi.registerTool({
		name: "perspectives",
		label: "Perspectives",
		description:
			"Get multi-model perspectives analysis. Two models investigate independently, critique each other's findings, and an editor synthesizes an advisory memo.",
		promptSnippet:
			"Use perspectives before major decisions — models investigate independently, critique each other's findings, then an editor synthesizes.",
		promptGuidelines: [
			"Use perspectives when facing architectural decisions, design trade-offs, or any choice where getting it wrong is costly.",
			"The topic must be self-contained and information-rich. Perspectives agents only see what you pass in topic.",
			"Include in topic: the decision to make, relevant code snippets, file contents, constraints, trade-offs, and your current thinking. Read the relevant files yourself and paste their contents into the topic.",
			"Perspectives runs in four phases: a host-built decision card, blind parallel investigation, blind parallel critique (or fast-path skip), and an editor memo.",
			"After perspectives returns, use the editor memo to guide your action. Pay close attention to support status, confidence, decisive evidence, and unresolved risks.",
		],
		parameters: Type.Object({
			topic: Type.String({
				description:
					"The full decision brief with all context: what to decide, relevant code, constraints, trade-offs. Perspectives agents only see this.",
			}),
		}),

		async execute(_id, params, signal, onUpdate, ctx) {
			const models: string[] = DEFAULT_MODELS;
			const investigatorModels = models.slice(0, 2);
			const editorModel = models[2] ?? investigatorModels[0];
			const investigatorPromptPath = INVESTIGATOR_SYSTEM_PROMPT();
			const criticPromptPath = CRITIC_SYSTEM_PROMPT();
			const editorPromptPath = EDITOR_SYSTEM_PROMPT();
			const perspectivesSessionDir = createPerspectivesSessionDir();
			const decisionCard = buildDecisionCard(params.topic);
			let callIndex = 0;

			const investigations: InvestigationDetails[] = investigatorModels.map((model, index) => ({
				phase: 1,
				participant: `Model ${index === 0 ? "A" : "B"}`,
				model,
				prompt: "",
				text: "",
				state: "queued",
				recommendation: "",
				counterargument: "",
				unknowns: "",
				confidence: "unknown",
			}));
			const critiques: CritiqueDetails[] = investigatorModels.map((model, index) => ({
				phase: 2,
				participant: `Model ${index === 0 ? "A" : "B"}`,
				model,
				prompt: "",
				text: "",
				state: "queued",
				changeSummary: "",
				unresolvedQuestions: "",
			}));
			const editorMemo: EditorMemoDetails = {
				phase: 3,
				participant: "Editor",
				model: editorModel,
				prompt: "",
				text: "",
				state: "queued",
				recommendation: "",
				supportStatus: "unknown",
				confidence: "unknown",
			};

			const details: PerspectivesDetails = {
				models: models as string[],
				investigatorModels,
				editorModel,
				sessionDir: perspectivesSessionDir,
				phase: "decision-card",
				decisionCard,
				investigations,
				critiques,
				phase2Skipped: false,
				editorMemo,
			};

			const emitUpdate = () => {
				onUpdate?.({
					content: [{ type: "text", text: buildContentText(details) }],
					details: {
						...details,
						investigations: details.investigations.map(cloneInvestigation),
						critiques: details.critiques.map(cloneCritique),
						editorMemo: cloneEditor(details.editorMemo),
					},
				});
			};

			const nextSessionDir = (label: string, model: string) =>
				createTurnSessionDir(perspectivesSessionDir, callIndex++, `${label}-${model}`);

			const runCall = async (
				entry: PhaseCallDetails,
				systemPromptPath: string,
				postProcess?: () => void,
			) => {
				entry.state = "running";
				entry.liveStatus = "Starting…";
				entry.sessionDir = nextSessionDir(entry.participant.toLowerCase().replace(/\s+/g, "-"), entry.model);
				emitUpdate();

				let lastStatus = "";
				const updateStatus = (status: string) => {
					if (status && status !== lastStatus) {
						lastStatus = status;
						entry.liveStatus = status;
						emitUpdate();
					}
				};

				const result = await callPi(
					entry.model,
					systemPromptPath,
					entry.prompt,
					ctx.cwd,
					entry.sessionDir,
					signal,
					() => updateStatus("Thinking…"),
					(toolName, args) => {
						const status = summarizeChildTool(toolName, args);
						if (status) updateStatus(status);
					},
				);

				entry.sessionFile = result.sessionFile;
				if (result.error) {
					entry.state = "failed";
					entry.error = result.error;
					entry.liveStatus = `Failed: ${truncate(result.error, 80)}`;
					emitUpdate();
					return;
				}

				entry.text = result.text.trim();
				entry.state = "completed";
				entry.liveStatus = "Completed";
				postProcess?.();
				emitUpdate();
			};

			emitUpdate();

			// Phase 1
			details.phase = "phase1";
			investigations[0].prompt = buildInvestigatorPrompt(
				params.topic,
				decisionCard,
				"A",
				decisionCard.investigatorAEmphasis,
			);
			investigations[1].prompt = buildInvestigatorPrompt(
				params.topic,
				decisionCard,
				"B",
				decisionCard.investigatorBEmphasis,
			);
			emitUpdate();

			await Promise.all(
				investigations.map((entry) =>
					runCall(entry, investigatorPromptPath, () => {
						entry.recommendation = extractRecommendation(entry.text);
						entry.counterargument = extractCounterargument(entry.text);
						entry.unknowns = extractUnknowns(entry.text);
						entry.confidence = extractConfidence(entry.text);
					}),
				),
			);

			const fastPath =
				investigations.every(
					(entry) => entry.state === "completed" && entry.confidence === "high" && !!entry.recommendation,
				) &&
				recommendationsMatch(
					investigations[0].recommendation,
					investigations[1].recommendation,
				);

			// Phase 2
			if (fastPath) {
				details.phase = "phase2";
				details.phase2Skipped = true;
				for (const critique of critiques) {
					critique.state = "skipped";
					critique.text = "Skipped due to unanimous high-confidence agreement in Phase 1.";
					critique.changeSummary = "Skipped (unanimous high-confidence agreement)";
					critique.unresolvedQuestions = "None raised during critique because the fast-path was taken.";
				}
				emitUpdate();
			} else {
				details.phase = "phase2";
				critiques[0].prompt = buildCritiquePrompt(
					params.topic,
					decisionCard,
					"A",
					investigations[0].text,
					investigations[1].text,
				);
				critiques[1].prompt = buildCritiquePrompt(
					params.topic,
					decisionCard,
					"B",
					investigations[1].text,
					investigations[0].text,
				);
				emitUpdate();

				await Promise.all(
					critiques.map((entry) =>
						runCall(entry, criticPromptPath, () => {
							entry.changeSummary = extractChangeSummary(entry.text);
							entry.unresolvedQuestions = extractUnknowns(entry.text);
						}),
					),
				);
			}

			// Phase 3
			details.phase = "phase3";
			editorMemo.prompt = buildEditorPrompt(
				params.topic,
				decisionCard,
				investigations,
				critiques,
				details.phase2Skipped,
			);
			emitUpdate();

			await runCall(editorMemo, editorPromptPath, () => {
				editorMemo.recommendation = extractRecommendation(editorMemo.text);
				editorMemo.supportStatus = extractSupportStatus(editorMemo.text);
				editorMemo.confidence = extractConfidence(editorMemo.text);
			});

			const finalMemo = editorMemo.text.trim() || buildFallbackEditorMemo(details);
			const finalRecommendation =
				editorMemo.recommendation || extractRecommendation(finalMemo) || "Gather more evidence before acting.";
			const supportStatus =
				editorMemo.supportStatus !== "unknown"
					? editorMemo.supportStatus
					: extractSupportStatus(finalMemo);
			const confidence =
				editorMemo.confidence !== "unknown"
					? editorMemo.confidence
					: extractConfidence(finalMemo);

			details.phase = "done";
			details.finalMemo = finalMemo;
			details.finalRecommendation = finalRecommendation;
			details.supportStatus = supportStatus;
			details.confidence = confidence;
			emitUpdate();

			return {
				content: [
					{
						type: "text",
						text: `${finalMemo}\n\nSession logs: ${perspectivesSessionDir}`,
					},
				],
				details: {
					...details,
					investigations: details.investigations.map(cloneInvestigation),
					critiques: details.critiques.map(cloneCritique),
					editorMemo: cloneEditor(details.editorMemo),
				},
			};
		},

		renderCall(args, theme) {
			const topic = typeof args.topic === "string" ? args.topic : "";
			const models = DEFAULT_MODELS;
			const investigators = models.slice(0, 2);
			const editor = models[2] ?? investigators[0];
			return new Text(
				`${theme.fg("toolTitle", theme.bold("perspectives "))}${theme.fg("accent", "structured deliberation")}\n` +
					`  ${theme.fg("dim", `Investigators: ${investigators.join(", ")}`)}\n` +
					`  ${theme.fg("dim", `Editor: ${editor}`)}\n` +
					`  ${theme.fg("dim", truncate(topic, 140))}`,
				0,
				0,
			);
		},

		renderResult(result, options, theme) {
			const details = result.details as PerspectivesDetails | undefined;
			const expanded = Boolean(options?.expanded);

			if (!details) {
				const text = result.content.find((p) => p.type === "text")?.text || "(no output)";
				return new Text(text, 0, 0);
			}

			if (!expanded) {
				if (details.phase !== "done") {
					return new Text(buildContentText(details), 0, 0);
				}

				const lines: string[] = [
					theme.fg("accent", "Perspectives: 4 phases, advisory memo ready"),
					"",
					theme.fg("muted", "✓ Phase 0: Decision card"),
					theme.fg("muted", "✓ Phase 1: Investigation (2 models, parallel)"),
					`  Model A: ${truncate(details.investigations[0]?.recommendation || details.investigations[0]?.text || "(no brief)", 100)}`,
					`  Model B: ${truncate(details.investigations[1]?.recommendation || details.investigations[1]?.text || "(no brief)", 100)}`,
				];

				if (details.phase2Skipped) {
					lines.push(theme.fg("muted", "✓ Phase 2: Critique (skipped — unanimous high-confidence agreement)"));
				} else {
					lines.push(theme.fg("muted", "✓ Phase 2: Critique (2 models, parallel)"));
				}

				lines.push(theme.fg("muted", "✓ Phase 3: Editor memo"));
				lines.push(`  Recommendation: ${truncate(details.finalRecommendation || "(missing)", 100)}`);
				lines.push(`  Support: ${details.supportStatus || "unknown"}`);
				lines.push(`  Confidence: ${details.confidence || "unknown"}`);
				lines.push("");
				lines.push(theme.fg("muted", "(expand for full briefs and memo)"));
				return new Text(lines.join("\n"), 0, 0);
			}

			const lines: string[] = [
				theme.fg("toolTitle", theme.bold("perspectives (structured deliberation)")),
				theme.fg("muted", `Investigators: ${details.investigatorModels.join(", ")}`),
				theme.fg("muted", `Editor: ${details.editorModel}`),
				details.sessionDir ? theme.fg("muted", `Sessions: ${details.sessionDir}`) : "",
				"",
				theme.fg("toolTitle", theme.bold("Phase 0 — Decision card")),
				formatDecisionCard(details.decisionCard),
				"",
				theme.fg("toolTitle", theme.bold("Phase 1 — Investigation")),
				"",
			].filter(Boolean);

			for (const inv of details.investigations) {
				lines.push(theme.fg("toolTitle", theme.bold(`${inv.participant} — ${inv.model}`)));
				lines.push(theme.fg("muted", `State: ${inv.state}`));
				if (inv.sessionFile) lines.push(theme.fg("muted", `Session: ${inv.sessionFile}`));
				if (inv.recommendation) lines.push(`Recommendation: ${truncate(inv.recommendation, 160)}`);
				if (inv.confidence !== "unknown") lines.push(`Confidence: ${inv.confidence}`);
				lines.push("");
				lines.push(theme.fg("toolTitle", theme.bold("Prompt")));
				lines.push(inv.prompt || "(no prompt)");
				lines.push("");
				lines.push(theme.fg("toolTitle", theme.bold(inv.state === "failed" ? "Error" : "Brief")));
				lines.push(inv.state === "failed" ? theme.fg("error", inv.error || "unknown error") : inv.text || "(no brief)");
				lines.push("");
				lines.push("---");
				lines.push("");
			}

			lines.push(theme.fg("toolTitle", theme.bold("Phase 2 — Critique")));
			lines.push("");
			if (details.phase2Skipped) {
				lines.push(theme.fg("muted", "Skipped due to unanimous high-confidence agreement in Phase 1."));
				lines.push("");
			} else {
				for (const crit of details.critiques) {
					lines.push(theme.fg("toolTitle", theme.bold(`${crit.participant} — ${crit.model}`)));
					lines.push(theme.fg("muted", `State: ${crit.state}`));
					if (crit.sessionFile) lines.push(theme.fg("muted", `Session: ${crit.sessionFile}`));
					if (crit.changeSummary) lines.push(`Recommendation change: ${truncate(crit.changeSummary, 160)}`);
					lines.push("");
					lines.push(theme.fg("toolTitle", theme.bold("Prompt")));
					lines.push(crit.prompt || "(no prompt)");
					lines.push("");
					lines.push(theme.fg("toolTitle", theme.bold(crit.state === "failed" ? "Error" : "Challenge brief")));
					lines.push(crit.state === "failed" ? theme.fg("error", crit.error || "unknown error") : crit.text || "(no critique)");
					lines.push("");
					lines.push("---");
					lines.push("");
				}
			}

			lines.push(theme.fg("toolTitle", theme.bold("Phase 3 — Editor memo")));
			if (details.editorMemo?.sessionFile) {
				lines.push(theme.fg("muted", `Session: ${details.editorMemo.sessionFile}`));
			}
			lines.push("");
			lines.push(theme.fg("toolTitle", theme.bold("Prompt")));
			lines.push(details.editorMemo?.prompt || "(no prompt)");
			lines.push("");
			lines.push(theme.fg("toolTitle", theme.bold("Memo")));
			lines.push(details.finalMemo || details.editorMemo?.text || "(no memo)");

			return new Text(lines.join("\n"), 0, 0);
		},
	});

	pi.registerCommand("perspectives", {
		description: "Start a structured multi-model perspectives deliberation",
		handler: async (args, ctx) => {
			const topic = args.trim();
			if (!topic) {
				ctx.ui.notify("Usage: /perspectives <topic>", "warning");
				return;
			}
			await (ctx as any).session.prompt(`Use the perspectives tool to analyze: ${topic}`);
		},
	});
	*/
}
