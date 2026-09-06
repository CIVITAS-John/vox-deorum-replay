/**
 * enum-names.ts
 * Utility functions to convert enum values to display names
 * Used primarily for UI rendering and debugging
 */

import {
  EventType,
  ElevationType,
  TileType,
  FeatureType
} from '../replay/types';

/**
 * Convert EventType enum to display name
 */
export function getEventTypeName(type: EventType): string {
  switch (type) {
    case EventType.Message: return 'Message';
    case EventType.CityFounded: return 'City Founded';
    case EventType.TilesClaimed: return 'Tiles Claimed';
    case EventType.CitiesTransferred: return 'Cities Transferred';
    case EventType.CityRazed: return 'City Razed';
    case EventType.ReligionFounded: return 'Religion Founded';
    case EventType.PantheonSelected: return 'Pantheon Selected';
    default: return `Unknown Event ${type}`;
  }
}

/**
 * Convert ElevationType enum to display name
 */
export function getElevationName(elevation: ElevationType): string {
  switch (elevation) {
    case ElevationType.Mountain: return 'Mountain';
    case ElevationType.Hills: return 'Hills';
    case ElevationType.AboveSeaLevel: return 'Above Sea Level';
    case ElevationType.BelowSeaLevel: return 'Below Sea Level';
    default: return `Unknown Elevation ${elevation}`;
  }
}

/**
 * Convert TileType enum to display name
 */
export function getTileTypeName(type: TileType): string {
  switch (type) {
    case TileType.Grassland: return 'Grassland';
    case TileType.Plains: return 'Plains';
    case TileType.Desert: return 'Desert';
    case TileType.Tundra: return 'Tundra';
    case TileType.Snow: return 'Snow';
    case TileType.Coast: return 'Coast';
    case TileType.Ocean: return 'Ocean';
    default: return `Unknown Tile ${type}`;
  }
}

/**
 * Convert FeatureType enum to display name
 */
export function getFeatureName(feature: FeatureType): string {
  switch (feature) {
    case FeatureType.NoFeature: return 'None';
    case FeatureType.Ice: return 'Ice';
    case FeatureType.Jungle: return 'Jungle';
    case FeatureType.Marsh: return 'Marsh';
    case FeatureType.Oasis: return 'Oasis';
    case FeatureType.FloodPlains: return 'Flood Plains';
    case FeatureType.Forest: return 'Forest';
    case FeatureType.CerroDePotosi: return 'Cerro de Potosi';
    case FeatureType.Atoll: return 'Atoll';
    case FeatureType.SriPada: return 'Sri Pada';
    case FeatureType.MtSinai: return 'Mt. Sinai';
    default: return `Unknown Feature ${feature}`;
  }
}