import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

function quoteArgs(args: string): string {
	const trimmed = args.trim();
	return trimmed ? ` ${trimmed}` : "";
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("deep-interview", {
		description: "<rough task> — Start Socratic requirements interview before planning",
		handler: async (args, ctx) => {
			if (!ctx.isIdle()) {
				ctx.ui.notify("Agent is still working. Wait for it to finish before starting deep interview.", "warning");
				return;
			}
			pi.sendUserMessage(`Use the deep-interview skill.${quoteArgs(args)}`);
		},
	});

	pi.registerCommand("ralplan", {
		description: "<interview path|task> — Create a Ralph-ready plan in .ralph/ without executing",
		handler: async (args, ctx) => {
			if (!ctx.isIdle()) {
				ctx.ui.notify("Agent is still working. Wait for it to finish before starting RALPLAN.", "warning");
				return;
			}
			pi.sendUserMessage(`Use the ralplan skill.${quoteArgs(args)}`);
		},
	});
}
