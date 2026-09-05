/**
 * save-parser.ts
 * Parser for Civilization V (Vox Populi) save game files
 * Saves do not embed a finished replay, they embed the raw ingredients: the
 * event log inside the game section, and one replay data cluster per player
 * slot. This parser extracts those, rebuilds the civilization list from the
 * uncompressed pregame section, and assembles the same data shape the
 * replay parser produces so the rest of the application cannot tell the
 * difference.
 *
 * Layout of a save, top to bottom:
 * - An uncompressed engine header (shared front half with replay files)
 * - The uncompressed CvPreGame section (slot setup and game options)
 * - An 8 byte compression marker, then one zlib stream to end of file
 * - Inside the stream: the game section (with the event log early on and the
 *   embedded SQLite database at its end), the map section right after the
 *   database, then one section per player slot in slot order
 */

import { BaseParser } from './base-parser';
import { BinaryParser } from './binary-parser';
import { inflateZlib } from './inflate';
import { getCivNameFromType } from '../utils/civ-names';
import { FileConfig } from '../types';

/** One replay message straight off the wire */
interface SaveMessage {
  turn: number;
  type: number;
  tiles: { x: number; y: number }[];
  civId: number;
  text: string;
}

/** A replay data region: the m_ReplayData map of one player slot */
interface ReplayCluster {
  startPos: number;
  endPos: number;
  datasets: Map<string, { turn: number; value: number }[]>;
  damagedEntries: number;
  validEntries: number;
  nameCount: number;
  /** Last turn with a nonzero score value, a death signature that survives value corruption (-1 when unknown) */
  scoreLastNonzeroTurn: number;
  /** True when the region yielded usable stat series beyond damage */
  hasGameData: boolean;
}

/** Diagnostic counters surfaced after parsing, useful for troubleshooting */
export interface SaveParserDiagnostics {
  decompressedSize: number;
  eventListPos: number;
  clusterCount: number;
  damagedClusters: number;
  unattachedClusters: number;
  mapDimsSource: 'map-section' | 'events' | 'none';
  terrainCoverage: number;
  terrainTrusted: number;
  terrainSkipped: number;
  terrainSegments: number;
  terrainGatePassed: boolean;
}

/** Terrain statistics reported by the plot walker */
export interface MapTerrainStats {
  /** Byte offset of the first plot record, or -1 when the array was not found */
  arrayStart: number;
  /** Plot slots the walk reached, including damaged records counted as skipped */
  slotsFilled: number;
  /** Records whose terrain values passed the semantic trust rule */
  trustedTiles: number;
  /** Records found in the data but rejected by the trust rule */
  damagedTiles: number;
  /** Records that failed the structural check and were only counted, not read */
  skippedRecords: number;
  /** Number of contiguous record segments that were walked */
  segments: number;
}

/** Terrain extraction result: one entry per plot, null when unknown */
export interface MapTerrainResult {
  tiles: ({ elevation: number; type: number; feature: number } | null)[];
  stats: MapTerrainStats;
}

/** Dataset name prefix used for every replay stat series */
const DATASET_PREFIX = 'REPLAYDATASET_';

/** First bytes of the SQLite database embedded at the end of the game section */
const SQLITE_MAGIC = 'SQLite format 3';

/** The event list sits near the start of the game section, well within this window */
const EVENTS_SCAN_LIMIT = 0x40000;

/**
 * When a cluster is damaged, parsing resumes at the next dataset name within
 * this distance. Real datasets sit a few kilobytes apart, while the gap
 * between two player sections is over a hundred kilobytes, so this bound
 * keeps a damaged cluster from swallowing the next one
 */
const CLUSTER_RESYNC_LIMIT = 0x10000;

/** Highest player slot id (barbarians) */
const MAX_PLAYER_SLOT = 63;

/**
 * The plot record head of the current CvPlot serialization, in bytes from the
 * record start. The prefix holds small counters and the river id list, then
 * come the packed flag word, the owner and terrain bytes, and the owning city
 * reference. Everything after that is skipped by the walker, so tail layout
 * changes between game versions do not matter
 */
const PLOT_PREFIX_SIZE = 28;
/** Position of the packed plot flag word relative to the record base after the river list */
const PLOT_BITS_OFFSET = 21;
/** Position of the owner byte relative to the record base after the river list */
const PLOT_OWNER_OFFSET = 28;
/** End of the owning city data relative to the record base after the river list, where the yield list starts */
const PLOT_YIELDS_OFFSET = 76;
/** Size of the per team visibility block that follows the yields */
const PLOT_TEAM_BLOCK_SIZE = 1024;
/** Window in which the periodic team block must begin after the yields */
const PLOT_TEAM_SEARCH = 200;
/** Number of yield bytes between the owning city data and the team block */
const PLOT_YIELD_COUNT = 17;
/** How far ahead the walker scans for the next record before giving up on a segment */
const PLOT_NEXT_SCAN_LIMIT = 0x10000;

/** The terrain fields of one plot record that the walker cares about */
interface PlotHead {
  plotType: number;
  terrain: number;
  feature: number;
  /** Record base after the river id list, used to place the team block */
  riversBase: number;
}

/**
 * Check whether a plot record starts at the given position and read its
 * terrain fields. The validation is structural and damage tolerant: values
 * that corruption can change (the feature word, the owning city ids) are not
 * range checked, while the fields whose damage would break the walk (the
 * prefix counters, the flag word, the plot type) are. The team visibility
 * block is the decisive anchor: a real block is 64 sixteen byte entries and
 * most of it consists of runs of identical entries with the negative enum
 * fill bytes, while random data or record tails never mimic that much
 * periodicity
 * @param body The decompressed game state
 * @param s Candidate record start
 * @returns The terrain fields, or null when no record starts here
 */
export function checkPlotHead(body: Uint8Array, s: number): PlotHead | null {
  if (s < 0 || s + PLOT_YIELDS_OFFSET + PLOT_TEAM_SEARCH + 400 >= body.length) return null;
  const i16 = (p: number) => ((body[p] | (body[p + 1] << 8)) << 16) >> 16;
  const i8 = (p: number) => (body[p] << 24) >> 24;
  const u8 = (p: number) => body[p];
  const i32 = (p: number) => (body[p] | (body[p + 1] << 8) | (body[p + 2] << 16) | (body[p + 3] << 24));
  const u32 = (p: number) => ((body[p] | (body[p + 1] << 8) | (body[p + 2] << 16) | (body[p + 3] << 24)) >>> 0);

  if (i16(s) < -1 || i16(s) > 8192) return null;
  if (i16(s + 2) < -1 || i16(s + 2) > 20000) return null;
  if (i16(s + 4) < -1 || i16(s + 4) > 20000) return null;
  if (i16(s + 6) < -1 || i16(s + 6) > 20000) return null;
  for (let k = 0; k < 5; k++) {
    const c = i8(s + 8 + k);
    if (c < -1 || c > 63) return null;
  }
  if (i16(s + 13) < -1 || i16(s + 13) > 4096) return null;
  if (i16(s + 15) < -1 || i16(s + 15) > 4096) return null;

  // The river id list: the current serialization writes an empty marker of
  // all ones, older builds wrote a plain count. Both shapes are accepted
  const rivers = u32(s + 17);
  let riverCount = 0;
  if (rivers === 0xFFFFFFFF) riverCount = 0;
  else if (rivers <= 64) riverCount = rivers;
  else return null;
  const b = s + riverCount * 4;

  if (u16le(body, b + PLOT_BITS_OFFSET) > 0x7FFF) return null;
  for (let k = 0; k < 5; k++) {
    const e = i8(b + 23 + k);
    if (e < -1 || e > 127) return null;
  }
  const owner = i8(b + PLOT_OWNER_OFFSET);
  if (owner < -1 || owner > 63) return null;
  const plotType = i8(b + PLOT_OWNER_OFFSET + 1);
  if (plotType < 0 || plotType > 3) return null;
  const terrain = i8(b + PLOT_OWNER_OFFSET + 2);
  if (terrain < 0 || terrain > 15) return null;
  const feature = i32(b + PLOT_OWNER_OFFSET + 3);
  // An entirely zero head is a zero run inside some record tail, not a plot:
  // a grassland mountain carrying the ice feature cannot exist. Damaged real
  // records keep their nonzero counters and pass this test
  if (feature === 0 && plotType === 0 && terrain === 0 && owner === 0) {
    let allZero = true;
    for (let k = 0; k < PLOT_PREFIX_SIZE; k++) {
      if (body[s + k] !== 0) { allZero = false; break; }
    }
    if (allZero) return null;
  }
  if (u8(b + 59) > 1) return null;
  for (const off of [60, 64, 68, 72]) {
    const v = i8(b + off);
    if (v < -1 || v > 63) return null;
  }

  return { plotType, terrain, feature, riversBase: b };
}

/**
 * Read a little endian unsigned sixteen bit word straight from a byte array
 */
function u16le(body: Uint8Array, p: number): number {
  return body[p] | (body[p + 1] << 8);
}

/**
 * Check that the per team visibility block behind a candidate head looks
 * real. The block sits after the yield list and consists of 64 entries of
 * sixteen bytes. Most entries repeat identically, so a cheap scan first
 * demands one long periodic run and a second pass demands that runs cover a
 * large fraction of the block. Fake heads inside the variable tail of a big
 * record only see short runs and fail the coverage test
 * @param body The decompressed game state
 * @param b The record base after the river list
 */
export function checkTeamBlock(body: Uint8Array, b: number): boolean {
  const isRunStart = (q: number): number => {
    let reps = 0;
    while (reps < 200 && q + (reps + 1) * 16 <= body.length) {
      let ok = true;
      for (let j = 0; j < 16; j++) {
        if (body[q + reps * 16 + j] !== body[q + j]) { ok = false; break; }
      }
      if (!ok) break;
      reps++;
    }
    return reps;
  };
  const runQualifies = (q: number): boolean => {
    let ff = 0, zz = 0;
    for (let j = 0; j < 16; j++) {
      if (body[q + j] === 0xff) ff++;
      else if (body[q + j] === 0) zz++;
    }
    return ff >= 3 && zz >= 2;
  };

  // One periodic run of at least eight repeats near the start of the block.
  // Seen plots can have many varying entries, so the whole block is not
  // required to be periodic, only the tail end of unused team slots
  for (let q = b + PLOT_YIELDS_OFFSET; q < b + PLOT_YIELDS_OFFSET + PLOT_TEAM_SEARCH; q++) {
    if (isRunStart(q) >= 8 && runQualifies(q)) return true;
  }
  return false;
}

/**
 * Count plot records between two byte positions by their team blocks. Each
 * record holds exactly one block, and one block can split into several
 * periodic runs when team entries differ, so runs less than 128 bytes apart
 * are merged before counting
 * @param body The decompressed game state
 * @param from First byte to inspect
 * @param to Last byte to inspect
 */
function countRecordsBetween(body: Uint8Array, from: number, to: number): number {
  const runs: [number, number][] = [];
  let i = Math.max(0, from);
  while (i < to - 96) {
    let reps = 0;
    while (reps < 200 && i + (reps + 1) * 16 <= body.length) {
      let ok = true;
      for (let j = 0; j < 16; j++) {
        if (body[i + reps * 16 + j] !== body[i + j]) { ok = false; break; }
      }
      if (!ok) break;
      reps++;
    }
    if (reps >= 6) {
      let ff = 0, zz = 0;
      for (let j = 0; j < 16; j++) {
        if (body[i + j] === 0xff) ff++;
        else if (body[i + j] === 0) zz++;
      }
      if (ff >= 3 && zz >= 2) {
        runs.push([i, reps * 16]);
        i += reps * 16;
        continue;
      }
    }
    i++;
  }
  let count = 0;
  let lastEnd = -1;
  for (const [start, len] of runs) {
    if (lastEnd < 0 || start - lastEnd > 128) count++;
    lastEnd = Math.max(lastEnd, start + len);
  }
  return count;
}

/**
 * Find the next plot record after the given position. The scan is filtered:
 * a record prefix carries either the all ones river marker or a small river
 * count at a fixed offset, so only positions preceded by four 0xFF bytes are
 * worth a full check. The window grows progressively because consecutive
 * records sit within a couple of kilobytes of each other, and only skipped
 * or damaged records push the gap wide
 * @param body The decompressed game state
 * @param s The current record position
 * @param minDist Closest accepted distance to the next record
 * @returns The next record position, or -1 when none is found nearby
 */
export function findNextPlotRecord(body: Uint8Array, s: number, minDist: number): number {
  const limit = Math.min(s + PLOT_NEXT_SCAN_LIMIT, body.length - 350);
  const from = s + minDist;
  let to = Math.min(s + 2048, limit);
  for (;;) {
    for (let t = Math.max(from, 4); t + 21 < to; t++) {
      // A record prefix carries either the all ones empty river marker or a
      // small river count at offset 17, so both shapes filter the position
      const isMarker = body[t] === 0xff && body[t + 1] === 0xff && body[t + 2] === 0xff && body[t + 3] === 0xff;
      const isCount = body[t] <= 64 && body[t + 1] === 0 && body[t + 2] === 0 && body[t + 3] === 0;
      if (!isMarker && !isCount) continue;
      const cand = t - 17;
      if (cand < from) continue;
      const head = checkPlotHead(body, cand);
      if (head && checkTeamBlock(body, head.riversBase)) return cand;
    }
    if (to >= limit) return -1;
    to = Math.min(to * 4, limit);
  }
}

/**
 * Walk one contiguous run of plot records starting at the given position. The
 * walk stops when no further record is found within the scan window. Records
 * that fail the structural check are not skipped silently: their team blocks
 * are counted in the gap so the plot index stays aligned, and those plots are
 * reported as unknown
 * @param body The decompressed game state
 * @param start First record position
 * @param maxSlots Stop after filling this many plot slots
 * @returns The walked tiles and where the walk ended
 */
function walkPlotSegment(body: Uint8Array, start: number, maxSlots: number): {
  tiles: (PlotHead | null)[];
  endPos: number;
  skipped: number;
} {
  const tiles: (PlotHead | null)[] = [];
  const dists: number[] = [];
  let minSize = 1500;
  let bootstrapped = false;
  let skipped = 0;
  let s = start;
  while (tiles.length < maxSlots) {
    const head = checkPlotHead(body, s);
    if (!head || !checkTeamBlock(body, head.riversBase)) break;
    const trusted = head.feature >= -1 && head.feature <= 100 &&
      (head.plotType !== 3 || head.terrain >= 5) &&
      (head.feature !== 0 || head.plotType === 3);
    tiles.push(trusted ? head : null);
    const next = findNextPlotRecord(body, s, bootstrapped ? minSize - 64 : 1400);
    if (next < 0) break;
    if (!bootstrapped) {
      dists.push(next - s);
      if (dists.length >= 12) {
        dists.sort((a, b) => a - b);
        minSize = dists[1];
        bootstrapped = true;
      }
    }
    // Records that failed the structural check between the current record and
    // the next one are counted through their team blocks. The window starts
    // past this record's own block: the yields, then 1024 block bytes
    const gap = countRecordsBetween(body, head.riversBase + PLOT_YIELDS_OFFSET + PLOT_YIELD_COUNT + PLOT_TEAM_BLOCK_SIZE + 16, next - 200);
    for (let k = 0; k < gap && tiles.length < maxSlots; k++) {
      tiles.push(null);
      skipped++;
    }
    s = next;
  }
  return { tiles, endPos: s, skipped };
}

/**
 * Extract the map terrain by walking the plot record array of the map
 * section. The array start is scanned on the resource table sizing first and
 * falls back to a free scan for layouts that differ. Far away record runs are
 * only joined when the record count proves they complete the map, which keeps
 * a spliced or damaged save from producing shifted terrain
 * @param body The decompressed game state
 * @param mapPos Byte offset of the map section header
 * @param width Map width in plots
 * @param height Map height in plots
 */
export function extractMapTerrain(body: Uint8Array, mapPos: number, width: number, height: number): MapTerrainResult {
  const numPlots = width * height;
  const tiles: ({ elevation: number; type: number; feature: number } | null)[] = new Array(numPlots).fill(null);
  const stats: MapTerrainStats = {
    arrayStart: -1,
    slotsFilled: 0,
    trustedTiles: 0,
    damagedTiles: 0,
    skippedRecords: 0,
    segments: 0
  };
  if (numPlots <= 0) return { tiles, stats };

  // The header is 47 bytes, then two resource count tables of width 4 bytes
  // each. The first plot record follows, so candidates sit on that grid
  const validateStart = (pos: number): boolean => {
    if (checkPlotHead(body, pos) === null) return false;
    if (!checkTeamBlock(body, checkPlotHead(body, pos)!.riversBase)) return false;
    const trial = walkPlotSegment(body, pos, 30);
    return trial.tiles.length >= 30 && trial.skipped === 0;
  };

  let arrayStart = -1;
  for (let r = 10; r <= 200 && arrayStart < 0; r++) {
    const cand = mapPos + 47 + r * 8;
    if (validateStart(cand)) arrayStart = cand;
  }
  if (arrayStart < 0) {
    for (let p = mapPos + 40; p < mapPos + 0x200000 && arrayStart < 0; p++) {
      if (validateStart(p)) arrayStart = p;
    }
  }
  if (arrayStart < 0) return { tiles, stats };
  stats.arrayStart = arrayStart;

  // Walk the first segment, then look for further record runs
  const first = walkPlotSegment(body, arrayStart, numPlots);
  const collected: (PlotHead | null)[] = first.tiles;
  stats.skippedRecords += first.skipped;
  stats.segments = 1;

  // A clean save has one contiguous array and never enters this loop. A
  // spliced save may hold a continuation further out, but more than a handful
  // of candidate runs means the region is unrelated data, so the attempts and
  // the search radius are both bounded
  let scanPos = first.endPos + 600;
  const farLimit = Math.min(first.endPos + 0x800000, body.length - 350);
  for (let attempt = 0; attempt < 5 && collected.length < numPlots && scanPos < farLimit; attempt++) {
    let cand = -1;
    for (let t = scanPos; t < farLimit; t++) {
      // Same filter as the walk scan: a record prefix carries a river marker
      // or a small river count at a fixed offset
      const isMarker = body[t] === 0xff && body[t + 1] === 0xff && body[t + 2] === 0xff && body[t + 3] === 0xff;
      const isCount = body[t] <= 64 && body[t + 1] === 0 && body[t + 2] === 0 && body[t + 3] === 0;
      if (!isMarker && !isCount) continue;
      const head = checkPlotHead(body, t - 17);
      if (head && checkTeamBlock(body, head.riversBase)) { cand = t - 17; break; }
    }
    if (cand < 0) break;
    const trial = walkPlotSegment(body, cand, numPlots);
    // Only trust a far run when the record count proves it completes the map,
    // then align it to the end of the plot index
    if (trial.tiles.length >= 30 && collected.length + trial.tiles.length === numPlots) {
      for (let i = 0; i < trial.tiles.length; i++) {
        collected.push(trial.tiles[i]);
      }
      stats.skippedRecords += trial.skipped;
      stats.segments++;
      break;
    }
    scanPos = trial.endPos + 600;
  }

  for (let i = 0; i < Math.min(collected.length, numPlots); i++) {
    const head = collected[i];
    if (head) {
      tiles[i] = { elevation: head.plotType, type: head.terrain, feature: head.feature };
      stats.trustedTiles++;
    } else {
      stats.damagedTiles++;
    }
  }
  stats.slotsFilled = Math.min(collected.length, numPlots);
  return { tiles, stats };
}

/**
 * Skip a CvBaseInfo block: an int32 id followed by eight strings
 */
function skipBaseInfo(this: BaseParser): void {
  this.getInt32();
  for (let i = 0; i < 8; i++) {
    this.getVarString();
  }
}

/**
 * Skip a CvClimateInfo block: a base info plus four ints and seven floats
 */
function skipClimateInfo(this: BaseParser): void {
  skipBaseInfo.call(this);
  for (let i = 0; i < 4; i++) {
    this.getInt32();
  }
  for (let i = 0; i < 7; i++) {
    this.getFloat32();
  }
}

/**
 * Skip a CvSeaLevelInfo block: a base info plus one int
 */
function skipSeaLevelInfo(this: BaseParser): void {
  skipBaseInfo.call(this);
  this.getInt32();
}

/**
 * Skip a CvTurnTimerInfo block: a base info plus four ints
 */
function skipTurnTimerInfo(this: BaseParser): void {
  skipBaseInfo.call(this);
  for (let i = 0; i < 4; i++) {
    this.getInt32();
  }
}

/**
 * Skip a CvWorldInfo block: a base info plus twenty three ints
 */
function skipWorldInfo(this: BaseParser): void {
  skipBaseInfo.call(this);
  for (let i = 0; i < 23; i++) {
    this.getInt32();
  }
}

/**
 * Read the known players table, probing the element width (uint32 vs uint64
 * bitmasks depending on the compiled civ limit) by checking which stride
 * lands on the archive version marker that follows the table. The table is
 * empty unless the "keep unmet players unknown" game option was enabled.
 */
function readKnownPlayersTable(this: BaseParser): number {
  const count = this.getInt32();
  if (count <= 0) {
    return 0;
  }

  const afterTable = this.tell();
  for (const width of [8, 4]) {
    const candidate = afterTable + count * width;
    this.seek(candidate);
    if (this.getInt32() === 6) {
      // Positioned right before the archive version, which the schema reads next
      this.seek(candidate);
      return count;
    }
  }

  // Unknown layout, leave the cursor untouched and let the walk fail loudly
  this.seek(afterTable);
  return count;
}

/**
 * Schema for the uncompressed part of a save: the engine header, the
 * CvPreGame slot hints, and the CvPreGame archive. Junk fields carry an
 * underscore prefix and stay hidden unless junk parsing is requested.
 */
const SAVE_FILE_CONFIG: FileConfig = {
  // Engine header, shared front half with replay files
  game: { type: 'str', length: 0x04 }, // CIV5
  _formatVersion: 'int32',             // 8 for saves, 1 for replays
  version: 'varstr',
  build: 'varstr',
  headerTurn: 'int32',                 // game turn at save time
  _flag: 'int8',
  playerCiv: 'varstr',
  difficulty: 'varstr',
  eraStart: 'varstr',
  eraEnd: 'varstr',
  gameSpeed: 'varstr',
  worldSize: 'varstr',
  mapScript: 'varstr',
  dlc: {
    type: 'array',
    items: {
      id: { type: 'str', length: 0x10 },
      enabled: 'int32',
      name: 'varstr'
    }
  },
  mods: {
    type: 'array',
    items: {
      id: 'varstr',
      version: 'int32',
      name: 'varstr'
    }
  },
  _empty1: 'varstr',
  _empty2: 'varstr',
  playerColor: 'varstr',
  _hash1: { type: 'byte', length: 0x10 },
  _engineVersion: 'varstr',            // "1.0.0"
  _hash2: { type: 'byte', length: 0x10 },
  _engineTrailingInt: 'int32',

  // CvPreGame slot hints (version 3)
  _hintVersion: 'int32',
  _hintGameSpeed: 'int32',
  _hintWorldSize: 'int32',
  pregameMapScript: 'varstr',
  _slotCivs: { type: 'array', items: 'int32' },
  _nicknames: { type: 'array', items: 'varstr' },
  _slotStatus: { type: 'array', items: 'int32' },
  _slotClaims: { type: 'array', items: 'int32' },
  _teamTypes: { type: 'array', items: 'int32' },
  _handicaps: { type: 'array', items: 'int32' },
  civilizationKeys: { type: 'array', items: 'varstr' },
  leaderKeys: { type: 'array', items: 'varstr' },
  _knownPlayersTable: readKnownPlayersTable,

  // CvPreGame archive (version 6)
  _archiveVersion: 'int32',
  activePlayer: 'int32',
  _adminPassword: 'varstr',
  _alias: 'varstr',
  _artStyles: { type: 'array', items: 'int32' },
  _autorun: 'int8',
  _autorunTurnDelay: 'float32',
  _autorunTurnLimit: 'int32',
  _bandwidth: 'int32',
  calendar: 'int32',
  _calendarInfo: skipBaseInfo,
  _civAdjectives: { type: 'array', items: 'varstr' },
  _civDescriptions: { type: 'array', items: 'varstr' },
  _civPasswords: { type: 'array', items: 'varstr' },
  _civShortDescriptions: { type: 'array', items: 'varstr' },
  climate: 'int32',
  _climateInfo: skipClimateInfo,
  era: 'int32',
  _emailAddresses: { type: 'array', items: 'varstr' },
  _endTurnTimerLength: 'float32',
  _flagDecals: { type: 'array', items: 'varstr' },
  _forceControls: { type: 'array', items: 'int8' },
  _gameMode: 'int32',
  gameName: 'varstr',
  _archiveGameSpeed: 'int32',
  _gameStarted: 'int8',
  gameTurn: 'int32',
  _gameType: 'int8',                   // GameTypes serializes as a single byte
  _gameMapType: 'int32',
  _gameUpdateTime: 'int32',
  _handicaps2: { type: 'array', items: 'int32' },
  _lastHumanHandicaps: { type: 'array', items: 'int32' },
  _isEarthMap: 'int8',
  _isInternetGame: 'int8',
  _leaderNames: { type: 'array', items: 'varstr' },
  _loadFileName: 'varstr',
  _localPlayerEmailAddress: 'varstr',
  _mapNoPlayers: 'int8',
  _mapRandomSeed: 'int32',
  _loadWBScenario: 'int8',
  _overrideScenarioHandicap: 'int8',
  _archiveMapScript: 'varstr',
  _maxCityElimination: 'int32',
  _maxTurns: 'int32',
  _numMinorCivs: 'int32',
  minorCivTypes: { type: 'array', items: 'varstr' },
  _minorNationCivs: { type: 'array', items: 'int8' },
  _dummyvalue: 'int8',
  _multiplayerOptions: { type: 'array', items: 'int8' },
  _netIDs: { type: 'array', items: 'int32' },
  _nicknames2: { type: 'array', items: 'varstr' },
  _numVictoryInfos: 'int32',
  _pitBossTurnTime: 'int32',
  _playableCivs: { type: 'array', items: 'int8' },
  playerColors: { type: 'array', items: 'varstr' },
  _privateGame: 'int8',
  _quickCombat: 'int8',
  _quickCombatDefault: 'int8',
  _quickHandicap: 'int32',
  _quickstart: 'int8',
  _randomWorldSize: 'int8',
  _randomMapScript: 'int8',
  _readyPlayers: { type: 'array', items: 'int8' },
  seaLevel: 'int32',
  _seaLevelInfo: skipSeaLevelInfo,
  _dummyvalue2: 'int8',
  _slotClaims2: { type: 'array', items: 'int32' },
  _slotStatus2: { type: 'array', items: 'int32' },
  _smtpHost: 'varstr',
  _syncRandomSeed: 'int32',
  _targetScore: 'int32',
  _teamTypes2: { type: 'array', items: 'int32' },
  _transferredMap: 'int8',
  _turnTimer: skipTurnTimerInfo,
  _turnTimerType: 'int32',
  _cityScreenBlocked: 'int8',
  _victories: { type: 'array', items: 'int8' },
  _whiteFlags: { type: 'array', items: 'int8' },
  _worldInfo: skipWorldInfo,
  _archiveWorldSize: 'int32',
  gameOptions: {
    type: 'array',
    items: {
      name: 'varstr',
      value: 'int32'
    }
  },
  mapOptions: {
    type: 'array',
    items: {
      name: 'varstr',
      value: 'int32'
    }
  },
  _versionString: 'varstr',
  _turnNotifySteamInvite: { type: 'array', items: 'int8' },
  _turnNotifyEmail: { type: 'array', items: 'int8' },
  _turnNotifyEmailAddress: { type: 'array', items: 'varstr' }
};

/**
 * Encode an ASCII string as bytes, for searching the decompressed buffer
 * @param text The string to encode
 */
function stringToBytes(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    bytes[i] = text.charCodeAt(i) & 0xff;
  }
  return bytes;
}

/**
 * Find the first occurrence of a byte sequence at or after a position
 * @param haystack The buffer to search
 * @param needle The sequence to find
 * @param from The position to start from
 * @returns The position of the match, or -1 when not found
 */
function findBytes(haystack: Uint8Array, needle: Uint8Array, from: number): number {
  const last = haystack.length - needle.length;
  for (let pos = from; pos <= last; pos++) {
    if (haystack[pos] !== needle[0]) {
      continue;
    }
    let matched = true;
    for (let i = 1; i < needle.length; i++) {
      if (haystack[pos + i] !== needle[i]) {
        matched = false;
        break;
      }
    }
    if (matched) {
      return pos;
    }
  }
  return -1;
}

/**
 * Detect whether a buffer holds a save file rather than a replay file
 * @param file The raw file contents
 * @returns True when the buffer should be handled by SaveParser
 */
export function isSaveFile(file: ArrayBuffer): boolean {
  if (file.byteLength < 8) {
    return false;
  }
  const view = new DataView(file);
  const magic = String.fromCharCode(
    view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3)
  );
  return magic === 'CIV5' && view.getInt32(4, true) !== 1;
}

/**
 * SaveParser class
 * Parses save files and rebuilds the replay data they contain
 */
export class SaveParser extends BaseParser {
  private fileSize: number;
  private decompressed: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  private diagnostics: SaveParserDiagnostics = {
    decompressedSize: 0,
    eventListPos: 0,
    clusterCount: 0,
    damagedClusters: 0,
    unattachedClusters: 0,
    mapDimsSource: 'none',
    terrainCoverage: 0,
    terrainTrusted: 0,
    terrainSkipped: 0,
    terrainSegments: 0,
    terrainGatePassed: false
  };

  /**
   * Create a save parser
   * @param file The raw save file contents
   * @param size The size of the save data within the buffer
   */
  constructor(file: ArrayBuffer, size: number) {
    super(file, size, SAVE_FILE_CONFIG);
    this.fileSize = size;
  }

  /**
   * Get the default save file configuration
   */
  static getDefaultFileConfig(): FileConfig {
    return SAVE_FILE_CONFIG;
  }

  /**
   * Get diagnostic counters from the last parseReplay run
   */
  getDiagnostics(): SaveParserDiagnostics {
    return this.diagnostics;
  }

  /**
   * Parse the whole save and assemble the replay data
   * The uncompressed header is parsed by the inherited schema driven parse,
   * then the compressed body is inflated and scanned for the replay content
   * @returns A data object shaped like the replay parser output
   */
  async parseReplay(): Promise<Record<string, unknown>> {
    // Stage 1 and 2: engine header plus the whole CvPreGame section
    const header = this.parse() as Record<string, any>;

    // Stage 3: locate the compression marker and inflate the body
    const body = await this.readCompressedBody();
    this.decompressed = body;
    this.diagnostics.decompressedSize = body.byteLength;

    const state = new BinaryParser(body.buffer, body.byteLength);

    // Stage 4: the game section prelude carries the turn and year anchors
    const prelude = this.parseGamePrelude(state, header.headerTurn);
    const endTurn = prelude.endTurn;

    // Stage 5: the event log sits early in the game section
    const eventList = this.findEventList(state, endTurn, prelude.startTurn);

    // Stage 6: the civ list comes from the event slots plus the pregame names
    const civSlots = this.collectCivSlots(eventList.messages);
    const civs = this.buildCivList(header, civSlots);
    const slotToIndex = new Map<number, number>();
    civSlots.forEach((slot, index) => slotToIndex.set(slot, index));

    // Stage 7: replay data clusters, one per player slot in slot order
    const clusters = this.scanClusters(state, eventList.endPos, endTurn);
    const citySeries = this.predictCityCounts(eventList.messages, civSlots, endTurn);
    const deaths = this.analyzeDeaths(eventList.messages, civSlots);
    const clusterBySlot = this.assignClusters(clusters, civSlots, citySeries, deaths, endTurn);

    // Stage 8: map dimensions and terrain, then assemble the output shape
    const mapDims = this.readMapDimensions(state, eventList.messages);

    // Stage 9: walk the plot records for terrain when the map section was found
    let terrain: MapTerrainResult | null = null;
    if (mapDims.mapPos >= 0 && mapDims.width > 0 && mapDims.height > 0) {
      terrain = extractMapTerrain(this.decompressed, mapDims.mapPos, mapDims.width, mapDims.height);
      const coverage = terrain.stats.slotsFilled / (mapDims.width * mapDims.height);
      this.diagnostics.terrainCoverage = coverage;
      this.diagnostics.terrainTrusted = terrain.stats.trustedTiles;
      this.diagnostics.terrainSkipped = terrain.stats.skippedRecords;
      this.diagnostics.terrainSegments = terrain.stats.segments;
      // A damaged or spliced save can leave the walk short and its records
      // misaligned. Only render terrain when the walk covered nearly the
      // whole map, otherwise fall back to blank hexes
      this.diagnostics.terrainGatePassed = coverage >= 0.9;
      if (!this.diagnostics.terrainGatePassed) {
        console.warn(`Save terrain unreliable: the plot walk covered ${(coverage * 100).toFixed(1)}% of the map, rendering blank hexes`);
        terrain = null;
      }
    } else {
      this.diagnostics.terrainCoverage = 0;
      this.diagnostics.terrainGatePassed = false;
    }

    return this.assembleRawData(header, prelude, civs, civSlots, slotToIndex,
      eventList.messages, clusters, clusterBySlot, mapDims, terrain);
  }

  /**
   * Read and inflate the compressed body that follows the pregame section
   * @returns The decompressed game state
   */
  private async readCompressedBody(): Promise<Uint8Array<ArrayBuffer>> {
    // The schema cursor sits exactly on the compression marker
    const compressionType = this.getInt32();
    if (compressionType !== 2) {
      throw new Error(`Expected the zlib compression marker at position ${this.decToHex(this.tell() - 4)}, found ${compressionType}`);
    }
    this.getInt32(); // Chunk size hint, not needed

    const payload = this.getBytes(this.fileSize - this.tell());
    return inflateZlib(payload);
  }

  /**
   * Parse the fixed prelude of the game section: save version, data hash,
   * version string, then the first game fields including the turn counters
   * and the start year
   * @param state Reader over the decompressed game state
   * @param headerTurn The game turn from the engine header, for cross checking
   */
  private parseGamePrelude(state: BinaryParser, headerTurn: number): { startTurn: number; endTurn: number; startYear: number } {
    state.getInt32();                  // Save version, always 0
    state.getBytes(16);                // Game data hash
    state.getVarString();              // Game core version string

    state.getInt32();                  // End turn messages sent
    const elapsedGameTurns = state.getInt32();
    const startTurn = state.getInt32();
    state.getInt32();                  // Winning turn
    const startYear = state.getInt32();

    const endTurn = elapsedGameTurns;
    if (endTurn !== headerTurn) {
      console.warn(`Save turn mismatch: header says ${headerTurn}, game section says ${endTurn}`);
    }

    return { startTurn, endTurn, startYear };
  }

  /**
   * Locate and parse the replay event list
   * The list has no fixed offset within the game section, so the search
   * anchors on the first city founding text and then tries list headers in
   * the bytes just before it, validating each candidate by fully parsing
   * it. A real list satisfies every field constraint across all of its
   * messages and always contains the founding text it was anchored on
   * @param state Reader over the decompressed game state
   * @param endTurn The current game turn, upper bound for event turns
   * @param startTurn The turn the game started on
   */
  private findEventList(state: BinaryParser, endTurn: number, startTurn: number): { messages: SaveMessage[]; endPos: number } {
    const anchor = stringToBytes(' is founded.');
    const scanLimit = Math.min(EVENTS_SCAN_LIMIT, state.remaining());
    const body = this.decompressed;

    let pos = 0;
    while ((pos = findBytes(body, anchor, pos)) !== -1 && pos < scanLimit) {
      // The list header (a count) sits within a few hundred bytes before
      // the founding text, no matter how long the city name is
      const windowStart = Math.max(0, pos - 256);
      for (let countPos = pos - 4; countPos >= windowStart; countPos--) {
        const candidate = this.tryParseEventList(state, countPos, endTurn, startTurn);
        if (candidate && candidate.messages.some(m => m.text.includes(' is founded.'))) {
          this.diagnostics.eventListPos = countPos;
          return candidate;
        }
      }
      pos++;
    }

    throw new Error('Unable to locate the replay event list inside the save');
  }

  /**
   * Try to parse a complete event list starting at a candidate position
   * @returns The messages and the end position, or null when any field fails validation
   */
  private tryParseEventList(state: BinaryParser, pos: number, endTurn: number, startTurn: number): { messages: SaveMessage[]; endPos: number } | null {
    const cursor = state.tell();
    state.seek(pos);

    try {
      const count = state.getInt32();
      if (count < 1 || count > 200000) {
        return null;
      }

      const messages: SaveMessage[] = [];
      for (let i = 0; i < count; i++) {
        const turn = state.getInt32();
        if (turn < 0 || turn > endTurn + 10) {
          return null;
        }

        const type = state.getInt32();
        if (type < 0 || type > 6) {
          return null;
        }

        const tileCount = state.getInt32();
        if (tileCount < 0 || tileCount > 2000) {
          return null;
        }

        const tiles = [];
        for (let t = 0; t < tileCount; t++) {
          const x = state.getInt16();
          const y = state.getInt16();
          if (x < -1 || x > 2048 || y < -1 || y > 2048) {
            return null;
          }
          tiles.push({ x, y });
        }

        const civId = state.getInt32();
        if (civId < -1 || civId > MAX_PLAYER_SLOT) {
          return null;
        }

        const textLength = state.getInt32();
        if (textLength < 0 || textLength > 10000) {
          return null;
        }
        const text = state.getString(textLength);

        messages.push({ turn, type, tiles, civId, text });
      }

      // The log always begins at or near the game start
      if (messages[0].turn > startTurn + 5) {
        return null;
      }

      return { messages, endPos: state.tell() };
    } catch (e) {
      // Out of bounds reads just disqualify the candidate
      return null;
    } finally {
      state.seek(cursor);
    }
  }

  /**
   * Collect the sorted list of player slots that ever appeared in the events
   * @param messages The parsed event log
   */
  private collectCivSlots(messages: SaveMessage[]): number[] {
    const slots = new Set<number>();
    for (const message of messages) {
      // The topmost slot is the barbarian horde: it records events but it
      // is not a civilization, so it stays out of the viewer's civ list
      if (message.civId >= 0 && message.civId < MAX_PLAYER_SLOT) {
        slots.add(message.civId);
      }
    }
    return Array.from(slots).sort((a, b) => a - b);
  }

  /**
   * Build the civilization list for the viewer
   * Majors are named from the civilization keys, city states from the minor
   * civ types of their slot
   * @param header The parsed pregame data
   * @param civSlots The ever alive player slots, in slot order
   */
  private buildCivList(header: Record<string, any>, civSlots: number[]): Record<string, unknown>[] {
    const civKeys: string[] = header.civilizationKeys || [];
    const minorTypes: string[] = header.minorCivTypes || [];

    return civSlots.map(slot => {
      const civKey = civKeys[slot] || '';
      const minorKey = minorTypes[slot] || '';

      // Minor slots carry a generic civ key, the specific identity lives in
      // the minor civ type list
      const type = minorKey || civKey;
      return { name: getCivNameFromType(type) };
    });
  }

  /**
   * Scan the decompressed state for replay data clusters
   * Every player slot carries one cluster in slot order, in one of three
   * shapes: a full dataset map for civs that played, a single score series
   * for slots that never joined the game, or nothing at all when the data
   * was wiped
   * @param state Reader over the decompressed game state
   * @param minPos Clusters live after the event list, so scanning starts there
   * @param endTurn The current game turn, upper bound for entry turns
   */
  private scanClusters(state: BinaryParser, minPos: number, endTurn: number): ReplayCluster[] {
    const candidates = this.findDatasetNameCandidates(minPos);

    const clusters: ReplayCluster[] = [];
    let lastEnd = minPos;
    let index = 0;

    while (index < candidates.length) {
      const startPos = candidates[index];
      if (startPos < lastEnd) {
        index++;
        continue;
      }

      const cluster = this.parseClusterAt(state, candidates, index, endTurn);
      if (!cluster) {
        index++;
        continue;
      }

      clusters.push(cluster);
      lastEnd = cluster.endPos;
      // Always consume at least the starting candidate: a region can chain
      // to nothing and end where it began, and the scan must still advance
      index++;
      while (index < candidates.length && candidates[index] < lastEnd) {
        index++;
      }
    }

    this.diagnostics.clusterCount = clusters.length;
    return clusters;
  }

  /**
   * Find the positions of all dataset name length prefixes, the anchors from
   * which cluster parsing starts
   * @param minPos Position to start scanning from
   */
  private findDatasetNameCandidates(minPos: number): number[] {
    const body = this.decompressed;
    const needle = stringToBytes(DATASET_PREFIX);
    const view = new DataView(body.buffer, body.byteOffset, body.byteLength);

    const candidates: number[] = [];
    let pos = minPos;
    while ((pos = findBytes(body, needle, pos)) !== -1) {
      const lengthPos = pos - 4;
      if (lengthPos >= 0) {
        const length = view.getInt32(lengthPos, true);
        if (length >= 15 && length <= 60) {
          candidates.push(lengthPos);
        }
      }
      pos++;
    }

    return candidates;
  }

  /**
   * Parse one cluster starting at a dataset name length prefix
   * Damaged datasets keep their byte layout but can carry nonsense values,
   * and a damaged entry count forces a resync at the next dataset name
   * @param state Reader over the decompressed game state
   * @param candidates All dataset name positions in the buffer
   * @param index The candidate index to start from
   * @param endTurn The current game turn
   */
  private parseClusterAt(state: BinaryParser, candidates: number[], index: number, endTurn: number): ReplayCluster | null {
    const startPos = candidates[index];

    const datasets = new Map<string, { turn: number; value: number }[]>();
    let damagedEntries = 0;
    let validEntries = 0;
    let nameCount = 0;
    let scoreLastNonzeroTurn = -1;
    let endPos = startPos;

    // Walk dataset records back to back, resyncing at the next candidate
    // when a record is too damaged to follow
    let current = index;
    while (current < candidates.length) {
      const namePos = candidates[current];
      if (current > index && namePos - endPos > CLUSTER_RESYNC_LIMIT) {
        // The next dataset name is too far away: the cluster ends here
        break;
      }

      state.seek(namePos);
      const length = state.getInt32();
      if (length < 15 || length > 60) {
        break;
      }
      const name = state.getString(length);
      if (!name.startsWith(DATASET_PREFIX)) {
        break;
      }

      nameCount++;

      const entryCount = state.getInt32();
      if (entryCount < 0 || entryCount > 100000) {
        // Damaged entry count: skip to the next dataset name
        endPos = namePos;
        damagedEntries++;
        current++;
        continue;
      }

      const entries: { turn: number; value: number }[] = [];
      let lastTurn = -1;
      for (let e = 0; e < entryCount; e++) {
        const turn = state.getInt32();
        const value = state.getInt32();
        // Keep only entries a healthy map could have produced: turns inside
        // the game, strictly ascending. Data corrupted in memory fails here
        // and is dropped rather than repaired
        if (turn >= 0 && turn <= endTurn && turn > lastTurn) {
          entries.push({ turn, value });
          lastTurn = turn;
          // The score series is written every turn for every player, so its
          // last nonzero value marks the death turn even when other values
          // rotted
          if (name === DATASET_PREFIX + 'SCORE' && value !== 0) {
            scoreLastNonzeroTurn = turn;
          }
        } else {
          damagedEntries++;
        }
      }

      datasets.set(name, entries);
      validEntries += entries.length;
      endPos = state.tell();
      current++;
    }

    // A chain with no dataset names at all is a byte coincidence, for
    // example a stray string inside script data. A chain with names but no
    // surviving entries is a real region whose values were wiped, and it
    // still occupies a player slot in the sequence
    if (nameCount === 0) {
      return null;
    }

    // A region holding anything beyond the bare score series belongs to a
    // civ that actually played
    const hasGameData = validEntries > 0 && (datasets.size > 1 || !datasets.has(DATASET_PREFIX + 'SCORE'));

    return { startPos, endPos, datasets, damagedEntries, validEntries, nameCount, scoreLastNonzeroTurn, hasGameData };
  }

  /**
   * Predict each civ's city count per turn from the event log, used to
   * attribute clusters to slots when wiped slots create gaps in the sequence
   * @param messages The parsed event log
   * @param civSlots The ever alive player slots
   * @param endTurn The current game turn
   */
  private predictCityCounts(messages: SaveMessage[], civSlots: number[], endTurn: number): Map<number, Int32Array> {
    const cityOwner = new Map<string, number>();
    const counts = new Map<number, number>(civSlots.map(slot => [slot, 0]));
    const series = new Map<number, Int32Array>(civSlots.map(slot => [slot, new Int32Array(endTurn + 1)]));

    let index = 0;
    for (let turn = 0; turn <= endTurn; turn++) {
      // Events are appended in game order, so a single sweep covers the turn
      while (index < messages.length && messages[index].turn <= turn) {
        const message = messages[index];
        const civId = message.civId;

        if (civId >= 0 && counts.has(civId)) {
          if (message.type === 1 && message.tiles.length > 0) {
            // City founded
            const key = `${message.tiles[0].x},${message.tiles[0].y}`;
            counts.set(civId, counts.get(civId)! + 1);
            cityOwner.set(key, civId);
          } else if (message.type === 3) {
            // City captured: the winner gains what the loser loses
            for (const tile of message.tiles) {
              const key = `${tile.x},${tile.y}`;
              const previous = cityOwner.get(key);
              if (previous !== undefined && previous !== civId) {
                counts.set(previous, counts.get(previous)! - 1);
              }
              if (previous !== civId) {
                counts.set(civId, counts.get(civId)! + 1);
                cityOwner.set(key, civId);
              }
            }
          } else if (message.type === 4) {
            // City razed: the current owner loses it
            for (const tile of message.tiles) {
              const key = `${tile.x},${tile.y}`;
              const previous = cityOwner.get(key);
              if (previous !== undefined) {
                counts.set(previous, counts.get(previous)! - 1);
                cityOwner.delete(key);
              }
            }
          }
        }

        index++;
      }

      for (const [slot, line] of series) {
        line[turn] = Math.max(0, counts.get(slot) || 0);
      }
    }

    return series;
  }

  /**
   * Detect the death turn of every civ that died for good
   * A civ counts as dead when its very last event is its own conquest
   * message. A civ that was conquered but came back keeps producing events,
   * so its last event is something else entirely
   * @param messages The parsed event log
   * @param civSlots The ever alive player slots
   */
  private analyzeDeaths(messages: SaveMessage[], civSlots: number[]): Map<number, number> {
    const slotSet = new Set(civSlots);
    const lastTurn = new Map<number, number>();
    const lastIsConquest = new Map<number, boolean>();

    for (const message of messages) {
      if (slotSet.has(message.civId)) {
        // Events arrive in game order, so the last write per civ wins
        lastTurn.set(message.civId, message.turn);
        lastIsConquest.set(message.civId, message.type === 0 && message.text.includes('has been conquered'));
      }
    }

    const deaths = new Map<number, number>();
    for (const slot of civSlots) {
      if (lastIsConquest.get(slot)) {
        deaths.set(slot, lastTurn.get(slot)!);
      }
    }
    return deaths;
  }

  /**
   * Assign clusters to player slots
   * Clusters appear in slot order, one region per slot that has any replay
   * data at all. Full regions belong to ever alive slots, bare score regions
   * to slots that never joined, and regions whose values were wiped still
   * occupy their slot in the sequence. When a full region could belong to
   * either of the next ever alive slots (a wiped slot in between), two
   * signals pick the owner: how well its city count series matches the
   * trajectory predicted from the events, and how well its score series
   * death signature matches the candidate's expected end
   * @param clusters The parsed regions in stream order
   * @param civSlots The ever alive player slots, in slot order
   * @param citySeries Predicted city counts per slot and turn
   * @param deaths Death turns per slot, for civs that died for good
   * @param endTurn The current game turn
   */
  private assignClusters(clusters: ReplayCluster[], civSlots: number[], citySeries: Map<number, Int32Array>, deaths: Map<number, number>, endTurn: number): Map<number, ReplayCluster> {
    const slotSet = new Set(civSlots);
    const neverAlive: number[] = [];
    for (let slot = 0; slot <= MAX_PLAYER_SLOT; slot++) {
      if (!slotSet.has(slot)) {
        neverAlive.push(slot);
      }
    }

    const clusterBySlot = new Map<number, ReplayCluster>();
    let civIndex = 0;
    let neverAliveIndex = 0;
    let unattached = 0;

    for (const cluster of clusters) {
      if (cluster.hasGameData) {
        if (civIndex >= civSlots.length) {
          unattached++;
          continue;
        }

        // Compare the next few ever alive slots and let the data decide
        // when a wiped slot makes the nearest candidate the wrong one
        let chosen = 0;
        const candidateCount = Math.min(3, civSlots.length - civIndex);
        if (candidateCount > 1) {
          const scores: number[] = [];
          for (let k = 0; k < candidateCount; k++) {
            const slot = civSlots[civIndex + k];
            const trajectory = this.cityTrajectoryScore(cluster, slot, citySeries, endTurn);
            const death = this.deathFit(cluster, slot, deaths, endTurn);
            scores.push(0.5 * (trajectory < 0 ? 0 : trajectory) + 0.5 * death);
          }
          let best = 0;
          for (let k = 1; k < scores.length; k++) {
            if (scores[k] > scores[best]) {
              best = k;
            }
          }
          // Skipping a slot needs strong evidence, otherwise the nearest
          // slot wins and wiped slots stay empty
          if (best > 0 && scores[best] - scores[0] > 0.15) {
            chosen = best;
          }
        }

        const slot = civSlots[civIndex + chosen];
        clusterBySlot.set(slot, cluster);
        civIndex += chosen + 1;
      } else if (cluster.validEntries === 0 && cluster.nameCount > 1) {
        // A region with many dataset names but no surviving values belongs
        // to a civ that played: its slot is consumed even though nothing
        // can be salvaged from it
        if (civIndex < civSlots.length) {
          civIndex++;
        } else {
          unattached++;
        }
      } else {
        // A bare or wiped score series marks a slot that never joined the
        // game, with a fallback for civs that only ever recorded a score
        if (neverAliveIndex < neverAlive.length) {
          neverAliveIndex++;
        } else if (civIndex < civSlots.length) {
          civIndex++;
        } else {
          unattached++;
        }
      }
    }

    this.diagnostics.damagedClusters = clusters.filter(c => c.damagedEntries > 0).length;
    this.diagnostics.unattachedClusters = unattached;

    if (unattached > 0) {
      console.warn(`${unattached} replay data clusters could not be matched to a player slot`);
    }

    return clusterBySlot;
  }

  /**
   * Score how well a cluster's score series death signature matches a
   * candidate's expected end
   * The score series is written every turn for every player and drops to
   * zero for good after death, so its last nonzero turn should land on the
   * candidate's death turn, or on the final turn for a survivor
   * @returns A fit between 0 and 1, or 0 when the signature is unreadable
   */
  private deathFit(cluster: ReplayCluster, slot: number, deaths: Map<number, number>, endTurn: number): number {
    if (cluster.scoreLastNonzeroTurn < 0) {
      return 0;
    }
    const expected = deaths.has(slot) ? deaths.get(slot)! : endTurn;
    return Math.max(0, 1 - Math.abs(cluster.scoreLastNonzeroTurn - expected) / 20);
  }

  /**
   * Score how well a cluster's city count series matches the city trajectory
   * predicted from the events of one slot
   * @returns The fraction of matching turns, or -1 when there is too little
   * clean data to judge
   */
  private cityTrajectoryScore(cluster: ReplayCluster, slot: number, citySeries: Map<number, Int32Array>, endTurn: number): number {
    const entries = cluster.datasets.get(DATASET_PREFIX + 'CITYCOUNT');
    const line = citySeries.get(slot);
    if (!entries || !line || entries.length === 0) {
      return -1;
    }

    let comparable = 0;
    let matches = 0;
    for (const entry of entries) {
      if (entry.turn <= endTurn) {
        comparable++;
        if (entry.value === line[entry.turn]) {
          matches++;
        }
      }
    }

    return comparable >= 30 ? matches / comparable : -1;
  }

  /**
   * Read the map dimensions
   * The map section follows the embedded savegame database directly, but its
   * fields can carry corrupted high bytes, so both dimensions are masked to
   * their low sixteen bits. When the landmark does not validate, the event
   * coordinates provide a fallback estimate. The section position is returned
   * alongside the dimensions so the terrain walker can start from there
   * @param state Reader over the decompressed game state
   * @param messages The parsed event log
   */
  private readMapDimensions(state: BinaryParser, messages: SaveMessage[]): { width: number; height: number; mapPos: number } {
    const body = this.decompressed;
    const view = new DataView(body.buffer, body.byteOffset, body.byteLength);

    // First choice: the grid header right after the savegame database
    const dbPos = findBytes(body, stringToBytes(SQLITE_MAGIC), 0);
    if (dbPos > 4) {
      const dbSize = view.getInt32(dbPos - 4, true);
      const mapPos = dbPos + dbSize;
      if (dbSize > 0 && mapPos + 8 <= body.byteLength) {
        state.seek(mapPos);
        const width = state.getInt32() & 0xffff;
        const height = state.getInt32() & 0xffff;
        if (this.validateMapDims(width, height, messages)) {
          this.diagnostics.mapDimsSource = 'map-section';
          return { width, height, mapPos };
        }
      }
    }

    // Fallback: the largest coordinates seen in the events
    let maxX = 0;
    let maxY = 0;
    for (const message of messages) {
      for (const tile of message.tiles) {
        if (tile.x > maxX) maxX = tile.x;
        if (tile.y > maxY) maxY = tile.y;
      }
    }

    if (maxX > 0 && maxY > 0) {
      this.diagnostics.mapDimsSource = 'events';
      return { width: maxX + 1, height: maxY + 1, mapPos: -1 };
    }

    this.diagnostics.mapDimsSource = 'none';
    return { width: 0, height: 0, mapPos: -1 };
  }

  /**
   * Check that map dimensions are plausible given the event coordinates
   */
  private validateMapDims(width: number, height: number, messages: SaveMessage[]): boolean {
    if (width < 16 || width > 512 || height < 16 || height > 512) {
      return false;
    }
    for (const message of messages) {
      for (const tile of message.tiles) {
        if (tile.x >= width || tile.y >= height) {
          return false;
        }
      }
    }
    return true;
  }

  /**
   * Assemble the output in the same shape the replay parser produces
   */
  private assembleRawData(
    header: Record<string, any>,
    prelude: { startTurn: number; endTurn: number; startYear: number },
    civs: Record<string, unknown>[],
    civSlots: number[],
    slotToIndex: Map<number, number>,
    messages: SaveMessage[],
    clusters: ReplayCluster[],
    clusterBySlot: Map<number, ReplayCluster>,
    mapDims: { width: number; height: number },
    terrain: MapTerrainResult | null
  ): Record<string, unknown> {
    // Union of all dataset names, alphabetical like the replay file order
    const datasetNames = new Set<string>();
    for (const cluster of clusters) {
      for (const name of cluster.datasets.keys()) {
        datasetNames.add(name);
      }
    }
    const datasets = Array.from(datasetNames).sort().map(key => ({ key }));

    // Per civ value tables aligned with the dataset name list
    const datasetValues = civSlots.map(slot => {
      const cluster = clusterBySlot.get(slot);
      return datasets.map(d => (cluster && cluster.datasets.get(d.key)) || []);
    });

    // Remap the raw slot ids in the events to dense civ indices
    const events = messages.map(message => ({
      turn: message.turn,
      type: message.type,
      tiles: message.tiles,
      civId: message.civId >= 0 ? (slotToIndex.get(message.civId) ?? -1) : message.civId,
      text: message.text
    }));

    // Tiles from the plot walk when it passed the quality gate, otherwise
    // placeholders: the hex grid renders without textures while cities,
    // borders and event highlights stay fully functional
    const tiles: Record<string, number>[] = [];
    if (mapDims.width > 0 && mapDims.height > 0) {
      for (let i = 0; i < mapDims.width * mapDims.height; i++) {
        const t = terrain && terrain.tiles[i];
        if (t) {
          tiles.push({ elevation: t.elevation, type: t.type, feature: t.feature });
        } else {
          tiles.push({ elevation: -1, type: -1, feature: -1 });
        }
      }
    }

    return {
      game: header.game,
      version: header.version,
      build: header.build,
      playerCiv: header.playerCiv,
      playerColor: header.playerColor,
      difficulty: header.difficulty,
      eraStart: header.eraStart,
      eraEnd: header.eraEnd,
      gameSpeed: header.gameSpeed,
      worldSize: header.worldSize,
      mapScript: header.mapScript,
      dlc: header.dlc,
      mods: header.mods,
      startTurn: prelude.startTurn,
      startYear: prelude.startYear,
      endTurn: prelude.endTurn,
      endYear: `Turn ${prelude.endTurn}`,
      civs,
      datasets,
      datasetValues,
      events,
      mapWidth: mapDims.width,
      mapHeight: mapDims.height,
      tiles
    };
  }
}
