# OpenClaw Codebase Patterns

**Always reuse existing code - no redundancy!**

## Workspace Boundary

- **Project root**: `/home/aeneas/code/openclaw` — this is the ONLY directory you should read, write, or modify.
- **Do NOT** touch any files or directories outside the project root unless the user explicitly asks.
- **Do NOT** create, edit, or reference paths under `~/`, `/home/aeneas/code/openclaw-voice`, `/home/aeneas/.openclaw`, or any other external location.

## Local Configuration (`.openclaw/`)

The `.openclaw/` folder lives **inside** the project root and contains all OpenClaw gateway configuration, workspace files, and agent state. Key points:

- **Config**: `.openclaw/openclaw.json` — main gateway config (API keys, providers, hooks, etc.). **Gitignored** — never committed.
- **Template**: `.openclaw/openclaw.json.template` — redacted copy safe to commit (secrets replaced with `<REDACTED>`).
- **Workspace**: `.openclaw/workspace/` — agent memory files (`MEMORY.md`, `memory/*.md`, `SOUL.md`, `AGENTS.md`, etc.). These **are** committed.
- **Sensitive dirs** (all gitignored): `identity/`, `devices/`, `agents/*/sessions/`, `agents/*/agent/auth-profiles.json`, `logs/`, `cron/`.
- **Docker**: `docker-compose.yml` mounts `.openclaw/` via `OPENCLAW_CONFIG_DIR` and `OPENCLAW_WORKSPACE_DIR` set in `.env`.
- **`.env`** is gitignored and contains `OPENCLAW_CONFIG_DIR=/home/aeneas/code/openclaw/.openclaw` and `OPENCLAW_WORKSPACE_DIR=/home/aeneas/code/openclaw/.openclaw/workspace`.

When editing OpenClaw configuration, edit `.openclaw/openclaw.json` directly (or use `openclaw config set`). When updating the template, re-run the redaction or edit `.openclaw/openclaw.json.template` manually.

## Tech Stack

- **Runtime**: Node 22+ (Bun also supported for dev/scripts)
- **Language**: TypeScript (ESM, strict mode)
- **Package Manager**: pnpm (keep `pnpm-lock.yaml` in sync)
- **Lint/Format**: Oxlint, Oxfmt (`pnpm check`)
- **Tests**: Vitest with V8 coverage
- **CLI Framework**: Commander + clack/prompts
- **Build**: tsdown (outputs to `dist/`)

## Anti-Redundancy Rules

- Avoid files that just re-export from another file. Import directly from the original source.
- If a function already exists, import it - do NOT create a duplicate in another file.
- Before creating any formatter, utility, or helper, search for existing implementations first.

## Source of Truth Locations

### Formatting Utilities (`src/infra/`)

- **Time formatting**: `src\infra\format-time`

**NEVER create local `formatAge`, `formatDuration`, `formatElapsedTime` functions - import from centralized modules.**

### Terminal Output (`src/terminal/`)

- Tables: `src/terminal/table.ts` (`renderTable`)
- Themes/colors: `src/terminal/theme.ts` (`theme.success`, `theme.muted`, etc.)
- Progress: `src/cli/progress.ts` (spinners, progress bars)

### CLI Patterns

- CLI option wiring: `src/cli/`
- Commands: `src/commands/`
- Dependency injection via `createDefaultDeps`

## Import Conventions

- Use `.js` extension for cross-package imports (ESM)
- Direct imports only - no re-export wrapper files
- Types: `import type { X }` for type-only imports

## Code Quality

- TypeScript (ESM), strict typing, avoid `any`
- Keep files under ~700 LOC - extract helpers when larger
- Colocated tests: `*.test.ts` next to source files
- Run `pnpm check` before commits (lint + format)
- Run `pnpm tsgo` for type checking

## Stack & Commands

- **Package manager**: pnpm (`pnpm install`)
- **Dev**: `pnpm openclaw ...` or `pnpm dev`
- **Type-check**: `pnpm tsgo`
- **Lint/format**: `pnpm check`
- **Tests**: `pnpm test`
- **Build**: `pnpm build`

If you are coding together with a human, do NOT use scripts/committer, but git directly and run the above commands manually to ensure quality.
