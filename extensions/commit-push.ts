import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.registerCommand("commit-push", {
    description: "Commit changes from this session and push to current branch",
    handler: async (args, ctx) => {
      if (!ctx.isIdle()) {
        ctx.ui.notify("Agent is still working. Wait for it to finish first.", "warning");
        return;
      }

      const commitMsg = args.trim();
      const prompt = commitMsg
        ? `Review the changes we made in this session and commit them with the message: "${commitMsg}". Then push to the current branch. Only commit files related to changes we discussed — do not blindly stage everything in git.`
        : `Review the changes we made in this session, write a clear commit message, commit them, and push to the current branch. Only commit files related to changes we discussed — do not blindly stage everything in git.`;

      pi.sendUserMessage(prompt);
    },
  });
}
