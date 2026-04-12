export type PlanFrontmatter = {
	depends_on?: string[];
};

export type ActivePlan = {
	path: string;
	body: string;
	content: string;
	title: string;
	dependsOn: string[];
	hasFrontmatter: boolean;
};

export type DependencyAnalysis = {
	metadataCoverage: "none" | "partial" | "full";
	ready: ActivePlan[];
	blocked: Array<{ plan: ActivePlan; blockedBy: string[] }>;
	withoutFrontmatter: ActivePlan[];
};

export type LoopAttemptStatus = "baseline" | "progress" | "error" | "stopped";

export type AgentProviderId = "amazon-bedrock" | "openai-codex";

export type ProviderCursorState = Partial<Record<AgentProviderId, number>>;

export type LoopRecoveryState = {
	activeModel: string | null;
	consecutiveProviderErrors: number;
	lastProviderError: string | null;
	lastModelSwitchAt: string | null;
	lastModelSwitch: string | null;
	providerCursors?: ProviderCursorState;
};

export type LoopState = {
	version: 1;
	enabled: boolean;
	runTag: string;
	startedAt: string;
	updatedAt: string;
	iteration: number;
	extraInstructions: string | null;
	repo: {
		root: string;
		branch: string;
		baselineSha: string;
		checkpointSha: string;
		headSha: string;
		workingTreeClean: boolean;
		statusSummary: string[];
	};
	plans: {
		activePaths: string[];
		lastSeenSummary: string;
	};
	recovery?: LoopRecoveryState;
	lastTurn: {
		status: LoopAttemptStatus;
		summary: string;
		assistantStopReason?: string;
		assistantError?: string;
		assistantText?: string;
		toolErrors: string[];
		commitSha: string;
	};
};

export type GitSnapshot = {
	branch: string;
	headSha: string;
	workingTreeClean: boolean;
	statusSummary: string[];
};

export type AgentOutcome = {
	status: Exclude<LoopAttemptStatus, "baseline" | "stopped">;
	summary: string;
	assistantStopReason?: string;
	assistantError?: string;
	assistantText?: string;
	toolErrors: string[];
	shouldSendPlainContinue: boolean;
};

export type LoadLoopStateResult = {
	state: LoopState | null;
	error: string | null;
};

export type ModelSpecParts = {
	provider: string;
	modelId: string;
};

export type LoopEvent =
	| { type: "loop_start"; runTag: string; iteration: number; activePlans: string[]; model: string | null }
	| { type: "loop_resume"; runTag: string; iteration: number; activePlans: string[] }
	| { type: "loop_stop"; reason: "user" | "no_plans" | "provider_exhaustion" | "error"; summary: string }
	| { type: "iteration_end"; iteration: number; status: LoopAttemptStatus; model: string | null; summary: string }
	| { type: "model_switch"; from: string | null; to: string; consecutiveErrors: number; reason: string }
	| { type: "model_switch_failed"; currentModel: string | null; consecutiveErrors: number; reason: string }
	| { type: "send_follow_up"; mode: "plain_continue" | "full_prompt"; iteration: number }
	| { type: "compaction_start"; model: string; attempt: number; contextUsagePercent: number }
	| { type: "compaction_success"; model: string; attempt: number }
	| { type: "compaction_failure"; model: string; attempt: number; error: string; willRetry: boolean }
	| { type: "provider_error"; iteration: number; consecutiveErrors: number; limit: number; model: string | null; error: string }
	| { type: "tool_availability"; tool: string; change: "enabled" | "disabled" | "unavailable"; loopActive: boolean };
