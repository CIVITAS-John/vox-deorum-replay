# Plan: .Civ5Save parser for the replay viewer

## Goal

Let the viewer load `.Civ5Save` files in addition to `.Civ5Replay` files, by extracting the replay
information that the save format stores (event log, per-civ stat series, civ list, game setup)
and feeding it through the existing `Replay` pipeline unchanged.

Research is complete: the save container, the replay storage inside saves, and every quirk of the
example files were verified byte-for-byte against `examples/4.Civ5Save`, `examples/4.Civ5Replay`,
and the DLL source in `vox-deorum/civ5-dll`. Nothing below is speculative.

## Established facts (verified)

### Save container

- Plain (uncompressed) region: engine header + `CvPreGame` data, ending with the 8-byte marker
  `02 00 00 00 00 00 01 00` at 0x3953 in the example.
- One single zlib stream (`78 9C`) from 0x395B to EOF. It is not chunked, has no adler32 trailer,
  and ends with a sync flush (the writer used `Z_SYNC_FLUSH`). Verified: raw-inflating the bytes
  after the 2-byte zlib header plus an appended final empty stored block
  (`01 00 00 FF FF`) yields the complete 28,375,559-byte game state in ~30ms.
- The engine header shares its front half with the replay header: `CIV5` magic, int32 (8 for saves,
  1 for replays), version, build, turn int32, 1 flag byte, 7 varstrs, DLC array, mods array. After
  `playerColor` the save diverges: 16-byte hash, `"1.0.0"` varstr, 16-byte hash, some int32s, then a
  second map-script varstr. Then `CvPreGame::write` output (slot hints v3 + archive v6) up to the
  marker. Field-for-field order documented from `CvPreGame.cpp`.
- `CvPreGame` contains everything needed for civ names: 64 slot `civilizationKeys` (e.g.
  `CIVILIZATION_ARABIA`), `minorCivTypes` (e.g. `MINOR_CIV_KABUL`), `playerColors`, `slotStatus`,
  `handicaps`, `worldInfo` (includes GridWidth 79 / GridHeight 53), `gameTurn`, `gameSpeed`,
  `calendarInfo`, game options. All self-describing (no DB-dependent counts).

### Replay data inside the decompressed game state

- The event log is `CvGame::m_listReplayMessages`, located ~0x1F95 in the example: int32 count
  (2802) then `CvReplayMessage` records: turn int32, type int32, plotCount + (int16 x, int16 y)
  pairs, player int32 (raw slot id), varstr text. Same wire format as the replay file events.
  The 2802 events match `4.Civ5Replay` 100% except civIds (raw slots vs remapped dense indices).
- Per-turn stat series are `CvPlayer::m_ReplayData`, serialized once per player slot, in slot
  order: `[datasetCount][per dataset: name varstr, entryCount, (turn u32, value i32) pairs]`.
  Three shapes occur: 29-dataset clusters for civs that played, a 1-dataset
  (`REPLAYDATASET_SCORE`) cluster for never-alive slots, and a bare `[0]` for the rare wiped case.
- Game-section prelude right at the start of the decompressed blob:
  `[saveVersion=0][16-byte hash][version varstr][...][endTurn 484][...][startYear -4000]`,
  deterministic landmark for startYear/endTurn.

### Data quirks of the example save (drive the robustness design)

- Some players' clusters contain damaged regions (impossible duplicate map keys, `FF` runs
  replacing zeros). Cause: the save was written by a session whose in-memory replay data was
  already corrupted (different session lineage than the one that wrote the replay file). The
  damage is not bit-mask recoverable: bytes are wrong, not shifted.
- Two civs (Brazil slot 3, Lutetia slot 30) have entirely wiped replay data in the save (their
  cluster is a bare `[0]`, invisible to name-based scanning). The replay file has full data for
  them, so tests must treat them as known gaps.
- Consequence for attribution: cluster ordinality is slot order, but wiped slots create gaps.
  Attribution rule (validated): clusters appear in slot order; `SCORE`-only clusters belong to
  never-alive slots; 29-dataset clusters belong to ever-alive slots; when a gap is ambiguous
  (a with-data cluster could belong to the next ever-alive slot or the one after), disambiguate
  by correlating the cluster's `CITYCOUNT`/`POPULATION` series against a trajectory predicted
  from the event log (city foundings/captures per civ). Validated: cluster 4 matches Polynesia's
  POPULATION series 229/229 while its CITYCOUNT matches 89.9% (rest is damage).
- Ever-alive civ list is exactly the set of distinct event civIds (24 in the example: slots 0-7
  and 22-37), each with a capital coordinate from its first city-founding event.
- Map terrain is NOT stored in replay format anywhere in the save; it exists only as full
  `CvPlot` serialization inside the map section (~2700 lines of schema with DB-count-dependent
  fields). Out of scope for phase 1 (see open questions).
- `endYear` ("2042 AD") is not in the save; it is derived at replay-export time.

## Architecture

New modules (plain TS, comments on every function per AGENTS.md):

- `src/core/inflate.ts`: raw-inflate helper. Takes the zlib payload, strips the 2-byte header,
  appends the final empty stored block, and inflates via the native
  `DecompressionStream('deflate-raw')` (validated to work in this environment's Node 22 and in
  all modern browsers). Returns a Promise of Uint8Array. Zero new npm dependencies.
- `src/core/save-parser.ts`: `SaveParser` orchestrating the stages below. Extends `BaseParser`
  for the uncompressed header (schema-driven like `ReplayParser`), then works over the
  decompressed buffer with `BinaryParser` primitives.
- `src/utils/civ-names.ts`: maps type strings (`CIVILIZATION_ARABIA`, `MINOR_CIV_KABUT` style,
  `LEADER_*`, `PLAYERCOLOR_*`) to display names, reusing the existing `CivColors` keys where
  possible with a title-case fallback.

Modified modules:

- `src/core/replay.ts`: `loadFromFile` sniffs the format (magic `CIV5` + int32 at offset 4:
  1 = replay, 8 = save) and routes to the right parser. Becomes async because inflation is
  async; the save path returns the same `rawData` shape the replay path produces, so
  `processRawData` is untouched.
- `src/ui/replay-viewer.ts`: accept `.Civ5Save` in the file dialog and drag-drop; await the
  async load.

## SaveParser pipeline

1. Header: parse the shared front half (game, version, build, turn, flag, 7 varstrs, dlc, mods,
   playerColor), then the save-specific tail (hashes, `1.0.0`, mapScript2). Keep unknowns as
   underscore junk fields, hidden by default like the replay parser does.
2. CvPreGame: schema walk of slot hints + archive per the DLL field order, extracting
   `civilizationKeys`, `leaderKeys`, `minorCivTypes`, `playerColors`, `slotStatus`, `handicaps`,
   `worldInfo` (map dims), `gameTurn`, `gameSpeed`, `calendarInfo`. Validation: the cursor must
   land exactly on the `02 00 00 00 00 00 01 00` marker; the test locks this.
3. Inflate the zlib payload.
4. Prelude: read saveVersion, skip the hash, read the version string, extract endTurn and
   startYear from the early int32s (landmark-validated, with the header turn as cross-check).
5. Events: scan the first ~64KB for a valid message-list header (count sanity, first records
   validate: turn small, type 0-6, plotCount sane, coordinates within map bounds), then parse
   all messages. From the events derive: the ever-alive slot list, each slot's capital, and
   per-civ city-count trajectories for cluster disambiguation.
6. Civs: dense index = rank of slot in the sorted ever-alive list; names from CvPreGame types
   via the civ-names util; colors keep working through the existing `CivColors` lookup by name.
7. Clusters: scan all `[count][len]["REPLAYDATASET_"]` candidates; accept sequentially and
   non-overlapping with a lenient parse that resynchronizes at the next dataset-name boundary
   when entry bytes fail validation (turn beyond endTurn, non-ascending, duplicate). Classify
   as with-data vs SCORE-only; assign to slots with the monotonic rule plus trajectory
   correlation for gaps. Keep valid entries, drop damaged ones, and warn via `console.warn`.
8. Assemble `rawData` in the existing replay shape: startTurn 0, startYear, endTurn, endYear
   (computed best-effort from calendar; fallback to a "Turn N" string), civs, datasets (union
   of names), datasetValues (per civ, absolute turns), events with civIds remapped to the
   dense index, mapWidth/mapHeight from worldInfo, tiles `[]`.

## Handling of what the save lacks

- Terrain: tiles stay empty in phase 1. The map still renders city markers, borders, and event
  highlights because those derive from events; the hex layer just has no terrain colors.
  Verify the hex layer degrades gracefully and patch it if it assumes tile data.
- endYear: compute from turn + calendar when straightforward, else "Turn N".

## Tests (Vitest, mirroring the style of `tests/core/replay-parser.test.ts`)

- `tests/core/save-parser.test.ts` against `examples/4.Civ5Save`:
  - header and CvPreGame fields (cursor lands on the marker; mods list, civ keys, map dims).
  - inflate: decompressed size is 28,375,559.
  - events: 2802 parsed; first two records equal the replay file's (Mecca founding etc.);
    full deep-equal against `4.Civ5Replay` events after civId remap.
  - civs: 24 entries, dense order, names match the replay file's civ list (Arabia first,
    Bratislava last).
  - clusters: attribution matches ground truth (spot-check Polynesia via series, Kabul 235,
    Ethiopia 416, Jerusalem 282); clean civs' series equal the replay file's series; Brazil
    and Lutetia are empty; damaged clusters yield partial series without throwing.
  - end-to-end: `Replay.loadFromFile` on the save buffer produces a populated `Replay`
    (events, cities, datasets, dims) with tiles empty.
- Keep all existing tests green (`npm test`).

## Decisions

- Terrain: skipped in this task. Map terrain from `CvPlot` serialization is a phase 2
  follow-up candidate (needs DB-count handling). The phase 1 map renders cities, borders, and
  event highlights without terrain colors.
- Inflation: native `DecompressionStream('deflate-raw')`, no new npm dependency. Save loading
  requires a 2022+ browser or Node 22+; replay file loading keeps its synchronous path and is
  unaffected.

## Out of scope / follow-ups

- Map terrain from `CvPlot` serialization (phase 2 candidate, needs DB-count handling).
- Supporting saves from other mod configs relies on the same self-describing formats; only
  `4.Civ5Save` is a locked test case for now.
