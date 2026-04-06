import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { StringEnum } from "@mariozechner/pi-ai";
import { Editor, type EditorTheme, Key, matchesKey, Text, truncateToWidth, wrapTextWithAnsi } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";

const TOOL_NAME = "ask_user_question";
const DISABLE_IN_SUBAGENT_ENV = "PI_AGENT_TOOL_DISABLED";

interface QuestionOption {
	label: string;
	value?: string;
	description?: string;
}

type QuestionKind = "select" | "multi_select" | "text";

interface InputQuestion {
	id?: string;
	header?: string;
	question: string;
	type?: QuestionKind;
	multiSelect?: boolean;
	options?: QuestionOption[];
	placeholder?: string;
	required?: boolean;
	minSelections?: number;
	maxSelections?: number;
}

interface NormalizedQuestion {
	id: string;
	header: string;
	question: string;
	type: QuestionKind;
	options: QuestionOption[];
	placeholder?: string;
	required: boolean;
	minSelections: number;
	maxSelections?: number;
}

interface AnswerAnnotation {
	kind: "select" | "multi_select" | "text" | "other" | "mixed";
	header: string;
	question: string;
	labels: string[];
	indices?: number[];
	customText?: string;
}

interface AnswerDetails {
	id: string;
	header: string;
	question: string;
	kind: AnswerAnnotation["kind"];
	value: string | string[];
	labels: string[];
	indices?: number[];
	customText?: string;
}

interface AskUserQuestionResult {
	answers: Record<string, string | string[]>;
	annotations: Record<string, AnswerAnnotation>;
	orderedAnswers: AnswerDetails[];
	cancelled: boolean;
}

type RenderOption = QuestionOption & { isOther?: boolean };

const QuestionOptionSchema = Type.Object({
	label: Type.String({ description: "Display label for the option" }),
	value: Type.Optional(Type.String({ description: "Optional value returned to the model. Defaults to label." })),
	description: Type.Optional(Type.String({ description: "Optional helper text shown below the option." })),
});

const QuestionKindSchema = StringEnum(["select", "multi_select", "text"] as const, {
	description: "Question type. If omitted, inferred from options and multiSelect.",
});

const QuestionSchema = Type.Object({
	id: Type.Optional(Type.String({ description: "Optional stable key for this question. Defaults to its index as a string." })),
	header: Type.Optional(
		Type.String({
			description: "Short header or label for the question, ideally 12 chars or less.",
		}),
	),
	question: Type.String({ description: "The full question text to show the user." }),
	type: Type.Optional(QuestionKindSchema),
	multiSelect: Type.Optional(
		Type.Boolean({
			description: "Claude-compatible alias. If true and options are provided, the question becomes multi_select.",
		}),
	),
	options: Type.Optional(Type.Array(QuestionOptionSchema, { description: "Options for select or multi_select questions." })),
	placeholder: Type.Optional(Type.String({ description: "Optional placeholder hint for free-text answers." })),
	required: Type.Optional(Type.Boolean({ description: "Whether an answer is required. Defaults to true." })),
	minSelections: Type.Optional(Type.Number({ minimum: 0, description: "Minimum selections for multi_select questions." })),
	maxSelections: Type.Optional(Type.Number({ minimum: 1, description: "Maximum selections for multi_select questions." })),
});

const AskUserQuestionParams = Type.Object({
	questions: Type.Array(QuestionSchema, {
		minItems: 1,
		maxItems: 8,
		description: "Questions to ask the user. Claude-compatible flows typically use 1-4 questions.",
	}),
});

function isBuiltInOtherOption(option: QuestionOption): boolean {
	const normalizedLabel = option.label.trim().toLowerCase();
	const normalizedValue = option.value?.trim().toLowerCase();
	return (
		normalizedLabel === "type something else..." ||
		normalizedLabel === "type something else…" ||
		normalizedValue === "__custom__"
	);
}

function normalizeQuestions(questions: InputQuestion[]): NormalizedQuestion[] {
	return questions.map((question, index) => {
		const options = (question.options ?? []).filter((option) => !isBuiltInOtherOption(option));
		let type: QuestionKind;
		if (question.type) type = question.type;
		else if (options.length === 0) type = "text";
		else type = question.multiSelect ? "multi_select" : "select";

		if (type !== "text" && options.length === 0) {
			throw new Error(`Question ${index + 1} requires options for type ${type}`);
		}

		const required = question.required !== false;
		const minSelections = type === "multi_select" ? (question.minSelections ?? (required ? 1 : 0)) : 0;
		const maxSelections = type === "multi_select" ? question.maxSelections : undefined;

		if (type === "multi_select" && maxSelections !== undefined && maxSelections < minSelections) {
			throw new Error(`Question ${index + 1} has maxSelections smaller than minSelections`);
		}

		return {
			id: question.id ?? String(index),
			header: question.header?.trim() || `Q${index + 1}`,
			question: question.question.trim(),
			type,
			options,
			placeholder: question.placeholder,
			required,
			minSelections,
			maxSelections,
		};
	});
}

function renderOptions(question: NormalizedQuestion, customText: string | undefined): RenderOption[] {
	const items: RenderOption[] = [...question.options];
	if (question.type !== "text") {
		items.push({
			label: customText?.trim() ? `Other: ${customText.trim()}` : "Type something else…",
			value: customText,
			description: customText?.trim() ? "Edit custom answer (or clear it in multi-select with Space)" : "Enter a custom answer",
			isOther: true,
		});
	}
	return items;
}

function selectionSummary(question: NormalizedQuestion, selection: Set<number>, customText?: string): string {
	const labels = Array.from(selection)
		.sort((a, b) => a - b)
		.map((index) => question.options[index]?.label)
		.filter((label): label is string => Boolean(label));
	if (customText?.trim()) labels.push(customText.trim());
	if (labels.length === 0) return "Nothing selected";
	return labels.join(", ");
}

function buildResult(
	questions: NormalizedQuestion[],
	answerMap: Map<string, AnswerDetails>,
	cancelled: boolean,
): AskUserQuestionResult {
	const orderedAnswers = questions
		.map((question) => answerMap.get(question.id))
		.filter((answer): answer is AnswerDetails => Boolean(answer));

	const answers: Record<string, string | string[]> = {};
	const annotations: Record<string, AnswerAnnotation> = {};
	for (const answer of orderedAnswers) {
		answers[answer.id] = answer.value;
		annotations[answer.id] = {
			kind: answer.kind,
			header: answer.header,
			question: answer.question,
			labels: answer.labels,
			indices: answer.indices,
			customText: answer.customText,
		};
	}

	return { answers, annotations, orderedAnswers, cancelled };
}

function toModelPayload(result: AskUserQuestionResult): string {
	return JSON.stringify({
		answers: result.answers,
		annotations: result.annotations,
		cancelled: result.cancelled,
	});
}

function createCancelledResult(questions: NormalizedQuestion[]): AskUserQuestionResult {
	return buildResult(questions, new Map(), true);
}

export default function askUserQuestionExtension(pi: ExtensionAPI) {
	if (process.env[DISABLE_IN_SUBAGENT_ENV] === "1") {
		return;
	}

	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) {
			const active = pi.getActiveTools().filter((name) => name !== TOOL_NAME);
			pi.setActiveTools(active);
		}
	});

	pi.registerTool({
		name: TOOL_NAME,
		label: "Ask User Question",
		description:
			"Ask the user one or more blocking clarifying questions and return structured answers. Supports single select, multi-select, and free-text questions.",
		promptSnippet:
			"Ask the user blocking clarifying questions during execution. Supports single select, multi-select, and text answers.",
		promptGuidelines: [
			"Use this tool when multiple valid directions exist and you need the user's choice before continuing.",
			"Prefer 1-4 concise questions per call. Use short headers and 2-4 options when offering choices.",
			"Select and multi-select questions always include a 'Type something else…' custom-answer option.",
			"Do not use this tool in non-interactive contexts; it requires a live user interface.",
		],
		parameters: AskUserQuestionParams,

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const questions = normalizeQuestions(params.questions as InputQuestion[]);

			const askQuestions = (ctx.ui as { askQuestions?: (questions: InputQuestion[]) => Promise<AskUserQuestionResult> } | undefined)
				?.askQuestions;
			if (askQuestions) {
				const result = await askQuestions(questions);
				return {
					content: [{ type: "text", text: toModelPayload(result) }],
					details: result,
				};
			}

			if (!ctx.hasUI) {
				const result = createCancelledResult(questions);
				return {
					content: [{ type: "text", text: toModelPayload(result) }],
					details: result,
				};
			}

			const result = await ctx.ui.custom<AskUserQuestionResult>((tui, theme, _kb, done) => {
				let currentIndex = 0;
				let optionIndex = 0;
				let inputMode = false;
				let cachedLines: string[] | undefined;
				const answerMap = new Map<string, AnswerDetails>();
				const multiSelections = new Map<string, Set<number>>();
				const customTexts = new Map<string, string>();
				const textValues = new Map<string, string>();

				const editorTheme: EditorTheme = {
					borderColor: (value) => theme.fg("accent", value),
					selectList: {
						selectedPrefix: (value) => theme.fg("accent", value),
						selectedText: (value) => theme.fg("accent", value),
						description: (value) => theme.fg("muted", value),
						scrollInfo: (value) => theme.fg("dim", value),
						noMatch: (value) => theme.fg("warning", value),
					},
				};
				const editor = new Editor(tui, editorTheme);

				function refresh() {
					cachedLines = undefined;
					tui.requestRender();
				}

				function currentQuestion(): NormalizedQuestion | undefined {
					return questions[currentIndex];
				}

				function isReviewScreen(): boolean {
					return currentIndex >= questions.length;
				}

				function getSelection(questionId: string): Set<number> {
					if (!multiSelections.has(questionId)) multiSelections.set(questionId, new Set<number>());
					return multiSelections.get(questionId)!;
				}

				function moveTo(index: number) {
					currentIndex = Math.max(0, Math.min(index, questions.length));
					optionIndex = 0;
					const question = currentQuestion();
					if (question?.type === "text") {
						inputMode = true;
						editor.setText(textValues.get(question.id) ?? "");
					} else {
						inputMode = false;
						editor.setText("");
					}
					refresh();
				}

				function nextQuestion() {
					moveTo(currentIndex + 1);
				}

				function cycleQuestion() {
					moveTo((currentIndex + 1) % (questions.length + 1));
				}

				function saveTextAnswer(question: NormalizedQuestion, rawValue: string) {
					const value = rawValue.trim();
					if (!value && question.required) return false;
					textValues.set(question.id, rawValue);
					answerMap.set(question.id, {
						id: question.id,
						header: question.header,
						question: question.question,
						kind: "text",
						value,
						labels: value ? [value] : [],
						customText: value || undefined,
					});
					return true;
				}

				function saveSelectAnswer(question: NormalizedQuestion, option: RenderOption, selectedIndex: number) {
					const value = (option.value && option.value.trim()) || option.label;
					const kind: AnswerAnnotation["kind"] = option.isOther ? "other" : "select";
					answerMap.set(question.id, {
						id: question.id,
						header: question.header,
						question: question.question,
						kind,
						value,
						labels: [option.isOther ? value : option.label],
						indices: option.isOther ? undefined : [selectedIndex + 1],
						customText: option.isOther ? value : undefined,
					});
				}

				function saveMultiAnswer(question: NormalizedQuestion): boolean {
					const selection = getSelection(question.id);
					const selectedIndices = Array.from(selection).sort((a, b) => a - b);
					const customText = customTexts.get(question.id)?.trim();
					const labels = selectedIndices.map((index) => question.options[index]?.label).filter((label): label is string => Boolean(label));
					const values = selectedIndices
						.map((index) => {
							const option = question.options[index];
							return option ? option.value ?? option.label : undefined;
						})
						.filter((value): value is string => typeof value === "string");

					if (customText) {
						labels.push(customText);
						values.push(customText);
					}

					if (values.length < question.minSelections) return false;
					if (question.maxSelections !== undefined && values.length > question.maxSelections) return false;

					let kind: AnswerAnnotation["kind"] = "multi_select";
					if (customText && values.length === 1) kind = "other";
					else if (customText) kind = "mixed";

					answerMap.set(question.id, {
						id: question.id,
						header: question.header,
						question: question.question,
						kind,
						value: values,
						labels,
						indices: selectedIndices.length > 0 ? selectedIndices.map((index) => index + 1) : undefined,
						customText,
					});
					return true;
				}

				function totalSelections(question: NormalizedQuestion): number {
					if (question.type !== "multi_select") return 0;
					return getSelection(question.id).size + (customTexts.get(question.id)?.trim() ? 1 : 0);
				}

				function allRequiredAnswered(): boolean {
					return questions.every((question) => {
						if (!question.required && !answerMap.has(question.id)) return true;
						return answerMap.has(question.id);
					});
				}

				function finish(cancelled: boolean) {
					done(buildResult(questions, answerMap, cancelled));
				}

				editor.onSubmit = (value) => {
					const question = currentQuestion();
					if (!question) return;

					if (question.type === "text") {
						if (!saveTextAnswer(question, value)) {
							refresh();
							return;
						}
						nextQuestion();
						return;
					}

					const trimmed = value.trim();
					customTexts.set(question.id, value);
					if (question.type === "select") {
						if (!trimmed && question.required) {
							refresh();
							return;
						}
						saveSelectAnswer(question, { label: trimmed, value: trimmed, isOther: true }, optionIndex);
						nextQuestion();
						return;
					}

					inputMode = false;
					refresh();
				};

				function handleInput(data: string) {
					const question = currentQuestion();

					if (inputMode) {
						const current = currentQuestion();
						if (matchesKey(data, Key.tab)) {
							cycleQuestion();
							return;
						}
						if (matchesKey(data, Key.escape)) {
							if (current?.type === "text") {
								finish(true);
								return;
							}
							inputMode = false;
							editor.setText(customTexts.get(current?.id ?? "") ?? "");
							refresh();
							return;
						}
						editor.handleInput(data);
						refresh();
						return;
					}

					if (matchesKey(data, Key.escape)) {
						finish(true);
						return;
					}

					if (isReviewScreen()) {
						if (matchesKey(data, Key.enter) && allRequiredAnswered()) {
							finish(false);
							return;
						}
						if (matchesKey(data, Key.tab)) {
							cycleQuestion();
							return;
						}
						return;
					}
					if (!question) return;

					if (matchesKey(data, Key.tab)) {
						cycleQuestion();
						return;
					}

					const options = renderOptions(question, customTexts.get(question.id));
					if (question.type !== "text") {
						if (matchesKey(data, Key.up)) {
							optionIndex = Math.max(0, optionIndex - 1);
							refresh();
							return;
						}
						if (matchesKey(data, Key.down)) {
							optionIndex = Math.min(Math.max(0, options.length - 1), optionIndex + 1);
							refresh();
							return;
						}
					}

					if (question.type === "text") {
						inputMode = true;
						editor.setText(textValues.get(question.id) ?? "");
						editor.handleInput(data);
						refresh();
						return;
					}

					if (question.type === "multi_select" && matchesKey(data, Key.space)) {
						const option = options[optionIndex];
						if (option?.isOther) {
							if (customTexts.get(question.id)?.trim()) {
								customTexts.delete(question.id);
								refresh();
								return;
							}
							inputMode = true;
							editor.setText(customTexts.get(question.id) ?? "");
							refresh();
							return;
						}

						if (!option) return;
						const selection = getSelection(question.id);
						if (selection.has(optionIndex)) selection.delete(optionIndex);
						else {
							const totalSelected = selection.size + (customTexts.get(question.id)?.trim() ? 1 : 0);
							if (question.maxSelections !== undefined && totalSelected >= question.maxSelections) {
								refresh();
								return;
							}
							selection.add(optionIndex);
						}
						refresh();
						return;
					}

					if (matchesKey(data, Key.enter)) {
						const option = options[optionIndex];
						if (question.type === "select") {
							if (!option) return;
							if (option.isOther) {
								inputMode = true;
								editor.setText(customTexts.get(question.id) ?? "");
								refresh();
								return;
							}
							saveSelectAnswer(question, option, optionIndex);
							nextQuestion();
							return;
						}

						if (question.type === "multi_select") {
							if (option?.isOther) {
								if (!customTexts.get(question.id)?.trim()) {
									inputMode = true;
									editor.setText(customTexts.get(question.id) ?? "");
									refresh();
									return;
								}
								if (!saveMultiAnswer(question)) {
									refresh();
									return;
								}
								nextQuestion();
								return;
							}
							if (!saveMultiAnswer(question)) {
								refresh();
								return;
							}
							nextQuestion();
						}
					}
				}

				function render(width: number): string[] {
					if (cachedLines) return cachedLines;
					const lines: string[] = [];
					const add = (value = "") => lines.push(truncateToWidth(value, width));

					add(theme.fg("accent", "─".repeat(width)));

					if (isReviewScreen()) {
						add(theme.fg("accent", theme.bold(` Review answers (${questions.length}/${questions.length})`)));
						lines.push("");
						for (const question of questions) {
							const answer = answerMap.get(question.id);
							const summary = answer
								? Array.isArray(answer.value)
									? answer.labels.join(", ")
									: answer.labels[0] ?? String(answer.value)
								: theme.fg(question.required ? "warning" : "dim", question.required ? "(missing)" : "(optional, unanswered)");
							add(`${theme.fg("muted", `${question.header}: `)}${summary}`);
						}
						lines.push("");
						if (allRequiredAnswered()) add(theme.fg("success", " Press Enter to submit"));
						else add(theme.fg("warning", " Required answers are still missing"));
						add(theme.fg("dim", " Tab cycle • Enter submit • Esc cancel"));
						add(theme.fg("accent", "─".repeat(width)));
						cachedLines = lines;
						return lines;
					}

					const question = currentQuestion();
					if (!question) {
						cachedLines = lines;
						return lines;
					}

					add(theme.fg("accent", theme.bold(` ${question.header}`)) + theme.fg("dim", `  ${currentIndex + 1}/${questions.length}`));
					add(theme.fg("dim", ` Tab cycles through questions${currentIndex + 1 === questions.length ? " and review" : ""}`));
					for (const line of wrapTextWithAnsi(theme.fg("text", ` ${question.question}`), width)) lines.push(line);
					if (question.placeholder) for (const line of wrapTextWithAnsi(theme.fg("dim", ` ${question.placeholder}`), width)) lines.push(line);
					lines.push("");

					if (question.type === "text") {
						add(theme.fg("muted", " Your answer:"));
						for (const line of editor.render(Math.max(10, width - 2))) add(` ${line}`);
						lines.push("");
						add(
							theme.fg(
								"dim",
								question.required
									? " Enter to submit • Tab cycle • Esc cancel"
									: " Enter to submit blank or text • Tab cycle • Esc cancel",
							),
						);
					} else {
						const options = renderOptions(question, customTexts.get(question.id));
						const selection = question.type === "multi_select" ? getSelection(question.id) : undefined;
						for (let index = 0; index < options.length; index++) {
							const option = options[index];
							const selected = index === optionIndex;
							const prefix = selected ? theme.fg("accent", "> ") : "  ";
							const otherSelected = option.isOther && Boolean(customTexts.get(question.id)?.trim());
							const selectedMark =
								question.type === "multi_select"
									? selection?.has(index) || otherSelected
										? "[x] "
										: "[ ] "
									: "";
							const label = inputMode && option.isOther ? `${option.label} ✎` : option.label;
							const color = selected ? "accent" : option.isOther ? "warning" : "text";
							add(prefix + theme.fg(color, `${index + 1}. ${selectedMark}${label}`));
							if (option.description) add(`     ${theme.fg("muted", option.description)}`);
						}
						lines.push("");

						if (inputMode) {
							add(theme.fg("muted", " Your answer:"));
							for (const line of editor.render(Math.max(10, width - 2))) add(` ${line}`);
							lines.push("");
							if (question.type === "multi_select") {
								add(theme.fg("dim", " Enter to save custom text • Tab cycle • Esc go back"));
							} else {
								add(theme.fg("dim", " Enter to submit custom answer • Esc go back"));
							}
						} else if (question.type === "multi_select") {
							const count = totalSelections(question);
							const limitText = question.maxSelections !== undefined
								? `${count}/${question.maxSelections} selected`
								: `${count} selected`;
							add(
								theme.fg("muted", ` Selected: ${selectionSummary(question, getSelection(question.id), customTexts.get(question.id))}`),
							);
							add(theme.fg("muted", ` ${limitText}`));
							const requirement = question.maxSelections !== undefined
								? ` Choose ${question.minSelections}-${question.maxSelections}`
								: question.minSelections > 0
									? ` Choose at least ${question.minSelections}`
									: " Choose any number";
							if (question.maxSelections !== undefined && count >= question.maxSelections) {
								add(theme.fg("warning", ` Selection limit reached (${question.maxSelections}). Uncheck one option to choose another.`));
							}
							add(theme.fg("dim", `${requirement} • Space toggle • Enter continue • Enter on Other edits when empty • Tab cycle • Esc cancel`));
						} else {
							add(theme.fg("dim", " ↑↓ navigate • Enter select • Tab cycle • Esc cancel"));
						}
					}

					add(theme.fg("accent", "─".repeat(width)));
					cachedLines = lines;
					return lines;
				}

				moveTo(0);
				return {
					render,
					invalidate: () => {
						cachedLines = undefined;
					},
					handleInput,
				};
			});

			return {
				content: [{ type: "text", text: toModelPayload(result) }],
				details: result,
			};
		},

		renderCall(args, theme) {
			const questions = Array.isArray(args.questions) ? (args.questions as InputQuestion[]) : [];
			const summary = questions
				.slice(0, 3)
				.map((question, index) => question.header || question.id || `Q${index + 1}`)
				.join(", ");
			let text = theme.fg("toolTitle", theme.bold(`${TOOL_NAME} `));
			text += theme.fg("muted", `${questions.length} question${questions.length === 1 ? "" : "s"}`);
			if (summary) text += theme.fg("dim", ` (${truncateToWidth(summary, 40)})`);
			return new Text(text, 0, 0);
		},

		renderResult(result, _options, theme) {
			const details = result.details as AskUserQuestionResult | undefined;
			if (!details) {
				const text = result.content[0];
				return new Text(text?.type === "text" ? text.text : "", 0, 0);
			}
			if (details.cancelled) return new Text(theme.fg("warning", "Cancelled"), 0, 0);
			const lines = details.orderedAnswers.map((answer) => {
				const rendered = Array.isArray(answer.value) ? answer.labels.join(", ") : answer.labels[0] ?? String(answer.value);
				return `${theme.fg("success", "✓ ")}${theme.fg("accent", answer.header)}: ${rendered}`;
			});
			return new Text(lines.join("\n"), 0, 0);
		},
	});
}
