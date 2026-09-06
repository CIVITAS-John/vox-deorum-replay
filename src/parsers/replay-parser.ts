/**
 * replay-parser.ts
 * Parser for Civilization V (Vox Populi) replay files
 * Supplies the replay file schema to the general purpose BaseParser
 */

import { BaseParser } from './base-parser';
import { FileConfig } from './types';

/**
 * Default file configuration for Vox Populi replay files
 * Defines the binary structure and data types
 */
const DEFAULT_FILE_CONFIG: FileConfig = {
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
  _5: function (this: BaseParser) {
    // Heuristic to get around something I don't understand :-(
    // This section still stumps me - it's variable length, but doesn't
    // seem to follow the conventions of the rest of the file.
    let unknown = 0;

    while (Math.abs(unknown) < 100000) {
      unknown = this.getInt32();
    }

    // We've hit the start year, need to rewind
    this.seek(this.tell() - 7);
    console.log(`Found the start year: ${this.decToHex(this.tell())}`);
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
      type: 'int32',
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
      elevation: 'int8',
      type: 'int8',
      feature: 'int8',
      _5: 'int8'
    }
  }
};

/**
 * ReplayParser class
 * Parses binary replay files using the Civ5 replay schema
 */
export class ReplayParser extends BaseParser {
  /**
   * Create a replay parser
   * @param file The raw replay file contents
   * @param size The size of the replay data within the buffer
   * @param fileConfig Optional schema override
   */
  constructor(file: ArrayBuffer, size: number, fileConfig?: FileConfig) {
    super(file, size, fileConfig ?? DEFAULT_FILE_CONFIG);
  }

  /**
   * Get the default replay file configuration
   */
  static getDefaultFileConfig(): FileConfig {
    return DEFAULT_FILE_CONFIG;
  }
}
