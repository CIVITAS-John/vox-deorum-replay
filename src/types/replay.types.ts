/**
 * replay.types.ts
 * Type definitions for replay data structures
 */

// Civilization data
export interface Civilization {
  _1: number;                    // Unknown field 1 (likely internal ID or flags)
  _2: number;                    // Unknown field 2 (likely internal ID or flags)
  _3: number;                    // Unknown field 3 (likely internal ID or flags)
  _4: number;                    // Unknown field 4 (likely internal ID or flags)
  leader: string;                // Leader name (e.g., "Washington", "Gandhi")
  longName: string;              // Full civilization name (e.g., "United States of America")
  name: string;                  // Short civilization name (e.g., "America", "India")
  demonym: string;               // Demonym for the civilization (e.g., "American", "Indian")
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
  game: string;                  // Game name (e.g., "Civilization V")
  version: string;               // Game version string
  build: string;                 // Build number or identifier
  playerCiv: string;             // Player's civilization name
  difficulty: string;            // Difficulty level (e.g., "Prince", "King", "Emperor")
  eraStart: string;              // Starting era (e.g., "Ancient", "Classical", "Medieval")
  eraEnd: string;                // Ending era (e.g., "Information", "Future")
  gameSpeed: string;             // Game speed setting (e.g., "Standard", "Quick", "Marathon")
  worldSize: string;             // Map size (e.g., "Small", "Standard", "Large", "Huge")
  mapScript: string;             // Map generation script name
  dlc: DLC[];                    // Array of installed DLC packs
  mods: Mod[];                   // Array of installed mods
  playerColor: string;           // Player's civilization color
  mapScript2: string;            // Secondary map script identifier (duplicate/alternate)
  startTurn: number;             // Starting turn number
  startYear: number;             // Starting year in game time
  endTurn: number;               // Final turn number
  endYear: string;               // Final year in game time (string format)
  zeroStartYear: number;         // Base year for calculations (start)
  zeroEndYear: number;           // Base year for calculations (end)
  width?: number;                // Map width in tiles (optional)
  height?: number;               // Map height in tiles (optional)
  mapWidth?: number;             // Alternative map width property (optional)
  mapHeight?: number;            // Alternative map height property (optional)
  [key: string]: unknown;        // Allow additional properties for extensibility
}

// Tile data
export interface Tile {
  x: number;                               // X coordinate on the hex grid
  y: number;                               // Y coordinate on the hex grid
  terrain?: number;                        // Terrain type ID
  improvement?: number;                    // Improvement ID (e.g., farm, mine)
  route?: number;                          // Route type ID (e.g., road, railroad)
  owner?: number;                          // Civilization ID that owns this tile
  city?: number;                           // City ID if tile contains a city
  visibility?: number[];                   // Array of civilization IDs that can see this tile
  resource?: number;                       // Resource ID (e.g., iron, wheat, oil)
  natural_wonder?: number;                 // Natural wonder ID if present

  // Type and feature can be either number (ID) or string (name)
  type?: number | string;                  // Tile type (ID or name after parsing)
  typeId?: number;                         // Original numeric type ID
  feature?: number | string;               // Feature (e.g., forest, jungle) - ID or name
  featureId?: number;                      // Original numeric feature ID

  // Human-readable fields added after parsing
  elevationId?: number;                    // Elevation level ID
  elevation?: string | number;             // Elevation description or value
  terrainName?: string;                    // Human-readable terrain name
  ownerName?: string;                      // Human-readable civilization name
  cityName?: string;                       // Human-readable city name

  // Allow additional properties
  [key: string]: number | number[] | string | undefined;
}

// Event data
export interface GameEvent {
  turn: number;                                          // Turn number when event occurred
  type: string | number;                                 // Event type (ID or name)
  typeId?: number;                                       // Original numeric event type ID
  tiles?: Tile[];                                        // Tiles affected by this event
  civs?: number[];                                       // Civilization IDs involved in event
  civId?: number;                                        // Primary civilization ID for event
  civ?: string | null;                                   // Civilization name (parsed)
  description?: string;                                  // Human-readable event description
  text?: string;                                         // Event text or message
  x?: number;                                            // X coordinate where event occurred
  y?: number;                                            // Y coordinate where event occurred
  index?: number;                                        // Event index in sequence
  city?: City | { name: string; owner: string | null };  // City involved in event
  data?: Record<string, unknown>;                        // Additional event-specific data
  [key: string]: unknown;                                // Allow additional properties
}

// City data
export interface City {
  name: string;                    // City name
  owner: string | number | null;   // Owner civilization (name, ID, or null if razed/free)
  x?: number;                      // X coordinate on map
  y?: number;                      // Y coordinate on map
  population?: number;             // City population size
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
  // Additional raw data fields:
  _0: number;                      // Unknown field 0 (likely version or format indicator)
  _1: Uint8Array;                  // Unknown binary data 1
  _2: string;                      // Unknown string field 2
  _3: string;                      // Unknown string field 3
  _4: Uint8Array;                  // Unknown binary data 4
  civs: Civilization[];            // Array of all civilizations in the game
  datasets: DatasetEntry[];        // Available dataset keys (e.g., scores, culture)
  datasetValues: DatasetValues;    // Actual dataset values by turn
  width: number;                   // Map width in tiles (required, unlike in metadata)
  height: number;                  // Map height in tiles (required, unlike in metadata)
  tiles: Tile[][];                 // 2D array of tile data [y][x]
  eventCount: number;              // Total number of events in replay
  events: GameEvent[];             // Array of all game events
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