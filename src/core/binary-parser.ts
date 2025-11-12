/**
 * binary-parser.ts
 * Handles parsing of binary replay files for Civilization V
 * Uses jDataView library to read binary data with proper byte order handling
 */

// External library accessed as global
declare const jDataView: any;
declare const _: any;

interface ItemConfig {
  type: string;
  length?: number;
  value?: any;
  items?: any;
}

export class BinaryParser {
  private view: any;

  constructor(file: ArrayBuffer, size: number) {
    this.view = new jDataView(file, 0, size, false);
  }

  parseItem(itemConfig: string | ItemConfig | Function, includeJunk?: boolean): any {
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
      case 'until': return this.getUntil(config.value);
      case 'tell': return this.tell();
      case 'array': return this.getArray(config.items, includeJunk);
      default:
        break;
    }
  }

  parseItems(itemConfigs: any, includeJunk?: boolean): any {
    if (itemConfigs.type === 'array') {
      return this.parseItem(itemConfigs, includeJunk);
    }

    // Takes dictionary of configs
    const data: any = {};

    _.each(itemConfigs, (type: any, key: string) => {
      const pointer = this.tell();

      try {
        const value = this.parseItem(type, includeJunk);

        if (key === "events") console.log(`Parsed ${value.length} events`);

        // Bail if we don't want to include junk data
        if (key.startsWith('_') && includeJunk === false) { return; }

        data[key] = value;
      } catch (e) {
        // Seek back to the pointer
        this.view.seek(pointer);
        console.error(`Error parsing key "${key}" at position ${this.decToHex(pointer)}: ${e}`);
        // Print the next 200 bytes
        console.log(`Next 200 bytes: ${this.getBytes(200).toHex().toUpperCase()}`);
        // Print the current data
        console.log(data);
        throw (e);
      }
    });

    return data;
  }

  tell(): number {
    return this.view.tell();
  }

  getBytes(length: number): any {
    try {
      return this.view.getBytes(length);
    } catch (e) {
      throw new Error(`Unable to read ${length} bytes at position ${this.decToHex(this.tell())}`);
    }
  }

  getString(length: number): string {
    try {
      return this.view.getString(length);
    } catch (e) {
      throw new Error(`Unable to read string of length ${length} at position ${this.decToHex(this.tell())}`);
    }
  }

  getInt32(): number {
    return this.view.getInt32(this.tell(), true);
  }

  getInt16(): number {
    return this.view.getInt16(this.tell(), true);
  }

  getInt8(): number {
    return this.view.getInt8(this.tell(), true);
  }

  getUntil(test: number): number[] {
    const result: number[] = [];
    let val: number | null = null;

    do {
      val = this.getInt8();
      result.push(val);
    } while (val !== test);

    return result;
  }

  getVarString(): string {
    // Variable-length string - uses first four bytes to specify length
    const length = this.getInt32();
    const value = this.getString(length);
    return value;
  }

  getArray(config: any, includeJunk?: boolean): any[] {
    const length = this.getInt32();
    const records: any[] = [];

    for (let i = 0; i < length; i++) {
      let record: any = {};

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

  decToHex(dec: number): string {
    // arbitrary length decimal to hex conversion
    return parseInt(dec.toString()).toString(16).toUpperCase().padStart(2, '0');
  }
}