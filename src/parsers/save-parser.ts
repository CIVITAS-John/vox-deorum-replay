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
 * Beyond the replay content, the parser reads the save-only snapshot data
 * that sits at known offsets: the victory result from the game section
 * prelude, the map header (wrap flags and map-wide counts) in front of the
 * plot records, and the per plot snapshot fields (owner, resource,
 * improvement, route, city flag, owning city) inside each plot record.
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
import { inflateZlib } from './utils/inflate';
import { getCivNameFromType } from './utils/civ-names';
import { FileConfig } from './types';

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
  terrainGatePassed: boolean;
}

/** Terrain data of one plot, shaped the way the replay pipeline expects it */
export interface MapTerrainTile {
  elevation: number;
  type: number;
  feature: number;
  /** One river id per hex direction in the order NE, E, SE, SW, W, NW, each -1 when the edge has no river */
  rivers: number[];
  /** Snapshot: owning player slot, -1 when unowned */
  owner: number;
  /** Snapshot: resource type index, -1 when none */
  resource: number;
  /** Snapshot: improvement type index, -1 when none */
  improvement: number;
  /** Snapshot: route type index, -1 when none */
  route: number;
  /** Snapshot: 1 when a city stands on the plot */
  isCity: number;
  /** Snapshot: player slot of the city whose borders cover the plot, -1 when none */
  owningCityOwner: number;
  /** Snapshot: id of the city whose borders cover the plot, -1 when none */
  owningCityId: number;
}

/**
 * Map section header: grid size and map-wide facts. Like terrain and rivers,
 * these are fixed when the map is generated, so they are valid at every turn
 * even though only save files carry them.
 */
export interface MapHeader {
  width: number;
  height: number;
  /** Plots that are not water */
  landPlots: number;
  /** Plots owned by any player at the save turn */
  ownedPlots: number;
  /** Natural wonders on the map */
  numNaturalWonders: number;
  /** Latitude range of the map, purely decorative */
  topLatitude: number;
  bottomLatitude: number;
  /** Whether the map wraps horizontally */
  wrapX: boolean;
  /** Whether the map wraps vertically */
  wrapY: boolean;
  /** Whether the map was generated in game rather than loaded from a file */
  mapGenerated: boolean;
}

/**
 * Victory result of a loaded game. The save parser reads it from the game
 * section header, where it can lie (a modded or hand-edited game), so a
 * file result counts as reliable only when the event log confirms it with
 * a victory message at the winning turn. A result can also come from the
 * `winner` parameter of a shared link, for saves taken before the game was
 * won: such a save cannot prove its result, so the sharer asserts it. The
 * interface may present a winner only when reliable is true, and the source
 * tells the reader whether the file or the link vouches for it.
 */
export interface VictoryInfo {
  /** Turn the game was won on, -1 when nobody has won yet or the turn is unknown */
  winningTurn: number;
  /** Raw team id of the winner, -1 when none or unknown */
  winnerTeam: number;
  /** Raw index into the mod's Victories table, -1 when none; the victory event text is the readable source */
  victoryType: number;
  /** 0 while the game runs, 1 when it is over, 2 when playing on after the end, -1 when unknown */
  gameState: number;
  /** Dense civilization index of the winner, taken from the victory event or the link, -1 when unknown */
  winnerCivId: number;
  /** True when the result may be presented: proven by the file or asserted by a shared link */
  reliable: boolean;
  /** Where the result comes from: the loaded file, or the winner parameter of a shared link */
  source: 'file' | 'link';
}

/** Dataset quality of one civilization, so statistics can label uncertain series */
export interface DatasetDiagnostics {
  /** True when a replay data region was attached to the civilization's player slot */
  attached: boolean;
  /** Entries dropped or repaired across the region's series, zero when clean */
  damagedEntries: number;
}

/** Terrain statistics reported by the plot record walk */
export interface MapTerrainStats {
  /** Byte offset of the first plot record, or -1 when the array was not found */
  arrayStart: number;
  /** Plot records the walk decoded */
  slotsFilled: number;
  /** Plots that border at least one river */
  riverPlots: number;
}

/** Terrain extraction result: one entry per plot, null when unknown */
export interface MapTerrainResult {
  tiles: (MapTerrainTile | null)[];
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
 * The plot record array of the map section, decoded with the exact
 * CvPlot::Serialize layout of the game DLL. The constants below describe one
 * record: a small counter prefix, the river id list, the terrain fields, a
 * per team visibility block, the revealed bits, and a tail of counted pieces
 */

/** Size of the map header in front of the two resource count tables */
const MAP_HEADER_SIZE = 47;
/** Both resource count tables together take four bytes per resource type */
const MAP_RESOURCE_ENTRY_SIZE = 8;
/** How many resource types the first record search tries at most */
const MAP_MAX_RESOURCE_TYPES = 300;
/** Length of the shortest possible plot record, every variable part empty */
const PLOT_MIN_RECORD_SIZE = 1422;
/** Offset of the river id list count word inside a plot record */
const PLOT_RIVER_COUNT_OFFSET = 17;
/** A plot holds one river id per hex direction and the list stays short */
const PLOT_MAX_RIVERS = 64;
/** Offset of the owner byte behind the river id list */
const PLOT_OWNER_OFFSET = 7;
/** Offset of the plot type byte behind the river id list */
const PLOT_PLOT_TYPE_OFFSET = 8;
/** Offset of the terrain type byte behind the river id list */
const PLOT_TERRAIN_OFFSET = 9;
/** Offset of the feature word behind the river id list, stored as a full enum */
const PLOT_FEATURE_OFFSET = 10;
/** Offset of the resource word behind the river id list, stored as a full enum */
const PLOT_RESOURCE_OFFSET = 14;
/** Offset of the improvement word behind the river id list, stored as a full enum */
const PLOT_IMPROVEMENT_OFFSET = 18;
/** Offset of the route byte behind the river id list */
const PLOT_ROUTE_OFFSET = 30;
/** Offset of the city flag byte behind the river id list */
const PLOT_IS_CITY_OFFSET = 38;
/** Offset of the owning city pair behind the river id list: owner then city id, both int32 */
const PLOT_OWNING_CITY_OFFSET = 39;
/** Size of the per team visibility block between the yields and the revealed bits */
const PLOT_TEAM_BLOCK_SIZE = 1024;
/** Size of the revealed bits array behind the team block */
const PLOT_REVEALED_BITS_SIZE = 256;
/**
 * Distance from the end of the river id list to the river crossing byte of
 * the record tail: the packed flag word, the counter and enum fields, the
 * owning city pairs, the yields, the team block, and the revealed bits
 */
const PLOT_TAIL_START = 1352;
/** Closing fields behind the unit list: continent, archaeology, trade route, build turn, spawned resource */
const PLOT_CLOSING_FIELDS_SIZE = 31;
/** A candidate head must chain into this many followers to count as the array start */
const PLOT_TRIAL_RECORDS = 30;

/** The decoded fields of one plot record */
interface PlotRecord {
  /** Position where the next record starts */
  end: number;
  plotType: number;
  terrain: number;
  feature: number;
  /** One river id per hex direction, -1 when the edge has no river */
  rivers: number[];
  /** Owning player slot, -1 when unowned */
  owner: number;
  /** Resource type index, -1 when none */
  resource: number;
  /** Improvement type index, -1 when none */
  improvement: number;
  /** Route type index, -1 when none */
  route: number;
  /** 1 when a city stands on the plot */
  isCity: number;
  /** Player slot of the city whose borders cover the plot, -1 when none */
  owningCityOwner: number;
  /** Id of the city whose borders cover the plot, -1 when none */
  owningCityId: number;
}

/**
 * Decode one plot record following the exact CvPlot::Serialize layout of the
 * game DLL. Every counted piece of the tail must carry a plausible size
 * word, otherwise the bytes are not a record and the walk must stop
 * @param body The decompressed game state
 * @param view Little endian view over the game state
 * @param s Record start
 * @returns The record fields and the position of the next record, or null
 * when the bytes do not follow the layout
 */
function decodePlotRecord(body: Uint8Array, view: DataView, s: number): PlotRecord | null {
  if (s < 0 || s + PLOT_MIN_RECORD_SIZE > body.length) return null;

  // The river id list starts with a count word, the all ones value marks an
  // empty list, then comes one river id per hex direction
  const riverWord = view.getUint32(s + PLOT_RIVER_COUNT_OFFSET, true);
  if (riverWord !== 0xFFFFFFFF && riverWord > PLOT_MAX_RIVERS) return null;
  const riverCount = riverWord === 0xFFFFFFFF ? 0 : riverWord;
  const rivers: number[] = [];
  for (let i = 0; i < riverCount; i++) {
    rivers.push(view.getInt32(s + 21 + i * 4, true));
  }

  // Behind the river id list every field sits at a fixed offset
  const base = s + 21 + riverCount * 4;
  const owner = view.getInt8(base + PLOT_OWNER_OFFSET);
  const plotType = view.getInt8(base + PLOT_PLOT_TYPE_OFFSET);
  const terrain = view.getInt8(base + PLOT_TERRAIN_OFFSET);
  const feature = view.getInt32(base + PLOT_FEATURE_OFFSET, true);
  const resource = view.getInt32(base + PLOT_RESOURCE_OFFSET, true);
  const improvement = view.getInt32(base + PLOT_IMPROVEMENT_OFFSET, true);
  const route = view.getInt8(base + PLOT_ROUTE_OFFSET);
  const isCity = body[base + PLOT_IS_CITY_OFFSET];
  const owningCityOwner = view.getInt32(base + PLOT_OWNING_CITY_OFFSET, true);
  const owningCityId = view.getInt32(base + PLOT_OWNING_CITY_OFFSET + 4, true);

  // The counted tail pieces. Script data exists only behind a flag byte,
  // the other pieces always carry their count word
  let p = base + PLOT_TAIL_START;
  p += 1; // river crossing
  const scriptFlag = body[p];
  p += 1;
  if (scriptFlag !== 0) {
    const len = view.getUint32(p, true);
    if (len === 0xFFFFFFFF) p += 4;
    else if (len <= 10000) p += 4 + len;
    else return null;
  }
  // Build progress: pairs of build type and remaining work
  const buildCount = view.getUint32(p, true);
  if (buildCount === 0xFFFFFFFF) p += 4;
  else if (buildCount <= 20) p += 4 + buildCount * 8;
  else return null;
  // Invisible visibility unit counts: pairs of team and count
  const invisibleUnits = view.getUint32(p, true);
  if (invisibleUnits === 0xFFFFFFFF) p += 4;
  else if (invisibleUnits <= 200) p += 4 + invisibleUnits * 8;
  else return null;
  // Invisible visibility counts: pairs of team and a counted int vector
  const invisiblePlots = view.getUint32(p, true);
  if (invisiblePlots === 0xFFFFFFFF) p += 4;
  else if (invisiblePlots <= 200) {
    p += 4;
    for (let i = 0; i < invisiblePlots; i++) {
      p += 4; // the team id
      const inner = view.getUint32(p, true);
      if (inner === 0xFFFFFFFF) p += 4;
      else if (inner <= 500) p += 4 + inner * 4;
      else return null;
    }
  } else return null;
  // Units: pairs of owner and unit id
  const unitCount = view.getUint32(p, true);
  if (unitCount === 0xFFFFFFFF) p += 4;
  else if (unitCount <= 500) p += 4 + unitCount * 8;
  else return null;

  p += PLOT_CLOSING_FIELDS_SIZE;
  if (p > body.length) return null;
  return { end: p, plotType, terrain, feature, rivers, owner, resource, improvement, route, isCity, owningCityOwner, owningCityId };
}

/**
 * Extract the map terrain by decoding the plot records of the map section.
 * The records sit row by row behind the map header and the two resource
 * count tables. The table size depends on the mod set, so the first record
 * is found by trying every possible table size until a plausible head chains
 * cleanly across the whole map. When no candidate covers the map, the best
 * partial walk is returned and the caller decides through the coverage gate
 * whether the terrain is trustworthy
 * @param body The decompressed game state
 * @param mapPos Byte offset of the map section header
 * @param width Map width in plots
 * @param height Map height in plots
 * @returns The terrain tiles, null where a record failed to decode, plus walk statistics
 */
export function extractMapTerrain(body: Uint8Array, mapPos: number, width: number, height: number): MapTerrainResult {
  const numPlots = width * height;
  const empty: (MapTerrainTile | null)[] = new Array(numPlots).fill(null);
  const stats: MapTerrainStats = { arrayStart: -1, slotsFilled: 0, riverPlots: 0 };
  if (numPlots <= 0) return { tiles: empty, stats };
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);

  // Decode records from the given start until the map is full or a record
  // breaks the layout
  const walk = (start: number): MapTerrainResult => {
    const tiles: (MapTerrainTile | null)[] = new Array(numPlots).fill(null);
    const walkStats: MapTerrainStats = { arrayStart: start, slotsFilled: 0, riverPlots: 0 };
    let p = start;
    for (let i = 0; i < numPlots; i++) {
      const record = decodePlotRecord(body, view, p);
      if (!record) break;
      tiles[i] = {
        elevation: record.plotType,
        type: record.terrain,
        feature: record.feature,
        rivers: record.rivers,
        owner: record.owner,
        resource: record.resource,
        improvement: record.improvement,
        route: record.route,
        isCity: record.isCity,
        owningCityOwner: record.owningCityOwner,
        owningCityId: record.owningCityId
      };
      if (record.rivers.some(id => id >= 0)) walkStats.riverPlots++;
      walkStats.slotsFilled++;
      p = record.end;
    }
    return { tiles, stats: walkStats };
  };

  // A valid start decodes as a plausible terrain head and chains into
  // further records. Resource table bytes never survive both checks
  const looksLikeRecord = (pos: number): boolean => {
    const first = decodePlotRecord(body, view, pos);
    if (!first) return false;
    if (first.plotType < 0 || first.plotType > 3) return false;
    if (first.terrain < 0 || first.terrain > 15) return false;
    if (first.feature < -1 || first.feature > 200) return false;
    let p = first.end;
    for (let i = 1; i < PLOT_TRIAL_RECORDS; i++) {
      const record = decodePlotRecord(body, view, p);
      if (!record) return false;
      p = record.end;
    }
    return true;
  };

  // Candidates are tried from the largest table size downward. A start inside
  // the resource tables can only chain when a table word happens to mimic a
  // river count and lands the field base on the real first record, so the
  // deepest candidate that chains is the true first record
  let best: MapTerrainResult | null = null;
  for (let resources = MAP_MAX_RESOURCE_TYPES; resources >= 1; resources--) {
    const candidate = mapPos + MAP_HEADER_SIZE + resources * MAP_RESOURCE_ENTRY_SIZE;
    if (candidate + PLOT_MIN_RECORD_SIZE > body.length) continue;
    if (!looksLikeRecord(candidate)) continue;
    const walked = walk(candidate);
    if (walked.stats.slotsFilled === numPlots) return walked;
    if (!best || walked.stats.slotsFilled > best.stats.slotsFilled) best = walked;
  }
  return best ?? { tiles: empty, stats };
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

    // The victory result needs the event log and the slot mapping
    const victory = this.buildVictoryInfo(prelude, eventList.messages, slotToIndex);

    // Stage 7: replay data clusters, one per player slot in slot order
    const clusters = this.scanClusters(state, eventList.endPos, endTurn);
    const citySeries = this.predictCityCounts(eventList.messages, civSlots, endTurn);
    const deaths = this.analyzeDeaths(eventList.messages, civSlots);
    const clusterBySlot = this.assignClusters(clusters, civSlots, citySeries, deaths, endTurn);

    // Stage 8: the map section header, then assemble the output shape
    const mapDims = this.readMapSection(state, eventList.messages);

    // Stage 9: decode the plot records for terrain when the map section was found
    let terrain: MapTerrainResult | null = null;
    if (mapDims.mapPos >= 0 && mapDims.width > 0 && mapDims.height > 0) {
      terrain = extractMapTerrain(this.decompressed, mapDims.mapPos, mapDims.width, mapDims.height);
      const coverage = terrain.stats.slotsFilled / (mapDims.width * mapDims.height);
      this.diagnostics.terrainCoverage = coverage;
      this.diagnostics.terrainTrusted = terrain.stats.slotsFilled;

      // A save from a different game version can leave the walk short.
      // Only render terrain when the walk covered nearly the whole map,
      // otherwise fall back to blank hexes
      this.diagnostics.terrainGatePassed = coverage >= 0.9;
      if (!this.diagnostics.terrainGatePassed) {
        console.warn(`Save terrain unreliable: the plot walk covered ${(coverage * 100).toFixed(1)}% of the map, rendering blank hexes`);
        terrain = null;
      }
    } else {
      this.diagnostics.terrainCoverage = 0;
      this.diagnostics.terrainGatePassed = false;
    }

    return this.assembleRawData(header, prelude, victory, civs, civSlots, slotToIndex,
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
   * version string, then the game fields including the turn counters, the
   * start year, and the victory result. Every field up to the victory block
   * has a fixed size, so the read is one straight walk following
   * CvGame::Serialize in the game DLL
   * @param state Reader over the decompressed game state
   * @param headerTurn The game turn from the engine header, for cross checking
   */
  private parseGamePrelude(state: BinaryParser, headerTurn: number): {
    startTurn: number;
    endTurn: number;
    startYear: number;
    winningTurn: number;
    winnerTeam: number;
    victoryType: number;
    gameState: number;
  } {
    state.getInt32();                  // Save version, always 0
    state.getBytes(16);                // Game data hash
    state.getVarString();              // Game core version string

    state.getInt32();                  // End turn messages sent
    const elapsedGameTurns = state.getInt32();
    const startTurn = state.getInt32();
    const winningTurn = state.getInt32();
    const startYear = state.getInt32();

    // Turn estimates, slice counters, and score counters up to the civ counts
    for (let i = 0; i < 28; i++) {
      state.getInt32();
    }
    // Six bools: score dirty, circumnavigated, and friends
    for (let i = 0; i < 6; i++) {
      state.getInt8();
    }
    state.getInt32();                  // Observer UI override player
    // Five bools: tuner, saved once, tutorial, and friends
    for (let i = 0; i < 5; i++) {
      state.getInt8();
    }
    // Advisor messages viewed: a counted set of hashes
    const advisorMessages = state.getInt32();
    if (advisorMessages < 0 || advisorMessages > 100000) {
      throw new Error(`Implausible advisor message count ${advisorMessages} in the game prelude`);
    }
    state.getBytes(advisorMessages * 4);

    state.getInt32();                  // Handicap
    state.getInt32();                  // Pause player
    state.getInt32();                  // AI auto play return player
    state.getInt32();                  // Best land unit
    const winnerTeam = state.getInt32();
    const victoryType = state.getInt32();
    const gameState = state.getInt32();

    const endTurn = elapsedGameTurns;
    if (endTurn !== headerTurn) {
      console.warn(`Save turn mismatch: header says ${headerTurn}, game section says ${endTurn}`);
    }

    return { startTurn, endTurn, startYear, winningTurn, winnerTeam, victoryType, gameState };
  }

  /**
   * Build the victory result from the prelude fields and the event log
   * A result counts as reliable only when the header claims a winner and the
   * event log carries the matching victory message at the winning turn; the
   * winner civilization comes from that message, whose slot is mapped to the
   * dense civ index
   * @param prelude The parsed game prelude
   * @param messages The raw event log, with original player slots
   * @param slotToIndex Mapping from player slots to dense civ indices
   */
  private buildVictoryInfo(
    prelude: { startTurn: number; endTurn: number; startYear: number; winningTurn: number; winnerTeam: number; victoryType: number; gameState: number },
    messages: SaveMessage[],
    slotToIndex: Map<number, number>
  ): VictoryInfo {
    // The header claims a winner when the winning turn is past the start and
    // the victory fields are set; m_iWinningTurn stays 0 until someone wins
    const claimed = prelude.winningTurn > 0 && prelude.victoryType >= 0 &&
      prelude.winnerTeam >= 0 && prelude.gameState !== 0;

    // The event log must confirm the claim with a victory message at the
    // winning turn, which also names the winning civilization
    const victoryEvent = claimed
      ? messages.find(m => m.turn === prelude.winningTurn && m.civId >= 0 && m.text.includes(' has won a '))
      : undefined;

    const winnerSlot = victoryEvent ? victoryEvent.civId : -1;
    const winnerCivId = winnerSlot >= 0 ? (slotToIndex.get(winnerSlot) ?? -1) : -1;

    return {
      winningTurn: claimed ? prelude.winningTurn : -1,
      winnerTeam: prelude.winnerTeam,
      victoryType: prelude.victoryType,
      gameState: prelude.gameState,
      winnerCivId,
      reliable: victoryEvent !== undefined && winnerCivId >= 0,
      source: 'file'
    };
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
   * Read the map section: dimensions from the grid header right after the
   * savegame database, plus the rest of the header (land and owned plot
   * counts, natural wonders, latitudes, wrap flags). The header fields can
   * carry corrupted high bytes, so both dimensions are masked to their low
   * sixteen bits. When the landmark does not validate, the event coordinates
   * provide a fallback estimate and no header is returned. The section
   * position is returned alongside so the terrain walker can start from there
   * @param state Reader over the decompressed game state
   * @param messages The parsed event log
   */
  private readMapSection(state: BinaryParser, messages: SaveMessage[]): { width: number; height: number; mapPos: number; header: MapHeader | null } {
    const body = this.decompressed;
    const view = new DataView(body.buffer, body.byteOffset, body.byteLength);

    // First choice: the grid header right after the savegame database
    const dbPos = findBytes(body, stringToBytes(SQLITE_MAGIC), 0);
    if (dbPos > 4) {
      const dbSize = view.getInt32(dbPos - 4, true);
      const mapPos = dbPos + dbSize;
      if (dbSize > 0 && mapPos + MAP_HEADER_SIZE <= body.byteLength) {
        state.seek(mapPos);
        const width = state.getInt32() & 0xffff;
        const height = state.getInt32() & 0xffff;
        if (this.validateMapDims(width, height, messages)) {
          // The rest of the 47 byte header: plot counts, natural wonders,
          // latitudes, wrap flags, a 16 byte GUID, and the generated flag
          const landPlots = state.getInt32();
          const ownedPlots = state.getInt32();
          const numNaturalWonders = state.getInt32();
          const topLatitude = state.getInt32();
          const bottomLatitude = state.getInt32();
          const wrapX = state.getInt8() !== 0;
          const wrapY = state.getInt8() !== 0;
          state.getBytes(16);          // Map GUID, of no use to the viewer
          const mapGenerated = state.getInt8() !== 0;
          this.diagnostics.mapDimsSource = 'map-section';
          const header: MapHeader = { width, height, landPlots, ownedPlots, numNaturalWonders, topLatitude, bottomLatitude, wrapX, wrapY, mapGenerated };
          return { width, height, mapPos, header };
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
      return { width: maxX + 1, height: maxY + 1, mapPos: -1, header: null };
    }

    this.diagnostics.mapDimsSource = 'none';
    return { width: 0, height: 0, mapPos: -1, header: null };
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
   * Assemble the output in the same shape the replay parser produces, plus
   * the save-only extras: the map header, the victory result, the player
   * slots behind the civilization list, and the per civ dataset diagnostics
   */
  private assembleRawData(
    header: Record<string, any>,
    prelude: { startTurn: number; endTurn: number; startYear: number },
    victory: VictoryInfo,
    civs: Record<string, unknown>[],
    civSlots: number[],
    slotToIndex: Map<number, number>,
    messages: SaveMessage[],
    clusters: ReplayCluster[],
    clusterBySlot: Map<number, ReplayCluster>,
    mapDims: { width: number; height: number; header: MapHeader | null },
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

    // Per civ dataset quality, so statistics can label uncertain series
    const datasetDiagnostics: DatasetDiagnostics[] = civSlots.map(slot => {
      const cluster = clusterBySlot.get(slot);
      return { attached: cluster !== undefined, damagedEntries: cluster ? cluster.damagedEntries : 0 };
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
    const tiles: Record<string, unknown>[] = [];
    if (mapDims.width > 0 && mapDims.height > 0) {
      for (let i = 0; i < mapDims.width * mapDims.height; i++) {
        const t = terrain && terrain.tiles[i];
        if (t) {
          tiles.push({
            elevation: t.elevation, type: t.type, feature: t.feature, rivers: t.rivers,
            owner: t.owner, resource: t.resource, improvement: t.improvement, route: t.route,
            isCity: t.isCity, owningCityOwner: t.owningCityOwner, owningCityId: t.owningCityId
          });
        } else {
          tiles.push({
            elevation: -1, type: -1, feature: -1, rivers: [],
            owner: -1, resource: -1, improvement: -1, route: -1,
            isCity: 0, owningCityOwner: -1, owningCityId: -1
          });
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
      civSlots,
      datasets,
      datasetValues,
      datasetDiagnostics,
      events,
      mapWidth: mapDims.width,
      mapHeight: mapDims.height,
      mapHeader: mapDims.header,
      victory,
      tiles
    };
  }
}
