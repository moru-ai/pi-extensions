import fs from "node:fs";

import { LOOP_INSTRUCTIONS, LOOP_STEERING_PATH } from "./constants";
import { buildDependencyFrontierLines } from "./plans";
import type { ActivePlan, LoopState } from "./types";

function readSteeringInstructions(): string | null {
	try {
		if (!fs.existsSync(LOOP_STEERING_PATH)) return null;
		const text = fs.readFileSync(LOOP_STEERING_PATH, "utf8").trim();
		if (!text) return null;
		return text.length > 4000 ? `${text.slice(0, 4000)}\n\n[truncated]` : text;
	} catch {
		return null;
	}
}

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

	const steeringInstructions = readSteeringInstructions();
	if (steeringInstructions) {
		lines.push(
			"",
			"Operator steering (re-read every iteration from .pi/exec-plan-loop/steering.md):",
			...steeringInstructions.split("\n").map((line) => `> ${line}`),
		);
	}

	lines.push("", "What to do next:", LOOP_INSTRUCTIONS);
	return lines.join("\n");
}
