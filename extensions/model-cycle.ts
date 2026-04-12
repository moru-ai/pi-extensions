/**
 * Model cycling extension - cycles through configured models on Ctrl+M
 *
 * Checks provider availability and falls back gracefully if a provider
 * is not configured. Cycles: Bedrock Haiku → Codex Spark → Bedrock Sonnet → Codex Spark
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const MODEL_CYCLE = [
  { provider: "amazon-bedrock", id: "us.anthropic.claude-haiku-4-5-20251001-v1:0", name: "Bedrock Haiku" },
  { provider: "openai-codex", id: "gpt-4o", name: "Codex Spark" },
  { provider: "amazon-bedrock", id: "us.anthropic.claude-sonnet-4-20250514-v1:0", name: "Bedrock Sonnet" },
  { provider: "openai-codex", id: "gpt-4o", name: "Codex Spark" },
];

export default function (pi: ExtensionAPI) {
  let currentIndex = 0;

  // Find initial model index based on current model
  pi.on("session_start", async (_event, ctx) => {
    if (ctx.model) {
      const index = MODEL_CYCLE.findIndex(
        (m) => m.provider === ctx.model.provider && m.id === ctx.model.id
      );
      if (index >= 0) {
        currentIndex = index;
      }
    }
    ctx.ui.setStatus("model-cycle", `Model: ${MODEL_CYCLE[currentIndex].name}`);
  });

  // Register keyboard shortcut for cycling
  pi.registerShortcut("ctrl+m", {
    description: "Cycle to next model in queue",
    handler: async (ctx) => {
      const availableModels = MODEL_CYCLE.filter((m) => {
        const model = ctx.modelRegistry.find(m.provider, m.id);
        return model !== undefined;
      });

      if (availableModels.length === 0) {
        ctx.ui.notify("No available models in cycle", "error");
        return;
      }

      // Find current position in available models
      const current = MODEL_CYCLE[currentIndex];
      let nextIndex = (currentIndex + 1) % MODEL_CYCLE.length;

      // Skip unavailable models
      let attempts = 0;
      while (attempts < MODEL_CYCLE.length) {
        const model = ctx.modelRegistry.find(
          MODEL_CYCLE[nextIndex].provider,
          MODEL_CYCLE[nextIndex].id
        );
        if (model !== undefined) {
          break;
        }
        nextIndex = (nextIndex + 1) % MODEL_CYCLE.length;
        attempts++;
      }

      currentIndex = nextIndex;
      const nextModel = MODEL_CYCLE[currentIndex];
      const model = ctx.modelRegistry.find(nextModel.provider, nextModel.id);

      if (!model) {
        ctx.ui.notify("No available model found", "error");
        return;
      }

      const success = await pi.setModel(model);
      if (success) {
        ctx.ui.notify(
          `Switched to ${nextModel.name}`,
          "success"
        );
        ctx.ui.setStatus("model-cycle", `Model: ${nextModel.name}`);
      } else {
        ctx.ui.notify(
          `Failed to switch to ${nextModel.name} - check API key`,
          "error"
        );
      }
    },
  });

  // Register command to show cycle
  pi.registerCommand("model-cycle", {
    description: "Show model cycle and current position",
    handler: async (_args, ctx) => {
      const lines = MODEL_CYCLE.map((m, i) => {
        const isCurrent = i === currentIndex ? "→ " : "  ";
        const model = ctx.modelRegistry.find(m.provider, m.id);
        const available = model ? "✓" : "✗";
        return `${isCurrent}${available} ${m.name} (${m.provider}/${m.id})`;
      });
      ctx.ui.notify(lines.join("\n"), "info");
    },
  });

  // Update status bar on model selection
  pi.on("model_select", async (event, ctx) => {
    const index = MODEL_CYCLE.findIndex(
      (m) => m.provider === event.model.provider && m.id === event.model.id
    );
    if (index >= 0) {
      currentIndex = index;
      ctx.ui.setStatus("model-cycle", `Model: ${MODEL_CYCLE[index].name}`);
    } else {
      ctx.ui.setStatus("model-cycle", `Model: ${event.model.id}`);
    }
  });
}
