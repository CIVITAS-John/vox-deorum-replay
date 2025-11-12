/**
 * replay.ts
 * Core replay file parser for Civilization V (Vox Populi) replay files
 * Handles parsing game metadata, player data, map data, and turn events
 */

import { BinaryParser } from './binary-parser';
import {
  ReplayMetadata,
  Civilization,
  City,
  GameEvent,
  Tile,
  RawReplayData,
  DatasetValues,
  FileConfig
} from '../types';

// External library accessed as global (lodash) - type defined in globals.d.ts

export class Replay {
  private parser: BinaryParser;
  public meta: ReplayMetadata = {} as ReplayMetadata;
  public civs: Civilization[] = [];
  public cities: Record<string, City> = {};
  public events: GameEvent[] = [];
  public datasets: Record<string, DatasetValues> = {};
  public tiles: Tile[][] = [];
  private rawData: RawReplayData;
  private fileConfig: FileConfig;

  constructor(file: ArrayBuffer, size: number) {
    this.parser = new BinaryParser(file, size);

    this.fileConfig = {
      game: { type: 'str', length: 0x04 }, // CIV5
      _0: 'int32', // 01 00 00 00
      version: 'varstr',
      build: 'varstr',
      _1: { type: 'byte', length: 0x05 }, // 41 01 00 00 01 ?
      playerCiv: 'varstr',
      difficulty: 'varstr',
      eraStart: 'varstr',
      eraEnd: 'varstr',
      gameSpeed: 'varstr',
      worldSize: 'varstr',
      mapScript: 'varstr',
      dlc: {
        type: 'array',
        items: {
          id: { type: 'str', length: 0x10 },
          enabled: 'int32',
          name: 'varstr'
        }
      },
      mods: {
        type: 'array',
        items: {
          id: 'varstr',
          version: 'int32',
          name: 'varstr'
        }
      },
      _2: 'varstr', // 00 00 00 00
      _3: 'varstr', // 00 00 00 00
      playerColor: 'varstr',
      // 4 bytes for Vox Populi - not sure why, instead of 8
      _4: { type: 'byte', length: 4 },
      mapScript2: 'varstr',
      _5: function(this: BinaryParser) {
        // Heuristic to get around something I don't understand :-(
        // This section still stumps me - it's variable length, but doesn't
        // seem to follow the conventions of the rest of the file.
        let unknown = 0;

        while (Math.abs(unknown) < 100000) {
          unknown = this.getInt32();
        }

        // We've hit the start year, need to rewind
        (this.view as any).seek((this.view as any).tell() - 7);
        console.log(`Found the start year: ${this.decToHex((this.view as any).tell())}`);
      },
      startTurn: 'int32',
      startYear: 'int32',
      endTurn: 'int32',
      endYear: 'varstr',
      zeroStartYear: 'int32',
      zeroEndYear: 'int32',
      civs: {
        type: 'array',
        items: {
          _1: 'int32',
          _2: 'int32',
          _3: 'int32',
          _4: 'int32',
          leader: 'varstr',
          longName: 'varstr',
          name: 'varstr',
          demonym: 'varstr'
        }
      },
      datasets: {
        type: 'array',
        items: {
          key: 'varstr'
        }
      },
      datasetValues: {
        type: 'array',
        items: {
          type: 'array',
          items: {
            type: 'array',
            items: {
              turn: 'int32',
              value: 'int32'
            }
          }
        }
      },
      // _7: 'int32', // this is not present in VP saves
      events: {
        type: 'array',
        items: {
          turn: 'int32',
          typeId: 'int32',
          tiles: {
            type: 'array',
            items: {
              x: 'int16',
              y: 'int16'
            }
          },
          civId: 'int32',
          text: 'varstr'
        }
      },
      mapWidth: 'int32',
      mapHeight: 'int32',
      tiles: {
        type: 'array',
        items: {
          _1: 'int32', // always 1?
          _2: 'int32', // always 267?
          elevationId: 'int8',
          typeId: 'int8',
          featureId: 'int8',
          _5: 'int8'
        }
      }
    };
  }

  process(): void {
    // Do initial basic parsing
    this.rawData = this.parser.parseItems(this.fileConfig, false) as RawReplayData;

    // Store everything but civs / tiles / datasets / events in this.meta
    this.meta = _.omit(this.rawData, ['civs', 'datasets', 'datasetValues', 'events', 'tiles']);

    // Civs are fine as is
    this.civs = this.rawData.civs;

    // Organize dataset values by civ id and dataset name
    const datasetNames = _.pluck(this.rawData.datasets, 'key');
    this.datasets = _(this.rawData.datasets).chain().pluck('key').map((key: string, datasetIndex: number) => {
      return _.pluck(this.rawData.datasetValues, datasetIndex);
    }).value();

    this.datasets = _.zipObject(datasetNames, this.datasets);

    // Add human-readable stuff to events
    this.cities = {};
    this.events = [];

    _.each(this.rawData.events, (event: GameEvent, i: number) => {
      // There may be multiple events combined into one to save space
      let eventsToAdd = [event];

      event.index = i;
      event.civ = this.civs[event.civId] ? this.civs[event.civId].name : null;

      // Add type name
      switch (event.typeId) {
        case 0: event.type = 'MESSAGE'; break;
        case 1: event.type = 'CITY_FOUNDED'; break;
        case 2: event.type = 'TILES_CLAIMED'; break;
        case 3: event.type = 'CITIES_TRANSFERRED'; break;
        case 4: event.type = 'CITY_RAZED'; break;
        case 5: event.type = 'RELIGION_FOUNDED'; break;
        case 6: event.type = 'PANTHEON_SELECTED'; break;
        default: event.type = event.typeId; break;
      }

      // Add x/y reference to keep things easy
      if (event.tiles.length === 1 && event.type !== 'TILES_CLAIMED' && event.type !== 'CITIES_CLAIMED') {
        event.x = event.tiles[0].x;
        event.y = event.tiles[0].y;
      }

      if (event.type === 'CITY_FOUNDED') {
        // Keep track of the city
        const cityName = event.text.replace(' is founded.', '');
        event.city = { name: cityName, owner: event.civ };
        this.cities[event.x + ',' + event.y] = event.city;
      }
      else if (event.type === 'CITY_RAZED') {
        event.x = event.tiles[0].x;
        event.y = event.tiles[0].y;
        event.city = this.cities[event.x + ',' + event.y];
        event.text = `${event.city.name} has been burned to the ground by ${event.civ}!`;

        // Mass razings are compounded into one event; we want to separate them
        _.each(event.tiles.slice(1), (tile: Tile) => {
          const eventCopy = Object.assign({}, event);
          eventCopy.x = tile.x;
          eventCopy.y = tile.y;
          eventCopy.city = this.cities[eventCopy.x + ',' + eventCopy.y];
          eventCopy.text = `${eventCopy.city.name} has been burned to the ground by ${eventCopy.civ}!`;
          eventsToAdd.push(eventCopy);
        });
      }
      else if (event.type === 'CITIES_TRANSFERRED') {
        const cityNames = _.map(event.tiles, (tile: Tile) => {
          return this.cities[tile.x + ',' + tile.y].name;
        });

        if (cityNames.length === 1) {
          event.text = `${event.civ} now controls the city of ${cityNames[0]}.`;
        }
        else {
          const lastCity = cityNames.pop();
          const citiesString = cityNames.length === 1 ? cityNames[0] : (cityNames.join(', ') + ',');
          event.text = `${event.civ} now controls the cities of ${citiesString} and ${lastCity}.`;
        }
      }

      if (event.type === 'TILES_CLAIMED') {
        if (event.civ) {
          event.text = `${event.civ} has claimed ${event.tiles.length} tile${event.tiles.length > 1 ? 's' : ''}.`;
        }
        else {
          event.text = `${event.tiles.length} tile${event.tiles.length > 1 ? 's have' : ' has'} been abandoned!`;
        }
      }

      this.events = this.events.concat(eventsToAdd);
    });

    // Add human-readable stuff to tiles
    this.tiles = _.each(this.rawData.tiles, (tile: Tile, i: number) => {
      switch (tile.elevationId) {
        case 0: tile.elevation = 'MOUNTAIN'; break;
        case 1: tile.elevation = 'HILLS'; break;
        case 2: tile.elevation = 'ABOVE_SEA_LEVEL'; break;
        case 3: tile.elevation = 'BELOW_SEA_LEVEL'; break;
        default: tile.elevation = tile.elevationId; break;
      }

      switch (tile.typeId) {
        case 0: tile.type = 'GRASSLAND'; break;
        case 1: tile.type = 'PLAINS'; break;
        case 2: tile.type = 'DESERT'; break;
        case 3: tile.type = 'TUNDRA'; break;
        case 4: tile.type = 'SNOW'; break;
        case 5: tile.type = 'COAST'; break;
        case 6: tile.type = 'OCEAN'; break;
        default: tile.type = tile.typeId; break;
      }

      switch (tile.featureId) {
        case -1: tile.feature = 'NO_FEATURE'; break;
        case 0: tile.feature = 'ICE'; break;
        case 1: tile.feature = 'JUNGLE'; break;
        case 2: tile.feature = 'MARSH'; break;
        case 3: tile.feature = 'OASIS'; break;
        case 4: tile.feature = 'FLOOD_PLAINS'; break;
        case 5: tile.feature = 'FOREST'; break;
        case 15: tile.feature = 'CERRO_DE_POTOSI'; break;
        case 17: tile.feature = 'ATOLL'; break;
        case 18: tile.feature = 'SRI_PADA'; break;
        case 19: tile.feature = 'MT_SINAI'; break;
        default: tile.feature = tile.featureId; break;
        // TODO: enumerate the rest of the natural wonders and feature types
      }
    });

    // Chunk the tiles a 2D array
    this.tiles = _.chunk(this.tiles, this.meta.mapWidth);

    for (let y = 0; y < this.tiles.length; y++) {
      for (let x = 0; x < this.tiles[y].length; x++) {
        this.tiles[y][x].x = x;
        this.tiles[y][x].y = y;
      }
    }
  }
}