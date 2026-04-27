# pi-extensions Agent Notes

## Refresh local Pi after package changes

When changing this repository's Pi package contents (extensions, skills, prompts, agents, or package metadata):

1. Commit and push the change to `origin/main`.
2. Refresh the locally installed Pi package from a normal workspace by running:

   ```bash
   cd ~/vacatio && pi update
   ```

3. Verify the refreshed copy under Pi's installed package path when practical, for example:

   ```bash
   ls ~/.pi/agent/git/github.com/moru-ai/pi-extensions/skills
   ```

Rationale: Pi loads the installed package copy, not necessarily this working checkout. A pushed repo change is not available to fresh Pi sessions until `pi update` refreshes the local install.
