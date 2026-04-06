# Repository Guidelines

## Project AGENTS.md

## Execution Bias

- For explicit build requests, complete the full obvious sequence end-to-end without pausing for confirmation.
- Treat closely related follow-through work as included when it is safe and reversible: implementation, asset generation, validation, commits, and pushes that the user has already implied or previously requested.
- Default to fixing the next clear blocker instead of stopping to report partial progress.
- Only stop to ask when a choice is materially risky, destructive, or genuinely ambiguous.

## Proactivity

- If a request implies adjacent maintenance needed for the result to actually work, do it in the same turn.
- When a workflow has a robust long-term version and a temporary fallback, prefer finishing the robust path instead of leaving the fallback as the main path.
- If a command fails because of a clear environmental issue that can be worked around safely, apply the workaround and continue.

## Validation

- After non-trivial changes, run the narrowest useful checks first, then broader smoke checks for the changed flow.
- Do not claim completion while a known fallback is still being used for the requested feature if the real implementation is feasible in the current environment.

## Project Structure & Module Organization
This is a Vite + TypeScript browser game project. Source files live in `src/`, with game logic grouped under `src/game/`:
- `src/game/MoonGame.ts` initializes rendering, controls, HUD, and the game loop.
- `src/game/terrain/` handles terrain loading, tiling, and streaming.
- `src/game/systems/` contains gameplay systems such as mission and input.
- `src/game/ui/` owns HUD bindings and UI update logic.
- `scripts/terrain/` contains the data baking pipeline.
- `public/data/` stores baked terrain and mission assets loaded at runtime.
- `dist/` is build output (do not edit manually).

## Build, Test, and Development Commands
- `npm install` — install dependencies.
- `npm run dev` — start the Vite dev server with hot reload.
- `npm run check` — run TypeScript compile checks (`tsc --noEmit`) against `src`.
- `npm run build` — production compile + Vite bundle into `dist/`.
- `npm run preview` — serve the production build locally.
- `npm run terrain:bake` — regenerate Tycho terrain/mission assets from `scripts/terrain/bake-site.mjs`.

## Coding Style & Naming Conventions
- TypeScript uses strict checks (`noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`). Keep code free of dead variables/imports.
- Use 2-space indentation, semicolons, and single quotes.
- Prefer `camelCase` for variables/functions, `PascalCase` for classes/types/interfaces, and constants in `UPPER_SNAKE_CASE` when truly global.
- Keep modules focused; place shared utilities in existing feature folders rather than creating new layers.

## Testing Guidelines
- There is no dedicated test suite in this repository yet.
- At minimum, run `npm run check` before PRs and validate gameplay in `npm run dev`.
- If you add tests, use names like `<name>.test.ts` or `<name>.spec.ts` and colocate near the owning module or add a `tests/` folder.

## Commit & Pull Request Guidelines
Recent commits use conventional commit prefixes (`feat:`, `chore:`). Continue this pattern, e.g. `feat: add rover battery depletion clamp`.
- PR descriptions should include behavior change summary, files changed, and validation steps.
- For terrain, mission, or rendering changes, include a short screenshot/video and any manual verification steps.
- When touching runtime data, explicitly list affected files under `public/data/tycho/`.

## Data & External Dependencies Notes
- `npm run terrain:bake` requires `opj_decompress` (OpenJPEG) and network access to the remote PDS terrain source URL.
- Keep generated artifacts in `public/data/tycho/`; ignore local cache/temp artifacts such as `.cache/` and `node_modules/`.
