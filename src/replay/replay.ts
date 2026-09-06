/**
 * replay.ts
 * Data hub for Civilization V (Vox Populi) replay files
 * Manages parsed replay data and provides utility functions for data access
 */

import { ReplayParser } from '../parsers/replay-parser';
import { SaveParser, isSaveFile } from '../parsers/save-parser';
import { EventParser } from './event-parser';
import { getCivColors } from '../utils/civ-colors';
import { indexDatasets, buildTileGrid } from './utils/replay-data';
import {
  Civilization,
  City,
  GameEvent,
  Tile,
  DatasetCivSeries,
  DatasetSeries,
  DataKind,
  DLC,
  Mod
} from './types';

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

    // Index the datasets by name
    this.datasets = indexDatasets(rawData.datasets, rawData.datasetValues);

    // Process events
    this.processEvents(rawData.events || []);

    // Build the tile grid
    this.tiles = buildTileGrid(rawData.tiles || [], this.mapWidth);
  }

  /**
   * Process game events and add human-readable information
   */
  private processEvents(events: GameEvent[]): void {
    const eventParser = new EventParser(this);
    this.events = eventParser.processEvents(events);
    this.cities = eventParser.getCities();
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
    const civName = typeof civIdOrName === 'number'
      ? this.getCivName(civIdOrName)
      : civIdOrName;

    if (!civName) {
      return null;
    }

    return getCivColors(civName);
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