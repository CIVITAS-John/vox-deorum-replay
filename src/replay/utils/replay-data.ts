/**
 * replay-data.ts
 * Shapes raw parser output into the structures the Replay hub stores
 */

import { DatasetCivSeries, Tile, ElevationType, FeatureType } from '../types';
import { chunk } from './arrays';

/**
 * Index the per-civilization dataset tables by dataset name
 * Each dataset becomes one series of turn and value pairs per civilization
 */
export function indexDatasets(datasets: { key: string }[] | undefined, datasetValues: any[][] | undefined): Record<string, DatasetCivSeries> {
  if (!datasets || !datasetValues) {
    return {};
  }

  const indexed: Record<string, DatasetCivSeries> = {};
  datasets.forEach((dataset, index) => {
    indexed[dataset.key] = datasetValues.map((civData: any[]) => civData[index] || []);
  });
  return indexed;
}

/**
 * Convert raw parsed tiles into the hex grid: enum-typed tiles chunked into
 * rows of mapWidth and stamped with their grid coordinates
 */
export function buildTileGrid(tiles: any[], mapWidth: number): Tile[][] {
  const processed: Tile[] = tiles.map((tile: any) => {
    const converted: Tile = {
      x: 0, // Filled in below, once the row structure exists
      y: 0,
      elevation: (tile.elevationId ?? ElevationType.AboveSeaLevel) as ElevationType,
      type: tile.type,
      feature: (tile.featureId ?? FeatureType.NoFeature) as FeatureType
    };

    // Copy any additional raw properties
    Object.keys(tile).forEach(key => {
      (converted as any)[key] = tile[key];
    });

    return converted;
  });

  const rows = chunk(processed, mapWidth);
  for (let y = 0; y < rows.length; y++) {
    for (let x = 0; x < rows[y].length; x++) {
      rows[y][x].x = x;
      rows[y][x].y = y;
    }
  }
  return rows;
}
