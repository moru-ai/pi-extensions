import { readFileSync } from "node:fs";
import path from "node:path";

import type { AgentProviderId, LoopAttemptStatus } from "./types";

export const EXTENSION_DIR = typeof __dirname === "string" ? __dirname : process.cwd();
export const REPO_ROOT = path.resolve(EXTENSION_DIR, "..", "..", "..");
export const ACTIVE_PLAN_DIR = path.join(REPO_ROOT, "docs", "exec-plans", "active");
export const ACTIVE_PLAN_PREFIX = "docs/exec-plans/active";
export const LOOP_STATE_DIR = path.join(REPO_ROOT, ".pi", "exec-plan-loop");
export const LOOP_STATE_PATH = path.join(LOOP_STATE_DIR, "state.json");
export const LOOP_ATTEMPTS_PATH = path.join(LOOP_STATE_DIR, "attempts.ndjson");
export const LOOP_EVENTS_PATH = path.join(LOOP_STATE_DIR, "events.ndjson");
export const MAX_STATUS_LINES = 6;
export const MAX_TOOL_ERRORS = 3;
export const MAX_TEXT_LENGTH = 280;
export const LOOP_ATTEMPT_STATUSES: readonly LoopAttemptStatus[] = ["baseline", "progress", "error", "stopped"];
export const ASK_USER_QUESTION_TOOL = "ask_user_question";
export const AGENT_PROVIDER_ERROR_RETRY_LIMIT = 3;
export const SEND_MESSAGE_WATCHDOG_MS = 15_000;
export const AGENT_PROVIDER_IDS: readonly AgentProviderId[] = ["openai-codex", "anthropic"];
export const AGENT_PROVIDER_MODEL_ORDER: Record<AgentProviderId, string[]> = {
	"anthropic": [
		"claude-opus-4-6",
		"claude-sonnet-4-6",
		"claude-opus-4-5",
	],
	"openai-codex": [
		"gpt-5.4",
		"gpt-5.3-codex",
		"gpt-5.2-codex",
	],
};
export const COMPACT_THRESHOLD_PERCENT = 0.9;
export const COMPACT_BASE_DELAY_MS = 2_000;
export const COMPACT_MODELS: string[] = [
	"anthropic/claude-sonnet-4-6",
	"anthropic/claude-opus-4-6",
	"openai-codex/gpt-5.4",
	"openai-codex/gpt-5.2",
];
export const COMPACT_INSTRUCTIONS = readFileSync(path.join(EXTENSION_DIR, "compact-prompt.md"), "utf8").trim();
export const LOOP_INSTRUCTIONS = readFileSync(path.join(EXTENSION_DIR, "loop-instructions.md"), "utf8").trim();
