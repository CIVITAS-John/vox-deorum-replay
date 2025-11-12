/**
 * map.types.ts
 * Type definitions for map-related structures
 */

import { Tile, GameEvent } from './replay.types';

// Hex layer configuration
export interface HexLayerConfig {
  tileSize: number;
  continuousWorld?: boolean;
  noWrap?: boolean;
  drawHex?: (ctx: CanvasRenderingContext2D, hex: HexData, cx: number, cy: number, x1: number, y1: number, x2: number, y2: number) => void;
}

// Hex data structure
export interface HexData {
  x: number;
  y: number;
  terrain?: number;
  owner?: number;
  city?: number;
  improvement?: number;
  route?: number;
  visibility?: number[];
  resource?: number;
  feature?: number | string;
  type?: number | string;
  natural_wonder?: number;
  [key: string]: number | number[] | string | undefined;
}

// Turn state
export interface TurnState {
  turn: number;
  tiles: HexData[][];
  events?: GameEvent[];
  [key: string]: unknown;
}

// Map layer interface - using any for Leaflet map to avoid namespace issues
export interface MapLayer {
  addTo(map: any): void;
  setData(tiles: HexData[][]): void;
  redraw(): void;
  options?: HexLayerConfig;
  turnState?: any;
  _map?: any;
}

// Map control interface - using any for Leaflet map to avoid namespace issues
export interface MapControl {
  addTo(map: any): void;
  update?(turnState: TurnState): void;
}

// Coordinate types
export interface MapCoordinates {
  lat: number;
  lng: number;
}

export interface TileCoordinates {
  x: number;
  y: number;
}

// Layer options for different visualization types
export interface TerrainLayerOptions extends HexLayerConfig {
  type: 'terrain';
}

export interface OwnerLayerOptions extends HexLayerConfig {
  type: 'owner';
  civColors?: Record<number, string>;
}

export interface CityLayerOptions extends HexLayerConfig {
  type: 'city';
  showNames?: boolean;
}

export interface ImprovementLayerOptions extends HexLayerConfig {
  type: 'improvement';
}

export interface RouteLayerOptions extends HexLayerConfig {
  type: 'route';
}

export interface FogLayerOptions extends HexLayerConfig {
  type: 'fog';
  playerIndex?: number;
}