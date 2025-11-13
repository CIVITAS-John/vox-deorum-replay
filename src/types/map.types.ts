/**
 * map.types.ts
 * Type definitions for map-related structures
 */

import { Tile, GameEvent } from './replay.types';

// Hex layer configuration
export interface HexLayerConfig {
  tileSize: number;                        // Size of each hexagon tile in pixels
  continuousWorld?: boolean;               // Whether world wraps horizontally
  noWrap?: boolean;                        // Disable world wrapping
  drawHex?: (ctx: CanvasRenderingContext2D, hex: HexData, cx: number, cy: number, x1: number, y1: number, x2: number, y2: number) => void;  // Custom hex drawing function
}

// Hex data structure (mirrors Tile interface for map rendering)
export interface HexData {
  x: number;                                               // X coordinate on hex grid
  y: number;                                               // Y coordinate on hex grid
  feature?: number | string;                               // Feature (forest, jungle) - ID or name
  type?: number | string;                                  // Tile type - ID or name
  [key: string]: number | number[] | string | undefined;   // Allow additional properties
}

// Tile state information for a single hex
export interface TileStateInfo {
  owner?: string;                          // Civilization that owns this tile
  city?: string;                           // City name if this tile has a city
}

// Turn state - maps hex coordinates to tile state
export type TurnState = Record<string, TileStateInfo>;

// Map layer interface - using any for Leaflet map to avoid namespace issues
export interface MapLayer {
  addTo(map: any): void;                   // Add layer to Leaflet map
  setData(tiles: HexData[][]): void;       // Set tile data for rendering
  redraw(): void;                          // Force redraw of layer
  redrawHexes(changedHexKeys: string[]): void; // Selectively redraw specific hexes
  clearCache?(): void;                     // Clear tile cache (optional, for HexLayer)
  options?: HexLayerConfig;                // Layer configuration options
  turnState?: TurnState;                   // Current turn state
  _map?: any;                              // Reference to Leaflet map instance
}

// Map control interface - using any for Leaflet map to avoid namespace issues
export interface MapControl {
  addTo(map: any): void;                   // Add control to Leaflet map
  update?(turnState: TurnState): void;     // Update control with new turn state
}

// Coordinate types
export interface MapCoordinates {
  lat: number;                             // Latitude coordinate
  lng: number;                             // Longitude coordinate
}

export interface TileCoordinates {
  x: number;                               // Tile X coordinate
  y: number;                               // Tile Y coordinate
}

// Layer options for different visualization types
export interface TerrainLayerOptions extends HexLayerConfig {
  type: 'terrain';                         // Layer type identifier
}

export interface OwnerLayerOptions extends HexLayerConfig {
  type: 'owner';                           // Layer type identifier
  civColors?: Record<number, string>;      // Map of civilization ID to color
}

export interface CityLayerOptions extends HexLayerConfig {
  type: 'city';                            // Layer type identifier
  showNames?: boolean;                     // Whether to display city names
}

export interface ImprovementLayerOptions extends HexLayerConfig {
  type: 'improvement';                     // Layer type identifier
}

export interface RouteLayerOptions extends HexLayerConfig {
  type: 'route';                           // Layer type identifier
}

export interface FogLayerOptions extends HexLayerConfig {
  type: 'fog';                             // Layer type identifier
  playerIndex?: number;                    // Player index for fog of war
}