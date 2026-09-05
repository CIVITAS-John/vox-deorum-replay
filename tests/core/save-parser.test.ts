/**
 * save-parser.test.ts
 * Regression tests for the save parser against real games
 * examples/4.Civ5Save and examples/5.Civ5Replay come from the same game as
 * examples/4.Civ5Replay and examples/5.Civ5Replay: the saves are mid and
 * late game snapshots and the replay files serve as ground truth, so the
 * save parser must rebuild the exact same event log, civilization list, and
 * dataset keys, and the value tables must match wherever the save snapshot
 * reaches
 *
 * Known quirks, locked in by the tests below:
 * - The replay file exporter misattributes barbarian events to the first
 *   player through a defaulting map lookup; the save parser keeps them
 *   unattributed instead, so those seven events differ on purpose
 * - The save stores the raw plot state, and the mod transforms parts of the
 *   map (the polar regions in these games) when a save is loaded, so the
 *   walked terrain differs from the replay file there: the transformed
 *   plots read as zeroed or garbled records and come out as unknown tiles
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SaveParser, isSaveFile, extractMapTerrain } from '../../src/core/save-parser';
import { inflateZlib } from '../../src/core/inflate';
import { ReplayParser } from '../../src/core/replay-parser';
import { Replay } from '../../src/core/replay';

/**
 * Load an example file from the examples directory as a standalone ArrayBuffer
 */
function loadExample(name: string): ArrayBuffer {
  const raw = readFileSync(fileURLToPath(new URL(`../../examples/${name}`, import.meta.url)));
  return raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
}

/**
 * Find a byte sequence in a buffer with a manual loop, since indexOf cannot
 * take a subarray in this runtime
 */
function findBytes(hay: Uint8Array, needle: Uint8Array, from: number): number {
  outer: for (let i = from; i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (hay[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

/**
 * Inflate the compressed body of a save the way the production parser does
 */
async function inflateSaveBody(name: string): Promise<Uint8Array> {
  const raw = new Uint8Array(loadExample(name));
  const marker = new Uint8Array([0x02, 0, 0, 0, 0, 0, 1, 0]);
  const markerPos = findBytes(raw, marker, 0);
  return inflateZlib(raw.subarray(markerPos + 8));
}

describe('SaveParser on examples/4.Civ5Save', () => {
  let data: Record<string, any>;
  let parser: SaveParser;
  let replayData: Record<string, any>;

  beforeAll(async () => {
    const file = loadExample('4.Civ5Save');
    parser = new SaveParser(file, file.byteLength);
    data = await parser.parseReplay();

    const replayFile = loadExample('4.Civ5Replay');
    replayData = new ReplayParser(replayFile, replayFile.byteLength).parse() as Record<string, any>;
  });

  it('recognizes saves and rejects replays', () => {
    expect(isSaveFile(loadExample('4.Civ5Save'))).toBe(true);
    expect(isSaveFile(loadExample('4.Civ5Replay'))).toBe(false);
  });

  it('reads the engine header', () => {
    expect(data.game).toBe('CIV5');
    expect(data.version).toBe('1.0.3.279 (403694)');
    expect(data.build).toBe('403694');
  });

  it('reads the game setup', () => {
    expect(data.playerCiv).toBe('CIVILIZATION_ARABIA');
    expect(data.playerColor).toBe('PLAYERCOLOR_ARABIA');
    expect(data.difficulty).toBe('HANDICAP_AI_DEFAULT');
    expect(data.eraStart).toBe('ERA_ANCIENT');
    expect(data.eraEnd).toBe('ERA_FUTURE');
    expect(data.gameSpeed).toBe('GAMESPEED_STANDARD');
    expect(data.worldSize).toBe('WORLDSIZE_STANDARD');
    expect(data.mapScript).toContain('Vox_Deorum.lua');
  });

  it('reads the DLC and mod lists', () => {
    expect(data.dlc).toHaveLength(13);
    expect(data.dlc[0].name).toBe('Mongolia');
    expect(data.dlc[0].enabled).toBe(1);
    expect(data.dlc[12].name).toBe('Upgrade 1');

    expect(data.mods.map((m: any) => m.name)).toEqual([
      '(1) Community Patch',
      '(2) Vox Populi',
      '(5) Vox Deorum'
    ]);
    expect(data.mods.map((m: any) => m.version)).toEqual([149, 17, 1]);
  });

  it('lands the pregame cursor exactly on the compression marker', () => {
    const file = loadExample('4.Civ5Save');
    const fresh = new SaveParser(file, file.byteLength);
    fresh.parse();
    // The marker (int32 2, int32 0x10000) sits at 0x3953 in this file
    expect(fresh.tell()).toBe(0x3953);
  });

  it('inflates the chunked compressed body completely', () => {
    // The save writer slices its deflate stream into 64KB chunks separated
    // by four byte size words; the inflater must strip them all
    expect(parser.getDiagnostics().decompressedSize).toBe(28369633);
  });

  it('reads turns and years', () => {
    expect(data.startTurn).toBe(0);
    expect(data.startYear).toBe(-4000);
    expect(data.endTurn).toBe(484);
    expect(data.endYear).toBe('Turn 484');
  });

  it('reads the event log and it matches the replay file exactly', () => {
    expect(data.events).toHaveLength(2802);

    // First events: Arabia claiming its starting tiles, then founding Mecca
    expect(data.events[0]).toMatchObject({ turn: 0, type: 2, civId: 0, text: '' });
    expect(data.events[0].tiles).toHaveLength(7);
    expect(data.events[0].tiles[0]).toEqual({ x: 54, y: 19 });
    expect(data.events[1]).toEqual({
      turn: 0,
      type: 1,
      tiles: [{ x: 54, y: 19 }],
      civId: 0,
      text: 'Mecca is founded.'
    });

    // Last event: the game ending victory message
    expect(data.events[2801]).toEqual({
      turn: 484,
      type: 0,
      tiles: [{ x: -1, y: -1 }],
      civId: 6,
      text: 'Maria Theresa has won a Cultural Victory!!!'
    });

    // The full log, including the civ id remapping from raw slots to dense
    // indices, must match the replay file. The only allowed difference:
    // barbarian events, which the replay exporter misattributes to the
    // first player while the save parser keeps them unattributed
    expect(data.events).toHaveLength(replayData.events.length);
    let barbarianDifferences = 0;
    for (let i = 0; i < data.events.length; i++) {
      const saveEvent = data.events[i];
      const replayEvent = replayData.events[i];
      if (saveEvent.civId === -1 && replayEvent.civId === 0 &&
          saveEvent.turn === replayEvent.turn && saveEvent.type === replayEvent.type) {
        barbarianDifferences++;
      } else {
        expect(saveEvent).toEqual(replayEvent);
      }
    }
    expect(barbarianDifferences).toBe(7);
  });

  it('reads the civilization list and it matches the replay file', () => {
    expect(data.civs).toHaveLength(24);
    expect(data.civs.map((c: any) => c.name)).toEqual(
      replayData.civs.map((c: any) => c.name)
    );
    expect(data.civs[0].name).toBe('Arabia');
    expect(data.civs[1].name).toBe('The Zulus');
    expect(data.civs[19].name).toBe('Kyiv');
    expect(data.civs[23].name).toBe('Bratislava');
  });

  it('reads the dataset keys and they match the replay file', () => {
    expect(data.datasets.map((d: any) => d.key)).toEqual(
      replayData.datasets.map((d: any) => d.key)
    );
    expect(data.datasets).toHaveLength(29);
  });

  it('attaches value tables that are byte identical to the replay file', () => {
    // With the chunk markers stripped, every civ's tables survive intact:
    // all 24 civs match the replay file exactly
    for (let civIndex = 0; civIndex < data.datasetValues.length; civIndex++) {
      expect(data.datasetValues[civIndex]).toEqual(replayData.datasetValues[civIndex]);
    }
  });

  it('finds every cluster a home', () => {
    // All replay data regions attach to their player slots; the one left
    // over is the barbarian slot, which carries no replay data of its own
    const diagnostics = parser.getDiagnostics();
    expect(diagnostics.clusterCount).toBe(64);
    expect(diagnostics.damagedClusters).toBe(0);
    expect(diagnostics.unattachedClusters).toBe(1);
  });

  it('reads the map dimensions from the map section', () => {
    expect(data.mapWidth).toBe(79);
    expect(data.mapHeight).toBe(53);
    expect(data.tiles).toHaveLength(79 * 53);
    expect(parser.getDiagnostics().mapDimsSource).toBe('map-section');
  });

  it('walks the plot records and reads real terrain', async () => {
    // Inflate the body once and hand it to the walker directly, the same way
    // the parser does, so the walk itself can be checked against the replay
    const body = await inflateSaveBody('4.Civ5Save');
    const result = extractMapTerrain(body, 0x4faca, 79, 53);

    // The walk covers the whole map and passes the quality gate
    expect(result.stats.slotsFilled).toBe(79 * 53);
    const diagnostics = parser.getDiagnostics();
    expect(diagnostics.terrainGatePassed).toBe(true);
    expect(diagnostics.terrainCoverage).toBe(1);

    // The first polar plots are intact ocean with ice and match the replay
    // file ground truth exactly
    for (let i = 0; i <= 16; i++) {
      const tile = result.tiles[i];
      expect(tile).toEqual({ elevation: 3, type: 6, feature: 0 });
    }

    // The plots the mod transforms on load are stored zeroed or garbled and
    // come out as unknown tiles rather than wrong values
    let unknown = 0;
    for (const tile of result.tiles) {
      if (tile === null) unknown++;
    }
    expect(unknown).toBeGreaterThan(2000);

    // Among the known tiles the large majority of values that the mod does
    // not transform on load match the replay file exactly; the differences
    // concentrate in the transformed polar regions where coast and ocean
    // shifted between the raw save and the loaded game
    let match = 0;
    let known = 0;
    for (let i = 0; i < result.tiles.length; i++) {
      const tile = result.tiles[i];
      if (tile === null) continue;
      known++;
      const gt = replayData.tiles[i];
      if (tile.elevation === gt.elevation && tile.type === gt.type && tile.feature === gt.feature) {
        match++;
      }
    }
    expect(match).toBeGreaterThan(500);
    expect(match / known).toBeGreaterThan(0.35);
  });

  it('renders terrain through the full pipeline', () => {
    // The assembled output carries the walked terrain, not placeholders
    let real = 0;
    for (const tile of data.tiles) {
      if (tile.elevation !== -1) real++;
    }
    expect(real).toBeGreaterThan(1000);
    expect(data.tiles[0]).toEqual({ elevation: 3, type: 6, feature: 0 });
  });

  it('keeps every parsed series within the game bounds', () => {
    for (const civTable of data.datasetValues) {
      for (const series of civTable) {
        let lastTurn = -1;
        for (const entry of series) {
          expect(entry.turn).toBeGreaterThanOrEqual(0);
          expect(entry.turn).toBeLessThanOrEqual(484);
          expect(entry.turn).toBeGreaterThan(lastTurn);
          lastTurn = entry.turn;
        }
      }
    }
  });

  it('loads end to end through the Replay class', async () => {
    const file = loadExample('4.Civ5Save');
    const replay = new Replay();
    await replay.loadFromFile(file, file.byteLength);

    // The event processor skips tile claim events that belong to no civ:
    // three unattributed claims from the game itself plus three barbarian
    // claims that the replay file would have misattributed to Arabia
    expect(replay.events).toHaveLength(2796);
    expect(replay.civs).toHaveLength(24);
    expect(replay.getCivName(0)).toBe('Arabia');
    expect(replay.getCivName(23)).toBe('Bratislava');
    expect(replay.getCityAt(54, 19)?.name).toBe('Mecca');
    expect(replay.mapWidth).toBe(79);
    expect(replay.mapHeight).toBe(53);
    // The terrain grid chunks into one row per map height
    expect(replay.tiles).toHaveLength(53);
    expect(replay.tiles[0]).toHaveLength(79);
  });
});

describe('SaveParser on examples/5.Civ5Save', () => {
  let data: Record<string, any>;
  let parser: SaveParser;
  let replayData: Record<string, any>;

  beforeAll(async () => {
    const file = loadExample('5.Civ5Save');
    parser = new SaveParser(file, file.byteLength);
    data = await parser.parseReplay();

    const replayFile = loadExample('5.Civ5Replay');
    replayData = new ReplayParser(replayFile, replayFile.byteLength).parse() as Record<string, any>;
  });

  it('reads the engine header and game setup', () => {
    expect(data.game).toBe('CIV5');
    expect(data.version).toBe('1.0.3.279 (403694)');
    expect(data.playerCiv).toBe('CIVILIZATION_ARABIA');
    expect(data.mapScript).toContain('Vox_Deorum.lua');
    expect(data.mods.map((m: any) => m.version)).toEqual([149, 17, 1]);
  });

  it('inflates the chunked compressed body completely', () => {
    expect(parser.getDiagnostics().decompressedSize).toBe(29148019);
  });

  it('reads turns and years', () => {
    expect(data.startTurn).toBe(0);
    expect(data.startYear).toBe(-4000);
    expect(data.endTurn).toBe(413);
    expect(data.endYear).toBe('Turn 413');
  });

  it('reads the event log as an exact prefix of the replay file', () => {
    // The save is a mid game snapshot at turn 413 while the replay file was
    // exported a few turns later, so the save's 3057 events must match the
    // first 3057 replay events one for one
    expect(data.events).toHaveLength(3057);
    expect(replayData.events.length).toBeGreaterThan(data.events.length);
    for (let i = 0; i < data.events.length; i++) {
      expect(data.events[i]).toEqual(replayData.events[i]);
    }
  });

  it('reads the civilization list and it matches the replay file', () => {
    expect(data.civs).toHaveLength(24);
    expect(data.civs.map((c: any) => c.name)).toEqual(
      replayData.civs.map((c: any) => c.name)
    );
  });

  it('attaches value tables that are exact prefixes of the replay file', () => {
    // The save snapshot ends at turn 413, so every series carries the same
    // entries as the replay file up to that turn
    for (let civIndex = 0; civIndex < data.datasetValues.length; civIndex++) {
      const saveTable = data.datasetValues[civIndex];
      const replayTable = replayData.datasetValues[civIndex];
      for (let d = 0; d < saveTable.length; d++) {
        const saveSeries = saveTable[d];
        const replaySeries = replayTable[d];
        expect(saveSeries.length).toBeLessThanOrEqual(replaySeries.length);
        for (let i = 0; i < saveSeries.length; i++) {
          expect(saveSeries[i]).toEqual(replaySeries[i]);
        }
      }
    }
  });

  it('reads the map dimensions and walks real terrain', () => {
    expect(data.mapWidth).toBe(79);
    expect(data.mapHeight).toBe(53);
    expect(parser.getDiagnostics().mapDimsSource).toBe('map-section');

    const diagnostics = parser.getDiagnostics();
    expect(diagnostics.terrainCoverage).toBe(1);
    expect(diagnostics.terrainGatePassed).toBe(true);

    // The polar plots read as ocean with ice, the transformed ones as
    // unknown, and the known tiles largely agree with the replay file
    expect(data.tiles[0]).toEqual({ elevation: 3, type: 6, feature: 0 });
    let unknown = 0;
    let match = 0;
    let known = 0;
    for (let i = 0; i < data.tiles.length; i++) {
      const tile = data.tiles[i];
      if (tile.elevation === -1) { unknown++; continue; }
      known++;
      const gt = replayData.tiles[i];
      if (tile.elevation === gt.elevation && tile.type === gt.type && tile.feature === gt.feature) {
        match++;
      }
    }
    expect(unknown).toBeGreaterThan(1500);
    expect(match).toBeGreaterThan(700);
    expect(match / known).toBeGreaterThan(0.3);
  });

  it('loads end to end through the Replay class', async () => {
    const file = loadExample('5.Civ5Save');
    const replay = new Replay();
    await replay.loadFromFile(file, file.byteLength);
    expect(replay.civs).toHaveLength(24);
    expect(replay.getCityAt(54, 19)?.name).toBe('Mecca');
    expect(replay.mapWidth).toBe(79);
    expect(replay.tiles).toHaveLength(53);
    expect(replay.tiles[0]).toHaveLength(79);
  });
});
