/**
 * binary-parser.ts
 * Handles parsing of binary replay files for Civilization V
 * Uses jDataView library to read binary data with proper byte order handling
 */

import { ItemConfig, ParserConfig } from '../types/parser.types';

// External libraries accessed as globals - types defined in globals.d.ts

export class BinaryParser {
  public view: jDataView;  // jDataView instance for reading binary data with little-endian byte order

  constructor(file: ArrayBuffer, size: number) {
    this.view = new jDataView(file, 0, size, false);  // Initialize view with file buffer, false = little-endian
  }

  // Parse a single data item based on its configuration
  parseItem(itemConfig: ParserConfig, includeJunk?: boolean): unknown {
    if (typeof itemConfig === 'string') {
      itemConfig = { type: itemConfig };
    }

    if (typeof itemConfig === 'function') {
      (itemConfig.bind(this))();
      return;
    }

    const config = itemConfig as ItemConfig;

    switch (config.type) {
      case 'byte': return this.getBytes(config.length!);
      case 'str': return this.getString(config.length!);
      case 'varstr': return this.getVarString();
      case 'int32': return this.getInt32();
      case 'int16': return this.getInt16();
      case 'int8': return this.getInt8();
      case 'until': return this.getUntil(config.value as number);
      case 'tell': return this.tell();
      case 'array': return this.getArray(config.items as any, includeJunk);
      default:
        break;
    }
  }

  // Parse multiple items from a configuration object or array
  parseItems(itemConfigs: any, includeJunk?: boolean): unknown {
    if (typeof itemConfigs === 'object' && 'type' in itemConfigs && itemConfigs.type === 'array') {
      return this.parseItem(itemConfigs as ParserConfig, includeJunk);
    }

    // Takes dictionary of configs
    const data: Record<string, unknown> = {};

    _.each(itemConfigs as Record<string, ParserConfig>, (type: ParserConfig, key: string) => {
      const pointer = this.tell();

      try {
        const value = this.parseItem(type, includeJunk);

        if (key === "events" && Array.isArray(value)) console.log(`Parsed ${value.length} events`);

        // Bail if we don't want to include junk data
        if (key.startsWith('_') && includeJunk === false) { return; }

        data[key] = value;
      } catch (e) {
        // Seek back to the pointer
        this.view.seek(pointer);
        console.error(`Error parsing key "${key}" at position ${this.decToHex(pointer)}: ${e}`);
        // Print the next 200 bytes
        const bytes = this.getBytes(200);
        const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
        console.log(`Next 200 bytes: ${hex.toUpperCase()}`);
        // Print the current data
        console.log(data);
        throw (e);
      }
    });

    return data;
  }

  // Get current position in the buffer
  tell(): number {
    return this.view.tell();
  }

  // Read specified number of bytes from current position
  getBytes(length: number): Uint8Array {
    try {
      return this.view.getBytes(length);
    } catch (e) {
      throw new Error(`Unable to read ${length} bytes at position ${this.decToHex(this.tell())}`);
    }
  }

  // Read fixed-length string from current position
  getString(length: number): string {
    try {
      return this.view.getString(length);
    } catch (e) {
      throw new Error(`Unable to read string of length ${length} at position ${this.decToHex(this.tell())}`);
    }
  }

  // Read 32-bit integer (little-endian)
  getInt32(): number {
    return this.view.getInt32(this.tell(), true);
  }

  // Read 16-bit integer (little-endian)
  getInt16(): number {
    return this.view.getInt16(this.tell(), true);
  }

  // Read 8-bit integer
  getInt8(): number {
    return this.view.getInt8(this.tell());
  }

  // Read bytes until a specific value is encountered
  getUntil(test: number): number[] {
    const result: number[] = [];
    let val: number | null = null;

    do {
      val = this.getInt8();
      result.push(val);
    } while (val !== test);

    return result;
  }

  // Read variable-length string (length prefix as 32-bit int)
  getVarString(): string {
    // Variable-length string - uses first four bytes to specify length
    const length = this.getInt32();
    const value = this.getString(length);
    return value;
  }

  // Read array of items (length prefix as 32-bit int)
  getArray(config: ParserConfig, includeJunk?: boolean): unknown[] {
    const length = this.getInt32();
    const records: unknown[] = [];

    for (let i = 0; i < length; i++) {
      let record: unknown = {};

      if (typeof config === 'function') {
        record = config(i, includeJunk);
      }
      else if (typeof config === 'object') {
        record = this.parseItems(config, includeJunk);
      }

      records.push(record);
    }

    return records;
  }

  // Convert decimal number to hexadecimal string (for debugging)
  decToHex(dec: number): string {
    // arbitrary length decimal to hex conversion
    return parseInt(dec.toString()).toString(16).toUpperCase().padStart(2, '0');
  }
}