import { readFileSync } from "node:fs";
import path from "node:path";

import type { AgentProviderId, LoopAttemptStatus } from "./types";

export const EXTENSION_DIR = typeof __dirname === "string" ? __dirname : process.cwd();

/**
 * Resolve REPO_ROOT to the worktree pi is running in.
 *
 * When pi-extensions are installed globally (~/.pi/agent/git/...), __dirname
 * points inside the global package — NOT the target worktree. Walking up from
 * __dirname lands in the wrong directory entirely. The reliable source of truth
 * for the repo root is process.cwd(), which pi sets to the worktree on launch.
 *
 * We only fall back to __dirname-relative resolution when the extension lives
 * inside a repo-local .pi directory (i.e. <repo>/.pi/extensions/exec-plan-loop).
 */
function resolveRepoRoot(): string {
	if (typeof __dirname !== "string") return process.cwd();

	const piSegment = path.sep + ".pi" + path.sep;
	const piIndex = __dirname.indexOf(piSegment);
	if (piIndex === -1) return process.cwd();

	// Check whether .pi is a global install (~/.pi/agent/git/...) or repo-local.
	// Global installs have the .pi at the user home level and contain "agent/git".
	const afterPi = __dirname.slice(piIndex + piSegment.length);
	if (afterPi.startsWith("agent" + path.sep + "git")) {
		// Global install — __dirname is meaningless for repo root.
		return process.cwd();
	}

	// Repo-local .pi: the repo root is the directory containing .pi.
	return __dirname.slice(0, piIndex);
}

export const REPO_ROOT = resolveRepoRoot();
export const ACTIVE_PLAN_DIR = path.join(REPO_ROOT, "docs", "exec-plans", "active");
export const ACTIVE_PLAN_PREFIX = "docs/exec-plans/active";
export const LOOP_STATE_DIR = path.join(REPO_ROOT, ".pi", "exec-plan-loop");
export const LOOP_STATE_PATH = path.join(LOOP_STATE_DIR, "state.json");
export const LOOP_ATTEMPTS_PATH = path.join(LOOP_STATE_DIR, "attempts.ndjson");
export const LOOP_EVENTS_PATH = path.join(LOOP_STATE_DIR, "events.ndjson");
export const LOOP_STEERING_PATH = path.join(LOOP_STATE_DIR, "steering.md");
export const MAX_STATUS_LINES = 6;
export const MAX_TOOL_ERRORS = 3;
export const MAX_TEXT_LENGTH = 280;
export const LOOP_ATTEMPT_STATUSES: readonly LoopAttemptStatus[] = ["baseline", "progress", "error", "stopped"];
export const ASK_USER_QUESTION_TOOL = "ask_user_question";
export const AGENT_PROVIDER_ERROR_RETRY_LIMIT = 3;
export const SEND_MESSAGE_WATCHDOG_MS = 15_000;
export const AGENT_PROVIDER_IDS: readonly AgentProviderId[] = ["openai-codex", "amazon-bedrock"];
export const AGENT_PROVIDER_MODEL_ORDER: Record<AgentProviderId, string[]> = {
	"amazon-bedrock": [
		"global.anthropic.claude-opus-4-6-v1",
		"global.anthropic.claude-sonnet-4-6",
		"global.anthropic.claude-haiku-4-5-20251001-v1:0",
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
	"amazon-bedrock/global.anthropic.claude-sonnet-4-6",
	"amazon-bedrock/global.anthropic.claude-opus-4-6-v1",
	"amazon-bedrock/global.anthropic.claude-haiku-4-5-20251001-v1:0",
	"openai-codex/gpt-5.4",
	"openai-codex/gpt-5.2",
];
export const COMPACT_INSTRUCTIONS = readFileSync(path.join(EXTENSION_DIR, "compact-prompt.md"), "utf8").trim();
export const LOOP_INSTRUCTIONS = readFileSync(path.join(EXTENSION_DIR, "loop-instructions.md"), "utf8").trim();
