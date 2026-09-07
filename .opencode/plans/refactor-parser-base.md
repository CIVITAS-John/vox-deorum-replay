# Refactor: extract a general purpose parser base, add Vitest coverage

## What we know (verified by direct DataView extraction on the real files)

- The current schema in `src/core/replay-parser.ts` parses `examples/test-1.Civ5Replay` (2,637,853 bytes) to the very last byte, and the same holds for examples 1, 2, and 3. All four fully consume.
- Ground truth for example 4: game CIV5, version "1.0.3.279 (403694)", playerCiv CIVILIZATION_ARABIA, 13 DLC, 3 mods (Community Patch, Vox Populi, Vox Deorum), startTurn 0, startYear -4000, endTurn 484, endYear "2042 AD", 24 civs, 29 dataset keys, 2802 events, map 79x53 with 4187 tiles, junk bytes `_1` = e4 01 00 00 01 and `_4` = 06 00 00 00.
- The mysterious `_5` heuristic is now understood: it scans misaligned int32s until it sees the start year byte-shifted (found -1024000, which is -4000 shifted one byte), then rewinds 7 bytes to land exactly on startTurn. Behavior stays identical, only the code gets cleaner.
- A native `DataView` implementation reproduces jDataView semantics exactly, including latin1 string decoding (the event-parser mojibake fix depends on it, so we must NOT use UTF-8 TextDecoder).
- Baseline `npx tsc --noEmit` currently passes (exit 0).

## Architecture: three layers

1. `src/core/binary-parser.ts`: `BinaryParser` becomes a pure binary reader over native `DataView`.
   - Drops the jDataView global and the lodash `_.each` global dependency.
   - Keeps the same public surface and error messages: tell, seek, getBytes, getString (latin1, fromCharCode per byte), getInt32, getInt16, getInt8, getUntil, getVarString, decToHex.
   - Bounds-checked reads that throw the same "Unable to read N bytes at position X" errors.

2. `src/core/base-parser.ts` (new): `BaseParser`, the general purpose, format-agnostic parser base.
   - Abstract class owning a `BinaryParser` and an abstract `fileConfig`.
   - The schema engine moves here from the old BinaryParser: parseItem, parseItems, getArray, junk filtering (underscore-prefixed keys are parsed but dropped unless includeJunk), and the parse-failure diagnostics (seek back, log the error plus the next 200 bytes).
   - Delegates read primitives (getInt32, seek, tell, decToHex, and friends) so schema functions written as `function (this: BaseParser)` keep today's ergonomics.
   - Public `parse(includeJunk = false)` plus `tell()` so callers can assert full file consumption.
   - The replay-specific `key === "events"` debug log is dropped; it does not belong in a general base.

3. `src/core/replay-parser.ts`: `ReplayParser extends BaseParser`.
   - Keeps `DEFAULT_FILE_CONFIG` (the Civ5 replay schema) and `static getDefaultFileConfig()`.
   - Constructor signature unchanged: `(file: ArrayBuffer, size: number, fileConfig?)`. `Replay.loadFromFile` needs no changes.
   - The `_5` heuristic stays, now typed `function (this: BaseParser)` and using `this.seek(this.tell() - 7)` instead of the `(this.view as any).seek(...)` hack. Comments preserved.
   - Later, `SavegameParser extends BaseParser` will only need to supply the save schema.

## Types cleanup

- `FileConfig`, `FileConfigItem`, `FileConfigArray` move from `replay.types.ts` to `parser.types.ts` (they describe the general parser, not replay data). `types/index.ts` keeps re-exporting everything, so existing `import { FileConfig } from '../types'` keeps working.

## Dead code removal

- jDataView declarations removed from `src/globals.d.ts` and `src/types/globals.d.ts`.
- `<script src="./vendor/jdataview.js">` tag removed from `index.html` (nothing references it anymore). The vendor file itself stays on disk.

## Logging (per user decision)

- Keep `console.log` / `console.error` as-is in the refactored parser code. No winston.
- AGENTS.md gets updated to match the repo instead:
  - The "Winston logger only" rule becomes: console logging is fine in this browser-bundled app.
  - The "ESM everywhere" rule becomes: extensionless relative imports, Rollup IIFE bundle for the browser, Vitest resolves TypeScript imports (no `"type": "module"`, no `.js` import extensions).
  - The npm workspaces line (`build:all` / `test:all`) is corrected to this single-package repo's real commands (`npm install` from repo root, `npm run build`, `npm test`).

## Testing (Vitest)

- `npm install -D vitest @types/node` from the repo root. No vitest config file needed (defaults: node environment, `**/*.test.ts` discovery).
- `package.json` scripts: `"test": "vitest run"`, `"test:watch": "vitest"`.
- Tests live in a top-level `tests/` directory (outside the app's `src/`, so the Rollup bundle is untouched):
  - `tests/core/binary-parser.test.ts`: synthetic buffers pinning little-endian reads, tell/seek, varstr, latin1 decoding of high bytes (the mojibake contract), getUntil, and the bounds error.
  - `tests/core/base-parser.test.ts`: a tiny `TestParser extends BaseParser` with a custom schema (str, int32, varstr, nested arrays, a function item using `this.seek`/`this.getInt32`, junk filtering both ways) proves the base is genuinely general purpose and ready for the savegame parser.
  - `tests/core/replay-parser.test.ts`: the real-file regression test using `examples/test-1.Civ5Replay` (parsed once in beforeAll):
    - Header and metadata: CIV5, version, build, playerCiv, difficulty, eras, speed, world size.
    - 13 DLC entries, 3 mods with names Community Patch, Vox Populi, Vox Deorum.
    - startTurn 0, startYear -4000, endTurn 484, endYear "2042 AD".
    - 24 civs, civs[0] is Arabia led by Harun al-Rashid.
    - 29 dataset keys, datasetValues shaped [24][29].
    - 2802 events; first event is turn 0, type 2 (TilesClaimed), 7 tiles, civId 0; last event is the turn 484 cultural victory message.
    - Map 79x53, 4187 tiles.
    - Junk filtering: default output has no underscore keys; `parse(true)` exposes them with the exact junk bytes above.
    - Full consumption: `parser.tell() === 2637853`.
    - Smoke coverage: examples 1, 2, 3 also parse fully (CIV5 header, tiles equal width times height, final offset equals file size).

## Verification

- `npx tsc --noEmit` stays green.
- `npm test` passes the new suite.
- `npm run build` still produces the browser bundle (behavior unchanged for the viewer).

## Out of scope

- The savegame parser itself (next change; `test-1.Civ5Save` is already in examples for it).
- Converting UI/map files to any new conventions, touching vendor files beyond the script tag, staging anything in git.

## Delegation note

Only read-only `explore` subagents are available in this environment, so the code edits are done directly. The up-front exploration (schema ground truth on all four example files, baseline tsc check) was already completed inline during planning.
