import * as fs from "node:fs";
import * as path from "node:path";
import { completeSimple } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

import { COMPACT_THRESHOLD_PERCENT } from "../exec-plan-loop/constants";
import { getGitSnapshot } from "../exec-plan-loop/state";
import type { AgentOutcome } from "../exec-plan-loop/types";
import { createRunTag, summarizeAgentOutcome, truncate } from "../exec-plan-loop/utils";
import { setAskUserQuestionToolEnabled, type ToolAvailabilityChange } from "../loop-runtime";

const RALPH_ROOT = "ralph-loop";
const COMPLETE_MARKER = "<promise>COMPLETE</promise>";
const LOOP_MARKER_PREFIX = "RALPH_LOOP_NAME:";
const NAME_MODEL_PROVIDER = "openai-codex";
const NAME_MODEL_ID = "gpt-5.3-codex-spark";
const NAME_GENERATION_TIMEOUT_MS = 5_000;
const RALPH_COMPACT_INSTRUCTIONS = [
	"Summarize the active Ralph prompt loops so they can continue after compaction.",
	"Preserve loop names, original prompts, optional args, iteration counts, completion marker requirements, current repo state, last actions, blockers, and any verification evidence.",
	"Keep the summary concise but sufficient for continuing each named loop without relying on hidden memory.",
].join("\n");

type RalphTurnStatus = AgentOutcome["status"] | "baseline" | "stopped" | "complete";

interface RalphState {
	version: 1;
	name: string;
	enabled: boolean;
	runTag: string;
	prompt: string;
	args: string | null;
	startedAt: string;
	updatedAt: string;
	iteration: number;
	maxIterations: number;
	lastTurn?: {
		status: RalphTurnStatus;
		summary: string;
		assistantStopReason?: string;
		assistantError?: string;
		assistantText?: string;
		toolErrors: string[];
	};
}

function sanitizeName(name: string): string {
	return name.trim().toLowerCase().replace(/[^a-z0-9_.-]+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "") || "loop";
}

function fallbackNameFromPrompt(prompt: string): string {
	return sanitizeName(prompt.split(/\s+/).slice(0, 6).join("-")).slice(0, 48) || "loop";
}

function uniqueName(ctx: ExtensionContext, rawName: string): string {
	const base = sanitizeName(rawName).slice(0, 48) || "loop";
	let candidate = base;
	let counter = 2;
	while (fs.existsSync(statePath(ctx, candidate))) {
		candidate = `${base}-${counter}`;
		counter += 1;
	}
	return candidate;
}

function rootDir(ctx: ExtensionContext): string {
	return path.join(ctx.cwd, ".pi", RALPH_ROOT);
}

function loopDir(ctx: ExtensionContext, name: string): string {
	return path.join(rootDir(ctx), sanitizeName(name));
}

function statePath(ctx: ExtensionContext, name: string): string {
	return path.join(loopDir(ctx, name), "state.json");
}

function eventsPath(ctx: ExtensionContext, name: string): string {
	return path.join(loopDir(ctx, name), "events.ndjson");
}

function ensureLoopDir(ctx: ExtensionContext, name: string): void {
	fs.mkdirSync(loopDir(ctx, name), { recursive: true });
}

function saveState(ctx: ExtensionContext, state: RalphState): void {
	ensureLoopDir(ctx, state.name);
	const filePath = statePath(ctx, state.name);
	const tempPath = `${filePath}.tmp`;
	fs.writeFileSync(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
	fs.renameSync(tempPath, filePath);
}

function isRalphState(value: unknown): value is RalphState {
	if (!value || typeof value !== "object") return false;
	const state = value as Partial<RalphState>;
	return state.version === 1
		&& typeof state.name === "string"
		&& typeof state.enabled === "boolean"
		&& typeof state.runTag === "string"
		&& typeof state.prompt === "string"
		&& typeof state.iteration === "number"
		&& typeof state.maxIterations === "number";
}

function loadState(ctx: ExtensionContext, name: string): RalphState | null {
	try {
		const parsed = JSON.parse(fs.readFileSync(statePath(ctx, name), "utf8"));
		return isRalphState(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

function listStates(ctx: ExtensionContext): RalphState[] {
	try {
		return fs.readdirSync(rootDir(ctx), { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => loadState(ctx, entry.name))
			.filter((state): state is RalphState => state !== null)
			.sort((a, b) => a.name.localeCompare(b.name));
	} catch {
		return [];
	}
}

function appendEvent(ctx: ExtensionContext, name: string, event: Record<string, unknown>): void {
	try {
		ensureLoopDir(ctx, name);
		fs.appendFileSync(eventsPath(ctx, name), `${JSON.stringify({ ...event, timestamp: new Date().toISOString() })}\n`, "utf8");
	} catch {
		// best effort only
	}
}

function tokenizeArgs(args: string): string[] {
	return args.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((token) => token.replace(/^"|"$/g, "")) ?? [];
}

function extractStartArgs(args: string): { explicitName: string | null; resumeName: string | null; prompt: string; maxIterations: number; extraArgs: string | null } {
	const tokens = tokenizeArgs(args);
	let maxIterations = 50;
	let explicitName: string | null = null;
	const positional: string[] = [];
	const extra: string[] = [];
	let passthrough = false;

	for (let i = 0; i < tokens.length; i += 1) {
		const token = tokens[i];
		if (passthrough) {
			extra.push(token);
			continue;
		}
		if (token === "--") {
			passthrough = true;
			continue;
		}
		if ((token === "--name" || token === "-n") && tokens[i + 1]) {
			explicitName = sanitizeName(tokens[i + 1]);
			i += 1;
			continue;
		}
		if (token.startsWith("--name=")) {
			explicitName = sanitizeName(token.slice("--name=".length));
			continue;
		}
		if (token === "--max-iterations" && tokens[i + 1]) {
			maxIterations = Number.parseInt(tokens[i + 1], 10) || maxIterations;
			i += 1;
			continue;
		}
		if (token.startsWith("--max-iterations=")) {
			maxIterations = Number.parseInt(token.slice("--max-iterations=".length), 10) || maxIterations;
			continue;
		}
		if (token.startsWith("--")) {
			extra.push(token);
			continue;
		}
		positional.push(token);
	}

	const prompt = positional.join(" ").trim();
	return {
		explicitName,
		resumeName: explicitName === null && positional.length === 1 ? sanitizeName(positional[0]) : null,
		prompt,
		maxIterations: Math.max(1, maxIterations),
		extraArgs: extra.length > 0 ? extra.join(" ") : null,
	};
}

function extractLoopNameFromMessages(messages: unknown): string | null {
	if (!Array.isArray(messages)) return null;
	for (let i = messages.length - 1; i >= 0; i -= 1) {
		const message = messages[i];
		if (!message || typeof message !== "object") continue;
		if ((message as { role?: unknown }).role !== "user") continue;
		const content = (message as { content?: unknown }).content;
		const text = typeof content === "string"
			? content
			: Array.isArray(content)
				? content.flatMap((part) => part && typeof part === "object" && (part as { type?: unknown }).type === "text" && typeof (part as { text?: unknown }).text === "string" ? [(part as { text: string }).text] : []).join("\n")
				: "";
		const match = text.match(/RALPH_LOOP_NAME:\s*([^\s]+)/);
		if (match) return sanitizeName(match[1]);
	}
	return null;
}

function assistantCompleted(text: string | undefined): boolean {
	return Boolean(text?.includes(COMPLETE_MARKER));
}

function extractNameFromModelText(text: string): string {
	const trimmed = text.trim();
	try {
		const parsed = JSON.parse(trimmed);
		if (parsed && typeof parsed === "object" && typeof parsed.name === "string") return parsed.name;
	} catch {
		// Fall through to plain-text parsing for providers that ignore structured output.
	}
	return trimmed.split(/\s+/)[0] ?? trimmed;
}

function addNameStructuredOutput(payload: unknown): unknown {
	if (!payload || typeof payload !== "object") return payload;
	const record = payload as Record<string, unknown>;
	const text = record.text && typeof record.text === "object" ? record.text as Record<string, unknown> : {};
	return {
		...record,
		text: {
			...text,
			format: {
				type: "json_schema",
				name: "ralph_loop_name",
				strict: true,
				schema: {
					type: "object",
					additionalProperties: false,
					required: ["name"],
					properties: {
						name: {
							type: "string",
							description: "Filesystem-safe Ralph loop namespace slug.",
							pattern: "^[a-z0-9][a-z0-9-]{1,47}$",
						},
					},
				},
			},
		},
	};
}

async function generateLoopName(ctx: ExtensionContext, prompt: string, args: string | null): Promise<string> {
	const fallback = fallbackNameFromPrompt(prompt);
	const existingNames = listStates(ctx).map((state) => state.name);
	const model = ctx.modelRegistry.find(NAME_MODEL_PROVIDER, NAME_MODEL_ID);
	if (!model) return uniqueName(ctx, fallback);
	const getApiKey = (ctx.modelRegistry as unknown as { getApiKey?: (model: unknown) => Promise<string | null> }).getApiKey;
	const apiKey = typeof getApiKey === "function" ? await getApiKey.call(ctx.modelRegistry, model).catch(() => null) : null;

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), NAME_GENERATION_TIMEOUT_MS);
	try {
		const response = await completeSimple(model, {
			messages: [{
				role: "user" as const,
				content: [{
					type: "text" as const,
					text: [
						"Create a short filesystem-safe slug for this loop.",
						"Rules: 2-5 lowercase words, hyphen-separated, no quotes, no extension, max 48 chars.",
						"Avoid existing namespaces. If the prompt is similar to an existing namespace, choose a clearly distinct suffix.",
						`Existing namespaces: ${existingNames.length > 0 ? existingNames.join(", ") : "none"}`,
						`Prompt: ${prompt}`,
						args ? `Optional args: ${args}` : "",
					].filter(Boolean).join("\n"),
				}],
				timestamp: Date.now(),
			}],
		}, {
			...(apiKey ? { apiKey } : {}),
			maxTokens: 32,
			reasoning: "minimal",
			signal: controller.signal,
			timeoutMs: NAME_GENERATION_TIMEOUT_MS,
			maxRetries: 0,
			onPayload: addNameStructuredOutput,
		});
		const text = response.content
			.filter((part): part is { type: "text"; text: string } => part.type === "text")
			.map((part) => part.text)
			.join(" ");
		const candidate = sanitizeName(extractNameFromModelText(text));
		return uniqueName(ctx, candidate.length >= 4 && candidate !== "loop" ? candidate : fallback);
	} catch {
		return uniqueName(ctx, fallback);
	} finally {
		clearTimeout(timeout);
	}
}

async function buildPrompt(pi: ExtensionAPI, state: RalphState, options?: { postErrorContinue?: boolean; postCompaction?: boolean }): Promise<string> {
	const git = await getGitSnapshot(pi).catch(() => null);
	const lines = [
		`${LOOP_MARKER_PREFIX} ${state.name}`,
		"",
		`Ralph loop '${state.name}' is active. Run ${state.runTag}. Iteration ${state.iteration}.`,
		"",
		"Original prompt:",
		state.prompt,
	];

	if (state.args) {
		lines.push("", "Optional arguments:", state.args);
	}

	lines.push(
		"",
		"Loop contract:",
		"- Keep working on the original prompt until it is done.",
		`- When the task is fully done, output exactly: ${COMPLETE_MARKER}`,
		"- If it is not done, do useful next work now; do not ask permission for safe local steps.",
		"- Keep this loop scoped to its namespace/name. Do not mutate other Ralph loop state.",
		"- Complex planned/checklist-driven work belongs in exec-plan-loop, not Ralph.",
	);

	if (git) {
		lines.push("", "Repo snapshot:", `- Branch: ${git.branch}`, `- HEAD: ${git.headSha}`, `- Working tree: ${git.workingTreeClean ? "clean" : "dirty"}`);
		if (git.statusSummary.length > 0) {
			lines.push("- Status summary:");
			for (const statusLine of git.statusSummary) lines.push(`  ${statusLine}`);
		}
	}

	if (state.lastTurn) {
		lines.push("", "Previous turn:", `- Status: ${state.lastTurn.status}`, `- Summary: ${state.lastTurn.summary}`);
	}
	if (options?.postErrorContinue) {
		lines.push("", "The previous turn appears to have ended with a provider/runtime error. Continue from the last known state if possible.");
	}
	if (options?.postCompaction) {
		lines.push("", "Context was just compacted. Re-read any files you need before editing; do not rely only on memory.");
	}
	return lines.join("\n");
}

function updateStatus(ctx: ExtensionContext): void {
	if (!ctx.hasUI) return;
	const active = listStates(ctx).filter((state) => state.enabled);
	if (active.length === 0) {
		ctx.ui.setStatus("ralph", undefined);
		ctx.ui.setWidget("ralph", undefined);
		return;
	}
	const { theme } = ctx.ui;
	ctx.ui.setStatus("ralph", theme.fg("accent", `🔁 ralph ${active.length}`));
	ctx.ui.setWidget("ralph", [
		theme.fg("accent", theme.bold("Ralph loops")),
		...active.map((state) => theme.fg("dim", `${state.name}: ${state.iteration}/${state.maxIterations} — ${truncate(state.prompt, 80)}`)),
	]);
}

export default function ralph(pi: ExtensionAPI) {
	const runtimeActive = new Set<string>();
	let compactionInProgress = false;

	function notifyToolAvailability(ctx: ExtensionContext, change: ToolAvailabilityChange): void {
		if (!ctx.hasUI || change === "unchanged") return;
		if (change === "disabled") ctx.ui.notify("Ralph loop active: ask_user_question tool disabled for the agent.", "info");
		else if (change === "enabled") ctx.ui.notify("Ralph loop inactive: ask_user_question tool restored for the agent.", "info");
		else ctx.ui.notify("ask_user_question tool could not be restored because it is not currently registered.", "warning");
	}

	function syncAskUserQuestionTool(ctx: ExtensionContext): void {
		const shouldDisable = runtimeActive.size > 0;
		const change = setAskUserQuestionToolEnabled(pi, !shouldDisable);
		notifyToolAvailability(ctx, change);
	}

	function sendLoopPrompt(name: string, content: string, ctx: ExtensionContext): void {
		runtimeActive.add(name);
		syncAskUserQuestionTool(ctx);
		pi.sendUserMessage(content, { deliverAs: "followUp" });
	}

	function shouldCompact(ctx: ExtensionContext): boolean {
		const usage = ctx.getContextUsage();
		return Boolean(usage && usage.tokens !== null && usage.contextWindow > 0 && usage.tokens > usage.contextWindow * COMPACT_THRESHOLD_PERCENT);
	}

	function triggerCompaction(ctx: ExtensionContext): void {
		if (compactionInProgress || runtimeActive.size === 0) return;
		compactionInProgress = true;
		if (ctx.hasUI) ctx.ui.notify("Ralph auto-compaction started.", "info");
		ctx.compact({
			customInstructions: RALPH_COMPACT_INSTRUCTIONS,
			onComplete: async () => {
				compactionInProgress = false;
				if (ctx.hasUI) ctx.ui.notify("Ralph auto-compaction completed.", "info");
				for (const name of [...runtimeActive]) {
					const activeState = loadState(ctx, name);
					if (!activeState?.enabled) {
						runtimeActive.delete(name);
						continue;
					}
					sendLoopPrompt(name, await buildPrompt(pi, activeState, { postCompaction: true }), ctx);
				}
				syncAskUserQuestionTool(ctx);
			},
			onError: (error) => {
				compactionInProgress = false;
				if (ctx.hasUI) ctx.ui.notify(`Ralph auto-compaction failed: ${error.message}`, "warning");
			},
		});
	}

	async function startLoop(name: string, prompt: string, maxIterations: number, args: string | null, ctx: ExtensionContext): Promise<RalphState> {
		const now = new Date().toISOString();
		const state: RalphState = {
			version: 1,
			name,
			enabled: true,
			runTag: createRunTag(),
			prompt,
			args,
			startedAt: now,
			updatedAt: now,
			iteration: 0,
			maxIterations,
			lastTurn: { status: "baseline", summary: "Ralph loop started.", toolErrors: [] },
		};
		saveState(ctx, state);
		appendEvent(ctx, name, { type: "loop_start", runTag: state.runTag, maxIterations, prompt: truncate(prompt), args });
		updateStatus(ctx);
		sendLoopPrompt(name, await buildPrompt(pi, state), ctx);
		return state;
	}

	function stopLoop(ctx: ExtensionContext, name: string): void {
		fs.rmSync(loopDir(ctx, name), { recursive: true, force: true });
		runtimeActive.delete(name);
		syncAskUserQuestionTool(ctx);
		updateStatus(ctx);
		if (ctx.hasUI) ctx.ui.notify(`Stopped and removed Ralph loop '${name}'.`, "info");
	}

	function stopAllLoops(ctx: ExtensionContext): void {
		fs.rmSync(rootDir(ctx), { recursive: true, force: true });
		runtimeActive.clear();
		syncAskUserQuestionTool(ctx);
		updateStatus(ctx);
		if (ctx.hasUI) ctx.ui.notify("Stopped and removed all Ralph loops.", "info");
	}

	pi.on("session_start", async (_event, ctx) => {
		runtimeActive.clear();
		syncAskUserQuestionTool(ctx);
		updateStatus(ctx);
		const active = listStates(ctx).filter((state) => state.enabled);
		if (active.length > 0 && ctx.hasUI) {
			ctx.ui.notify(`Found paused Ralph loop(s): ${active.map((state) => state.name).join(", ")}. Resume with /start-ralph-loop <name>.`, "info");
		}
	});

	pi.on("before_agent_start", (event) => {
		return {
			systemPrompt: `${event.systemPrompt}\n\n[RALPH LOOP]\nIf the current user message contains '${LOOP_MARKER_PREFIX} <name>', that named Ralph loop is active. Continue that loop until done. When fully done, output exactly ${COMPLETE_MARKER}.`,
		};
	});

	pi.registerCommand("start-ralph-loop", {
		description: "<prompt> [--name NAME] [--max-iterations N] [-- extra args] — Start/resume named Ralph loop",
		handler: async (args, ctx) => {
			const parsed = extractStartArgs(args);
			if (parsed.resumeName) {
				const existing = loadState(ctx, parsed.resumeName);
				if (existing?.enabled) {
					existing.updatedAt = new Date().toISOString();
					saveState(ctx, existing);
					appendEvent(ctx, existing.name, { type: "loop_resume", runTag: existing.runTag, iteration: existing.iteration });
					updateStatus(ctx);
					sendLoopPrompt(existing.name, await buildPrompt(pi, existing), ctx);
					return;
				}
			}
			if (!parsed.prompt) {
				if (ctx.hasUI) ctx.ui.notify(`Usage: /start-ralph-loop "prompt" [--name NAME] [--max-iterations N]`, "warning");
				return;
			}
			const name = parsed.explicitName ?? await generateLoopName(ctx, parsed.prompt, parsed.extraArgs);
			await startLoop(name, parsed.prompt, parsed.maxIterations, parsed.extraArgs, ctx);
			if (ctx.hasUI) ctx.ui.notify(`Ralph loop '${name}' started.`, "info");
		},
	});

	pi.registerCommand("stop-ralph-loop", {
		description: "<name|--all> — Stop and remove Ralph loop state",
		handler: async (args, ctx) => {
			const raw = args.trim();
			if (raw === "--all") {
				stopAllLoops(ctx);
				return;
			}
			stopLoop(ctx, sanitizeName(raw || "default"));
		},
	});

	pi.registerCommand("status-ralph-loop", {
		description: "Show Ralph loop status",
		handler: async (_args, ctx) => {
			const states = listStates(ctx);
			if (states.length === 0) {
				if (ctx.hasUI) ctx.ui.notify("No Ralph loop state found.", "info");
				return;
			}
			if (ctx.hasUI) {
				ctx.ui.notify(states.map((state) => [
					`${state.name}: ${state.enabled ? "enabled" : "stopped"}`,
					`  run: ${state.runTag}`,
					`  iteration: ${state.iteration}/${state.maxIterations}`,
					`  prompt: ${state.prompt}`,
					`  last: ${state.lastTurn?.summary ?? "none"}`,
				].join("\n")).join("\n\n"), "info");
			}
		},
	});


	pi.on("agent_end", async (event, ctx) => {
		const name = extractLoopNameFromMessages(event.messages);
		if (!name) return;
		if (!runtimeActive.has(name)) return;
		const current = loadState(ctx, name);
		if (!current?.enabled) {
			runtimeActive.delete(name);
			syncAskUserQuestionTool(ctx);
			updateStatus(ctx);
			return;
		}

		const outcome = summarizeAgentOutcome(event.messages);
		const done = assistantCompleted(outcome.assistantText);
		const next: RalphState = {
			...current,
			updatedAt: new Date().toISOString(),
			iteration: current.iteration + 1,
			lastTurn: {
				status: done ? "complete" : outcome.status,
				summary: done ? "Assistant reported Ralph completion." : outcome.summary,
				assistantStopReason: outcome.assistantStopReason,
				assistantError: outcome.assistantError,
				assistantText: outcome.assistantText,
				toolErrors: outcome.toolErrors,
			},
		};

		if (done) {
			next.enabled = false;
			saveState(ctx, next);
			runtimeActive.delete(name);
			syncAskUserQuestionTool(ctx);
			appendEvent(ctx, name, { type: "loop_complete", runTag: next.runTag, iteration: next.iteration });
			updateStatus(ctx);
			if (ctx.hasUI) ctx.ui.notify(`Ralph loop '${name}' complete after ${next.iteration} iterations.`, "info");
			return;
		}

		if (next.iteration >= next.maxIterations) {
			next.enabled = false;
			next.lastTurn = { ...next.lastTurn, status: "stopped", summary: `Ralph loop stopped at max iterations (${next.maxIterations}).` };
			saveState(ctx, next);
			runtimeActive.delete(name);
			syncAskUserQuestionTool(ctx);
			appendEvent(ctx, name, { type: "loop_stop", reason: "max_iterations", runTag: next.runTag, iteration: next.iteration });
			updateStatus(ctx);
			if (ctx.hasUI) ctx.ui.notify(`Ralph loop '${name}' stopped at max iterations (${next.maxIterations}).`, "warning");
			return;
		}

		saveState(ctx, next);
		appendEvent(ctx, name, { type: "iteration_end", runTag: next.runTag, iteration: next.iteration, status: outcome.status, summary: truncate(outcome.summary) });
		updateStatus(ctx);
		if (shouldCompact(ctx)) {
			triggerCompaction(ctx);
			return;
		}
		if (outcome.shouldSendPlainContinue) sendLoopPrompt(name, "continue", ctx);
		else sendLoopPrompt(name, await buildPrompt(pi, next), ctx);
		if (ctx.hasUI) ctx.ui.notify(`Ralph loop '${name}' continuing (#${next.iteration}).`, outcome.status === "error" ? "warning" : "info");
	});
}
