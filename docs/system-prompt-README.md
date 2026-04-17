# Pi System Prompt (Team Shared)

This is the shared system prompt for the Moru team's pi setup.
Copy this to `~/.pi/agent/APPEND_SYSTEM.md` on your local Mac and both workers.

**Usage:**
```bash
# Download to local Mac
curl -fsSL https://raw.githubusercontent.com/moru-ai/pi-extensions/main/docs/APPEND_SYSTEM.md -o ~/.pi/agent/APPEND_SYSTEM.md

# Copy to workers
scp ~/.pi/agent/APPEND_SYSTEM.md worker-1:~/.pi/agent/APPEND_SYSTEM.md
scp ~/.pi/agent/APPEND_SYSTEM.md worker-2:~/.pi/agent/APPEND_SYSTEM.md
```

After copying, open the file and fill in the `<PLACEHOLDER>` values for your setup.
