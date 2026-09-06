/**
  * types.ts
 * Type definitions for replay data structures
 */

// Event type enum for better type safety
export enum EventType {
  Message = 0,
  CityFounded = 1,
  TilesClaimed = 2,
  CitiesTransferred = 3,
  CityRazed = 4,
  ReligionFounded = 5,
  PantheonSelected = 6,
  Strategies = 7
}

// Whether a piece of data is known at every turn or only at the loaded save's turn
export enum DataKind {
  History = 'history',        // Known at every turn (event log, datasets, terrain)
  Snapshot = 'snapshot'       // Known only at the turn the save was taken
}

// Elevation type enum
export enum ElevationType {
  Mountain = 0,
  Hills = 1,
  AboveSeaLevel = 2,
  BelowSeaLevel = 3
}

// Tile type enum
export enum TileType {
  Grassland = 0,
  Plains = 1,
  Desert = 2,
  Tundra = 3,
  Snow = 4,
  Coast = 5,
  Ocean = 6
}

// Feature type enum
export enum FeatureType {
  NoFeature = -1,
  Ice = 0,
  Jungle = 1,
  Marsh = 2,
  Oasis = 3,
  FloodPlains = 4,
  Forest = 5,
  CerroDePotosi = 15,
  Atoll = 17,
  SriPada = 18,
  MtSinai = 19
}

// Civilization data
export interface Civilization {
  name: string;                  // Short civilization name (e.g., "America", "India")
  // Other fields are parsed from binary but not used in the application
  [key: string]: unknown;        // Allow additional properties from parsing
}

// DLC information
export interface DLC {
  id: string;                    // Unique identifier for the DLC
  enabled: number;               // Whether the DLC is enabled (0 = disabled, 1 = enabled)
  name: string;                  // Human-readable DLC name
}

// Mod information
export interface Mod {
  id: string;                    // Unique identifier for the mod
  version: number;               // Mod version number
  name: string;                  // Human-readable mod name
}


// Tile data
export interface Tile {
  x: number;                               // X coordinate on the hex grid
  y: number;                               // Y coordinate on the hex grid
  type: TileType;                         // Tile terrain type
  feature: FeatureType;                   // Tile feature (forest, jungle, etc.)
  elevation: ElevationType;               // Tile elevation level

  // Allow additional properties from raw parsing
  [key: string]: number | number[] | undefined;
}

// Event data
export interface GameEvent {
  turn: number;                                          // Turn number when event occurred
  type: EventType;                                       // Event type enum
  tiles?: Tile[];                                        // Tiles affected by this event
  civId?: number;                                        // Primary civilization ID for event
  text?: string;                                         // Event text or message
  x?: number;                                            // X coordinate where event occurred
  y?: number;                                            // Y coordinate where event occurred
  index?: number;                                        // Event index in sequence
  city?: City | { name: string; owner: string | null };  // City involved in event
  [key: string]: unknown;                                // Allow additional properties
}

// City data
export interface City {
  name: string;                    // City name
  owner: string | number | null;   // Owner civilization (name, ID, or null if razed/free)
  [key: string]: unknown;          // Allow additional properties
}

// Tile state information for a single hex
export interface TileStateInfo {
  owner?: string;                          // Civilization that owns this tile
  city?: string;                           // City name if this tile has a city
}

// Turn state: maps hex coordinates ("x,y") to the tile state at that turn
export type TurnState = Record<string, TileStateInfo>;

// One recorded dataset measurement: the value at a specific turn
export interface DatasetPoint {
  turn: number;                            // Turn the value was recorded at
  value: number;                           // Recorded value
}

// A civilization's full series for one dataset, ordered by turn
export type DatasetSeries = DatasetPoint[];

// Every civilization's series for one dataset, indexed by civilization id
export type DatasetCivSeries = DatasetSeries[];