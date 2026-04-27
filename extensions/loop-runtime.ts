import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export const ASK_USER_QUESTION_TOOL = "ask_user_question";

export type ToolAvailabilityChange = "enabled" | "disabled" | "unchanged" | "unavailable";

export function setAskUserQuestionToolEnabled(pi: ExtensionAPI, enabled: boolean): ToolAvailabilityChange {
	const active = pi.getActiveTools();
	const hasTool = active.includes(ASK_USER_QUESTION_TOOL);
	if (enabled) {
		if (hasTool) return "unchanged";
		const available = pi.getAllTools().some((tool) => tool.name === ASK_USER_QUESTION_TOOL);
		if (!available) return "unavailable";
		pi.setActiveTools([...active, ASK_USER_QUESTION_TOOL]);
		return "enabled";
	}
	if (!hasTool) return "unchanged";
	pi.setActiveTools(active.filter((toolName) => toolName !== ASK_USER_QUESTION_TOOL));
	return "disabled";
}

// pi loads top-level files in extensions/ as extensions. This helper is imported
// by real extensions, so expose a no-op default factory to keep discovery valid.
export default function loopRuntime(_pi: ExtensionAPI): void {}
