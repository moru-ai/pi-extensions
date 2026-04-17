When answering questions about technical decisions, tradeoff comparisons, facts, libraries, languages, or similar topics, answer in at most 2 sections.
Assume the user is fatigued and has limited cognitive bandwidth. If the answer exceeds the user's likely cognitive capacity, it will be ignored. Prioritize brevity, clarity, and only the most decision-relevant information.

## Tool Preferences

- Prefer `rg` (ripgrep) over `grep` for searching files and code, unless the user explicitly asks for `grep`.

## User Communication

- Whenever the user asks a question, it is not usually a pushback. The user will ask questions to find the correct answer, debate, check the current status, or compare solutions. Do not change your behavior based on the question unless the user explicitly asks you to.

## Output Safety

- **NEVER** run `find`, `ls`, `grep`, `rg`, `fd`, or `tree` on broad directories like `~/`, `/`, `/Users`, `/home`, `/tmp`, `~/Library`, or any top-level system path. Always scope to a specific project or subdirectory.
- When using the `find` tool, always set `path` to a specific project directory, never `~` or `/`.
- When using the `ls` tool, never list `~` or `/` — list a specific subdirectory.
- Avoid broad searches that can dump huge outputs.
- Prefer targeted `rg` searches with narrow paths, file globs, and excludes (for example `sessions/`, `bin/`, and other generated/log directories).
- If a command returns unexpectedly large or noisy output, stop and rerun with stricter filters before responding.

## Workers (Mac Minis)

- You have two Mac mini workers accessible via SSH: `worker-1` and `worker-2`.
- Connection details are in `~/.ssh/config`.
- Use `ssh worker-1 '<command>'` or `ssh worker-2 '<command>'` to run remote commands.

## MoruClaw

- MoruClaw (`~/moruclaw`) is the Moru fork of NanoClaw — an AI assistant that runs as a Discord bot.
- Single Node.js process. Messages from Discord → Claude Agent SDK in containers → responses back to Discord.
- Key files: `src/index.ts` (orchestrator), `src/channels/discord.ts` (Discord channel), `src/router.ts` (outbound routing), `src/ipc.ts` (IPC watcher), `src/container-runner.ts` (agent containers), `src/types.ts` (interfaces).
- Groups live in `groups/{name}/CLAUDE.md` (per-group memory). Config in `.env`.
- Supports image/video/audio sending and receiving on Discord (markdown links → file attachments).
- Deployed on a worker, managed by launchd (`com.nanoclaw`).
- Service management (run on the worker where moruclaw is deployed):
  - Restart: `cd ~/moruclaw && git pull origin main && npm run build && launchctl kickstart -k gui/$(id -u)/com.nanoclaw`
  - Stop: `launchctl unload ~/Library/LaunchAgents/com.nanoclaw.plist`
  - Start: `launchctl load ~/Library/LaunchAgents/com.nanoclaw.plist`
  - Logs: `tail -f ~/moruclaw/logs/moruclaw-launchd.log`

## wt — Worktree Management

- `wt` is a CLI for managing git worktrees locally and on workers.
- Workflow: `wt create <name>` → write exec plan → `wt send <name>` → Discord bot runs exec-plan-loop on worker.
- Naming convention:
  - Local: `~/wt/wt-<name>/`
  - Worker: `~/<repo>-wt/<name>/` (e.g. `~/ai-company-wt/agent-chat/`)
  - Branch: `plan/<name>` (default), or `-b <branch>` for custom.
- Commands: `wt create`, `wt send`, `wt sync`, `wt list`, `wt clean`.
- Use `--worker` / `-w` flag to target a specific worker: `wt send <name> -w worker-2`
- Always create worktrees via `wt create`. Never use manual `git worktree add`.

## Kickoff — New work always starts with a worktree

- When the user starts working on a feature, bug fix, or requirement — **anything that isn't a trivial quick fix on main** — bootstrap a worktree-based workstream.
- Flow: `wt create <name>` → `cd ~/wt/wt-<name>/` → work → `wt send <name>` → tell Discord bot to run the loop.
- If it's not a one-liner fix on main, **almost always** create a worktree.
- When in doubt, ask: "Should I create a worktree for this?"

## Pi Extensions

- The team's pi-extensions repo lives at `~/pi-extensions`.
- Remote: `https://github.com/moru-ai/pi-extensions.git`
- Contains custom extensions, agents, prompts, and perspectives-prompts for pi.
- When the user asks about pi extensions, custom tools, or shared pi config, check this repo first.

## Open Source Library References

- When the user asks to see a reference, understand internals, or look up implementation details of any open source library, prefer cloning the repository to `~/refs` to inspect the actual source code — not just documentation.
- If the user specifies a version, or if the target library is a dependency of the current working project, check out the matching version/tag that corresponds to the pinned dependency version.
- Before cloning, check if the repo already exists in `~/refs`, the project root, or inside the current working project. If it does, just `git pull` to update it instead of cloning again.
- Use the cloned source to answer questions from actual code implementation, not only from docs or READMEs.
