/**
 * replay.ts
 * Data hub for Civilization V (Vox Populi) replay files
 * Manages parsed replay data and provides utility functions for data access
 */

import { ReplayParser } from './replay-parser';
import { SaveParser, isSaveFile } from './save-parser';
import { EventParser } from './event-parser';
import { CivColors } from '../utils/civ-colors';
import {
  Civilization,
  City,
  GameEvent,
  Tile,
  DatasetCivSeries,
  DatasetSeries,
  DataKind,
  DLC,
  Mod,
  ElevationType,
  TileType,
  FeatureType
} from '../types';

// The two file types the viewer opens
export type ReplaySource = 'replay' | 'save';

/**
 * Replay class - Data hub for replay information
 * Provides centralized access to all replay data and utility functions
 */
export class Replay {
  // Core metadata (absorbed from ReplayMetadata)
  public startTurn: number = 0;
  public endTurn: number = 0;
  public startYear: number = 0;
  public endYear: string = '';
  public mapWidth: number = 0;
  public mapHeight: number = 0;

  // Which kind of file this data came from
  public source: ReplaySource = 'replay';

  // Kind of every data area this hub exposes, so views never have to guess
  // whether something is available at every turn or only at the save's turn.
  // Rivers are fixed when the map is generated, so their kind is history even
  // though only save files carry them today. Snapshot entries arrive with the
  // save parser work that reads the game state.
  public readonly dataKinds: Record<string, DataKind> = {
    terrain: DataKind.History,
    rivers: DataKind.History,
    events: DataKind.History,
    datasets: DataKind.History,
    ownership: DataKind.History
  };

  // Game configuration (absorbed from RawReplayData)
  public game: string = '';
  public version: string = '';
  public build: string = '';
  public playerCiv: string = '';
  public playerColor: string = '';
  public difficulty: string = '';
  public eraStart: string = '';
  public eraEnd: string = '';
  public gameSpeed: string = '';
  public worldSize: string = '';
  public mapScript: string = '';
  public dlc: DLC[] = [];
  public mods: Mod[] = [];

  // Core game data
  public civs: Civilization[] = [];
  public cities: Record<string, City> = {};
  public events: GameEvent[] = [];
  public datasets: Record<string, DatasetCivSeries> = {};
  public tiles: Tile[][] = [];

  /**
   * Load replay data from a binary file
   * Replay files parse synchronously, save files are routed through the
   * save parser which inflates the compressed game state first
   * @param file The raw file contents
   * @param size The size of the file data within the buffer
   */
  public async loadFromFile(file: ArrayBuffer, size: number): Promise<void> {
    const fromSave = isSaveFile(file);
    this.source = fromSave ? 'save' : 'replay';

    const rawData = fromSave
      ? await new SaveParser(file, size).parseReplay()
      : new ReplayParser(file, size).parse(false);

    this.processRawData(rawData);
  }

  /**
   * Process raw parsed data and populate the replay instance
   */
  private processRawData(rawData: any): void {
    // Store metadata fields
    this.startTurn = rawData.startTurn;
    this.endTurn = rawData.endTurn;
    this.startYear = rawData.startYear;
    this.endYear = rawData.endYear;
    this.mapWidth = rawData.mapWidth;
    this.mapHeight = rawData.mapHeight;

    // Store game configuration
    this.game = rawData.game;
    this.version = rawData.version;
    this.build = rawData.build;
    this.playerCiv = rawData.playerCiv;
    this.playerColor = rawData.playerColor;
    this.difficulty = rawData.difficulty;
    this.eraStart = rawData.eraStart;
    this.eraEnd = rawData.eraEnd;
    this.gameSpeed = rawData.gameSpeed;
    this.worldSize = rawData.worldSize;
    this.mapScript = rawData.mapScript;
    this.dlc = rawData.dlc || [];
    this.mods = rawData.mods || [];

    // Store civilizations
    this.civs = rawData.civs || [];

    // Process datasets
    this.processDatasets(rawData.datasets, rawData.datasetValues);

    // Process events
    this.processEvents(rawData.events || []);

    // Process tiles
    this.processTiles(rawData.tiles || []);
  }

  /**
   * Process dataset values by civ id and dataset name
   * Each dataset ends up as one series of turn and value pairs per civilization
   */
  private processDatasets(datasets: any[], datasetValues: any): void {
    if (!datasets || !datasetValues) return;

    const datasetNames = datasets.map(d => d.key);

    const processedDatasets = datasetNames.map((_key: string, index: number) => {
      return datasetValues.map((civData: any) => civData[index] || []);
    });

    // Create object from key-value pairs (ES5 compatible)
    this.datasets = {};
    datasetNames.forEach((name, i) => {
      this.datasets[name] = processedDatasets[i];
    });
  }

  /**
   * Process game events and add human-readable information
   */
  private processEvents(events: GameEvent[]): void {
    const eventParser = new EventParser(this);
    this.events = eventParser.processEvents(events);
    this.cities = eventParser.getCities();
  }

  /**
   * Process tiles and convert IDs to enums
   */
  private processTiles(tiles: any[]): void {
    if (!tiles || tiles.length === 0) return;

    // Convert raw tile data to use enums
    const processedTiles = tiles.map((tile: any) => {
      const processed: Tile = {
        x: 0, // Will be set later
        y: 0, // Will be set later
        elevation: (tile.elevationId ?? ElevationType.AboveSeaLevel) as ElevationType,
        type: tile.type,
        feature: (tile.featureId ?? FeatureType.NoFeature) as FeatureType
      };

      // Copy any additional raw properties
      Object.keys(tile).forEach(key => {
        (processed as any)[key] = tile[key];
      });

      return processed;
    });

    // Chunk into 2D array and add coordinates
    this.tiles = this.chunk(processedTiles, this.mapWidth);

    for (let y = 0; y < this.tiles.length; y++) {
      for (let x = 0; x < this.tiles[y].length; x++) {
        this.tiles[y][x].x = x;
        this.tiles[y][x].y = y;
      }
    }
  }

  /**
   * Utility function to chunk an array into a 2D array
   */
  private chunk<T>(array: T[], size: number): T[][] {
    const result: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      result.push(array.slice(i, i + size));
    }
    return result;
  }

  // ========== UTILITY FUNCTIONS ==========

  /**
   * Get civilization name from ID
   */
  public getCivName(civId?: number): string | null {
    if (civId === undefined || civId < 0 || civId >= this.civs.length) {
      return null;
    }
    return this.civs[civId].name;
  }

  /**
   * Get civilization color from ID or name
   */
  public getCivColor(civIdOrName: number | string): { city: [number, number, number], territory: [number, number, number] } | null {
    let civName: string | null = null;

    if (typeof civIdOrName === 'number') {
      civName = this.getCivName(civIdOrName);
    } else {
      civName = civIdOrName;
    }

    if (!civName || !CivColors[civName]) {
      return null;
    }

    return CivColors[civName];
  }

  /**
   * Get city at specific coordinates
   */
  public getCityAt(x: number, y: number): City | null {
    return this.cities[`${x},${y}`] || null;
  }

  /**
   * Get tile at specific coordinates
   */
  public getTileAt(x: number, y: number): Tile | null {
    if (y >= 0 && y < this.tiles.length && x >= 0 && x < this.tiles[y].length) {
      return this.tiles[y][x];
    }
    return null;
  }

  /**
   * Get all events for a specific turn
   */
  public getEventsForTurn(turn: number): GameEvent[] {
    return this.events.filter(event => event.turn === turn);
  }

  /**
   * Get the value series of a dataset for a specific civilization
   */
  public getDatasetForCiv(datasetName: string, civId: number): DatasetSeries {
    const dataset = this.datasets[datasetName];
    if (!dataset || !dataset[civId]) {
      return [];
    }
    return dataset[civId];
  }

}