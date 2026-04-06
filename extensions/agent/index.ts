import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
	AuthStorage,
	DefaultResourceLoader,
	ModelRegistry,
	SessionManager,
	bashTool,
	createAgentSession,
	editTool,
	findTool,
	getAgentDir,
	grepTool,
	lsTool,
	parseFrontmatter,
	readTool,
	type AgentSession,
	type AgentSessionEvent,
	type ExtensionAPI,
	type Tool,
	writeTool,
} from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";

const DISABLE_ENV = "PI_AGENT_TOOL_DISABLED";
const MAX_TASKS = 5;
const MAX_CONCURRENCY = 5;

interface AgentConfig {
	name: string;
	description: string;
	model?: string;
	models?: string[];
	thinkingLevel?: "minimal" | "low" | "medium" | "high" | "max" | "off";
	systemPrompt: string;
	filePath: string;
}

interface AutoCompactionEventDetails {
	reason?: string;
	aborted?: boolean;
	willRetry?: boolean;
	errorMessage?: string;
}

type AgentTaskState = "queued" | "running" | "completed" | "failed";

interface AgentTaskDetails {
	index: number;
	agent: string;
	description: string;
	prompt: string;
	cwd: string;
	finalOutput: string;
	stderr: string;
	exitCode: number;
	state: AgentTaskState;
	liveStatus?: string;
	model?: string;
	stopReason?: string;
	errorMessage?: string;
	sessionId?: string;
	sessionDir?: string;
	sessionFile?: string;
	failureMessage?: string;
	autoCompactionCount?: number;
	autoCompactions?: AutoCompactionEventDetails[];
}

interface AgentBatchDetails {
	mode: "tasks";
	total: number;
	queued: number;
	running: number;
	completed: number;
	failed: number;
	results: AgentTaskDetails[];
}

const AgentTaskParams = Type.Object({
	description: Type.String({
		description: "Short 3-5 word summary of what this child agent will do",
	}),
	prompt: Type.String({
		description:
			"Complete task briefing for the child agent. Include all necessary context because the child starts fresh and has not seen this conversation.",
	}),
	subagent_type: Type.Optional(
		Type.String({
			description: 'Agent type to use for this task. Defaults to "general-purpose".',
		}),
	),
	cwd: Type.Optional(
		Type.String({
			description: "Working directory for this task. Defaults to the current working directory.",
		}),
	),
});

const AgentParams = Type.Object({
	tasks: Type.Array(AgentTaskParams, {
		minItems: 1,
		maxItems: MAX_TASKS,
		description:
			"One or more delegated tasks. Use one task for a single child agent. Independent tasks run concurrently inside this tool call.",
	}),
});

function getAgentsDir(): string {
	const extensionDir = path.dirname(fileURLToPath(import.meta.url));
	return path.resolve(extensionDir, "..", "..", "agents");
}

function discoverAgents(): AgentConfig[] {
	const dir = getAgentsDir();
	if (!fs.existsSync(dir)) return [];

	const entries = fs.readdirSync(dir, { withFileTypes: true });
	const agents: AgentConfig[] = [];

	for (const entry of entries) {
		if (!entry.name.endsWith(".md")) continue;
		if (!entry.isFile() && !entry.isSymbolicLink()) continue;

		const filePath = path.join(dir, entry.name);
		let content: string;
		try {
			content = fs.readFileSync(filePath, "utf-8");
		} catch {
			continue;
		}

		const { frontmatter, body } = parseFrontmatter<Record<string, string>>(content);
		if (!frontmatter.name || !frontmatter.description) continue;

		const models = frontmatter.models
			?.split(",")
			.map((model) => model.trim())
			.filter(Boolean);
		const primaryModel = models && models.length > 0 ? models[0] : frontmatter.model?.trim();
		const thinkingLevel = (() => {
			const value = frontmatter.thinkingLevel?.trim() || frontmatter.thinking?.trim();
			if (!value) return undefined;
			if (["minimal", "low", "medium", "high", "max", "off"].includes(value)) {
				return value as AgentConfig["thinkingLevel"];
			}
			return undefined;
		})();

		agents.push({
			name: frontmatter.name,
			description: frontmatter.description,
			model: primaryModel,
			models: models && models.length > 0 ? models : primaryModel ? [primaryModel] : undefined,
			thinkingLevel,
			systemPrompt: body.trim(),
			filePath,
		});
	}

	return agents.sort((a, b) => a.name.localeCompare(b.name));
}

function extractText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((part): part is { type: string; text?: string } => !!part && typeof part === "object" && "type" in part)
		.filter((part) => part.type === "text" && typeof part.text === "string")
		.map((part) => part.text)
		.join("");
}

function createDebugSessionDir(agentName: string): string {
	const baseDir = path.join(getAgentDir(), "agent-tool-sessions");
	fs.mkdirSync(baseDir, { recursive: true });
	const safeName = agentName.replace(/[^\w.-]+/g, "_");
	return fs.mkdtempSync(path.join(baseDir, `${safeName}-`));
}

function findSessionFile(sessionDir: string): string | undefined {
	if (!fs.existsSync(sessionDir)) return undefined;

	const stack = [sessionDir];
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
				continue;
			}
			if (entry.isFile() && entry.name.endsWith(".jsonl")) {
				return entryPath;
			}
		}
	}

	return undefined;
}

function createQueuedTaskDetails(task: { description: string; prompt: string; subagent_type?: string; cwd?: string }, index: number, defaultCwd: string): AgentTaskDetails {
	return {
		index,
		agent: task.subagent_type ?? "general-purpose",
		description: task.description,
		prompt: task.prompt,
		cwd: task.cwd ?? defaultCwd,
		finalOutput: "",
		stderr: "",
		exitCode: 0,
		state: "queued",
		autoCompactionCount: 0,
		autoCompactions: [],
	};
}

function createFailedTaskDetails(
	task: { description: string; prompt: string; subagent_type?: string; cwd?: string },
	index: number,
	defaultCwd: string,
	failureMessage: string,
): AgentTaskDetails {
	return {
		...createQueuedTaskDetails(task, index, defaultCwd),
		state: "failed",
		failureMessage,
		liveStatus: truncateSentence(`Failed: ${failureMessage}`),
		stderr: failureMessage,
		exitCode: 1,
	};
}

const BUILT_IN_TOOLS: Record<string, Tool> = {
	read: readTool,
	bash: bashTool,
	edit: editTool,
	write: writeTool,
	grep: grepTool,
	find: findTool,
	ls: lsTool,
};

const BUILT_IN_TOOL_GROUPS = {
	readOnly: ["read", "bash", "grep", "find", "ls"],
	coding: ["read", "bash", "edit", "write", "grep", "find", "ls"],
} as const;

const BLOCKED_CHILD_TOOL_NAMES = ["agent", "ask_user_question"] as const;

type BuiltInToolName = keyof typeof BUILT_IN_TOOLS;

type AgentToolPolicy = {
	builtIns: BuiltInToolName[];
	allowExtensionTools?: "all" | string[];
	blockedTools?: string[];
};

const DEFAULT_AGENT_TOOL_POLICY: AgentToolPolicy = {
	builtIns: [...BUILT_IN_TOOL_GROUPS.coding],
	allowExtensionTools: "all",
	blockedTools: [...BLOCKED_CHILD_TOOL_NAMES],
};

const AGENT_TOOL_POLICIES: Record<string, AgentToolPolicy> = {
	explorer: {
		builtIns: [...BUILT_IN_TOOL_GROUPS.readOnly],
		allowExtensionTools: "all",
		blockedTools: [...BLOCKED_CHILD_TOOL_NAMES],
	},
	"general-purpose": {
		...DEFAULT_AGENT_TOOL_POLICY,
		builtIns: [...DEFAULT_AGENT_TOOL_POLICY.builtIns],
		blockedTools: [...(DEFAULT_AGENT_TOOL_POLICY.blockedTools ?? [])],
	},
};

const BUILT_IN_TOOL_NAMES = new Set<string>(Object.keys(BUILT_IN_TOOLS));

function appendStderr(result: AgentTaskDetails, message: string | undefined) {
	if (!message?.trim()) return;
	result.stderr = [result.stderr.trim(), message.trim()].filter(Boolean).join("\n");
}

function getAgentToolPolicy(agentName: string): AgentToolPolicy {
	const policy = AGENT_TOOL_POLICIES[agentName] ?? DEFAULT_AGENT_TOOL_POLICY;
	return {
		builtIns: [...policy.builtIns],
		allowExtensionTools: policy.allowExtensionTools ?? DEFAULT_AGENT_TOOL_POLICY.allowExtensionTools,
		blockedTools: [...new Set([...(DEFAULT_AGENT_TOOL_POLICY.blockedTools ?? []), ...(policy.blockedTools ?? [])])],
	};
}

function computeChildActiveToolNames(session: AgentSession, agentName: string): string[] {
	const policy = getAgentToolPolicy(agentName);
	const builtIns = new Set<string>(policy.builtIns);
	const blockedTools = new Set(policy.blockedTools ?? []);
	const allowedExtensionTools = policy.allowExtensionTools;

	return session
		.getAllTools()
		.map((tool) => tool.name)
		.filter((toolName) => {
			if (blockedTools.has(toolName)) return false;
			if (BUILT_IN_TOOL_NAMES.has(toolName)) return builtIns.has(toolName);
			if (allowedExtensionTools === "all") return true;
			return (allowedExtensionTools ?? []).includes(toolName);
		});
}

function resolveModelSpec(modelRegistry: ModelRegistry, modelSpec: string) {
	const slash = modelSpec.indexOf("/");
	if (slash <= 0 || slash === modelSpec.length - 1) return undefined;
	const provider = modelSpec.slice(0, slash);
	const modelId = modelSpec.slice(slash + 1);
	return modelRegistry.find(provider, modelId);
}

function applyChildSessionEvent(
	result: AgentTaskDetails,
	event: AgentSessionEvent,
	compactionState: { pendingReason?: string },
	onUpdate?: (details: AgentTaskDetails) => void,
) {
	switch (event.type) {
		case "auto_compaction_start": {
			const reason = typeof event.reason === "string" ? event.reason : undefined;
			compactionState.pendingReason = reason;
			result.liveStatus = reason === "overflow" ? "Auto-compacting after context overflow" : "Auto-compacting context";
			onUpdate?.({ ...result });
			return;
		}
		case "auto_compaction_end": {
			const details: AutoCompactionEventDetails = {
				reason: compactionState.pendingReason,
				aborted: Boolean(event.aborted),
				willRetry: Boolean(event.willRetry),
				errorMessage: typeof event.errorMessage === "string" ? event.errorMessage : undefined,
			};
			compactionState.pendingReason = undefined;
			result.autoCompactions = [...(result.autoCompactions ?? []), details];
			if (event.result) result.autoCompactionCount = (result.autoCompactionCount ?? 0) + 1;
			if (details.errorMessage) {
				result.liveStatus = truncateSentence(`Auto-compaction failed: ${details.errorMessage}`);
			} else if (details.aborted) {
				result.liveStatus = "Auto-compaction cancelled";
			} else if (details.willRetry) {
				result.liveStatus = "Compaction complete, retrying child agent";
			} else if (event.result) {
				result.liveStatus = "Compaction complete";
			}
			onUpdate?.({ ...result });
			return;
		}
		case "tool_execution_start": {
			result.liveStatus = summarizeToolCall(event.toolName, event.args);
			onUpdate?.({ ...result });
			return;
		}
		case "tool_execution_end": {
			if (!result.liveStatus) result.liveStatus = summarizeToolCall(event.toolName, event.args);
			onUpdate?.({ ...result });
			return;
		}
		case "message_update": {
			if (event.assistantMessageEvent?.type === "toolcall_end") {
				result.liveStatus = summarizeToolCall(
					event.assistantMessageEvent.toolCall?.toolName ?? "tool",
					event.assistantMessageEvent.toolCall?.args,
				);
				onUpdate?.({ ...result });
				return;
			}

			if (event.assistantMessageEvent?.type === "text_delta") {
				if (typeof event.assistantMessageEvent.delta === "string") {
					result.finalOutput += event.assistantMessageEvent.delta;
					if (!result.liveStatus) result.liveStatus = getLiveResultLine(result.finalOutput);
					onUpdate?.({ ...result });
				}
			}
			return;
		}
		case "message_end": {
			if (event.message.role !== "assistant") return;
			const text = extractText(event.message.content);
			if (text) {
				result.finalOutput = text;
				if (!result.liveStatus) result.liveStatus = getLiveResultLine(text);
			}
			if (!result.model && event.message.model) result.model = event.message.model;
			if (typeof event.message.stopReason === "string") result.stopReason = event.message.stopReason;
			if (typeof event.message.errorMessage === "string" && event.message.errorMessage.trim()) {
				result.errorMessage = event.message.errorMessage.trim();
				appendStderr(result, result.errorMessage);
			}
			onUpdate?.({ ...result });
			return;
		}
		default:
			return;
	}
}

async function waitForChildSessionSettlement(session: AgentSession, signal?: AbortSignal): Promise<void> {
	const internalSession = session as AgentSession & { _agentEventQueue?: Promise<unknown> };
	let stablePasses = 0;

	while (stablePasses < 2) {
		if (signal?.aborted) return;
		await session.agent.waitForIdle();
		await internalSession._agentEventQueue;
		if (signal?.aborted) return;

		const stable = !session.isCompacting && !session.isRetrying && !session.agent.state.isStreaming;
		stablePasses = stable ? stablePasses + 1 : 0;
		if (stablePasses >= 2) return;
		await new Promise((resolve) => setTimeout(resolve, 150));
	}
}

async function runChildAgentAttempt(params: {
	agent: AgentConfig;
	prompt: string;
	cwd: string;
	description: string;
	index: number;
	model?: string;
	thinkingLevel?: AgentConfig["thinkingLevel"];
	signal?: AbortSignal;
	onUpdate?: (details: AgentTaskDetails) => void;
}): Promise<AgentTaskDetails> {
	const { agent, prompt, cwd, description, index, model, thinkingLevel, signal, onUpdate } = params;
	const debugSessionDir = createDebugSessionDir(agent.name);
	const result: AgentTaskDetails = {
		index,
		agent: agent.name,
		description,
		prompt,
		cwd,
		finalOutput: "",
		stderr: "",
		exitCode: 0,
		state: "running",
		model,
		sessionDir: debugSessionDir,
		autoCompactionCount: 0,
		autoCompactions: [],
	};

	const agentDir = getAgentDir();
	const authStorage = AuthStorage.create(path.join(agentDir, "auth.json"));
	const modelRegistry = new ModelRegistry(authStorage, path.join(agentDir, "models.json"));
	const resolvedModel = model ? resolveModelSpec(modelRegistry, model) : undefined;
	if (model && !resolvedModel) {
		result.exitCode = 1;
		result.errorMessage = `Unknown model: ${model}`;
		appendStderr(result, result.errorMessage);
		return result;
	}

	let session: AgentSession | undefined;
	try {
		const blockedExtensionFragments = [
			`${path.sep}extensions${path.sep}agent${path.sep}`,
			`${path.sep}extensions${path.sep}ask-user-question${path.sep}`,
		];
		const resourceLoader = new DefaultResourceLoader({
			cwd,
			agentDir,
			extensionsOverride: (base) => ({
				...base,
				extensions: base.extensions.filter((extension) => {
					const extensionPath = extension.resolvedPath || extension.path || "";
					return !blockedExtensionFragments.some((fragment) => extensionPath.includes(fragment));
				}),
			}),
			...(agent.systemPrompt ? { appendSystemPrompt: agent.systemPrompt } : {}),
		});
		await resourceLoader.reload();

		const created = await createAgentSession({
			cwd,
			agentDir,
			authStorage,
			modelRegistry,
			resourceLoader,
			sessionManager: SessionManager.create(cwd, debugSessionDir),
			...(resolvedModel ? { model: resolvedModel } : {}),
			...(thinkingLevel ? { thinkingLevel } : {}),
		});
		session = created.session;
		session.setActiveToolsByName(computeChildActiveToolNames(session, agent.name));
	} catch (error) {
		result.exitCode = 1;
		result.stopReason = "error";
		result.errorMessage = error instanceof Error ? error.message : String(error);
		appendStderr(result, result.errorMessage);
		return result;
	}

	if (!session) return result;

	result.sessionId = session.sessionManager.getSessionId();
	result.sessionFile = session.sessionManager.getSessionFile();
	if (!result.model && session.model) result.model = `${session.model.provider}/${session.model.id}`;
	onUpdate?.({ ...result });

	let wasAborted = false;
	const compactionState: { pendingReason?: string } = {};
	const unsubscribe = session.subscribe((event) => {
		applyChildSessionEvent(result, event, compactionState, onUpdate);
	});

	const abortHandler = () => {
		wasAborted = true;
		void session.abort().catch((error) => {
			appendStderr(result, error instanceof Error ? error.message : String(error));
		});
	};

	if (signal?.aborted) {
		abortHandler();
	}
	if (signal) signal.addEventListener("abort", abortHandler, { once: true });
	if (wasAborted) throw new Error("Child agent was aborted");

	try {
		await session.prompt(prompt);
		await waitForChildSessionSettlement(session, signal);
	} catch (error) {
		if (!wasAborted) {
			result.stopReason = "error";
			result.errorMessage = error instanceof Error ? error.message : String(error);
			appendStderr(result, result.errorMessage);
		}
	} finally {
		unsubscribe();
		if (signal) signal.removeEventListener("abort", abortHandler);
		result.sessionFile = session.sessionManager.getSessionFile() ?? result.sessionFile ?? findSessionFile(debugSessionDir);
		session.dispose();
	}

	const lastAssistant = [...session.messages].reverse().find((message) => message.role === "assistant");
	if (lastAssistant?.role === "assistant") {
		const text = extractText(lastAssistant.content);
		if (text) result.finalOutput = text;
		result.stopReason = lastAssistant.stopReason;
		if (typeof lastAssistant.errorMessage === "string" && lastAssistant.errorMessage.trim()) {
			result.errorMessage = lastAssistant.errorMessage.trim();
			appendStderr(result, result.errorMessage);
		}
		if (!result.model && lastAssistant.model) result.model = `${lastAssistant.provider}/${lastAssistant.model}`;
	}

	if (wasAborted) throw new Error("Child agent was aborted");
	result.exitCode = result.stopReason === "error" || result.stopReason === "aborted" ? 1 : 0;
	return result;
}

function shouldFallbackToNextModel(result: AgentTaskDetails): boolean {
	const text = `${result.stderr}
${result.finalOutput}
${result.errorMessage ?? ""}`.toLowerCase();
	if (!text.trim()) return true;
	return [
		"no api key found",
		"api key",
		"unknown model",
		"model not found",
		"unsupported model",
		"authentication",
		"unauthorized",
		"forbidden",
		"provider",
		"vercel-ai-gateway",
		"rate limit",
		"usage limit",
		"chatgpt usage limit",
		"quota",
		"insufficient_quota",
		"billing",
		"credits",
		"temporarily unavailable",
		"service unavailable",
		"server error",
		"internal server error",
		"overloaded",
		"timeout",
		"429",
		"500",
		"502",
		"503",
		"504",
	].some((term) => text.includes(term));
}

function summarizeAttemptFailure(result: AgentTaskDetails): string {
	const source = truncateSentence(result.stderr || result.finalOutput || "unknown failure", 120);
	return `${result.model ?? "default"}: ${source || "unknown failure"}`;
}

async function runChildAgent(params: {
	agent: AgentConfig;
	prompt: string;
	cwd: string;
	description: string;
	index: number;
	signal?: AbortSignal;
	onUpdate?: (details: AgentTaskDetails) => void;
}): Promise<AgentTaskDetails> {
	const { agent, prompt, cwd, description, index, signal, onUpdate } = params;
	const candidateModels = agent.models && agent.models.length > 0 ? agent.models : agent.model ? [agent.model] : [undefined];
	const failures: string[] = [];
	let lastResult: AgentTaskDetails | undefined;

	for (let modelIndex = 0; modelIndex < candidateModels.length; modelIndex++) {
		const model = candidateModels[modelIndex];
		const result = await runChildAgentAttempt({
			agent,
			prompt,
			cwd,
			description,
			index,
			model,
			thinkingLevel: agent.thinkingLevel,
			signal,
			onUpdate,
		});
		lastResult = result;

		if (result.exitCode === 0 && result.stopReason !== "error") {
			if (failures.length > 0) {
				result.stderr = result.stderr.trim();
			}
			return result;
		}

		failures.push(summarizeAttemptFailure(result));
		const hasNextModel = modelIndex < candidateModels.length - 1;
		if (!hasNextModel || !shouldFallbackToNextModel(result)) {
			result.stderr = [result.stderr.trim(), failures.length > 1 ? `Model attempts:\n${failures.join("\n")}` : undefined]
				.filter(Boolean)
				.join("\n\n");
			return result;
		}

		onUpdate?.({
			...result,
			state: "running",
			liveStatus: `Retrying with fallback model ${candidateModels[modelIndex + 1]}`,
		});
	}

	if (!lastResult) {
		return {
			index,
			agent: agent.name,
			description,
			prompt,
			cwd,
			finalOutput: "",
			stderr: "Child agent did not start",
			exitCode: 1,
			state: "failed",
			autoCompactionCount: 0,
			autoCompactions: [],
		};
	}

	return lastResult;
}

function formatToolAccess(agent: AgentConfig): string {
	const policy = getAgentToolPolicy(agent.name);
	const parts: string[] = [];
	if (policy.builtIns.length > 0) parts.push(policy.builtIns.join(", "));
	if (policy.allowExtensionTools === "all") {
		parts.push("all other extension tools");
	} else if ((policy.allowExtensionTools ?? []).length > 0) {
		parts.push((policy.allowExtensionTools ?? []).join(", "));
	}
	if ((policy.blockedTools ?? []).length > 0) {
		parts.push(`excluding ${(policy.blockedTools ?? []).join(", ")}`);
	}
	return parts.join("; ") || "default tool policy";
}

function getLiveResultLine(text: string): string {
	const lines = text
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);
	if (lines.length === 0) return "";
	const lastLine = lines[lines.length - 1].replace(/\s+/g, " ");
	return lastLine.length > 180 ? `${lastLine.slice(0, 180)}...` : lastLine;
}

function truncateSentence(text: string, max = 180): string {
	const normalized = text.replace(/\s+/g, " ").trim();
	if (!normalized) return "";
	return normalized.length > max ? `${normalized.slice(0, max)}...` : normalized;
}

async function mapWithConcurrencyLimit<TIn, TOut>(
	items: TIn[],
	concurrency: number,
	fn: (item: TIn, index: number) => Promise<TOut>,
): Promise<TOut[]> {
	if (items.length === 0) return [];
	const limit = Math.max(1, Math.min(concurrency, items.length));
	const results: TOut[] = new Array(items.length);
	let nextIndex = 0;
	const workers = new Array(limit).fill(null).map(async () => {
		while (true) {
			const current = nextIndex++;
			if (current >= items.length) return;
			results[current] = await fn(items[current], current);
		}
	});
	await Promise.all(workers);
	return results;
}

function summarizeToolCall(toolName: string, args: unknown): string {
	const params = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
	const str = (value: unknown) => (typeof value === "string" ? value.trim() : "");

	switch (toolName) {
		case "read": {
			const path = str(params.path);
			return truncateSentence(path ? `Reading ${path}` : "Reading file");
		}
		case "ls": {
			const path = str(params.path);
			return truncateSentence(path ? `Listing ${path}` : "Listing directory contents");
		}
		case "find": {
			const pattern = str(params.pattern);
			const path = str(params.path);
			return truncateSentence(`Finding ${pattern || "files"}${path ? ` in ${path}` : ""}`);
		}
		case "grep": {
			const pattern = str(params.pattern);
			const path = str(params.path);
			return truncateSentence(`Searching for ${pattern ? `“${pattern}”` : "matches"}${path ? ` in ${path}` : ""}`);
		}
		case "bash": {
			const command = str(params.command);
			return truncateSentence(command ? `Running ${command}` : "Running shell command");
		}
		case "edit": {
			const path = str(params.path);
			return truncateSentence(path ? `Editing ${path}` : "Editing file");
		}
		case "write": {
			const path = str(params.path);
			return truncateSentence(path ? `Writing ${path}` : "Writing file");
		}
		default:
			return truncateSentence(`Running ${toolName}`);
	}
}

function buildAgentToolDescription(agents: AgentConfig[]): string {
	const availableAgents = agents.map((agent) => `- ${agent.name}: ${agent.description} (Tools: ${formatToolAccess(agent)})`);
	return [
		"Launch one or more child agents to handle complex, multi-step delegated work.",
		"",
		"The agent tool runs a tasks array. Use one task for a single child agent. Independent tasks in the same array run concurrently inside this tool call.",
		"",
		"Available agent types and the tools they have access to:",
		...availableAgents,
		"",
		"Each task supports: description, prompt, optional subagent_type, and optional cwd.",
		"",
		"Use direct tools for very small, local tasks, such as reading a known file or making a tiny single-file change with clear context.",
		"Lean toward the agent tool when the work is broader or naturally decomposable, especially for exploring multiple files, investigating multiple areas, or work likely to affect multiple files.",
		"",
		"Usage notes:",
		"- Always call this tool with a tasks array",
		"- Use one task for a single delegated child agent",
		"- Use multiple tasks when independent delegated tasks should run concurrently",
		"- Do not issue multiple separate agent tool calls expecting pi to run them in parallel",
		"- Always include a short description (3-5 words) for each task",
		"- Each child starts fresh with zero context unless you provide it in the prompt",
		"- Provide clear, detailed prompts so each child can work autonomously and return exactly what you need",
		"- Clearly tell the child whether you expect it to write code or just do research",
		"- Do not duplicate work that a child agent is already doing",
		"- Prefer subagent_type=explorer for reconnaissance, code search, and context gathering across multiple files or code areas",
		"- Prefer subagent_type=general-purpose for synthesis, implementation, and deeper reasoning",
		"- Child agents do not have access to the agent tool",
		`- Maximum tasks per call: ${MAX_TASKS}`,
	].join("\n");
}

function buildAgentCatalog(agents: AgentConfig[]): string {
	if (agents.length === 0) return "";
	const lines = agents.map((agent) => `- ${agent.name}: ${agent.description} (Tools: ${formatToolAccess(agent)})`);
	return [
		"## Agent tool",
		"Use the agent tool when delegation is likely to improve speed, decomposition, or context management.",
		"Use direct tools for very small, local tasks such as reading a known file, checking a narrow detail, or making a tiny single-file change with clear context.",
		"Lean toward the agent tool when the task spans multiple files, multiple code areas, multiple hypotheses, or is likely to involve multiple edits.",
		"Always call the agent tool with a `tasks` array. Use one task for a single child agent, or multiple independent tasks to run child agents concurrently inside one tool call.",
		"Do not issue multiple separate agent tool calls expecting pi to execute them in parallel.",
		"Prefer `subagent_type=explorer` for reconnaissance, code search, and context gathering across multiple files or code areas.",
		"Prefer `subagent_type=general-purpose` for synthesis, implementation, and deeper reasoning.",
		"Avoid duplicating work that child agents are already doing.",
		"Each child agent starts fresh and has zero context beyond the task prompt you provide.",
		"Keep delegation shallow. Child agents do not have access to the `agent` tool.",
		`Maximum tasks per call: ${MAX_TASKS}.`,
		"",
		"Available subagents:",
		...lines,
	].join("\n");
}

function buildBatchDetails(results: AgentTaskDetails[]): AgentBatchDetails {
	const queued = results.filter((result) => result.state === "queued").length;
	const running = results.filter((result) => result.state === "running").length;
	const completed = results.filter((result) => result.state === "completed").length;
	const failed = results.filter((result) => result.state === "failed").length;
	return {
		mode: "tasks",
		total: results.length,
		queued,
		running,
		completed,
		failed,
		results: results.map((result) => ({
			...result,
			autoCompactions: [...(result.autoCompactions ?? [])],
		})),
	};
}

function buildTaskOutput(task: AgentTaskDetails): string {
	if (task.state === "failed") {
		return task.failureMessage || task.stderr || task.errorMessage || "Agent failed";
	}
	if (task.state === "completed") {
		return task.finalOutput || "(no output)";
	}
	return task.liveStatus || (task.state === "queued" ? "Queued" : "(running...)");
}

function buildBatchContent(details: AgentBatchDetails): string {
	const summary = `Tasks: ${details.total} | completed: ${details.completed} | running: ${details.running} | failed: ${details.failed} | queued: ${details.queued}`;
	const sections = details.results.map((task) => {
		const lines = [
			`[${task.index + 1}] ${task.description} (${task.agent})`,
			`Status: ${task.state}`,
			`CWD: ${task.cwd}`,
			task.state === "failed" ? "Failure:" : task.state === "completed" ? "Result:" : "Progress:",
			buildTaskOutput(task),
		];
		return lines.join("\n");
	});
	return [summary, "", ...sections].join("\n\n");
}

function getTaskStateIcon(task: AgentTaskDetails): string {
	switch (task.state) {
		case "completed":
			return "✓";
		case "failed":
			return "✗";
		case "running":
			return "⏳";
		default:
			return "•";
	}
}

function getTaskSummary(task: AgentTaskDetails): string {
	if (task.state === "failed") return truncateSentence(task.failureMessage || task.stderr || task.errorMessage || "Agent failed", 100);
	if (task.state === "completed") return truncateSentence(task.liveStatus || getLiveResultLine(task.finalOutput) || task.finalOutput || "(no output)", 100);
	return truncateSentence(task.liveStatus || (task.state === "queued" ? "Queued" : "Running..."), 100);
}

export default function agentExtension(pi: ExtensionAPI) {
	if (process.env[DISABLE_ENV] === "1") {
		return;
	}

	const agents = discoverAgents();
	const agentToolDescription = buildAgentToolDescription(agents);

	pi.registerTool({
		name: "agent",
		label: "Agent",
		description: agentToolDescription,
		promptSnippet: "Launch one or more child agents for delegated work via a tasks array",
		promptGuidelines: [
			"Always call the agent tool with a `tasks` array.",
			"Use one task when delegating a single child-agent task.",
			"Use multiple tasks when independent delegated tasks should run concurrently inside this tool call.",
			"Do not issue multiple separate agent tool calls expecting pi to execute them in parallel.",
			"Prefer direct tools for very small, local work like reading a known file, checking a narrow detail, or making a tiny single-file change with clear context.",
			"Lean toward the agent tool when work spans multiple files, multiple code areas, multiple hypotheses, or is likely to involve multiple edits.",
			"Use the agent tool when the task matches a specialized agent description.",
			"For each task, provide complete context in the prompt because the child agent starts fresh.",
			"Always include a short description (3-5 words) for each task.",
			"Do not duplicate work that a child agent is already doing.",
			"Prefer `subagent_type=explorer` for reconnaissance, code search, and context gathering across multiple files or code areas.",
			"Prefer `subagent_type=general-purpose` for synthesis, implementation, and deeper reasoning.",
			"Child agents do not have access to the agent tool.",
			`Maximum tasks per call: ${MAX_TASKS}.`,
		],
		parameters: AgentParams,
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const agents = discoverAgents();
			if (agents.length === 0) {
				throw new Error(`No agents found in ${getAgentsDir()}`);
			}

			if (!Array.isArray(params.tasks) || params.tasks.length === 0) {
				throw new Error("agent requires at least one task");
			}
			if (params.tasks.length > MAX_TASKS) {
				throw new Error(`Too many tasks (${params.tasks.length}). Maximum is ${MAX_TASKS}.`);
			}

			const results = params.tasks.map((task, index) => createQueuedTaskDetails(task, index, ctx.cwd));
			const emitUpdate = () => {
				const details = buildBatchDetails(results);
				onUpdate?.({
					content: [{ type: "text", text: buildBatchContent(details) }],
					details,
				});
			};

			emitUpdate();

			await mapWithConcurrencyLimit(params.tasks, MAX_CONCURRENCY, async (task, index) => {
				const agentName = task.subagent_type ?? "general-purpose";
				const agent = agents.find((item) => item.name === agentName);
				if (!agent) {
					const available = agents.map((item) => item.name).join(", ") || "none";
					results[index] = createFailedTaskDetails(task, index, ctx.cwd, `Unknown agent: ${agentName}. Available agents: ${available}`);
					emitUpdate();
					return;
				}

				results[index] = {
					...results[index],
					agent: agent.name,
					state: "running",
					liveStatus: "Starting child agent",
				};
				emitUpdate();

				const cwd = task.cwd ?? ctx.cwd;
				const childResult = await runChildAgent({
					agent,
					prompt: task.prompt,
					cwd,
					description: task.description,
					index,
					signal,
					onUpdate: (details) => {
						results[index] = { ...details, state: "running" };
						emitUpdate();
					},
				});

				if (childResult.exitCode !== 0 || childResult.stopReason === "error") {
					const failureMessage =
						truncateSentence(
							(childResult.stopReason === "error" ? childResult.errorMessage || childResult.stderr : childResult.stderr || childResult.errorMessage) ||
								(childResult.stopReason === "error"
									? `Agent ${childResult.agent} returned an error`
									: `Agent ${childResult.agent} failed with exit code ${childResult.exitCode}`),
							400,
						) || `Agent ${childResult.agent} failed`;
					results[index] = {
						...childResult,
						state: "failed",
						failureMessage,
						liveStatus: truncateSentence(`Failed: ${failureMessage}`),
					};
					emitUpdate();
					return;
				}

				results[index] = {
					...childResult,
					state: "completed",
					liveStatus: childResult.liveStatus || getLiveResultLine(childResult.finalOutput) || "Completed",
				};
				emitUpdate();
			});

			const details = buildBatchDetails(results);
			return {
				content: [{ type: "text", text: buildBatchContent(details) }],
				details,
			};
		},
		renderCall(args, theme) {
			const tasks = Array.isArray(args.tasks) ? args.tasks : [];
			const count = tasks.length;
			const previewParts = tasks.slice(0, 3).map((task) => task.description || task.subagent_type || "delegated task");
			if (count > 3) previewParts.push(`+${count - 3} more`);
			const preview = previewParts.join(" / ") || "delegated tasks";
			return new Text(
				theme.fg("toolTitle", theme.bold("agent ")) +
					theme.fg("accent", `${count} task${count === 1 ? "" : "s"}`) +
					"\n  " +
					theme.fg("dim", preview),
				0,
				0,
			);
		},
		renderResult(result, options, theme) {
			const details = result.details as AgentBatchDetails | undefined;
			const expanded = Boolean(options?.expanded);
			const fallbackText = result.content.find((part) => part.type === "text")?.text || "(no output)";
			if (!details) return new Text(fallbackText, 0, 0);

			if (expanded) {
				const parts: string[] = [
					theme.fg("toolTitle", theme.bold(`agent tasks (${details.total})`)),
					theme.fg(
						"muted",
						`Completed: ${details.completed}  Running: ${details.running}  Failed: ${details.failed}  Queued: ${details.queued}`,
					),
				];

				for (const task of details.results) {
					parts.push("");
					parts.push(
						theme.fg("toolTitle", theme.bold(`[${task.index + 1}] ${getTaskStateIcon(task)} ${task.description}`)),
					);
					parts.push(theme.fg("muted", `Agent: ${task.agent}`));
					parts.push(theme.fg("muted", `Status: ${task.state}`));
					parts.push(theme.fg("muted", `CWD: ${task.cwd}`));
					if (task.model) parts.push(theme.fg("muted", `Model: ${task.model}`));
					if (task.sessionId) parts.push(theme.fg("muted", `Session ID: ${task.sessionId}`));
					if (task.sessionFile) parts.push(theme.fg("muted", `Session file: ${task.sessionFile}`));
					if (task.sessionDir && !task.sessionFile) parts.push(theme.fg("muted", `Session dir: ${task.sessionDir}`));
					if ((task.autoCompactionCount ?? 0) > 0) {
						parts.push(
							theme.fg(
								"muted",
								`Compaction: ${task.autoCompactionCount} auto-compaction${task.autoCompactionCount === 1 ? "" : "s"}`,
							),
						);
					}
					parts.push("");
					parts.push(theme.fg("toolTitle", theme.bold("Prompt")));
					parts.push(task.prompt || "(no prompt)");
					parts.push("");
					parts.push(
						theme.fg(
							"toolTitle",
							theme.bold(task.state === "failed" ? "Failure" : task.state === "completed" ? "Result" : "Progress"),
						),
					);
					parts.push(task.state === "failed" ? theme.fg("error", buildTaskOutput(task)) : buildTaskOutput(task));
					if (task.autoCompactions && task.autoCompactions.length > 0) {
						parts.push("");
						parts.push(theme.fg("toolTitle", theme.bold("Auto-compaction events")));
						for (const [eventIndex, event] of task.autoCompactions.entries()) {
							const bits = [event.reason || "unknown reason"];
							if (event.aborted) bits.push("aborted");
							else if (event.errorMessage) bits.push(`failed: ${event.errorMessage}`);
							else if (event.willRetry) bits.push("retrying");
							else bits.push("completed");
							parts.push(theme.fg(event.errorMessage ? "error" : "muted", `  ${eventIndex + 1}. ${bits.join(" — ")}`));
						}
					}
					if (task.stderr) {
						parts.push("");
						parts.push(theme.fg("error", "Stderr"));
						parts.push(theme.fg("error", task.stderr.trim()));
					}
				}

				return new Text(parts.join("\n"), 0, 0);
			}

			const summaryLine =
				details.running > 0 || details.queued > 0
					? `Parallel: ${details.completed}/${details.total} done, ${details.running} running${details.queued > 0 ? `, ${details.queued} queued` : ""}${details.failed > 0 ? `, ${details.failed} failed` : ""}`
					: `Parallel: ${details.completed}/${details.total} completed${details.failed > 0 ? `, ${details.failed} failed` : ""}`;
			const lines = [theme.fg(details.failed > 0 ? "warning" : "muted", summaryLine), ""];
			for (const task of details.results) {
				const icon = getTaskStateIcon(task);
				const color = task.state === "failed" ? "error" : task.state === "completed" ? "accent" : "warning";
				lines.push(`${theme.fg(color, icon)} ${task.description} — ${getTaskSummary(task)}`);
			}
			lines.push("");
			lines.push(theme.fg("muted", "(expand for full details)"));
			return new Text(lines.join("\n"), 0, 0);
		},
	});

	pi.on("before_agent_start", async (event) => {
		const agents = discoverAgents();
		if (agents.length === 0) return undefined;
		return {
			systemPrompt: `${event.systemPrompt}\n\n${buildAgentCatalog(agents)}`,
		};
	});
}
