# Model Cycle Extension

Cycles through a predefined set of AI models with provider availability checking.

## Features

- **Keyboard shortcut**: `Ctrl+M` to cycle to the next available model
- **Command**: `/model-cycle` to show the current cycle and available models  
- **Provider checking**: Automatically skips models whose providers aren't configured
- **Status bar**: Shows current model in the status bar
- **Fallback logic**: If a provider isn't available, gracefully skips to the next

## Model Cycle

The default cycle is:

1. **Bedrock Haiku** - `amazon-bedrock` / `us.anthropic.claude-haiku-4-5-20251001-v1:0`
2. **Codex Spark** - `openai-codex` / `gpt-4o`
3. **Bedrock Sonnet** - `amazon-bedrock` / `us.anthropic.claude-sonnet-4-20250514-v1:0`
4. **Codex Spark** - `openai-codex` / `gpt-4o` (repeats)

## Usage

### Keyboard

Press `Ctrl+M` to switch to the next available model:

```
Bedrock Haiku → Codex Spark → Bedrock Sonnet → Codex Spark → (repeats)
```

If a model's provider isn't configured (e.g., no ChatGPT subscription for Codex), it's automatically skipped.

### Command

Run `/model-cycle` in pi to view the cycle:

```
→ ✓ Bedrock Haiku (amazon-bedrock/...)
  ✓ Codex Spark (openai-codex/gpt-4o)
  ✗ Bedrock Sonnet (amazon-bedrock/...)
  ✓ Codex Spark (openai-codex/gpt-4o)
```

Legend:
- `→` = current model
- `✓` = provider configured  
- `✗` = provider not configured

## Configuration

Edit `model-cycle.ts` to customize the cycle:

```typescript
const MODEL_CYCLE = [
  { provider: "amazon-bedrock", id: "...", name: "Model Name" },
  // ...
];
```

Then run `/reload` in pi to reload the extension.

## Session Status

The extension updates pi's status bar (footer) to show the current model:

```
Model: Bedrock Haiku
```
