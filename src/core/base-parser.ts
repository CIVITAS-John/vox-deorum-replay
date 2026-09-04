/**
 * base-parser.ts
 * General purpose, format-agnostic parser base for Civilization V binary files
 * A subclass supplies a FileConfig schema describing the binary layout of its
 * file format and gets schema-driven parsing in return: the replay parser and
 * the upcoming savegame parser both build on this class
 */

import { BinaryParser } from './binary-parser';
import { FileConfig, ItemConfig, ParserConfig } from '../types';

export abstract class BaseParser {
  protected parser: BinaryParser;   // Low-level reader over the file buffer
  protected fileConfig: FileConfig; // Schema describing the file layout

  /**
   * Create a parser over a file buffer
   * @param file The raw file contents
   * @param size The size of the file data within the buffer
   * @param fileConfig Schema describing the binary layout of the file
   */
  constructor(file: ArrayBuffer, size: number, fileConfig: FileConfig) {
    this.parser = new BinaryParser(file, size);
    this.fileConfig = fileConfig;
  }

  /**
   * Parse the whole file according to the schema
   * @param includeJunk Whether to include unknown/debug fields (keys prefixed with an underscore)
   */
  parse(includeJunk: boolean = false): Record<string, unknown> {
    return this.parseItems(this.fileConfig, includeJunk) as Record<string, unknown>;
  }

  /**
   * Get the current read position in the buffer
   */
  tell(): number {
    return this.parser.tell();
  }

  /**
   * Move the read position to the given byte offset
   */
  seek(position: number): void {
    this.parser.seek(position);
  }

  /**
   * Read raw bytes from the current position
   */
  getBytes(length: number): Uint8Array<ArrayBuffer> {
    return this.parser.getBytes(length);
  }

  /**
   * Read a fixed-length string from the current position
   */
  getString(length: number): string {
    return this.parser.getString(length);
  }

  /**
   * Read a variable-length string from the current position
   */
  getVarString(): string {
    return this.parser.getVarString();
  }

  /**
   * Read a 32-bit little-endian integer from the current position
   */
  getInt32(): number {
    return this.parser.getInt32();
  }

  /**
   * Read a 16-bit little-endian integer from the current position
   */
  getInt16(): number {
    return this.parser.getInt16();
  }

  /**
   * Read an 8-bit integer from the current position
   */
  getInt8(): number {
    return this.parser.getInt8();
  }

  /**
   * Read a 32-bit little-endian float from the current position
   */
  getFloat32(): number {
    return this.parser.getFloat32();
  }

  /**
   * Convert a decimal number to a hexadecimal string (for debugging)
   */
  decToHex(dec: number): string {
    return this.parser.decToHex(dec);
  }

  /**
   * Parse a single schema entry
   * @param itemConfig A type name, a config object, or a custom function
   * @param includeJunk Whether to include unknown/debug fields
   */
  protected parseItem(itemConfig: ParserConfig, includeJunk?: boolean): unknown {
    if (typeof itemConfig === 'string') {
      itemConfig = { type: itemConfig };
    }

    // Custom parse hooks run against this parser and may return a value
    if (typeof itemConfig === 'function') {
      return (itemConfig as Function).call(this);
    }

    const config = itemConfig as ItemConfig;

    switch (config.type) {
      case 'byte': return this.parser.getBytes(config.length!);
      case 'str': return this.parser.getString(config.length!);
      case 'varstr': return this.parser.getVarString();
      case 'int32': return this.parser.getInt32();
      case 'int16': return this.parser.getInt16();
      case 'int8': return this.parser.getInt8();
      case 'float32': return this.parser.getFloat32();
      case 'until': return this.parser.getUntil(config.value as number);
      case 'tell': return this.tell();
      case 'array': return this.getArray(config.items as ParserConfig, includeJunk);
      default:
        return undefined;
    }
  }

  /**
   * Parse a dictionary of schema entries into a data object
   * @param itemConfigs A schema dictionary, or a nested array config
   * @param includeJunk Whether to include unknown/debug fields
   */
  protected parseItems(itemConfigs: FileConfig, includeJunk?: boolean): Record<string, unknown> | unknown[] {
    // An array config reads its own length prefix and recurses
    if ('type' in itemConfigs && itemConfigs.type === 'array') {
      return this.parseItem(itemConfigs as ParserConfig, includeJunk) as Record<string, unknown> | unknown[];
    }

    // Otherwise we have a dictionary of named fields, parsed in order
    const data: Record<string, unknown> = {};

    Object.keys(itemConfigs).forEach((key: string) => {
      const pointer = this.tell();

      try {
        const value = this.parseItem(itemConfigs[key], includeJunk);

        // Bail if we don't want to include junk data
        if (key.startsWith('_') && !includeJunk) { return; }

        data[key] = value;
      } catch (e) {
        // Seek back to the pointer before inspecting the damage
        this.seek(pointer);
        console.error(`Error parsing key "${key}" at position ${this.decToHex(pointer)}: ${e}`);
        // Print the next 200 bytes and the data collected so far, but never
        // let diagnostics mask the original error
        try {
          const bytes = this.getBytes(200);
          const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
          console.log(`Next 200 bytes: ${hex.toUpperCase()}`);
          console.log(data);
        } catch (e2) {
          // Not enough bytes left for diagnostics, nothing more to do
        }
        throw e;
      }
    });

    return data;
  }

  /**
   * Read an array: a 32-bit length prefix followed by that many records
   * @param config Schema for each record
   * @param includeJunk Whether to include unknown/debug fields
   */
  protected getArray(config: ParserConfig, includeJunk?: boolean): unknown[] {
    const length = this.parser.getInt32();
    const records: unknown[] = [];

    for (let i = 0; i < length; i++) {
      let record: unknown = {};

      if (typeof config === 'function') {
        record = (config as Function).call(this, i, includeJunk);
      } else if (typeof config === 'string') {
        record = this.parseItem(config, includeJunk);
      } else if (typeof config === 'object') {
        record = this.parseItems(config as FileConfig, includeJunk);
      }

      records.push(record);
    }

    return records;
  }
}
