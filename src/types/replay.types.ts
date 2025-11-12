/**
 * replay.types.ts
 * Type definitions for replay data structures
 */

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

// Replay metadata
export interface ReplayMetadata {
  startTurn: number;             // Starting turn number
  endTurn: number;               // Final turn number
  mapWidth?: number;             // Map width property used in rendering
  mapHeight?: number;            // Map height property used in rendering
  [key: string]: unknown;        // Allow additional properties for extensibility
}

// Tile data
export interface Tile {
  x: number;                               // X coordinate on the hex grid
  y: number;                               // Y coordinate on the hex grid

  // Type and feature can be either number (ID) or string (name)
  type?: number | string;                  // Tile type (ID or name after parsing)
  typeId?: number;                         // Original numeric type ID
  feature?: number | string;               // Feature (e.g., forest, jungle) - ID or name
  featureId?: number;                      // Original numeric feature ID

  // Elevation fields used in rendering
  elevationId?: number;                    // Elevation level ID
  elevation?: string | number;             // Elevation description or value

  // Allow additional properties
  [key: string]: number | number[] | string | undefined;
}

// Event data
export interface GameEvent {
  turn: number;                                          // Turn number when event occurred
  type: string | number;                                 // Event type (ID or name)
  typeId?: number;                                       // Original numeric event type ID
  tiles?: Tile[];                                        // Tiles affected by this event
  civId?: number;                                        // Primary civilization ID for event
  civ?: string | null;                                   // Civilization name (parsed)
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

// Complete raw data structure from parser
export interface RawReplayData extends ReplayMetadata {
  // Fields from ReplayMetadata are inherited
  // Core data fields used in application:
  civs: Civilization[];            // Array of all civilizations in the game
  datasets: DatasetEntry[];        // Available dataset keys (e.g., scores, culture)
  datasetValues: DatasetValues;    // Actual dataset values by turn
  width: number;                   // Map width in tiles (required, unlike in metadata)
  height: number;                  // Map height in tiles (required, unlike in metadata)
  tiles: Tile[][];                 // 2D array of tile data [y][x]
  events: GameEvent[];             // Array of all game events
  [key: string]: unknown;          // Allow additional properties from parsing
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