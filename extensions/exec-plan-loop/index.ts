import { completeSimple } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { convertToLlm, serializeConversation } from "@mariozechner/pi-coding-agent";

import {
	AGENT_PROVIDER_ERROR_RETRY_LIMIT,
	ASK_USER_QUESTION_TOOL,
	COMPACT_BASE_DELAY_MS,
	COMPACT_INSTRUCTIONS,
	COMPACT_MODELS,
	COMPACT_THRESHOLD_PERCENT,
	SEND_MESSAGE_WATCHDOG_MS,
} from "./constants";
import { switchToFallbackModel, getRecoveryState, withActiveModel } from "./models";
import { listActivePlans } from "./plans";
import { buildLoopPrompt } from "./prompt";
import { advanceState, appendAttemptLog, appendEventLog, createBaselineState, ensureSteeringFile, getGitSnapshot, loadLoopStateWithStatus, saveLoopState } from "./state";
import type { AgentOutcome, LoopEvent, LoopRecoveryState, LoopState } from "./types";
import { isRecord, modelToSpec, parseModelSpec, summarizeAgentOutcome, summarizePlanPaths, summarizePlans, truncate } from "./utils";

function getModelContextWindow(model: unknown): number | null {
	if (!isRecord(model)) return null;
	const contextWindow = model.contextWindow;
	return typeof contextWindow === "number" && Number.isFinite(contextWindow) && contextWindow > 0 ? contextWindow : null;
}

function getEligibleCompactionModels(ctx: ExtensionContext, requiredTokens: number | null): { eligible: string[]; skipped: string[] } {
	if (requiredTokens === null || !Number.isFinite(requiredTokens) || requiredTokens <= 0) {
		return { eligible: [...COMPACT_MODELS], skipped: [] };
	}

	const eligible: string[] = [];
	const skipped: string[] = [];
	for (const modelSpec of COMPACT_MODELS) {
		const slash = modelSpec.indexOf("/");
		if (slash <= 0) continue;
		const provider = modelSpec.slice(0, slash);
		const modelId = modelSpec.slice(slash + 1);
		const model = ctx.modelRegistry.find(provider, modelId);
		if (!model) continue;
		const contextWindow = getModelContextWindow(model);
		if (contextWindow !== null && contextWindow < requiredTokens) {
			skipped.push(`${modelSpec} (${contextWindow} < ${requiredTokens})`);
			continue;
		}
		eligible.push(modelSpec);
	}

	return { eligible, skipped };
}

function setAskUserQuestionToolEnabled(pi: ExtensionAPI, enabled: boolean): "enabled" | "disabled" | "unchanged" | "unavailable" {
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

function syncLoopToolAvailability(pi: ExtensionAPI, enabled: boolean): "enabled" | "disabled" | "unchanged" | "unavailable" {
	return setAskUserQuestionToolEnabled(pi, !enabled);
}

function notifyLoopToolAvailabilityChange(
	ctx: { hasUI: boolean; ui: { notify(message: string, level?: "info" | "warning" | "error"): void } },
	change: "enabled" | "disabled" | "unchanged" | "unavailable",
): void {
	if (!ctx.hasUI) return;
	if (change === "disabled") {
		ctx.ui.notify("Exec-plan loop active: ask_user_question tool disabled for the agent.", "info");
		return;
	}
	if (change === "enabled") {
		ctx.ui.notify("Exec-plan loop inactive: ask_user_question tool restored for the agent.", "info");
		return;
	}
	if (change === "unavailable") {
		ctx.ui.notify("ask_user_question tool could not be restored because it is not currently registered.", "warning");
	}
}

function fireAndForgetEventLog(event: LoopEvent): void {
	void appendEventLog(event).catch(() => {});
}

function logToolAvailabilityChange(change: "enabled" | "disabled" | "unchanged" | "unavailable", loopActive: boolean): void {
	if (change === "unchanged") return;
	fireAndForgetEventLog({
		type: "tool_availability",
		tool: ASK_USER_QUESTION_TOOL,
		change,
		loopActive,
	});
}

export default function execPlanLoop(pi: ExtensionAPI) {
	let runtimeEnabled = false;
	let state: LoopState | null = null;
	let compactionInProgress = false;
	let compactionAttempt = 0;
	let compactionModelChain: string[] = [...COMPACT_MODELS];
	let compactionRequiredTokens: number | null = null;
	let sendMessageWatchdog: ReturnType<typeof setTimeout> | null = null;
	let lastCtx: ExtensionContext | null = null;

	/**
	 * Wrap pi.sendUserMessage with a watchdog timer.
	 * If before_agent_start doesn't fire within SEND_MESSAGE_WATCHDOG_MS,
	 * the message was never delivered (e.g. auth expired at pre-validation).
	 * The watchdog logs send_message_failed and stops the loop.
	 */
	function sendMessageWithWatchdog(
		content: string | Parameters<typeof pi.sendUserMessage>[0],
		options?: Parameters<typeof pi.sendUserMessage>[1],
	): void {
		clearWatchdog();
		pi.sendUserMessage(content, options);
		sendMessageWatchdog = setTimeout(() => {
			sendMessageWatchdog = null;
			void handleSendMessageTimeout();
		}, SEND_MESSAGE_WATCHDOG_MS);
	}

	function clearWatchdog(): void {
		if (sendMessageWatchdog) {
			clearTimeout(sendMessageWatchdog);
			sendMessageWatchdog = null;
		}
	}

	async function handleSendMessageTimeout(): Promise<void> {
		if (!runtimeEnabled || !state?.enabled) return;

		const currentModelSpec = state.recovery?.activeModel ?? null;
		fireAndForgetEventLog({
			type: "send_message_failed",
			iteration: state.iteration,
			model: currentModelSpec,
			reason: "Watchdog timeout: before_agent_start not received after sendUserMessage",
		});

		// Try switching to a fallback model (only if we have a ctx reference)
		if (!lastCtx) {
			// No context available — can't attempt fallback, just stop
			runtimeEnabled = false;
			state = {
				...state,
				enabled: false,
				updatedAt: new Date().toISOString(),
				lastTurn: {
					...state.lastTurn,
					status: "stopped",
					summary: "Loop stopped: sendUserMessage failed before any agent turn completed.",
				},
			};
			await saveLoopState(state);
			await appendAttemptLog(state);
			await appendEventLog({ type: "loop_stop", reason: "send_message_failure", summary: state.lastTurn.summary });
			syncLoopToolAvailability(pi, false);
			return;
		}

		const recovery = getRecoveryState(state.recovery);
		const switchResult = await switchToFallbackModel(pi, lastCtx, currentModelSpec, recovery);

		if (switchResult.switched && switchResult.modelSpec) {
			fireAndForgetEventLog({
				type: "model_switch",
				from: currentModelSpec,
				to: switchResult.modelSpec,
				consecutiveErrors: 0,
				reason: "sendUserMessage delivery failure (watchdog timeout)",
			});

			// Retry with fallback model
			const plans = await listActivePlans();
			if (plans.length > 0) {
				state = {
					...state,
					updatedAt: new Date().toISOString(),
					recovery: {
						...switchResult.recovery,
						consecutiveProviderErrors: 0,
						lastModelSwitchAt: new Date().toISOString(),
						lastModelSwitch: `${currentModelSpec ?? "unknown"} -> ${switchResult.modelSpec}`,
					},
				};
				await saveLoopState(state);
				sendMessageWithWatchdog(buildLoopPrompt(plans, state), { deliverAs: "followUp" });
				await appendEventLog({ type: "send_follow_up", mode: "full_prompt", iteration: state.iteration });
				return;
			}
		}

		// No fallback available — stop the loop
		runtimeEnabled = false;
		state = {
			...state,
			enabled: false,
			updatedAt: new Date().toISOString(),
			lastTurn: {
				...state.lastTurn,
				status: "stopped",
				summary: `Loop stopped: sendUserMessage failed and no fallback model available. The provider may require re-authentication.`,
			},
		};
		await saveLoopState(state);
		await appendAttemptLog(state);
		await appendEventLog({
			type: "loop_stop",
			reason: "send_message_failure",
			summary: state.lastTurn.summary,
		});
		syncLoopToolAvailability(pi, false);
	}

	function isLoopRuntimeActive(): boolean {
		return runtimeEnabled && Boolean(state?.enabled);
	}

	function triggerCompaction(ctx: ExtensionContext, attempt = 0): void {
		if (compactionInProgress) return;
		compactionInProgress = true;
		compactionAttempt = attempt;
		let contextUsagePercent = 0;

		if (attempt === 0) {
			const usage = ctx.getContextUsage();
			compactionRequiredTokens = usage?.tokens ?? null;
			contextUsagePercent = usage && usage.tokens !== null && usage.contextWindow > 0 ? Math.round((usage.tokens / usage.contextWindow) * 100) : 0;
			const { eligible, skipped } = getEligibleCompactionModels(ctx, compactionRequiredTokens);
			compactionModelChain = eligible;
			if (ctx.hasUI && skipped.length > 0) {
				ctx.ui.notify(`Compaction skipped smaller-context models: ${skipped.join(", ")}`, "info");
			}
		}

		const modelSpec = attempt < compactionModelChain.length ? compactionModelChain[attempt] : null;
		if (attempt === 0) {
			fireAndForgetEventLog({
				type: "compaction_start",
				model: modelSpec ?? "unknown",
				attempt,
				contextUsagePercent,
			});
		}
		if (attempt === 0 && ctx.hasUI) {
			ctx.ui.notify(
				modelSpec
					? `Auto-compaction started (90% threshold) with ${modelSpec}`
					: "Auto-compaction started (90% threshold) with the session model",
				"info",
			);
		}

		ctx.compact({
			customInstructions: COMPACT_INSTRUCTIONS,
			onComplete: async () => {
				compactionInProgress = false;
				compactionAttempt = 0;
				compactionModelChain = [...COMPACT_MODELS];
				compactionRequiredTokens = null;
				await appendEventLog({ type: "compaction_success", model: modelSpec ?? "unknown", attempt });
				if (ctx.hasUI) ctx.ui.notify(`Auto-compaction completed (${modelSpec ?? "session model"})`, "info");
				if (runtimeEnabled && state?.enabled) {
					const plans = await listActivePlans();
					if (plans.length === 0) return;
					const git = await getGitSnapshot(pi);
					state = {
						...state,
						updatedAt: new Date().toISOString(),
						repo: {
							...state.repo,
							branch: git.branch,
							headSha: git.headSha,
							workingTreeClean: git.workingTreeClean,
							statusSummary: git.statusSummary,
						},
						plans: {
							activePaths: plans.map((plan) => plan.path),
							lastSeenSummary: summarizePlans(plans),
						},
					};
					await saveLoopState(state);
					sendMessageWithWatchdog(buildLoopPrompt(plans, state, { postCompaction: true }), { deliverAs: "followUp" });
					await appendEventLog({ type: "send_follow_up", mode: "full_prompt", iteration: state.iteration });
					if (ctx.hasUI) ctx.ui.notify("Exec-plan loop resumed after compaction", "info");
				}
			},
			onError: (error) => {
				compactionInProgress = false;
				const nextAttempt = attempt + 1;
				fireAndForgetEventLog({
					type: "compaction_failure",
					model: modelSpec ?? "unknown",
					attempt,
					error: error.message,
					willRetry: nextAttempt < compactionModelChain.length,
				});
				if (nextAttempt < compactionModelChain.length) {
					const nextModel = compactionModelChain[nextAttempt];
					const delay = COMPACT_BASE_DELAY_MS * Math.pow(2, attempt);
					if (ctx.hasUI) {
						ctx.ui.notify(`Compaction failed with ${modelSpec ?? "session model"}: ${error.message}. Retrying with ${nextModel} in ${delay / 1000}s...`, "warning");
					}
					setTimeout(() => triggerCompaction(ctx, nextAttempt), delay);
				} else {
					compactionAttempt = 0;
					compactionModelChain = [...COMPACT_MODELS];
					compactionRequiredTokens = null;
					if (ctx.hasUI) ctx.ui.notify(`Compaction failed after all eligible models: ${error.message}. Use /compact manually or start a new session.`, "error");
				}
			},
		});
	}

	pi.on("before_agent_start", () => {
		if (!sendMessageWatchdog) return;
		clearWatchdog();
	});

	pi.on("session_before_compact", async (event, ctx) => {
		if (!isLoopRuntimeActive() && !compactionInProgress) return;
		const { preparation, signal } = event;
		const { messagesToSummarize, turnPrefixMessages, tokensBefore, firstKeptEntryId, previousSummary } = preparation;
		compactionRequiredTokens = tokensBefore;
		compactionModelChain = getEligibleCompactionModels(ctx, compactionRequiredTokens).eligible;
		const modelSpec = compactionAttempt < compactionModelChain.length ? compactionModelChain[compactionAttempt] : null;
		if (!modelSpec) return;

		const slash = modelSpec.indexOf("/");
		if (slash <= 0) return;
		const provider = modelSpec.slice(0, slash);
		const modelId = modelSpec.slice(slash + 1);
		const model = ctx.modelRegistry.find(provider, modelId);
		if (!model) {
			if (ctx.hasUI) ctx.ui.notify(`Compaction model ${modelSpec} not found, using default`, "warning");
			return;
		}
		const apiKey = await ctx.modelRegistry.getApiKey(model);
		if (!apiKey) {
			if (ctx.hasUI) ctx.ui.notify(`No API key for ${provider}, using default`, "warning");
			return;
		}

		const allMessages = [...messagesToSummarize, ...turnPrefixMessages];
		const conversationText = serializeConversation(convertToLlm(allMessages));
		const previousContext = previousSummary ? `\n\nPrevious session summary:\n${previousSummary}` : "";

		try {
			const response = await completeSimple(model, {
				messages: [{
					role: "user" as const,
					content: [{ type: "text" as const, text: `${COMPACT_INSTRUCTIONS}${previousContext}\n\n<conversation>\n${conversationText}\n</conversation>` }],
					timestamp: Date.now(),
				}],
			}, { apiKey, maxTokens: 8192, signal, reasoning: "medium" });

			const summary = response.content
				.filter((c): c is { type: "text"; text: string } => c.type === "text")
				.map((c) => c.text)
				.join("\n");
			if (!summary.trim()) {
				if (!signal.aborted && ctx.hasUI) ctx.ui.notify(`Compaction summary from ${modelSpec} was empty`, "warning");
				return;
			}
			return { compaction: { summary, firstKeptEntryId, tokensBefore } };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (ctx.hasUI) ctx.ui.notify(`Compaction with ${modelSpec} failed: ${message}`, "error");
			return;
		}
	});

	pi.on("turn_end", (_event, ctx) => {
		if (!isLoopRuntimeActive() || compactionInProgress) return;
		const usage = ctx.getContextUsage();
		if (!usage || usage.tokens === null || usage.contextWindow === 0) return;
		if (usage.tokens > usage.contextWindow * COMPACT_THRESHOLD_PERCENT) {
			compactionAttempt = 0;
			triggerCompaction(ctx);
		}
	});

	pi.registerCommand("trigger-compact", {
		description: "Trigger compaction immediately with model fallback",
		handler: async (_args, ctx) => {
			compactionInProgress = false;
			compactionAttempt = 0;
			triggerCompaction(ctx);
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		runtimeEnabled = false;
		const loaded = await loadLoopStateWithStatus();
		state = loaded.state;
		const toolChange = syncLoopToolAvailability(pi, false);
		logToolAvailabilityChange(toolChange, false);
		notifyLoopToolAvailabilityChange(ctx, toolChange);
		if (loaded.error && ctx.hasUI) ctx.ui.notify(loaded.error, "warning");
		if (!state?.enabled) return;
		if (ctx.hasUI) {
			ctx.ui.notify(`Found persisted exec-plan loop ${state.runTag} for ${summarizePlanPaths(state.plans.activePaths)}. It is paused until you explicitly resume it with /start-exec-plan-loop.`, "info");
		}
	});

	pi.registerCommand("start-exec-plan-loop", {
		description: "Start or resume the exec-plan loop for active plans",
		handler: async (args, ctx) => {
			const normalizedArgs = args.trim();
			const extraInstructions = normalizedArgs.length > 0 ? normalizedArgs : null;
			const loaded = await loadLoopStateWithStatus();
			state = loaded.state;
			if (loaded.error && ctx.hasUI) ctx.ui.notify(loaded.error, "warning");

			if (state?.enabled && extraInstructions === null) {
				const plans = await listActivePlans();
				if (plans.length === 0) {
					runtimeEnabled = false;
					state = {
						...state,
						enabled: false,
						updatedAt: new Date().toISOString(),
						lastTurn: { ...state.lastTurn, status: "stopped", summary: "Loop was resumed, but there were no active exec plans left." },
					};
					await saveLoopState(state);
					await appendAttemptLog(state);
					await appendEventLog({ type: "loop_stop", reason: "no_plans", summary: "No active exec plans remaining." });
					const toolChange = syncLoopToolAvailability(pi, false);
					logToolAvailabilityChange(toolChange, false);
					notifyLoopToolAvailabilityChange(ctx, toolChange);
					if (ctx.hasUI) ctx.ui.notify("No active exec plans found. Persisted loop has been stopped.", "info");
					return;
				}

				const git = await getGitSnapshot(pi);
				state = {
					...state,
					updatedAt: new Date().toISOString(),
					repo: {
						...state.repo,
						branch: git.branch,
						headSha: git.headSha,
						workingTreeClean: git.workingTreeClean,
						statusSummary: git.statusSummary,
					},
					plans: {
						activePaths: plans.map((plan) => plan.path),
						lastSeenSummary: summarizePlans(plans),
					},
					recovery: withActiveModel(getRecoveryState(state.recovery), modelToSpec(ctx.model) ?? getRecoveryState(state.recovery).activeModel),
				};
				await saveLoopState(state);
				await appendEventLog({ type: "loop_resume", runTag: state.runTag, iteration: state.iteration, activePlans: state.plans.activePaths });
				await ensureSteeringFile();
				const toolChange = syncLoopToolAvailability(pi, true);
				logToolAvailabilityChange(toolChange, true);
				notifyLoopToolAvailabilityChange(ctx, toolChange);
				runtimeEnabled = true;
				if (ctx.hasUI) ctx.ui.notify(`Resuming exec-plan loop ${state.runTag} for ${summarizePlans(plans)}. Use /stop-exec-plan-loop to terminate it manually.`, "info");
				sendMessageWithWatchdog(buildLoopPrompt(plans, state));
				return;
			}

			const plans = await listActivePlans();
			if (plans.length === 0) {
				runtimeEnabled = false;
				state = null;
				if (ctx.hasUI) ctx.ui.notify("No active exec plans found. Loop not started.", "info");
				return;
			}

			const git = await getGitSnapshot(pi);
			state = createBaselineState(plans, git, extraInstructions, modelToSpec(ctx.model));
			await saveLoopState(state);
			await ensureSteeringFile();
			await appendAttemptLog(state);
			await appendEventLog({
				type: "loop_start",
				runTag: state.runTag,
				iteration: state.iteration,
				activePlans: state.plans.activePaths,
				model: modelToSpec(ctx.model) ?? null,
			});
			const toolChange = syncLoopToolAvailability(pi, true);
			logToolAvailabilityChange(toolChange, true);
			notifyLoopToolAvailabilityChange(ctx, toolChange);
			runtimeEnabled = true;
			if (ctx.hasUI) {
				ctx.ui.notify(`Exec-plan loop enabled for active plans: ${summarizePlans(plans)}. Baseline ${git.headSha}. Use /stop-exec-plan-loop to terminate it manually. Run /start-exec-plan-loop again after a restart to resume.`, "info");
			}
			sendMessageWithWatchdog(buildLoopPrompt(plans, state));
		},
	});

	pi.registerCommand("stop-exec-plan-loop", {
		description: "Stop the active exec-plan loop",
		handler: async (_args, ctx) => {
			if (!state) {
				const loaded = await loadLoopStateWithStatus();
				state = loaded.state;
				if (loaded.error && ctx.hasUI) ctx.ui.notify(loaded.error, "warning");
			}
			if (!state?.enabled) {
				runtimeEnabled = false;
				if (ctx.hasUI) ctx.ui.notify("Exec-plan loop is not running.", "info");
				return;
			}

			runtimeEnabled = false;
			clearWatchdog();
			state = {
				...state,
				enabled: false,
				updatedAt: new Date().toISOString(),
				lastTurn: { ...state.lastTurn, status: "stopped", summary: "Loop stopped by user." },
			};
			await saveLoopState(state);
			await appendAttemptLog(state);
			await appendEventLog({ type: "loop_stop", reason: "user", summary: "Loop stopped by user." });
			const toolChange = syncLoopToolAvailability(pi, false);
			logToolAvailabilityChange(toolChange, false);
			notifyLoopToolAvailabilityChange(ctx, toolChange);
			if (ctx.hasUI) ctx.ui.notify("Exec-plan loop stopped. No further follow-up turns will be scheduled.", "info");
		},
	});

	pi.on("agent_end", async (event, ctx) => {
		if (!runtimeEnabled) return;
		lastCtx = ctx;
		if (!state) {
			const loaded = await loadLoopStateWithStatus();
			state = loaded.state;
			if (loaded.error && ctx.hasUI) ctx.ui.notify(loaded.error, "warning");
		}
		if (!state?.enabled) {
			runtimeEnabled = false;
			return;
		}

		const plans = await listActivePlans();
		if (plans.length === 0) {
			runtimeEnabled = false;
			state = {
				...state,
				enabled: false,
				updatedAt: new Date().toISOString(),
				lastTurn: { ...state.lastTurn, status: "stopped", summary: "Loop stopped because there are no active exec plans remaining." },
				plans: { activePaths: [], lastSeenSummary: "no active exec plans" },
			};
			await saveLoopState(state);
			await appendAttemptLog(state);
			await appendEventLog({ type: "loop_stop", reason: "no_plans", summary: "No active exec plans remaining." });
			const toolChange = syncLoopToolAvailability(pi, false);
			logToolAvailabilityChange(toolChange, false);
			notifyLoopToolAvailabilityChange(ctx, toolChange);
			if (ctx.hasUI) ctx.ui.notify("Exec-plan loop stopped because there are no active exec plans remaining.", "info");
			return;
		}

		const git = await getGitSnapshot(pi);
		const outcome: AgentOutcome = summarizeAgentOutcome(event.messages);
		const previousRecovery = getRecoveryState(state.recovery);
		const currentModelSpec = modelToSpec(ctx.model) ?? previousRecovery.activeModel;
		let recovery: LoopRecoveryState;
		let continuationMode = "full loop prompt";

		if (outcome.shouldSendPlainContinue) {
			const consecutiveProviderErrors = currentModelSpec === previousRecovery.activeModel ? previousRecovery.consecutiveProviderErrors + 1 : 1;
			recovery = withActiveModel({ ...previousRecovery, consecutiveProviderErrors, lastProviderError: outcome.assistantError ?? outcome.summary }, currentModelSpec);
			await appendEventLog({
				type: "provider_error",
				iteration: state.iteration + 1,
				consecutiveErrors: consecutiveProviderErrors,
				limit: AGENT_PROVIDER_ERROR_RETRY_LIMIT,
				model: currentModelSpec ?? null,
				error: outcome.assistantError ?? outcome.summary,
			});
			if (consecutiveProviderErrors >= AGENT_PROVIDER_ERROR_RETRY_LIMIT) {
				const switchResult = await switchToFallbackModel(pi, ctx, currentModelSpec, recovery);
				if (switchResult.switched && switchResult.modelSpec) {
					recovery = {
						...switchResult.recovery,
						consecutiveProviderErrors: 0,
						lastModelSwitchAt: new Date().toISOString(),
						lastModelSwitch: `${currentModelSpec ?? "unknown"} -> ${switchResult.modelSpec}`,
					};
					await appendEventLog({
						type: "model_switch",
						from: currentModelSpec ?? null,
						to: switchResult.modelSpec,
						consecutiveErrors: consecutiveProviderErrors,
						reason: `${consecutiveProviderErrors} consecutive provider-only errors`,
					});
					// Model-downshift compaction: if new model has a smaller context
					// window, trigger compaction so the conversation fits.
					const oldCw = getModelContextWindow(ctx.model);
					const newParts = parseModelSpec(switchResult.modelSpec);
					const newModel = newParts ? ctx.modelRegistry.find(newParts.provider, newParts.modelId) : null;
					const newCw = newModel ? getModelContextWindow(newModel) : null;
					if (oldCw !== null && newCw !== null && newCw < oldCw) {
						const downshiftUsage = ctx.getContextUsage();
						if (downshiftUsage && downshiftUsage.tokens !== null && downshiftUsage.tokens > newCw * COMPACT_THRESHOLD_PERCENT) {
							fireAndForgetEventLog({ type: "compaction_start", model: switchResult.modelSpec, attempt: 0, contextUsagePercent: Math.round((downshiftUsage.tokens / newCw) * 100) });
							if (ctx.hasUI) ctx.ui.notify(`Model downshift ${currentModelSpec} → ${switchResult.modelSpec}: compacting to fit smaller context window`, "info");
							compactionAttempt = 0;
							triggerCompaction(ctx);
						}
					}
					continuationMode = `plain continue after model switch to ${switchResult.modelSpec}`;
					if (ctx.hasUI) ctx.ui.notify(`Exec-plan loop switched models after ${consecutiveProviderErrors} consecutive provider-only errors: ${currentModelSpec ?? "unknown"} -> ${switchResult.modelSpec}`, "warning");
				} else {
					await appendEventLog({
						type: "model_switch_failed",
						currentModel: currentModelSpec ?? null,
						consecutiveErrors: consecutiveProviderErrors,
						reason: switchResult.reason ?? "No fallback model available",
					});
					state = advanceState(state, plans, git, outcome, switchResult.recovery);
					state = {
						...state,
						enabled: false,
						updatedAt: new Date().toISOString(),
						lastTurn: {
							...state.lastTurn,
							status: "stopped",
							summary: `Loop stopped after ${consecutiveProviderErrors} consecutive provider-only errors on ${currentModelSpec ?? "the current model"} because no fallback model could be selected. Last provider error: ${truncate(outcome.assistantError ?? outcome.summary)}`,
						},
					};
					runtimeEnabled = false;
					await saveLoopState(state);
					await appendAttemptLog(state);
					await appendEventLog({
						type: "iteration_end",
						iteration: state.iteration,
						status: state.lastTurn.status,
						model: state.recovery?.activeModel ?? null,
						summary: state.lastTurn.summary,
					});
					await appendEventLog({ type: "loop_stop", reason: "provider_exhaustion", summary: state.lastTurn.summary });
					const toolChange = syncLoopToolAvailability(pi, false);
					logToolAvailabilityChange(toolChange, false);
					notifyLoopToolAvailabilityChange(ctx, toolChange);
					if (ctx.hasUI) ctx.ui.notify(`Exec-plan loop stopped: repeated provider-only failures hit the retry limit and no fallback model was available. ${switchResult.reason ?? ""}`.trim(), "error");
					return;
				}
			} else {
				continuationMode = `plain continue (${consecutiveProviderErrors}/${AGENT_PROVIDER_ERROR_RETRY_LIMIT} retries on ${currentModelSpec ?? "current model"})`;
			}
		} else {
			recovery = withActiveModel({ ...previousRecovery, consecutiveProviderErrors: 0, lastProviderError: null }, currentModelSpec);
		}

		state = advanceState(state, plans, git, outcome, recovery);
		await saveLoopState(state);
		await appendAttemptLog(state);
		await appendEventLog({
			type: "iteration_end",
			iteration: state.iteration,
			status: state.lastTurn.status,
			model: state.recovery?.activeModel ?? null,
			summary: state.lastTurn.summary,
		});
		// Pre-turn compaction: if context is over threshold, compact before sending
		// the next message. triggerCompaction's onComplete will resume the loop.
		const preUsage = ctx.getContextUsage();
		if (preUsage && preUsage.tokens !== null && preUsage.contextWindow > 0 && preUsage.tokens > preUsage.contextWindow * COMPACT_THRESHOLD_PERCENT) {
			compactionAttempt = 0;
			await appendEventLog({ type: "send_follow_up", mode: "pre_turn_compact", iteration: state.iteration });
			triggerCompaction(ctx);
		} else if (outcome.shouldSendPlainContinue) {
			sendMessageWithWatchdog("continue", { deliverAs: "followUp" });
			await appendEventLog({ type: "send_follow_up", mode: "plain_continue", iteration: state.iteration });
		} else {
			sendMessageWithWatchdog(buildLoopPrompt(plans, state), { deliverAs: "followUp" });
			await appendEventLog({ type: "send_follow_up", mode: "full_prompt", iteration: state.iteration });
		}
		if (ctx.hasUI) {
			const level = outcome.status === "error" ? "warning" : "info";
			ctx.ui.notify(`Exec-plan loop continuing (#${state.iteration}) from checkpoint ${state.repo.checkpointSha}: ${state.plans.lastSeenSummary}. Last result: ${outcome.status}. Next step: ${continuationMode}. Use /stop-exec-plan-loop to terminate it manually.`, level);
		}
	});
}
