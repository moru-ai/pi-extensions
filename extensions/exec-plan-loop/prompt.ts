import { LOOP_INSTRUCTIONS } from "./constants";
import { buildDependencyFrontierLines } from "./plans";
import type { ActivePlan, LoopState } from "./types";

export function buildLoopPrompt(plans: ActivePlan[], state: LoopState, options?: { postCompaction?: boolean }): string {

	if (plans.length === 0) {
		return [
			`Exec-plan loop run ${state.runTag} found no active plans at iteration ${state.iteration}.`,
			"",
			"There are currently no files in docs/exec-plans/active/.",
			"Stop and wait for further user instruction instead of continuing the loop.",
		].join("\n");
	}

	const dependencyLines = buildDependencyFrontierLines(plans);
	const lines: string[] = [`Exec-plan loop is active. Run ${state.runTag}. Iteration ${state.iteration}.`];

	if (options?.postCompaction) {
		lines.push("", "⚠ Context was just compacted. Do not trust memory - re-read files before editing.");
	}

	lines.push(
		"",
		"Current loop state:",
		`- Active exec plans: ${plans.map((plan) => plan.path).join(", ")}`,
		`- Git branch: ${state.repo.branch}`,
		`- HEAD: ${state.repo.headSha}`,
		`- Last clean checkpoint: ${state.repo.checkpointSha}`,
		`- Working tree: ${state.repo.workingTreeClean ? "clean" : "dirty"}`,
		"",
		...dependencyLines,
	);

	if (state.repo.statusSummary.length > 0) {
		lines.push("- Working tree summary:");
		for (const statusLine of state.repo.statusSummary) lines.push(`  ${statusLine}`);
	}
	if (state.extraInstructions) lines.push(`- Additional user instruction: ${state.extraInstructions}`);

	lines.push("", "What to do next:", LOOP_INSTRUCTIONS);
	return lines.join("\n");
}
