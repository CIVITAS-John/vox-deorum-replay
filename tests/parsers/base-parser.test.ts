/**
 * base-parser.test.ts
 * Unit tests for the general purpose parser base
 * Uses a toy schema over a hand-built buffer to prove the engine handles
 * every schema feature independent of the replay format, which is what the
 * upcoming savegame parser will rely on
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { BaseParser } from '../../src/parsers/base-parser';
import { FileConfig } from '../../src/parsers/types';

/**
 * Toy schema exercising every schema feature: fixed strings, ints, junk
 * fields, arrays of records, nested arrays, the tell pseudo-type, the until
 * type, and custom parse functions both as fields and as array items
 */
const toyConfig: FileConfig = {
  magic: { type: 'str', length: 3 },
  count: 'int32',
  _junk: 'int32',                                  // junk field, dropped by default
  entries: {
    type: 'array',
    items: {
      name: 'varstr',
      values: { type: 'array', items: 'int16' }
    }
  },
  grid: {
    type: 'array',
    items: { type: 'array', items: 'int16' }       // arrays of arrays
  },
  position: 'tell',                                // captures the current offset
  terminator: { type: 'until', value: 0 },
  shout: function (this: BaseParser) {
    // Custom field hook: read a varstr and transform it
    return this.getVarString().toUpperCase();
  },
  twins: {
    type: 'array',
    items: function (this: BaseParser, index: number) {
      // Custom array item hook: the parser is bound as this
      return this.getInt32() + index;
    }
  }
};

/**
 * Minimal concrete parser used to test the abstract base
 */
class ToyParser extends BaseParser {
  constructor(file: ArrayBuffer, fileConfig?: FileConfig) {
    super(file, file.byteLength, fileConfig ?? toyConfig);
  }
}

/**
 * The toy file: two named entries with int16 lists, a 2x2-ish grid, a
 * terminator, a varstr, and two function-built array records
 */
function buildToyFile(): ArrayBuffer {
  const bytes: number[] = [];
  const push = (...part: number[]) => bytes.push(...part);

  // magic and scalars
  push(0x54, 0x53, 0x54);            // 'TST'
  push(2, 0, 0, 0);                  // count = 2
  push(0xe7, 0x03, 0, 0);            // _junk = 999

  // entries: two records of (varstr name, int16 array values)
  push(2, 0, 0, 0);                  // two entries
  push(3, 0, 0, 0, 0x6f, 0x6e, 0x65);  // 'one'
  push(3, 0, 0, 0, 1, 0, 2, 0, 3, 0);  // values = [1, 2, 3]
  push(3, 0, 0, 0, 0x74, 0x77, 0x6f);  // 'two'
  push(0, 0, 0, 0);                    // values = []

  // grid: two rows of int16 columns
  push(2, 0, 0, 0);                  // two rows
  push(2, 0, 0, 0, 10, 0, 20, 0);    // [10, 20]
  push(1, 0, 0, 0, 30, 0);           // [30]

  // terminator and trailing fields
  push(5, 3, 0);                     // until-0 bytes
  push(4, 0, 0, 0, 0x6f, 0x75, 0x63, 0x68);  // varstr 'ouch'

  // twins: two records built by the custom function
  push(2, 0, 0, 0);
  push(10, 0, 0, 0);                 // 10 + 0
  push(20, 0, 0, 0);                 // 20 + 1

  return new Uint8Array(bytes).buffer;
}

describe('BaseParser', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parses every schema feature from a custom format', () => {
    const file = buildToyFile();
    const parser = new ToyParser(file);
    const data = parser.parse() as Record<string, any>;

    expect(data.magic).toBe('TST');
    expect(data.count).toBe(2);
    expect(data.entries).toEqual([
      { name: 'one', values: [1, 2, 3] },
      { name: 'two', values: [] }
    ]);
    expect(data.grid).toEqual([[10, 20], [30]]);
    expect(data.terminator).toEqual([5, 3, 0]);
    expect(data.shout).toBe('OUCH');
    expect(data.twins).toEqual([10, 21]);
  });

  it('exposes the read position through the tell pseudo-type', () => {
    const parser = new ToyParser(buildToyFile());
    const data = parser.parse() as Record<string, any>;

    // 61 bytes come before the position field: 3 magic + 4 + 4 scalars,
    // 32 for the entries block, 22 for the grid block
    expect(data.position).toBe(61);
  });

  it('drops underscore-prefixed junk fields by default and keeps them on demand', () => {
    const plain = new ToyParser(buildToyFile()).parse() as Record<string, any>;
    expect(Object.keys(plain)).not.toContain('_junk');
    expect('_junk' in plain).toBe(false);

    const withJunk = new ToyParser(buildToyFile()).parse(true) as Record<string, any>;
    expect(withJunk._junk).toBe(999);
  });

  it('consumes the whole buffer when the schema matches the data', () => {
    const file = buildToyFile();
    const parser = new ToyParser(file);
    parser.parse();

    expect(parser.tell()).toBe(file.byteLength);
  });

  it('reports the failing key and position when the data does not match the schema', () => {
    const logSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});

    // A schema that expects far more bytes than the buffer holds
    const broken = new ToyParser(
      new Uint8Array([7, 0, 0, 0]).buffer,
      { fine: 'int32', boom: { type: 'str', length: 9999 } }
    );

    expect(() => broken.parse()).toThrow(/Unable to read 9999 bytes/);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('boom'));
  });

  it('accepts a schema override per instance', () => {
    const file = new Uint8Array([1, 0, 0, 0, 2, 0, 0, 0]).buffer;
    const parser = new ToyParser(file, { a: 'int32', b: 'int32' });
    const data = parser.parse() as Record<string, any>;

    expect(data).toEqual({ a: 1, b: 2 });
  });
});
