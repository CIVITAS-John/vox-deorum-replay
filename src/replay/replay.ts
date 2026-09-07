/**
 * replay.ts
 * Data hub for Civilization V (Vox Populi) replay files
 * Manages parsed replay data and provides utility functions for data access
 */

import { ReplayParser } from '../parsers/replay-parser';
import { SaveParser, isSaveFile, MapHeader, VictoryInfo, DatasetDiagnostics } from '../parsers/save-parser';
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
  EventType,
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

  // Kind of every data area the loaded file carries, so views never have to
  // guess whether something is available at every turn (history) or only at
  // the save's turn (snapshot). Built per load in processRawData: a replay
  // file never has snapshot areas, and a save whose terrain walk failed has
  // neither rivers nor the plot snapshot.
  public dataKinds: Record<string, DataKind> = {};

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

  // Save-only extras, null or empty when the source is a replay file
  /** Player slot behind each civilization, so snapshot slot ids can be mapped to civs */
  public civSlots: number[] = [];
  /** Map header of the save (wrap flags and map-wide counts), null when unavailable */
  public mapHeader: MapHeader | null = null;
  /** Victory result, proven by the file or asserted by a shared link; only reliable results may be presented */
  public victory: VictoryInfo | null = null;
  /** Dataset quality per civilization, aligned with the civs list */
  public datasetDiagnostics: DatasetDiagnostics[] = [];

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

    // Store the save-only extras. Replay files carry byte exact series, so
    // every civilization starts with clean dataset diagnostics there
    this.civSlots = rawData.civSlots || [];
    this.mapHeader = rawData.mapHeader ?? null;
    this.victory = rawData.victory ?? null;
    this.datasetDiagnostics = rawData.datasetDiagnostics ||
      this.civs.map(() => ({ attached: true, damagedEntries: 0 }));

    // Index the datasets by name
    this.datasets = indexDatasets(rawData.datasets, rawData.datasetValues);

    // Process events
    this.processEvents(rawData.events || []);

    // Build the tile grid
    this.tiles = buildTileGrid(rawData.tiles || [], this.mapWidth);

    // Mark the kind of every data area this file carries. Terrain, rivers,
    // and the map header are fixed when the map is generated, so they count
    // as history even though only save files carry them; the plot snapshot
    // fields describe the save's game state and count as snapshot. The
    // terrain walk fills the tiles from the first record onward, so a real
    // first tile (not the -1 placeholder) means the walk succeeded
    const kinds: Record<string, DataKind> = {
      terrain: DataKind.History,
      events: DataKind.History,
      datasets: DataKind.History,
      ownership: DataKind.History
    };
    if (this.source === 'save') {
      if (this.mapHeader) {
        kinds.mapHeader = DataKind.History;
      }
      const firstTile = this.tiles.length > 0 && this.tiles[0].length > 0 ? this.tiles[0][0] : null;
      if (firstTile && (firstTile.elevation as number) !== -1) {
        kinds.rivers = DataKind.History;
        kinds.plotSnapshot = DataKind.Snapshot;
      }
    }
    this.dataKinds = kinds;
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
   * Map a raw player slot from snapshot data to a civilization index
   * @returns The civilization index, or -1 when no civilization uses the slot
   */
  public getCivIdForSlot(slot: number): number {
    return this.civSlots.indexOf(slot);
  }

  /**
   * Apply a winner asserted through the winner parameter of a shared link
   * A save taken before the game was won carries no proof of the result,
   * so the sharer can pass it externally. The link only fills the gap: a
   * result the file itself proved always stands, and the applied result is
   * marked as link sourced so the interface can attribute it
   * @param winnerCivId The winning civilization index
   * @returns True when the link winner was applied
   */
  public applyLinkVictory(winnerCivId: number): boolean {
    if (this.victory !== null && this.victory.reliable && this.victory.source === 'file') {
      return false;
    }
    if (winnerCivId < 0 || winnerCivId >= this.civs.length) {
      return false;
    }
    this.victory = {
      winningTurn: -1,
      winnerTeam: -1,
      victoryType: -1,
      gameState: -1,
      winnerCivId,
      reliable: true,
      source: 'link'
    };
    return true;
  }

  /**
   * List the civilizations that left decision-making trails, meaning strategy
   * change events in the event log, ordered by civilization id. A model that
   * drove the game leaves these trails, so the model parameter can mark them
   */
  public getCivIdsWithDecisionTrails(): number[] {
    const civIds = new Set<number>();

    for (const event of this.events) {
      if (event.type === EventType.Strategies && event.civId !== undefined && event.civId >= 0) {
        civIds.add(event.civId);
      }
    }

    return [...civIds].sort((a, b) => a - b);
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