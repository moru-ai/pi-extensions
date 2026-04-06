/**
 * Web Search Extension for pi
 *
 * Uses Exa AI for web search.
 * Set EXA_API_KEY environment variable to use.
 * Get a key at https://exa.ai (1,000 free requests/month)
 */

import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import {
  truncateHead,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
} from "@mariozechner/pi-coding-agent";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";

// ============================================================================
// Search Result Interface
// ============================================================================

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  content?: string;
  date?: string;
  score?: number;
}

interface SearchResponse {
  results: SearchResult[];
  provider: string;
}

// ============================================================================
// Format search results as clean text for the LLM
// ============================================================================

function formatResults(response: SearchResponse): string {
  const { results, provider } = response;

  if (results.length === 0) {
    return `No results found. (provider: ${provider})`;
  }

  const lines: string[] = [];
  lines.push(`Found ${results.length} results via ${provider}\n`);

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    lines.push(`## ${i + 1}. ${r.title}`);
    lines.push(`URL: ${r.url}`);
    if (r.date) lines.push(`Date: ${r.date}`);
    if (r.snippet) lines.push(`\n${r.snippet}`);
    if (r.content) lines.push(`\nContent:\n${r.content}`);
    lines.push("");
  }

  return lines.join("\n");
}

// ============================================================================
// Exa AI Provider
// ============================================================================

async function exaSearch(opts: {
  query: string;
  numResults: number;
  timeRange?: "day" | "week" | "month" | "year";
  category?: "general" | "news" | "code" | "science";
  signal?: AbortSignal;
}): Promise<SearchResponse> {
  const apiKey = process.env.EXA_API_KEY;
  if (!apiKey) {
    throw new Error(
      "EXA_API_KEY is not set. Get one at https://exa.ai and export EXA_API_KEY=...",
    );
  }

  const body: Record<string, unknown> = {
    query: opts.query,
    numResults: opts.numResults,
    type: "auto",
    contents: {
      highlights: { maxCharacters: 4000 },
      text: { maxCharacters: 2000 },
    },
  };

  if (opts.category === "news") body.category = "news";
  else if (opts.category === "science") body.category = "research paper";

  if (opts.timeRange) {
    const start = new Date();
    if (opts.timeRange === "day") start.setDate(start.getDate() - 1);
    else if (opts.timeRange === "week") start.setDate(start.getDate() - 7);
    else if (opts.timeRange === "month") start.setMonth(start.getMonth() - 1);
    else if (opts.timeRange === "year") start.setFullYear(start.getFullYear() - 1);
    body.startPublishedDate = start.toISOString();
  }

  const res = await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify(body),
    signal: opts.signal,
  });

  if (!res.ok) {
    throw new Error(`Exa error (${res.status}): ${await res.text()}`);
  }

  const data = (await res.json()) as {
    results: Array<{
      title: string;
      url: string;
      publishedDate?: string;
      text?: string;
      highlights?: string[];
      score?: number;
    }>;
  };

  return {
    provider: "exa",
    results: data.results.map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.highlights?.join(" … ") ?? "",
      content: r.text,
      date: r.publishedDate,
      score: r.score,
    })),
  };
}

// ============================================================================
// Extension
// ============================================================================

function currentYear(): string {
  return new Date().getFullYear().toString();
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "websearch",
    label: "Web Search",
    description: `Search the web for up-to-date information. The current year is ${currentYear()}.`,
    promptSnippet: `Search the web for current information (current year: ${currentYear()})`,
    promptGuidelines: [
      "Use websearch when the user asks about current events, recent releases, documentation, or anything beyond your knowledge cutoff.",
      `The current year is ${currentYear()}. Include the year in queries about recent information.`,
      "After searching, use webfetch or bash with `defuddle parse <url> --md` to read full pages if snippets aren't sufficient.",
    ],
    parameters: Type.Object({
      query: Type.String({ description: "Search query" }),
      numResults: Type.Optional(
        Type.Number({ description: "Number of results to return (default: 10, max: 20)" }),
      ),
      timeRange: Type.Optional(
        StringEnum(["day", "week", "month", "year"] as const, {
          description: "Filter results by recency",
        }),
      ),
      category: Type.Optional(
        StringEnum(["general", "news", "code", "science"] as const, {
          description: "Search category (default: general)",
        }),
      ),
    }),

    async execute(toolCallId, params, signal, onUpdate) {
      const {
        query,
        numResults,
        timeRange,
        category,
      } = params as {
        query: string;
        numResults?: number;
        timeRange?: "day" | "week" | "month" | "year";
        category?: "general" | "news" | "code" | "science";
      };

      onUpdate?.({
        content: [{ type: "text", text: `Searching: "${query}"...` }],
      });

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 25_000);
      const combinedSignal = signal
        ? AbortSignal.any([signal, controller.signal])
        : controller.signal;

      try {
        const response = await exaSearch({
          query,
          numResults: Math.min(numResults ?? 10, 20),
          timeRange,
          category,
          signal: combinedSignal,
        });

        const formatted = formatResults(response);

        const truncation = truncateHead(formatted, {
          maxLines: DEFAULT_MAX_LINES,
          maxBytes: DEFAULT_MAX_BYTES,
        });

        let output = truncation.content;
        if (truncation.truncated) {
          output += `\n\n[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)})]`;
        }

        return {
          content: [{ type: "text", text: output }],
          details: {
            query,
            provider: response.provider,
            numResults: response.results.length,
            truncated: truncation.truncated,
          },
        };
      } finally {
        clearTimeout(timer);
      }
    },

    renderCall(args, theme) {
      const a = args as { query?: string; category?: string; timeRange?: string };
      let text = theme.fg("toolTitle", theme.bold("websearch "));
      text += theme.fg("accent", `"${a.query ?? ""}"`);
      const tags: string[] = [];
      if (a.category && a.category !== "general") tags.push(a.category);
      if (a.timeRange) tags.push(a.timeRange);
      if (tags.length) text += theme.fg("muted", ` (${tags.join(", ")})`);
      return new Text(text, 0, 0);
    },

    renderResult(result, { expanded, isPartial }, theme) {
      if (isPartial) {
        return new Text(theme.fg("warning", "Searching..."), 0, 0);
      }
      const details = result.details as {
        query?: string;
        provider?: string;
        numResults?: number;
        truncated?: boolean;
      };
      const content = result.content?.[0];
      const text = content && "text" in content ? (content as { text: string }).text : "";

      if (!expanded) {
        let summary = theme.fg("success", "✓ ");
        summary += theme.fg("muted", `${details.numResults ?? 0} results`);
        summary += theme.fg("dim", ` for "${details.query ?? ""}"`);
        if (details.truncated) summary += theme.fg("warning", " (truncated)");
        return new Text(summary, 0, 0);
      }

      return new Text(text, 0, 0);
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    if (!process.env.EXA_API_KEY) {
      ctx.ui.notify(
        "websearch: EXA_API_KEY not set. Get a key at https://exa.ai",
        "warning",
      );
    }
  });
}
