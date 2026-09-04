# AGENTS.md

NEVER STAGE YOUR CHANGES UNLESS EXPLICITLY ASKED! However, if a change gets externally staged, it is from the human reviewer.

## Use Subagents Whenever Appropriate

ALWAYS delegate less critical/lower-level BATCH work to subagents with less capabilities, e.g., from Claude Fable to Sonnet/Haiku, or from GPT Sol to Terra (reviewing/implementing)/Luna (exploring/batch editing). Report which model you used to spawn that agent in response text. Such work may involve exploring repo structure, finding references, summarizing information, or conducting less sophisticated edits in batches.

## Workflow Rules

- Delegate to sub-agents for complex or multi-step features, and include the tool-calling rules in the prompt.
- Don't present action plans until requested, and don't change test scripts unless asked.

## Writing Style

Write everything in natural language: docs, code comments, commit messages, release notes, console output, and the AGENTS.md files themselves. Keep the prose plain and easy to follow. Bullets, subbullets, mermaid diagrams, and tables are encouraged wherever they make the content easier to understand. Do not use em-dashes anywhere. Reach for a colon, a comma, parentheses, or two separate sentences instead. Every agent working in this repo must follow this rule.

When editing documentation, plans, prioritize coherent rewriting over surgical edits. Readability is a paramount concern. Do not produce layered writings (e.g., instead of X we chose to do Y) that document revision histories, unless explicitly instructed to do so. Use comparisons only (e.g., it is not Y, it is X) when the reader needs the distinction to make a decision.

## Code Rules

- Prioritize simplification and streamlining more than complicating things or adding unnecessary guardrails.
- Plain TypeScript imports: use extensionless relative import paths. The app is bundled by Rollup into an IIFE for the browser, and Vitest resolves TypeScript imports at test time, so there is no `"type": "module"` and no `.js` import extensions.
- Single package: run `npm install <pkg>` from the repo root. Use `npm run build` for the browser bundle, `npm test` for the Vitest suite, and `npm run test:watch` while developing.
- Vitest for all TypeScript testing.
- Use `console.log` and `console.error` for logging: this is a browser-bundled app with no logger dependency, and the same applies to tests.
- camelCase for exported constants (for example, `export const apiKeyFields`).
- Comment everywhere: every function, at least, needs a comment.

## Documentation Rules

Documentation is centralized in `/docs/` and serves two audiences: players (how to use) and developers (what the repo does and how its pieces fit).

- Update docs in the same change that alters behavior, configuration, or setup, and never create docs proactively.
- Keep the detail light. Avoid raw code in docs; describe the behavior and name the source file instead.
- No line-number anchors. They drift, so refer to files, functions, or concepts by name.