import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.registerCommand("audit-plan", {
    description: "Audit an execution plan against PLANS.md and fix violations",
    handler: async (args, ctx) => {
      if (!ctx.isIdle()) {
        ctx.ui.notify("Agent is still working. Wait for it to finish first.", "warning");
        return;
      }

      const planPath = args.trim();

      const prompt = planPath
        ? `Read PLANS.md, then audit the execution plan at "${planPath}" against every requirement and rule defined there. Fix any violations directly in the plan file.`
        : `Read PLANS.md, then audit our working execution plan against every requirement and rule defined there. Fix any violations directly in the plan file.`;

      pi.sendUserMessage(prompt);
    },
  });
}
