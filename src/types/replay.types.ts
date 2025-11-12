/**
 * replay.types.ts
 * Type definitions for replay data structures
 */

// Civilization data
export interface Civilization {
  _1: number;
  _2: number;
  _3: number;
  _4: number;
  leader: string;
  longName: string;
  name: string;
  demonym: string;
}

// DLC information
export interface DLC {
  id: string;
  enabled: number;
  name: string;
}

// Mod information
export interface Mod {
  id: string;
  version: number;
  name: string;
}

// Replay metadata
export interface ReplayMetadata {
  game: string;
  version: string;
  build: string;
  playerCiv: string;
  difficulty: string;
  eraStart: string;
  eraEnd: string;
  gameSpeed: string;
  worldSize: string;
  mapScript: string;
  dlc: DLC[];
  mods: Mod[];
  playerColor: string;
  mapScript2: string;
  startTurn: number;
  startYear: number;
  endTurn: number;
  endYear: string;
  zeroStartYear: number;
  zeroEndYear: number;
  width?: number;
  height?: number;
  mapWidth?: number;
  mapHeight?: number;
  [key: string]: unknown;
}

// Tile data
export interface Tile {
  x: number;
  y: number;
  terrain?: number;
  improvement?: number;
  route?: number;
  owner?: number;
  city?: number;
  visibility?: number[];
  resource?: number;
  natural_wonder?: number;

  // Type and feature can be either number (ID) or string (name)
  type?: number | string;
  typeId?: number;
  feature?: number | string;
  featureId?: number;

  // Human-readable fields added after parsing
  elevationId?: number;
  elevation?: string | number;
  terrainName?: string;
  ownerName?: string;
  cityName?: string;

  // Allow additional properties
  [key: string]: number | number[] | string | undefined;
}

// Event data
export interface GameEvent {
  turn: number;
  type: string | number;
  typeId?: number;
  tiles?: Tile[];
  civs?: number[];
  civId?: number;
  civ?: string | null;
  description?: string;
  text?: string;
  x?: number;
  y?: number;
  index?: number;
  city?: City | { name: string; owner: string | null };
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

// City data
export interface City {
  name: string;
  owner: string | number | null;
  x?: number;
  y?: number;
  population?: number;
  [key: string]: unknown;
}

// Dataset entry
export interface DatasetEntry {
  key: string;
}

// Dataset values
export interface DatasetValues {
  turns: number[];
  values: number[][];
}

// Complete raw data structure from parser
export interface RawReplayData {
  game: string;
  _0: number;
  version: string;
  build: string;
  _1: Uint8Array;
  playerCiv: string;
  difficulty: string;
  eraStart: string;
  eraEnd: string;
  gameSpeed: string;
  worldSize: string;
  mapScript: string;
  dlc: DLC[];
  mods: Mod[];
  _2: string;
  _3: string;
  playerColor: string;
  _4: Uint8Array;
  mapScript2: string;
  startTurn: number;
  startYear: number;
  endTurn: number;
  endYear: string;
  zeroStartYear: number;
  zeroEndYear: number;
  civs: Civilization[];
  datasets: DatasetEntry[];
  datasetValues: DatasetValues;
  width: number;
  height: number;
  tiles: Tile[][];
  eventCount: number;
  events: GameEvent[];
}

// File configuration for binary parser
export interface FileConfig {
  [key: string]: string | number | FileConfigItem | FileConfigArray | Function;
}

export interface FileConfigItem {
  type: string;
  length?: number;
}

export interface FileConfigArray {
  type: 'array';
  items: FileConfig;
}