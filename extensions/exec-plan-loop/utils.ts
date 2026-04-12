import path from "node:path";

import { LOOP_ATTEMPT_STATUSES, MAX_TEXT_LENGTH } from "./constants";
import type {
	ActivePlan,
	AgentOutcome,
	LoopAttemptStatus,
	LoopRecoveryState,
	LoopState,
	ModelSpecParts,
	ProviderCursorState,
} from "./types";

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

export function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function isOptionalString(value: unknown): value is string | undefined {
	return value === undefined || typeof value === "string";
}

export function isNullableString(value: unknown): value is string | null {
	return value === null || typeof value === "string";
}

export function normalizeWhitespace(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

export function truncate(value: string, maxLength = MAX_TEXT_LENGTH): string {
	const normalized = normalizeWhitespace(value);
	if (normalized.length <= maxLength) return normalized;
	return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
}

export function getTextFromContent(content: unknown): string {
	if (typeof content === "string") return truncate(content);
	if (!Array.isArray(content)) return "";

	const texts = content.flatMap((item) => {
		if (!item || typeof item !== "object") return [] as string[];
		if (!("type" in item) || item.type !== "text") return [] as string[];
		const text = (item as { text?: unknown }).text;
		return typeof text === "string" && text.trim().length > 0 ? [text] : [];
	});

	return truncate(texts.join(" "));
}

export function createRunTag(now = new Date()): string {
	return now.toISOString().replace(/[.:]/g, "-");
}

export function summarizePlans(plans: Array<Pick<ActivePlan, "path">>): string {
	if (plans.length === 0) return "no active exec plans";
	return plans.map((plan) => path.posix.basename(plan.path)).join(", ");
}

export function summarizePlanPaths(paths: string[]): string {
	if (paths.length === 0) return "no active exec plans";
	return paths.map((planPath) => path.posix.basename(planPath)).join(", ");
}

export function isLoopAttemptStatus(value: unknown): value is LoopAttemptStatus {
	return typeof value === "string" && LOOP_ATTEMPT_STATUSES.includes(value as LoopAttemptStatus);
}

export function isProviderCursorState(value: unknown): value is ProviderCursorState {
	if (!isRecord(value)) return false;
	for (const [key, rawIndex] of Object.entries(value)) {
		if (key !== "amazon-bedrock" && key !== "openai-codex" && key !== "anthropic") return false;
		if (typeof rawIndex !== "number" || !Number.isInteger(rawIndex) || rawIndex < 0) return false;
	}
	return true;
}

export function isLoopRecoveryState(value: unknown): value is LoopRecoveryState {
	if (!isRecord(value)) return false;
	if (!isNullableString(value.activeModel)) return false;
	if (typeof value.consecutiveProviderErrors !== "number" || !Number.isInteger(value.consecutiveProviderErrors) || value.consecutiveProviderErrors < 0) return false;
	if (!isNullableString(value.lastProviderError)) return false;
	if (!isNullableString(value.lastModelSwitchAt)) return false;
	if (!isNullableString(value.lastModelSwitch)) return false;
	if (!(value.providerCursors === undefined || isProviderCursorState(value.providerCursors))) return false;
	return true;
}

export function isLoopState(value: unknown): value is LoopState {
	if (!isRecord(value)) return false;
	if (value.version !== 1) return false;
	if (typeof value.enabled !== "boolean") return false;
	if (typeof value.runTag !== "string") return false;
	if (typeof value.startedAt !== "string") return false;
	if (typeof value.updatedAt !== "string") return false;
	if (typeof value.iteration !== "number" || !Number.isInteger(value.iteration) || value.iteration < 0) return false;
	if (!(value.extraInstructions === null || typeof value.extraInstructions === "string")) return false;

	if (!isRecord(value.repo)) return false;
	if (typeof value.repo.root !== "string") return false;
	if (typeof value.repo.branch !== "string") return false;
	if (typeof value.repo.baselineSha !== "string") return false;
	if (typeof value.repo.checkpointSha !== "string") return false;
	if (typeof value.repo.headSha !== "string") return false;
	if (typeof value.repo.workingTreeClean !== "boolean") return false;
	if (!isStringArray(value.repo.statusSummary)) return false;

	if (!isRecord(value.plans)) return false;
	if (!isStringArray(value.plans.activePaths)) return false;
	if (typeof value.plans.lastSeenSummary !== "string") return false;
	if (!(value.recovery === undefined || isLoopRecoveryState(value.recovery))) return false;

	if (!isRecord(value.lastTurn)) return false;
	if (!isLoopAttemptStatus(value.lastTurn.status)) return false;
	if (typeof value.lastTurn.summary !== "string") return false;
	if (!isOptionalString(value.lastTurn.assistantStopReason)) return false;
	if (!isOptionalString(value.lastTurn.assistantError)) return false;
	if (!isOptionalString(value.lastTurn.assistantText)) return false;
	if (!isStringArray(value.lastTurn.toolErrors)) return false;
	if (typeof value.lastTurn.commitSha !== "string") return false;

	return true;
}

function summarizeAssistant(messages: Array<Record<string, unknown>>) {
	for (let i = messages.length - 1; i >= 0; i -= 1) {
		const message = messages[i];
		if (message.role !== "assistant") continue;
		return {
			stopReason:
				typeof message.stopReason === "string" && message.stopReason.length > 0
					? message.stopReason
					: undefined,
			errorMessage:
				typeof message.errorMessage === "string" && message.errorMessage.trim().length > 0
					? truncate(message.errorMessage)
					: undefined,
			text: getTextFromContent(message.content),
		};
	}
	return { stopReason: undefined, errorMessage: undefined, text: undefined };
}

function summarizeToolErrors(messages: Array<Record<string, unknown>>): string[] {
	const toolErrors: string[] = [];
	for (const message of messages) {
		if (message.role !== "toolResult" || message.isError !== true) continue;
		const toolName = typeof message.toolName === "string" ? message.toolName : "unknown-tool";
		const content = getTextFromContent(message.content) || "Tool returned an error without text output.";
		toolErrors.push(`${toolName}: ${content}`);
		if (toolErrors.length >= 3) break;
	}
	return toolErrors;
}

export function summarizeAgentOutcome(messages: unknown): AgentOutcome {
	const normalizedMessages = Array.isArray(messages)
		? messages.filter((message): message is Record<string, unknown> => Boolean(message) && typeof message === "object")
		: [];
	const assistant = summarizeAssistant(normalizedMessages);
	const toolErrors = summarizeToolErrors(normalizedMessages);
	const hadError = toolErrors.length > 0 || assistant.stopReason === "error" || Boolean(assistant.errorMessage);
	const providerOnlyError =
		toolErrors.length === 0
		&& (assistant.stopReason === "error" || assistant.stopReason === "aborted")
		&& !assistant.text;

	if (hadError) {
		const summary = assistant.errorMessage ?? toolErrors[0] ?? assistant.text ?? "The previous loop iteration ended with an error.";
		return {
			status: "error",
			summary,
			assistantStopReason: assistant.stopReason,
			assistantError: assistant.errorMessage,
			assistantText: assistant.text,
			toolErrors,
			shouldSendPlainContinue: providerOnlyError,
		};
	}

	return {
		status: "progress",
		summary: assistant.text || "The previous loop iteration finished without explicit errors.",
		assistantStopReason: assistant.stopReason,
		assistantError: assistant.errorMessage,
		assistantText: assistant.text,
		toolErrors,
		shouldSendPlainContinue: false,
	};
}

export function parseModelSpec(modelSpec: string): ModelSpecParts | null {
	const slash = modelSpec.indexOf("/");
	if (slash <= 0 || slash === modelSpec.length - 1) return null;
	return { provider: modelSpec.slice(0, slash), modelId: modelSpec.slice(slash + 1) };
}

export function modelToSpec(model: unknown): string | null {
	if (!isRecord(model)) return null;
	const provider = typeof model.provider === "string" ? model.provider : null;
	const modelId = typeof model.id === "string" ? model.id : null;
	if (!provider || !modelId) return null;
	return `${provider}/${modelId}`;
}
