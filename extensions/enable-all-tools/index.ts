import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async () => {
    const all = pi.getAllTools();
    pi.setActiveTools(all.map((t) => t.name));
  });
}
