import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

import { AGENT_PROVIDER_IDS, AGENT_PROVIDER_MODEL_ORDER } from "./constants";
import type { AgentProviderId, LoopRecoveryState, ProviderCursorState } from "./types";
import { parseModelSpec } from "./utils";

function createDefaultProviderCursors(): ProviderCursorState {
	return {
		"openai-codex": 0,
	};
}

export function isAgentProviderId(value: unknown): value is AgentProviderId {
	return typeof value === "string" && AGENT_PROVIDER_IDS.includes(value as AgentProviderId);
}

function getNextCursorForModel(provider: AgentProviderId, modelId: string): number {
	const order = AGENT_PROVIDER_MODEL_ORDER[provider];
	const index = order.indexOf(modelId);
	if (index === -1) return 0;
	return (index + 1) % order.length;
}

export function withActiveModel(recovery: LoopRecoveryState, activeModel: string | null): LoopRecoveryState {
	const nextRecovery: LoopRecoveryState = {
		...recovery,
		activeModel,
		providerCursors: {
			...createDefaultProviderCursors(),
			...(recovery.providerCursors ?? {}),
		},
	};

	if (!activeModel) return nextRecovery;
	const parts = parseModelSpec(activeModel);
	if (!parts || !isAgentProviderId(parts.provider)) return nextRecovery;
	nextRecovery.providerCursors![parts.provider] = getNextCursorForModel(parts.provider, parts.modelId);
	return nextRecovery;
}

export function createDefaultRecoveryState(activeModel: string | null = null): LoopRecoveryState {
	return withActiveModel({
		activeModel,
		consecutiveProviderErrors: 0,
		lastProviderError: null,
		lastModelSwitchAt: null,
		lastModelSwitch: null,
		providerCursors: createDefaultProviderCursors(),
	}, activeModel);
}

export function getRecoveryState(recovery: LoopRecoveryState | undefined): LoopRecoveryState {
	const normalized = recovery ?? createDefaultRecoveryState();
	return {
		...normalized,
		providerCursors: {
			...createDefaultProviderCursors(),
			...(normalized.providerCursors ?? {}),
		},
	};
}

function getFallbackProvider(): AgentProviderId {
	return "openai-codex";
}

function getProviderCandidateSpecs(provider: AgentProviderId, startCursor: number): string[] {
	const order = AGENT_PROVIDER_MODEL_ORDER[provider];
	return order.map((_, offset) => {
		const index = (startCursor + offset) % order.length;
		return `${provider}/${order[index]}`;
	});
}

export async function switchToFallbackModel(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	currentModelSpec: string | null,
	recovery: LoopRecoveryState,
): Promise<{ switched: boolean; modelSpec?: string; reason?: string; recovery: LoopRecoveryState }> {
	const targetProvider = getFallbackProvider();
	const providerCursors = {
		...createDefaultProviderCursors(),
		...(recovery.providerCursors ?? {}),
	};
	const startCursor = providerCursors[targetProvider] ?? 0;
	const candidates = getProviderCandidateSpecs(targetProvider, startCursor);

	for (const candidateSpec of candidates) {
		const parts = parseModelSpec(candidateSpec);
		if (!parts || !isAgentProviderId(parts.provider)) continue;
		const model = ctx.modelRegistry.find(parts.provider, parts.modelId);
		if (!model) continue;
		const success = await pi.setModel(model);
		if (success) {
			providerCursors[targetProvider] = getNextCursorForModel(targetProvider, parts.modelId);
			return {
				switched: true,
				modelSpec: candidateSpec,
				recovery: withActiveModel({
					...recovery,
					providerCursors,
				}, candidateSpec),
			};
		}
	}

	return {
		switched: false,
		reason: `No ${targetProvider} fallback model with an available API key could be selected. Tried: ${candidates.join(", ")}`,
		recovery: {
			...recovery,
			providerCursors,
		},
	};
}
