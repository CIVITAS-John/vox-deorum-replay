/**
 * save-parser.test.ts
 * Regression tests for the save parser against real games
 * examples/4.Civ5Save and examples/5.Civ5Save are late and mid game
 * snapshots of the same game as examples/4.Civ5Replay and
 * examples/5.Civ5Replay. The replay files are the ground truth: the save
 * parser must rebuild the exact same event log, civilization list, dataset
 * tables, and map terrain, down to every feature tile
 *
 * Known quirks, locked in by the tests below:
 * - The replay file exporter misattributes barbarian events to the first
 *   player through a defaulting map lookup; the save parser keeps them
 *   unattributed instead, so those seven events differ on purpose
 * - Replay files carry no river data, so the river extraction is checked
 *   structurally: every river edge is shared by the two plots it separates,
 *   so the per direction edge counts must pair up
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SaveParser, isSaveFile, extractMapTerrain } from '../../src/parsers/save-parser';
import { inflateZlib } from '../../src/parsers/utils/inflate';
import { ReplayParser } from '../../src/parsers/replay-parser';
import { Replay } from '../../src/replay/replay';
import { OwnershipTimeline } from '../../src/replay/ownership';

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
  let hub: Replay;

  beforeAll(async () => {
    const file = loadExample('4.Civ5Save');
    parser = new SaveParser(file, file.byteLength);
    data = await parser.parseReplay();

    hub = new Replay();
    await hub.loadFromFile(file, file.byteLength);

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

  it('decodes the plot records and the terrain matches the replay exactly', async () => {
    // Inflate the body once and hand it to the decoder directly, the same
    // way the parser does, so the walk itself can be checked against the
    // replay
    const body = await inflateSaveBody('4.Civ5Save');
    const result = extractMapTerrain(body, 0x4faca, 79, 53);

    // The structural walk starts at the first plot record behind the
    // resource tables and covers the whole map
    expect(result.stats.arrayStart).toBe(0x4faca + 527);
    expect(result.stats.slotsFilled).toBe(79 * 53);
    const diagnostics = parser.getDiagnostics();
    expect(diagnostics.terrainGatePassed).toBe(true);
    expect(diagnostics.terrainCoverage).toBe(1);

    // Every tile matches the replay file ground truth one for one,
    // elevation and terrain type and feature
    expect(result.tiles).toHaveLength(79 * 53);
    for (let i = 0; i < result.tiles.length; i++) {
      const tile = result.tiles[i];
      const gt = replayData.tiles[i];
      expect(tile).not.toBeNull();
      expect(tile!.elevation).toBe(gt.elevation);
      expect(tile!.type).toBe(gt.type);
      expect(tile!.feature).toBe(gt.feature);
    }

    // The first polar plot is ocean under ice and carries no river ids
    expect(result.tiles[0]).toEqual({
      elevation: 3, type: 6, feature: 0, rivers: [],
      owner: -1, resource: -1, improvement: -1, route: -1,
      isCity: 0, owningCityOwner: -1, owningCityId: -1
    });
  });

  it('extracts the river ids of every plot edge that borders a river', () => {
    // Each tile carries one river id per hex direction, -1 for no river.
    // Every river edge is shared with the neighbour across that edge, so
    // the direction counts must pair up: NE with SW, E with W, SE with NW
    const dirCount = [0, 0, 0, 0, 0, 0];
    let riverPlots = 0;
    let riverEdges = 0;
    const riverIds = new Set<number>();
    for (const tile of data.tiles) {
      const rivers: number[] = tile.rivers ?? [];
      let hasRiver = false;
      for (let d = 0; d < 6; d++) {
        if (rivers[d] >= 0) {
          dirCount[d]++;
          riverEdges++;
          riverIds.add(rivers[d]);
          hasRiver = true;
        }
      }
      if (hasRiver) riverPlots++;
    }
    expect(riverPlots).toBe(479);
    expect(riverEdges).toBe(1060);
    expect(riverIds.size).toBe(64);
    expect(dirCount[0]).toBe(dirCount[3]);
    expect(dirCount[1]).toBe(dirCount[4]);
    expect(dirCount[2]).toBe(dirCount[5]);

    // River 1 runs between the plots (16,2) and (17,2), stored once from
    // each side, on the east edge of the first plot and the west edge of
    // the second
    expect(data.tiles[2 * 79 + 16].rivers).toEqual([-1, 1, -1, -1, -1, -1]);
    expect(data.tiles[2 * 79 + 17].rivers).toEqual([-1, -1, -1, -1, 1, -1]);
  });

  it('renders terrain through the full pipeline', () => {
    // The assembled output carries the decoded terrain for the whole map
    let real = 0;
    for (const tile of data.tiles) {
      if (tile.elevation !== -1) real++;
    }
    expect(real).toBe(79 * 53);
    expect(data.tiles[0]).toMatchObject({ elevation: 3, type: 6, feature: 0 });
  });

  it('reads the map header including the wrap flags', () => {
    // The example maps wrap horizontally, which Stage 4 needs for wrapped
    // panning, and the owned plot count is the invariant checked below
    expect(data.mapHeader).toEqual({
      width: 79,
      height: 53,
      landPlots: 1434,
      ownedPlots: 2740,
      numNaturalWonders: 9,
      topLatitude: 90,
      bottomLatitude: -90,
      wrapX: true,
      wrapY: false,
      mapGenerated: true
    });
  });

  it('counts owned plots in agreement with the map header', () => {
    // The header's owned plot count must match the plot records themselves
    const owned = data.tiles.filter((tile: any) => tile.owner >= 0).length;
    expect(owned).toBe(data.mapHeader.ownedPlots);
    expect(owned).toBe(2740);
  });

  it('agrees with the event-derived ownership at the save turn', () => {
    // The strongest cross check available: every plot the save calls owned,
    // the ownership folded from the event log agrees on, owner by owner.
    // The fold cannot see tile releases (the game emits them as claim
    // events with no civilization), so plots released by a razing keep a
    // stale owner in the fold: five tiles around Rapa Nui, razed at turn 308
    const ownership = new OwnershipTimeline(hub.events, civId => hub.getCivName(civId));
    const state = ownership.stateAt(hub.endTurn);

    let owned = 0;
    let agreed = 0;
    let stale = 0;
    for (let y = 0; y < hub.mapHeight; y++) {
      for (let x = 0; x < hub.mapWidth; x++) {
        const tile = hub.getTileAt(x, y)!;
        const civId = hub.getCivIdForSlot(tile.owner ?? -1);
        const snapshotOwner = civId >= 0 ? hub.getCivName(civId) : null;
        const foldedOwner = state[`${x},${y}`]?.owner ?? null;
        if (snapshotOwner !== null) owned++;
        if (snapshotOwner !== null || foldedOwner !== null) {
          if (snapshotOwner === foldedOwner) agreed++;
          else stale++;
        }
      }
    }
    expect(owned).toBe(2740);
    expect(agreed).toBe(2740);
    expect(stale).toBe(5);
  });

  it('marks city plots that match the founded, captured, and razed events', () => {
    // The city flags of the plot records must land exactly on the cities
    // the event fold keeps alive, and every city plot is worked by the city
    // itself, so the owning city belongs to the plot owner
    const ownership = new OwnershipTimeline(hub.events, civId => hub.getCivName(civId));
    const state = ownership.stateAt(hub.endTurn);

    const cityPlotKeys = new Set<string>();
    for (let y = 0; y < hub.mapHeight; y++) {
      for (let x = 0; x < hub.mapWidth; x++) {
        const tile = hub.getTileAt(x, y)!;
        if (tile.isCity === 1) {
          cityPlotKeys.add(`${x},${y}`);
          expect(tile.owningCityOwner).toBe(tile.owner);
          expect(tile.owningCityId).toBeGreaterThanOrEqual(0);
        }
      }
    }

    const foldedCityKeys = Object.entries(state)
      .filter(([, info]) => info.city !== undefined)
      .map(([key]) => key);

    expect(cityPlotKeys.size).toBe(79);
    expect(foldedCityKeys).toHaveLength(79);
    expect([...cityPlotKeys].sort()).toEqual([...foldedCityKeys].sort());
  });

  it('reads the victory result and confirms it against the event log', () => {
    // The header says Maria Theresa's team won a cultural victory at turn
    // 484, and the event log carries the matching victory message, whose
    // author is Austria, so the result counts as reliable
    expect(data.victory).toEqual({
      winningTurn: 484,
      winnerTeam: 6,
      victoryType: 3,
      gameState: 2,
      winnerCivId: 6,
      reliable: true,
      source: 'file'
    });
    expect(data.civs[6].name).toBe('Austria');
  });

  it('exposes the player slots and clean dataset diagnostics', () => {
    // Eight major civilizations on slots 0 to 7, sixteen city states on
    // slots 22 to 37; every slot carries an undamaged data region
    expect(data.civSlots).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7,
      22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37
    ]);
    expect(data.datasetDiagnostics).toHaveLength(24);
    for (const entry of data.datasetDiagnostics) {
      expect(entry).toEqual({ attached: true, damagedEntries: 0 });
    }
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
  let hub: Replay;

  beforeAll(async () => {
    const file = loadExample('5.Civ5Save');
    parser = new SaveParser(file, file.byteLength);
    data = await parser.parseReplay();

    hub = new Replay();
    await hub.loadFromFile(file, file.byteLength);

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

  it('reads the map dimensions and the terrain matches the replay exactly', () => {
    expect(data.mapWidth).toBe(79);
    expect(data.mapHeight).toBe(53);
    expect(parser.getDiagnostics().mapDimsSource).toBe('map-section');

    const diagnostics = parser.getDiagnostics();
    expect(diagnostics.terrainCoverage).toBe(1);
    expect(diagnostics.terrainGatePassed).toBe(true);

    // Every tile matches the replay file ground truth one for one
    expect(data.tiles).toHaveLength(79 * 53);
    for (let i = 0; i < data.tiles.length; i++) {
      const tile = data.tiles[i];
      const gt = replayData.tiles[i];
      expect(tile.elevation).toBe(gt.elevation);
      expect(tile.type).toBe(gt.type);
      expect(tile.feature).toBe(gt.feature);
    }
    expect(data.tiles[0]).toEqual({
      elevation: 3, type: 6, feature: 0, rivers: [],
      owner: -1, resource: -1, improvement: -1, route: -1,
      isCity: 0, owningCityOwner: -1, owningCityId: -1
    });

    // The same map as the late game save, so the same rivers run through it
    let riverPlots = 0;
    for (const tile of data.tiles) {
      if ((tile.rivers ?? []).some((id: number) => id >= 0)) riverPlots++;
    }
    expect(riverPlots).toBe(479);
  });

  it('reads the map header and counts owned plots in agreement with it', () => {
    expect(data.mapHeader).toEqual({
      width: 79,
      height: 53,
      landPlots: 1434,
      ownedPlots: 2526,
      numNaturalWonders: 9,
      topLatitude: 90,
      bottomLatitude: -90,
      wrapX: true,
      wrapY: false,
      mapGenerated: true
    });

    const owned = data.tiles.filter((tile: any) => tile.owner >= 0).length;
    expect(owned).toBe(data.mapHeader.ownedPlots);
    expect(owned).toBe(2526);
  });

  it('agrees with the event-derived ownership at the save turn', () => {
    // Same picture as the finished game: every owned plot agrees with the
    // event fold. The fifteen stale tiles belong to Belo Horizonte, founded
    // by Brazil at turn 330 and razed by Arabia at turn 365, whose released
    // tiles the fold cannot see
    const ownership = new OwnershipTimeline(hub.events, civId => hub.getCivName(civId));
    const state = ownership.stateAt(hub.endTurn);

    let owned = 0;
    let agreed = 0;
    let stale = 0;
    for (let y = 0; y < hub.mapHeight; y++) {
      for (let x = 0; x < hub.mapWidth; x++) {
        const tile = hub.getTileAt(x, y)!;
        const civId = hub.getCivIdForSlot(tile.owner ?? -1);
        const snapshotOwner = civId >= 0 ? hub.getCivName(civId) : null;
        const foldedOwner = state[`${x},${y}`]?.owner ?? null;
        if (snapshotOwner !== null) owned++;
        if (snapshotOwner !== null || foldedOwner !== null) {
          if (snapshotOwner === foldedOwner) agreed++;
          else stale++;
        }
      }
    }
    expect(owned).toBe(2526);
    expect(agreed).toBe(2526);
    expect(stale).toBe(15);
  });

  it('marks city plots that match the founded, captured, and razed events', () => {
    const ownership = new OwnershipTimeline(hub.events, civId => hub.getCivName(civId));
    const state = ownership.stateAt(hub.endTurn);

    const cityPlotKeys = new Set<string>();
    for (let y = 0; y < hub.mapHeight; y++) {
      for (let x = 0; x < hub.mapWidth; x++) {
        const tile = hub.getTileAt(x, y)!;
        if (tile.isCity === 1) {
          cityPlotKeys.add(`${x},${y}`);
          expect(tile.owningCityOwner).toBe(tile.owner);
        }
      }
    }

    const foldedCityKeys = Object.entries(state)
      .filter(([, info]) => info.city !== undefined)
      .map(([key]) => key);

    expect(cityPlotKeys.size).toBe(82);
    expect(foldedCityKeys).toHaveLength(82);
    expect([...cityPlotKeys].sort()).toEqual([...foldedCityKeys].sort());
  });

  it('reports no victory for a mid game save', () => {
    // The game is still running, so the interface must never imply a result
    expect(data.victory).toEqual({
      winningTurn: -1,
      winnerTeam: -1,
      victoryType: -1,
      gameState: 0,
      winnerCivId: -1,
      reliable: false,
      source: 'file'
    });
  });

  it('accepts a winner passed through a shared link', () => {
    // A save taken before the game was won carries no proof of the result,
    // so a shared link may assert it; here it lands on Austria, and the
    // result is marked as link sourced so the interface can attribute it
    const original = hub.victory;
    expect(hub.applyLinkVictory(6)).toBe(true);
    expect(hub.victory).toEqual({
      winningTurn: -1,
      winnerTeam: -1,
      victoryType: -1,
      gameState: -1,
      winnerCivId: 6,
      reliable: true,
      source: 'link'
    });

    // A winner the loaded file does not have is rejected, and the applied
    // link result gives way to nothing
    expect(hub.applyLinkVictory(99)).toBe(false);
    expect(hub.victory?.winnerCivId).toBe(6);

    hub.victory = original;
  });

  it('exposes the player slots and clean dataset diagnostics', () => {
    expect(data.civSlots).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7,
      22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37
    ]);
    expect(data.datasetDiagnostics).toHaveLength(24);
    for (const entry of data.datasetDiagnostics) {
      expect(entry).toEqual({ attached: true, damagedEntries: 0 });
    }
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
