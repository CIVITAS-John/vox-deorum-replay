/**
 * replay.types.ts
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
  PantheonSelected = 6
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

// Dataset entry
export interface DatasetEntry {
  key: string;                     // Dataset key/identifier
}

// Dataset values
export interface DatasetValues {
  turns: number[];                 // Array of turn numbers
  values: number[][];              // 2D array of values per turn
}

// File configuration for binary parser
export interface FileConfig {
  [key: string]: string | number | FileConfigItem | FileConfigArray | Function;  // Dynamic configuration properties
}

export interface FileConfigItem {
  type: string;                    // Data type (e.g., 'int', 'str', 'byte')
  length?: number;                 // Optional length for strings/bytes
}

export interface FileConfigArray {
  type: 'array';                   // Array type indicator
  items: FileConfig;               // Configuration for array items
}