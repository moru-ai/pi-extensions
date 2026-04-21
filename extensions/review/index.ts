/**
 * Review — parallel multi-CLI code review.
 *
 * Runs `codex review` and `claude` in parallel against the current branch,
 * collects findings, and returns them to the agent for triage/fix/re-review.
 *
 * The agent drives the review loop: it reads findings, fixes non-trivial
 * issues, and calls the review tool again until satisfied.
 */

import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

// ── Constants ──────────────────────────────────────────────────────

const SUBPROCESS_TIMEOUT_MS = 900_000; // 15 minutes per reviewer
const MAX_OUTPUT_BYTES = 50_000; // truncate large outputs

const REVIEW_PROMPT_FILE = path.join(__dirname, "review_prompt.md");

// ── Types ──────────────────────────────────────────────────────────

type ReviewerState = "queued" | "running" | "completed" | "failed";

interface ReviewerResult {
	source: string;
	state: ReviewerState;
	exitCode: number | null;
	durationMs: number;
	output: string;
	stderr: string;
	error?: string;
}

interface ReviewDetails {
	baseBranch: string;
	reviewers: ReviewerResult[];
}

// ── Helpers ────────────────────────────────────────────────────────

function truncate(text: string, maxBytes: number): string {
	if (Buffer.byteLength(text) <= maxBytes) return text;
	const buf = Buffer.from(text);
	const truncated = buf.subarray(buf.length - maxBytes).toString("utf-8");
	return `... (truncated, showing last ${maxBytes} bytes)\n${truncated}`;
}

function whichSync(cmd: string): string | null {
	try {
		const { execFileSync } = require("node:child_process");
		return execFileSync("which", [cmd], { encoding: "utf-8" }).trim() || null;
	} catch {
		return null;
	}
}

function loadReviewPrompt(): string {
	try {
		return fs.readFileSync(REVIEW_PROMPT_FILE, "utf-8");
	} catch {
		return "You are a thorough code reviewer. Review the diff and report actionable findings with priority tags [P0]-[P3].";
	}
}

/**
 * Spawn a subprocess and collect output with timeout + abort support.
 */
function runProcess(
	cmd: string,
	args: string[],
	opts: {
		cwd: string;
		signal?: AbortSignal;
		onStatus?: (status: string) => void;
		env?: Record<string, string>;
	},
): Promise<{ stdout: string; stderr: string; exitCode: number | null; error?: string }> {
	return new Promise((resolve) => {
		let stdout = "";
		let stderr = "";
		let proc: ChildProcess;

		try {
			proc = spawn(cmd, args, {
				cwd: opts.cwd,
				env: { ...process.env, ...opts.env },
				stdio: ["ignore", "pipe", "pipe"],
			});
		} catch (e: any) {
			resolve({ stdout: "", stderr: "", exitCode: null, error: e.message });
			return;
		}

		proc.stdout?.on("data", (d: Buffer) => {
			stdout += d.toString();
		});
		proc.stderr?.on("data", (d: Buffer) => {
			stderr += d.toString();
		});

		// Timeout
		const timer = setTimeout(() => {
			proc.kill("SIGTERM");
			setTimeout(() => {
				if (!proc.killed) proc.kill("SIGKILL");
			}, 5000);
		}, SUBPROCESS_TIMEOUT_MS);

		proc.on("close", (code) => {
			clearTimeout(timer);
			resolve({ stdout, stderr, exitCode: code });
		});
		proc.on("error", (e) => {
			clearTimeout(timer);
			resolve({ stdout, stderr, exitCode: null, error: e.message });
		});

		// Abort signal
		if (opts.signal) {
			const kill = () => {
				proc.kill("SIGTERM");
				setTimeout(() => {
					if (!proc.killed) proc.kill("SIGKILL");
				}, 5000);
			};
			if (opts.signal.aborted) kill();
			else opts.signal.addEventListener("abort", kill, { once: true });
		}
	});
}

// ── Reviewers ──────────────────────────────────────────────────────

async function runCodexReview(
	baseBranch: string,
	instructions: string | undefined,
	cwd: string,
	signal?: AbortSignal,
	onStatus?: (status: string) => void,
): Promise<ReviewerResult> {
	const start = Date.now();
	onStatus?.("Starting codex review…");

	const args = ["review", "--base", baseBranch];
	if (instructions) {
		args.push(instructions);
	}

	const result = await runProcess("codex", args, { cwd, signal, onStatus });

	if (result.error) {
		return {
			source: "codex",
			state: "failed",
			exitCode: result.exitCode,
			durationMs: Date.now() - start,
			output: "",
			stderr: result.stderr,
			error: result.error,
		};
	}

	// codex review puts its verbose agent trace in stderr and the final
	// verdict in stdout.  If stdout is empty (regression), fall back to
	// the last paragraph of stderr which typically contains the summary.
	let output = result.stdout.trim();
	if (!output && result.stderr) {
		const lines = result.stderr.trim().split("\n");
		// Take last non-empty block after a blank line
		let i = lines.length - 1;
		while (i > 0 && lines[i - 1] !== "") i--;
		output = lines.slice(i).join("\n").trim();
	}

	return {
		source: "codex",
		state: result.exitCode === 0 ? "completed" : "failed",
		exitCode: result.exitCode,
		durationMs: Date.now() - start,
		output: truncate(output, MAX_OUTPUT_BYTES),
		stderr: result.exitCode !== 0 ? truncate(result.stderr, 2000) : "",
		error: result.exitCode !== 0 ? `codex exited with code ${result.exitCode}` : undefined,
	};
}

async function runClaudeReview(
	baseBranch: string,
	instructions: string | undefined,
	cwd: string,
	signal?: AbortSignal,
	onStatus?: (status: string) => void,
): Promise<ReviewerResult> {
	const start = Date.now();
	onStatus?.("Starting claude review…");

	const reviewPrompt = loadReviewPrompt();

	const userPrompt = [
		`Review the code changes on the current branch against the base branch '${baseBranch}'.`,
		`Run \`git diff $(git merge-base HEAD ${baseBranch})\` to inspect the changes.`,
		`Provide prioritized, actionable findings.`,
		instructions ? `\nAdditional instructions: ${instructions}` : "",
	]
		.filter(Boolean)
		.join(" ");

	const args = [
		"--print",
		"--append-system-prompt",
		reviewPrompt,
		"--output-format",
		"text",
		"--no-session-persistence",
		userPrompt,
	];

	const result = await runProcess("claude", args, { cwd, signal, onStatus });

	if (result.error) {
		return {
			source: "claude",
			state: "failed",
			exitCode: result.exitCode,
			durationMs: Date.now() - start,
			output: "",
			stderr: result.stderr,
			error: result.error,
		};
	}

	return {
		source: "claude",
		state: result.exitCode === 0 ? "completed" : "failed",
		exitCode: result.exitCode,
		durationMs: Date.now() - start,
		output: truncate(result.stdout, MAX_OUTPUT_BYTES),
		stderr: result.exitCode !== 0 ? truncate(result.stderr, 2000) : "",
		error: result.exitCode !== 0 ? `claude exited with code ${result.exitCode}` : undefined,
	};
}

// ── Extension ──────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	/*
	pi.registerTool({
		name: "review",
		label: "Review",
		description:
			"Run parallel code review using Codex CLI and Claude CLI against a base branch. " +
			"Returns prioritized findings from both reviewers. " +
			"Call repeatedly after fixing issues until only trivial (P2/P3) or no findings remain.",
		promptSnippet:
			"review: Run parallel code review (codex + claude) against a base branch. Returns findings with priority tags.",
		promptGuidelines: [
			"Use review to get code review feedback on the current branch before merging.",
			"Default base branch is 'main'. Override with base_branch parameter.",
			"After receiving findings, fix all P0 and P1 issues, then re-run review.",
			"The review loop is complete when: (a) no findings, (b) only P2/P3 findings remain, or (c) both reviewers say 'patch is correct'.",
			"Do not ask the user to review manually — you are the reviewer in the loop.",
			"If one reviewer fails (CLI not found, timeout), the other's results are still returned.",
		],
		parameters: Type.Object({
			base_branch: Type.Optional(
				Type.String({
					description:
						"Base branch to compare against. Defaults to 'main'.",
				}),
			),
			instructions: Type.Optional(
				Type.String({
					description:
						"Additional review instructions or focus areas (e.g. 'focus on error handling', 'check for race conditions').",
				}),
			),
		}),

		async execute(_id, params, signal, onUpdate, _ctx) {
			const baseBranch = params.base_branch || "main";
			const instructions = params.instructions;
			const cwd = _ctx.cwd;

			// Check which CLIs are available
			const hasCodex = !!whichSync("codex");
			const hasClaude = !!whichSync("claude");

			if (!hasCodex && !hasClaude) {
				throw new Error(
					"Neither 'codex' nor 'claude' CLI found in PATH. Install at least one to use the review tool.",
				);
			}

			// Initialize reviewer results
			const reviewers: ReviewerResult[] = [];
			const details: ReviewDetails = { baseBranch, reviewers };

			const emitUpdate = () => {
				const summary = reviewers
					.map((r) => `${r.source}: ${r.state}`)
					.join(" | ");
				onUpdate?.({
					content: [{ type: "text", text: `Reviewing against ${baseBranch}… ${summary}` }],
					details: { ...details },
				});
			};

			// Build reviewer tasks
			const tasks: Promise<ReviewerResult>[] = [];

			if (hasCodex) {
				const codexResult: ReviewerResult = {
					source: "codex",
					state: "queued",
					exitCode: null,
					durationMs: 0,
					output: "",
					stderr: "",
				};
				reviewers.push(codexResult);

				tasks.push(
					runCodexReview(baseBranch, instructions, cwd, signal, (status) => {
						codexResult.state = "running";
						emitUpdate();
					}).then((result) => {
						Object.assign(codexResult, result);
						emitUpdate();
						return result;
					}),
				);
			}

			if (hasClaude) {
				const claudeResult: ReviewerResult = {
					source: "claude",
					state: "queued",
					exitCode: null,
					durationMs: 0,
					output: "",
					stderr: "",
				};
				reviewers.push(claudeResult);

				tasks.push(
					runClaudeReview(baseBranch, instructions, cwd, signal, (status) => {
						claudeResult.state = "running";
						emitUpdate();
					}).then((result) => {
						Object.assign(claudeResult, result);
						emitUpdate();
						return result;
					}),
				);
			}

			emitUpdate();

			// Run all reviewers in parallel
			const results = await Promise.allSettled(tasks);

			// Check if all failed
			const allFailed = reviewers.every((r) => r.state === "failed");
			if (allFailed) {
				const errors = reviewers.map((r) => `${r.source}: ${r.error || "unknown error"}`).join("\n");
				throw new Error(`All reviewers failed:\n${errors}`);
			}

			// Build content text for the agent
			const contentParts: string[] = [];
			contentParts.push(`## Code Review: current branch → ${baseBranch}\n`);

			for (const reviewer of reviewers) {
				contentParts.push(`### ${reviewer.source.toUpperCase()} Review`);
				if (reviewer.state === "completed") {
					contentParts.push(
						`*(completed in ${(reviewer.durationMs / 1000).toFixed(1)}s)*\n`,
					);
					contentParts.push(reviewer.output || "(no output)");
				} else if (reviewer.state === "failed") {
					contentParts.push(
						`**FAILED**: ${reviewer.error || "unknown error"}`,
					);
					if (reviewer.stderr) {
						contentParts.push(`\`\`\`\n${reviewer.stderr}\n\`\`\``);
					}
				}
				contentParts.push(""); // blank line separator
			}

			contentParts.push("---");
			contentParts.push(
				"Read the findings above. Fix all P0/P1 issues, then re-run the review tool. " +
				"The review is done when only P2/P3 or no findings remain.",
			);

			return {
				content: [{ type: "text", text: contentParts.join("\n") }],
				details,
			};
		},

		renderResult(result, { expanded }, theme) {
			const details = result.details as ReviewDetails | undefined;
			if (!details) {
				return new (require("@mariozechner/pi-tui").Text)(
					"Review completed",
					0,
					0,
				);
			}

			const { Text: TuiText } = require("@mariozechner/pi-tui");
			const lines: string[] = [];

			lines.push(
				theme.fg(
					"accent",
					`Review against ${details.baseBranch}`,
				),
			);

			for (const r of details.reviewers) {
				const icon = r.state === "completed" ? "✓" : r.state === "failed" ? "✗" : "⏳";
				const duration = r.durationMs ? ` (${(r.durationMs / 1000).toFixed(1)}s)` : "";
				const stateColor = r.state === "completed" ? "success" : r.state === "failed" ? "error" : "muted";
				lines.push(
					`  ${icon} ${theme.fg(stateColor as any, r.source)}${duration}`,
				);
			}

			if (expanded) {
				for (const r of details.reviewers) {
					if (r.state === "completed" && r.output) {
						lines.push("");
						lines.push(theme.fg("accent", `── ${r.source} ──`));
						// Show first 40 lines in expanded view
						const outputLines = r.output.split("\n").slice(0, 40);
						lines.push(...outputLines);
						if (r.output.split("\n").length > 40) {
							lines.push(theme.fg("muted", "  ... (truncated in display)"));
						}
					}
				}
			}

			return new TuiText(lines.join("\n"), 0, 0);
		},
	});

	// ── /review slash command ────────────────────────────────────────

	pi.registerCommand("review", {
		description: "Run code review on current branch (default: against main)",
		handler: async (args, ctx) => {
			if (!ctx.isIdle()) {
				ctx.ui.notify("Agent is still working — wait for it to finish", "warning");
				return;
			}

			const baseBranch = args.trim() || "main";
			pi.sendUserMessage(
				`Run the review tool to review the current branch against '${baseBranch}'. ` +
				`Fix any P0/P1 issues found, then re-run review until the code is clean.`,
			);
		},
	});
	*/
}
