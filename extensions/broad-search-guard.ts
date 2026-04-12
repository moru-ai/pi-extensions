import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";
import { resolve } from "node:path";
import { homedir } from "node:os";

/**
 * Guards against overly broad file searches that can hang or flood output.
 *
 * Blocks `find`, `ls`, and `bash` calls that target directories too close to
 * the filesystem root or home directory without sufficient scoping.
 */
export default function (pi: ExtensionAPI) {
  const home = homedir();

  // Directories that are too broad to search directly
  const BLOCKED_ROOTS = [
    "/",
    "/Users",
    "/Users/",
    "/home",
    "/home/",
    "/var",
    "/var/",
    "/usr",
    "/usr/",
    "/opt",
    "/opt/",
    "/tmp",
    "/tmp/",
    "/System",
    "/Library",
    home,
    `${home}/`,
    `${home}/Library`,
    `${home}/Library/`,
  ];

  function normalizePath(p: string): string {
    // Expand ~ to home directory
    if (p.startsWith("~/") || p === "~") {
      p = p.replace(/^~/, home);
    }
    return resolve(p).replace(/\/+$/, "");
  }

  function isBroadPath(rawPath: string): boolean {
    const normalized = normalizePath(rawPath);
    return BLOCKED_ROOTS.some(
      (root) => normalizePath(root) === normalized
    );
  }

  // Patterns in bash commands that indicate broad searches
  const BROAD_BASH_PATTERNS = [
    // find with broad root
    /\bfind\s+(~\/?\s|\/\s|\/Users\b|\/home\b)/,
    // ls on home or root
    /\bls\s+(-[a-zA-Z]*\s+)*(~\/?\s*$|\/\s*$|\/Users\b|\/home\b)/,
    // recursive grep/rg on home
    /\b(rg|grep\s+-r)\s+.*\s+(~\/?\s*$|\/\s*$)/,
    // fd on broad paths
    /\bfd\s+.*\s+(~\/?\s*$|\/\s*$|\/Users\b|\/home\b)/,
    // tree on home or root
    /\btree\s+(~\/?\s*$|\/\s*$)/,
  ];

  function isBroadBashCommand(command: string): boolean {
    return BROAD_BASH_PATTERNS.some((pattern) => pattern.test(command));
  }

  pi.on("tool_call", async (event, ctx) => {
    // Guard: find tool
    if (isToolCallEventType("find", event)) {
      const searchPath = event.input.path || ".";
      if (isBroadPath(searchPath)) {
        return {
          block: true,
          reason: `Blocked: 'find' targeting broad directory "${searchPath}". Use a more specific subdirectory.`,
        };
      }
    }

    // Guard: ls tool
    if (isToolCallEventType("ls", event)) {
      const lsPath = event.input.path || ".";
      if (isBroadPath(lsPath)) {
        return {
          block: true,
          reason: `Blocked: 'ls' targeting broad directory "${lsPath}". Use a more specific subdirectory.`,
        };
      }
    }

    // Guard: bash tool (catch find/ls/rg/grep/fd/tree in shell commands)
    if (isToolCallEventType("bash", event)) {
      const command = event.input.command || "";
      if (isBroadBashCommand(command)) {
        return {
          block: true,
          reason: `Blocked: bash command appears to search a very broad directory. Use a more specific path. Command: "${command.slice(0, 120)}..."`,
        };
      }
    }
  });

  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.notify("Broad search guard active", "info");
  });
}
