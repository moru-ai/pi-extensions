import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const DISABLED_TOOL_NAMES = new Set(["review_plan"]);

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async () => {
    const all = pi.getAllTools();
    pi.setActiveTools(all.map((t) => t.name).filter((name) => !DISABLED_TOOL_NAMES.has(name)));
  });
}
