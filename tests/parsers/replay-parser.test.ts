/**
 * replay-parser.test.ts
 * Regression tests for the replay parser against real game files
 * examples/test-1.Civ5Replay is the detailed case: every assertion below is ground
 * truth extracted from the actual bytes of that exact file, so any parser
 * regression or accidental schema change trips a concrete failure
 */

import { describe, it, expect, beforeAll, afterAll, vi, type MockInstance } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ReplayParser } from '../../src/parsers/replay-parser';

/**
 * Load an example file from the examples directory as a standalone ArrayBuffer
 */
function loadExample(name: string): ArrayBuffer {
  const raw = readFileSync(fileURLToPath(new URL(`../../examples/${name}`, import.meta.url)));
  return raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
}

// The replay schema logs when it locates the start year; silence that for
// clean test output and record the calls so the heuristic test can verify them
let logSpy: MockInstance;
const consoleLogCalls: unknown[][] = [];

beforeAll(() => {
  // Installed in a hook rather than at module scope: the test runner sets up
  // its own console interception after module evaluation and would bypass a
  // spy installed that early. Calls are recorded in our own array because the
  // runner resets the spy's call history between tests and hooks
  logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    consoleLogCalls.push(args);
  });
});

afterAll(() => {
  vi.restoreAllMocks();
});

describe('ReplayParser on examples/test-1.Civ5Replay', () => {
  let data: Record<string, any>;
  let junkData: Record<string, any>;
  let endOffset: number;
  let fileSize: number;

  beforeAll(() => {
    const file = loadExample('test-1.Civ5Replay');
    fileSize = file.byteLength;

    // The production path parses without junk fields
    const parser = new ReplayParser(file, file.byteLength);
    data = parser.parse() as Record<string, any>;
    endOffset = parser.tell();

    // A second pass with junk fields enabled for the underscore-key tests
    junkData = new ReplayParser(file, file.byteLength).parse(true) as Record<string, any>;
  });

  it('is tested against the exact example file the ground truth comes from', () => {
    // If this fails, someone swapped the example and every hard-coded value
    // below needs to be re-derived from the new file
    expect(fileSize).toBe(2637853);
  });

  it('reads the file header', () => {
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
    expect(data.mapScript2).toBe(data.mapScript);
  });

  it('reads the DLC list', () => {
    expect(data.dlc).toHaveLength(13);
    expect(data.dlc[0].name).toBe('Mongolia');
    expect(data.dlc[0].enabled).toBe(1);
    expect(data.dlc[0].id).toHaveLength(16);
    expect(data.dlc[12].name).toBe('Upgrade 1');
  });

  it('reads the mod list', () => {
    expect(data.mods.map((m: any) => m.name)).toEqual([
      '(1) Community Patch',
      '(2) Vox Populi',
      '(5) Vox Deorum'
    ]);
    expect(data.mods.map((m: any) => m.version)).toEqual([149, 17, 1]);
  });

  it('reads turns and years', () => {
    expect(data.startTurn).toBe(0);
    expect(data.startYear).toBe(-4000);
    expect(data.endTurn).toBe(484);
    expect(data.endYear).toBe('2042 AD');
    expect(data.zeroStartYear).toBe(0);
    expect(data.zeroEndYear).toBe(6438);
  });

  it('reads the civilization list', () => {
    expect(data.civs).toHaveLength(24);
    expect(data.civs[0]).toMatchObject({
      leader: 'Harun al-Rashid',
      longName: 'Arabian Empire',
      name: 'Arabia',
      demonym: 'Arabian'
    });
    expect(data.civs[23].name).toBe('Bratislava');
  });

  it('reads the dataset keys and their per-civ value tables', () => {
    expect(data.datasets).toHaveLength(29);
    expect(data.datasets[0].key).toBe('REPLAYDATASET_BUILDINGMAINTENANCE');
    expect(data.datasets[28].key).toBe('REPLAYDATASET_WORKEDTILES');

    // One value table per civilization, one column per dataset
    expect(data.datasetValues).toHaveLength(24);
    for (const civTable of data.datasetValues) {
      expect(civTable).toHaveLength(29);
    }

    // Spot checks inside Arabia's tables: the first column only covers the
    // turns the stat was recorded for, the score column covers every turn
    expect(data.datasetValues[0][0][0]).toEqual({ turn: 1, value: 0 });
    const scoreIndex = data.datasets.findIndex((d: any) => d.key === 'REPLAYDATASET_SCORE');
    expect(data.datasetValues[0][scoreIndex][0]).toEqual({ turn: 0, value: 6 });
    expect(data.datasetValues[0][scoreIndex][484]).toEqual({ turn: 484, value: 0 });
  });

  it('reads the event log', () => {
    expect(data.events).toHaveLength(2802);

    // First event: Arabia claiming the tiles around its starting location
    expect(data.events[0]).toMatchObject({
      turn: 0,
      type: 2,
      civId: 0,
      text: ''
    });
    expect(data.events[0].tiles).toHaveLength(7);
    expect(data.events[0].tiles[0]).toEqual({ x: 54, y: 19 });

    // Second event: the founding of Mecca on that same tile
    expect(data.events[1]).toEqual({
      turn: 0,
      type: 1,
      tiles: [{ x: 54, y: 19 }],
      civId: 0,
      text: 'Mecca is founded.'
    });

    // Last event: the game-ending victory message
    expect(data.events[2801]).toEqual({
      turn: 484,
      type: 0,
      tiles: [{ x: -1, y: -1 }],
      civId: 6,
      text: 'Maria Theresa has won a Cultural Victory!!!'
    });
  });

  it('reads the map dimensions and tile data', () => {
    expect(data.mapWidth).toBe(79);
    expect(data.mapHeight).toBe(53);
    expect(data.tiles).toHaveLength(79 * 53);

    // The top-left corner of this map is ice over ocean below sea level
    expect(data.tiles[0]).toEqual({ elevation: 3, type: 6, feature: 0 });
  });

  it('hides junk fields by default and exposes them on demand', () => {
    // Default parse: no underscore keys anywhere
    for (const key of Object.keys(data)) {
      expect(key.startsWith('_')).toBe(false);
    }

    // Junk parse: the raw unknown fields are present with their exact bytes
    expect(junkData._0).toBe(1);
    expect(Array.from(junkData._1)).toEqual([0xe4, 0x01, 0x00, 0x00, 0x01]);
    expect(junkData._2).toBe('');
    expect(junkData._3).toBe('');
    expect(Array.from(junkData._4)).toEqual([0x06, 0x00, 0x00, 0x00]);

    // Junk fields inside array records are filtered the same way
    expect(data.tiles[0]._1).toBeUndefined();
    expect(junkData.tiles[0]._1).toBe(1);
    expect(junkData.tiles[0]._2).toBe(484);
  });

  it('runs the start-year search heuristic', () => {
    // The _5 schema hook scans for the start year and logs when it finds it:
    // once for the plain parse and once for the junk parse in beforeAll
    const messages = consoleLogCalls.flat().map(m => String(m));
    const heuristicLogs = messages.filter(m => m.includes('Found the start year'));
    expect(heuristicLogs).toHaveLength(2);
  });

  it('consumes the entire file', () => {
    // A correct schema lands exactly on the last byte of the file
    expect(endOffset).toBe(fileSize);
  });
});

describe.each([
  ['1.Civ5Replay', 'CIVILIZATION_CHINA', 56, 38],
  ['2.Civ5Replay', 'CIVILIZATION_ZULU', 56, 38],
  ['3.Civ5Replay', 'CIVILIZATION_CARTHAGE', 56, 38]
])('ReplayParser smoke test (%s)', (name, playerCiv, width, height) => {
  it('parses the whole file with a consistent map', () => {
    const file = loadExample(name);
    const parser = new ReplayParser(file, file.byteLength);
    const data: Record<string, any> = parser.parse();

    expect(data.game).toBe('CIV5');
    expect(data.playerCiv).toBe(playerCiv);
    expect(data.mapWidth).toBe(width);
    expect(data.mapHeight).toBe(height);
    expect(data.tiles).toHaveLength(width * height);
    expect(parser.tell()).toBe(file.byteLength);
  });
});
