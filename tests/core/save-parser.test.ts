/**
 * save-parser.test.ts
 * Regression tests for the save parser against a real game
 * examples/4.Civ5Save and examples/4.Civ5Replay come from the same game, so
 * the replay file serves as ground truth: the save parser must rebuild the
 * exact same event log, civilization list, and dataset keys, and the value
 * tables must match wherever the save data survived intact
 *
 * Known quirks of this particular save, locked in by the tests below:
 * - China, Ban Chiang, and Zurich lost their replay data in the saving
 *   session, so their tables come out empty
 * - Several civs (Arabia among them) carry values corrupted in memory in
 *   the saving session, so their tables come out partial: valid entries
 *   only, never repaired guesses
 * - Polynesia's table was truncated at turn 228 in the saving session, and
 *   the parser must still attribute it to Polynesia rather than Brazil
 * - The replay file exporter misattributes barbarian events to the first
 *   player through a defaulting map lookup; the save parser keeps them
 *   unattributed instead, so those seven events differ on purpose
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SaveParser, isSaveFile } from '../../src/core/save-parser';
import { ReplayParser } from '../../src/core/replay-parser';
import { Replay } from '../../src/core/replay';

/**
 * Load an example file from the examples directory as a standalone ArrayBuffer
 */
function loadExample(name: string): ArrayBuffer {
  const raw = readFileSync(fileURLToPath(new URL(`../../examples/${name}`, import.meta.url)));
  return raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
}

// Civ indices (dense, ever alive order) whose save side tables are known to
// be fully intact and byte identical to the replay file
const CLEAN_CIVS = [8, 9, 11, 12, 13, 17, 18, 19, 20, 21, 23];

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

  it('inflates the compressed body completely', () => {
    expect(parser.getDiagnostics().decompressedSize).toBe(28375559);
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

  it('attaches value tables that are byte identical for intact civs', () => {
    for (const civIndex of CLEAN_CIVS) {
      expect(data.datasetValues[civIndex]).toEqual(replayData.datasetValues[civIndex]);
    }
  });

  it('leaves wiped civs empty', () => {
    // China, Ban Chiang, and Zurich lost their replay data in the saving
    // session (Zurich's region is present but unrecoverable)
    for (const civIndex of [2, 15, 22]) {
      for (const series of data.datasetValues[civIndex]) {
        expect(series).toEqual([]);
      }
    }
  });

  it('degrades corrupted civs to partial but valid data', () => {
    // Arabia's replay data was corrupted in memory in the saving session.
    // Entries that became structurally impossible are dropped, so the
    // building maintenance series survives only partially, and the few
    // corrupted values that landed on plausible turns remain: without the
    // ground truth they are indistinguishable from real ones
    const saveSeries = data.datasetValues[0][0];
    const replaySeries = replayData.datasetValues[0][0];
    expect(saveSeries.length).toBeGreaterThan(0);
    expect(saveSeries.length).toBeLessThan(replaySeries.length);

    // Turns stay strictly ascending and in bounds, and the large majority
    // of surviving values match the replay file
    const replayByTurn = new Map(replaySeries.map((e: any) => [e.turn, e.value]));
    let lastTurn = -1;
    let matches = 0;
    for (const entry of saveSeries) {
      expect(entry.turn).toBeGreaterThan(lastTurn);
      expect(entry.turn).toBeLessThanOrEqual(484);
      lastTurn = entry.turn;
      if (replayByTurn.get(entry.turn) === entry.value) matches++;
    }
    expect(matches / saveSeries.length).toBeGreaterThan(0.75);
  });

  it('attributes truncated clusters by their content', () => {
    // Polynesia's table stops at turn 228 in the save. The attribution must
    // still pick Polynesia over the wiped China slot, and every surviving
    // population entry must match the replay file
    const popIndex = data.datasets.findIndex((d: any) => d.key === 'REPLAYDATASET_POPULATION');
    const savePop = data.datasetValues[4][popIndex];
    const replayPop = replayData.datasetValues[4][popIndex];

    expect(savePop.length).toBeGreaterThan(0);
    expect(savePop.length).toBeLessThan(replayPop.length);
    for (let i = 0; i < savePop.length; i++) {
      expect(savePop[i]).toEqual(replayPop[i]);
    }
  });

  it('attributes partially corrupted clusters by their content', () => {
    // Lutetia's table survived with heavy value corruption in the saving
    // session, and the attribution must pick Lutetia over the wiped Ban
    // Chiang slot. The majority of the building maintenance entries must
    // still match the replay file
    const bmIndex = data.datasets.findIndex((d: any) => d.key === 'REPLAYDATASET_BUILDINGMAINTENANCE');
    const saveSeries = data.datasetValues[16][bmIndex];
    const replaySeries = replayData.datasetValues[16][bmIndex];

    expect(saveSeries.length).toBeGreaterThan(0);
    const replayByTurn = new Map(replaySeries.map((e: any) => [e.turn, e.value]));
    let matches = 0;
    for (const entry of saveSeries) {
      if (replayByTurn.get(entry.turn) === entry.value) matches++;
    }
    expect(matches / saveSeries.length).toBeGreaterThan(0.8);
  });

  it('reads the map dimensions and fills the placeholder grid', () => {
    expect(data.mapWidth).toBe(79);
    expect(data.mapHeight).toBe(53);
    expect(data.tiles).toHaveLength(79 * 53);
    expect(data.tiles[0]).toEqual({ elevation: -1, type: -1, feature: -1 });
    expect(parser.getDiagnostics().mapDimsSource).toBe('map-section');
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
    // The placeholder grid chunks into one row per map height
    expect(replay.tiles).toHaveLength(53);
    expect(replay.tiles[0]).toHaveLength(79);
  });
});
