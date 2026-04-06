import { promises as fs } from "node:fs";
import path from "node:path";

import { ACTIVE_PLAN_DIR, ACTIVE_PLAN_PREFIX } from "./constants";
import type { ActivePlan, DependencyAnalysis, PlanFrontmatter } from "./types";

function extractTitle(content: string, fallbackPath: string): string {
	for (const line of content.split("\n")) {
		const trimmed = line.trim();
		if (trimmed.startsWith("# ")) return trimmed.slice(2).trim();
	}
	return path.posix.basename(fallbackPath, ".md");
}

function planFileName(planPath: string): string {
	return path.posix.basename(planPath);
}

function parseFrontmatter(text: string): { frontmatter: PlanFrontmatter | null; content: string } {
	if (!text.startsWith("---\n")) return { frontmatter: null, content: text };

	const closingIndex = text.indexOf("\n---\n", 4);
	if (closingIndex === -1) return { frontmatter: null, content: text };

	const rawFrontmatter = text.slice(4, closingIndex);
	const content = text.slice(closingIndex + 5);
	const frontmatter: PlanFrontmatter = {};
	let activeListKey: "depends_on" | null = null;

	for (const rawLine of rawFrontmatter.split("\n")) {
		const line = rawLine.trim();
		if (line.length === 0 || line.startsWith("#")) continue;

		const listMatch = line.match(/^([a-zA-Z0-9_]+):\s*$/);
		if (listMatch) {
			const key = listMatch[1];
			if (key === "depends_on") {
				frontmatter[key] = [];
				activeListKey = key;
				continue;
			}
			activeListKey = null;
			continue;
		}

		const itemMatch = line.match(/^[-*]\s+(.+)$/);
		if (itemMatch && activeListKey) {
			frontmatter[activeListKey]?.push(itemMatch[1].trim());
			continue;
		}

		const scalarMatch = line.match(/^([a-zA-Z0-9_]+):\s*(.+)$/);
		if (!scalarMatch) {
			activeListKey = null;
			continue;
		}

		const [, key, rawValue] = scalarMatch;
		activeListKey = null;
		const value = rawValue.trim().replace(/^['"]|['"]$/g, "");
		if (key === "depends_on") {
			if (value === "[]") {
				frontmatter[key] = [];
				continue;
			}
			if (value.startsWith("[") && value.endsWith("]")) {
				frontmatter[key] = value
					.slice(1, -1)
					.split(",")
					.map((item) => item.trim().replace(/^['"]|['"]$/g, ""))
					.filter((item) => item.length > 0);
			}
		}
	}

	return { frontmatter, content };
}

export async function listActivePlans(): Promise<ActivePlan[]> {
	try {
		const entries = await fs.readdir(ACTIVE_PLAN_DIR, { withFileTypes: true });
		const plans = await Promise.all(
			entries
				.filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
				.map(async (entry) => {
					const relativePath = `${ACTIVE_PLAN_PREFIX}/${entry.name}`;
					const fullPath = path.join(ACTIVE_PLAN_DIR, entry.name);
					const text = await fs.readFile(fullPath, "utf8");
					const { frontmatter, content } = parseFrontmatter(text);
					return {
						path: relativePath,
						body: text,
						content,
						title: extractTitle(content, relativePath),
						dependsOn: frontmatter?.depends_on?.map((item) => item.trim()).filter(Boolean) ?? [],
						hasFrontmatter: frontmatter !== null,
					};
				}),
		);
		return plans.sort((a, b) => a.path.localeCompare(b.path));
	} catch {
		return [];
	}
}

function formatPlanName(plan: ActivePlan): string {
	return planFileName(plan.path);
}

function analyzePlanDependencies(plans: ActivePlan[]): DependencyAnalysis {
	const plansWithFrontmatter = plans.filter((plan) => plan.hasFrontmatter);
	if (plansWithFrontmatter.length === 0) {
		return { metadataCoverage: "none", ready: [], blocked: [], withoutFrontmatter: plans };
	}

	const planById = new Map(plansWithFrontmatter.map((plan) => [planFileName(plan.path), plan]));
	const ready: ActivePlan[] = [];
	const blocked: Array<{ plan: ActivePlan; blockedBy: string[] }> = [];
	const withoutFrontmatter = plans.filter((plan) => !plan.hasFrontmatter);

	for (const plan of plansWithFrontmatter) {
		const blockedBy = plan.dependsOn.filter((dependencyId) => planById.has(dependencyId));
		if (blockedBy.length === 0) ready.push(plan);
		else blocked.push({ plan, blockedBy });
	}

	return {
		metadataCoverage: withoutFrontmatter.length === 0 ? "full" : "partial",
		ready: ready.sort((a, b) => a.path.localeCompare(b.path)),
		blocked: blocked.sort((a, b) => a.plan.path.localeCompare(b.plan.path)),
		withoutFrontmatter: withoutFrontmatter.sort((a, b) => a.path.localeCompare(b.path)),
	};
}

export function buildDependencyFrontierLines(plans: ActivePlan[]): string[] {
	const analysis = analyzePlanDependencies(plans);
	if (analysis.metadataCoverage === "none") {
		return [
			"Dependency frontier: no exec-plan frontmatter found yet.",
			"- Dependency order is unspecified by metadata. Use the plan prose and architecture dependencies manually.",
			"- Suggested frontmatter shape for future plans:",
			"  ---",
			"  depends_on:",
			"    - upstream-plan.md",
			"  ---",
		];
	}

	const lines = ["Dependency frontier:"];
	if (analysis.ready.length > 0) lines.push(`- Ready now: ${analysis.ready.map(formatPlanName).join(", ")}`);
	else lines.push("- Ready now: none explicitly ready from frontmatter.");
	for (const entry of analysis.blocked) lines.push(`- Blocked: ${formatPlanName(entry.plan)} -> ${entry.blockedBy.join(", ")}`);
	if (analysis.withoutFrontmatter.length > 0) {
		lines.push(`- No frontmatter: ${analysis.withoutFrontmatter.map((plan) => path.posix.basename(plan.path)).join(", ")}`);
		lines.push("- Plans without frontmatter may still be first in priority; determine ordering from the plan text and explicit dependencies in other plans.");
	}
	if (analysis.ready.length > 1) {
		lines.push("- Parallel note: multiple ready plans exist. Because they do not depend on each other, they are parallelizable; in this single loop, choose one small slice instead of thrashing between them.");
	}
	return lines;
}
