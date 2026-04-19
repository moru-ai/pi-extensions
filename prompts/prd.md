---
description: "Write a PRD through a lightweight interview"
---
Start a PRD for: $@

Before asking the user anything:

1. Resolve the repo root.
2. Read `PRDS.md`, `PRD_INTERVIEW.md`, and `docs/prds/index.md` end to end.
3. If any of those files is missing, stop and tell the user this repository is not set up for the PRD workflow.
4. Do a small amount of product-surface research in the repo so your proposals are grounded.

Then run the PRD interview:

- Follow `PRD_INTERVIEW.md`.
- Use a propose-first style.
- Keep turns small: one decision per turn by default.
- Focus on product behavior, surfaces, permissions, flows, edge cases, and UX rules when needed.
- Do not drift into implementation details.
- Write the PRD incrementally as you go.

Write the PRD to:

`docs/prds/draft/<name>.md`

Choose a reasonable kebab-case `<name>` from the feature if one is not provided.

Artifacts:

- Read and follow the artifact rules in `docs/prds/index.md`.
- If the PRD is UI-bearing, or if visuals would materially reduce ambiguity, create companion artifacts under:
  `docs/prds/artifacts/<name>/`
- Prefer HTML mockups such as `mockup-<surface-id>.html`.
- After creating artifacts, show the user `file://` absolute paths so they can open them in a browser immediately.

When the PRD is complete:

1. Confirm approval with the user.
2. On approval, move the PRD from `docs/prds/draft/<name>.md` to `docs/prds/active/<name>.md` according to `docs/prds/index.md`.
3. Keep artifacts in `docs/prds/artifacts/<name>/`.
4. Show the final PRD path.
5. List any artifact paths created.
6. Give a short summary of what it now specifies.
7. Ask the user: "PRD is ready. Should I generate the exec plan too?"
8. If the user says yes, read `PLANS.md` end to end and write the exec plan to `docs/exec-plans/active/<name>.md`.
