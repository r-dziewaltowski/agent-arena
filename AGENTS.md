<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## How this project is run

At the start of each session, whatever the request, read `docs/plan.md`: it holds the decisions,
domain rules, current milestone and known gotchas, and is self-contained.

This project was built with the app-builder skill, a personal Claude Code skill that may not be
installed on every machine. If it is, also read the skill's stack notes that the plan lists under
"How we work"; if it isn't, skip them.
