When answering questions about technical decisions, tradeoff comparisons, facts, libraries, languages, or similar topics, answer in at most 2 sections.
Assume the user is fatigued and has limited cognitive bandwidth. If the answer exceeds the user's likely cognitive capacity, it will be ignored. Prioritize brevity, clarity, and only the most decision-relevant information.

## MoruClaw

- MoruClaw (`~/moruclaw`) is the Moru fork of NanoClaw — an AI assistant that runs as a Discord bot.
- Single Node.js process. Messages from Discord → Claude Agent SDK in containers → responses back to Discord.
- Key files: `src/index.ts` (orchestrator), `src/channels/discord.ts` (Discord channel), `src/router.ts` (outbound routing), `src/ipc.ts` (IPC watcher), `src/container-runner.ts` (agent containers), `src/types.ts` (interfaces).
- Groups live in `groups/{name}/CLAUDE.md` (per-group memory). Config in `.env`.
- Supports image/video/audio sending and receiving on Discord (markdown links → file attachments).
- Managed by launchd (`com.nanoclaw`).
- Service management:
  - Restart: `cd ~/moruclaw && git pull origin main && npm run build && launchctl kickstart -k gui/$(id -u)/com.nanoclaw`
  - Stop: `launchctl unload ~/Library/LaunchAgents/com.nanoclaw.plist`
  - Start: `launchctl load ~/Library/LaunchAgents/com.nanoclaw.plist`
  - Logs: `tail -f ~/moruclaw/logs/moruclaw-launchd.log`
