import { promises as fs } from "node:fs";
import path from "node:path";

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { LOOP_ATTEMPTS_PATH, LOOP_EVENTS_PATH, LOOP_STATE_DIR, LOOP_STATE_PATH, MAX_STATUS_LINES, REPO_ROOT } from "./constants";
import { createDefaultRecoveryState } from "./models";
import type { AgentOutcome, GitSnapshot, LoadLoopStateResult, LoopEvent, LoopRecoveryState, LoopState } from "./types";
import { isLoopState, summarizePlans } from "./utils";

async function ensureLoopStateDir(): Promise<void> {
	await fs.mkdir(LOOP_STATE_DIR, { recursive: true });
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
	await ensureLoopStateDir();
	const tempPath = `${filePath}.tmp`;
	await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
	await fs.rename(tempPath, filePath);
}

export async function loadLoopStateWithStatus(): Promise<LoadLoopStateResult> {
	try {
		const raw = await fs.readFile(LOOP_STATE_PATH, "utf8");
		const parsed = JSON.parse(raw);
		if (!isLoopState(parsed)) {
			return {
				state: null,
				error: `Ignored invalid exec-plan loop state at ${path.relative(REPO_ROOT, LOOP_STATE_PATH)} because it does not match the expected schema.`,
			};
		}
		return { state: parsed, error: null };
	} catch (error) {
		const code = (error as NodeJS.ErrnoException | undefined)?.code;
		if (code === "ENOENT") return { state: null, error: null };
		if (error instanceof SyntaxError) {
			return {
				state: null,
				error: `Ignored invalid exec-plan loop state at ${path.relative(REPO_ROOT, LOOP_STATE_PATH)} because the JSON could not be parsed.`,
			};
		}
		return {
			state: null,
			error: `Failed to load exec-plan loop state at ${path.relative(REPO_ROOT, LOOP_STATE_PATH)}.`,
		};
	}
}

export async function saveLoopState(state: LoopState): Promise<void> {
	await writeJsonAtomic(LOOP_STATE_PATH, state);
}

export async function appendAttemptLog(state: LoopState): Promise<void> {
	await ensureLoopStateDir();
	const entry = {
		timestamp: state.updatedAt,
		runTag: state.runTag,
		iteration: state.iteration,
		status: state.lastTurn.status,
		summary: state.lastTurn.summary,
		assistantStopReason: state.lastTurn.assistantStopReason,
		assistantError: state.lastTurn.assistantError,
		toolErrors: state.lastTurn.toolErrors,
		branch: state.repo.branch,
		headSha: state.repo.headSha,
		checkpointSha: state.repo.checkpointSha,
		workingTreeClean: state.repo.workingTreeClean,
		activePlans: state.plans.activePaths,
		activeModel: state.recovery?.activeModel ?? null,
		consecutiveProviderErrors: state.recovery?.consecutiveProviderErrors ?? 0,
		lastModelSwitch: state.recovery?.lastModelSwitch ?? null,
	};
	await fs.appendFile(LOOP_ATTEMPTS_PATH, `${JSON.stringify(entry)}\n`, "utf8");
}

export async function appendEventLog(event: LoopEvent): Promise<void> {
	await ensureLoopStateDir();
	const entry = { ...event, timestamp: new Date().toISOString() };
	await fs.appendFile(LOOP_EVENTS_PATH, `${JSON.stringify(entry)}\n`, "utf8");
}

export async function getGitSnapshot(pi: ExtensionAPI): Promise<GitSnapshot> {
	const [branchResult, headResult, statusResult] = await Promise.all([
		pi.exec("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: REPO_ROOT, timeout: 30_000 }),
		pi.exec("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT, timeout: 30_000 }),
		pi.exec("git", ["status", "--short"], { cwd: REPO_ROOT, timeout: 30_000 }),
	]);

	const branch = branchResult.code === 0 ? branchResult.stdout.trim() || "HEAD" : "unknown";
	const headSha = headResult.code === 0 ? headResult.stdout.trim() || "unknown" : "unknown";
	const statusLines = (statusResult.stdout || "")
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.slice(0, MAX_STATUS_LINES);

	return {
		branch,
		headSha,
		workingTreeClean: statusLines.length === 0,
		statusSummary: statusLines,
	};
}

export function createBaselineState(
	plans: Array<{ path: string }>,
	git: GitSnapshot,
	extraInstructions: string | null,
	activeModel: string | null,
): LoopState {
	const now = new Date().toISOString();
	return {
		version: 1,
		enabled: true,
		runTag: now.replace(/[.:]/g, "-"),
		startedAt: now,
		updatedAt: now,
		iteration: 0,
		extraInstructions,
		repo: {
			root: REPO_ROOT,
			branch: git.branch,
			baselineSha: git.headSha,
			checkpointSha: git.headSha,
			headSha: git.headSha,
			workingTreeClean: git.workingTreeClean,
			statusSummary: git.statusSummary,
		},
		plans: {
			activePaths: plans.map((plan) => plan.path),
			lastSeenSummary: summarizePlans(plans),
		},
		recovery: createDefaultRecoveryState(activeModel),
		lastTurn: {
			status: "baseline",
			summary: "Loop started. Establish the baseline, then keep making validated progress.",
			toolErrors: [],
			commitSha: git.headSha,
		},
	};
}

export function advanceState(
	state: LoopState,
	plans: Array<{ path: string }>,
	git: GitSnapshot,
	outcome: AgentOutcome,
	recovery: LoopRecoveryState,
): LoopState {
	const checkpointSha = git.workingTreeClean ? git.headSha : state.repo.checkpointSha;
	return {
		...state,
		updatedAt: new Date().toISOString(),
		iteration: state.iteration + 1,
		repo: {
			...state.repo,
			branch: git.branch,
			headSha: git.headSha,
			checkpointSha,
			workingTreeClean: git.workingTreeClean,
			statusSummary: git.statusSummary,
		},
		plans: {
			activePaths: plans.map((plan) => plan.path),
			lastSeenSummary: summarizePlans(plans),
		},
		recovery,
		lastTurn: {
			status: outcome.status,
			summary: outcome.summary,
			assistantStopReason: outcome.assistantStopReason,
			assistantError: outcome.assistantError,
			assistantText: outcome.assistantText,
			toolErrors: outcome.toolErrors,
			commitSha: git.headSha,
		},
	};
}
