/**
 * binary-parser.test.ts
 * Unit tests for the low-level binary reader
 * Pins the exact read semantics the schema engine relies on, including the
 * latin1 string decoding contract (one byte becomes one character)
 */

import { describe, it, expect } from 'vitest';
import { BinaryParser } from '../../src/core/binary-parser';

/**
 * Encode a number as a 32-bit little-endian integer
 */
function int32(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}

/**
 * Encode a number as a 16-bit little-endian integer
 */
function int16(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff];
}

/**
 * Encode a string as ASCII bytes
 */
function ascii(value: string): number[] {
  return Array.from(value, ch => ch.charCodeAt(0));
}

/**
 * Encode a string as a length-prefixed (varstr) byte sequence
 */
function varstr(value: string): number[] {
  return [...int32(value.length), ...ascii(value)];
}

/**
 * Build an ArrayBuffer from a list of byte groups
 */
function bufferOf(...parts: number[][]): ArrayBuffer {
  const bytes: number[] = [];
  for (const part of parts) {
    bytes.push(...part);
  }
  return new Uint8Array(bytes).buffer;
}

describe('BinaryParser', () => {
  it('reads little-endian integers of all widths', () => {
    const parser = new BinaryParser(bufferOf(int32(-4000), int16(0x1234), [0xff]));

    expect(parser.getInt32()).toBe(-4000);
    expect(parser.getInt16()).toBe(0x1234);
    expect(parser.getInt8()).toBe(-1);
  });

  it('tracks and moves the read position', () => {
    const parser = new BinaryParser(bufferOf(int32(1), int32(2)));

    expect(parser.tell()).toBe(0);
    parser.getInt32();
    expect(parser.tell()).toBe(4);
    parser.seek(0);
    expect(parser.tell()).toBe(0);
    expect(parser.getInt32()).toBe(1);
  });

  it('reads raw bytes as a view over the buffer', () => {
    const parser = new BinaryParser(bufferOf([1, 2, 3, 4, 5]));

    const bytes = parser.getBytes(3);
    expect(Array.from(bytes)).toEqual([1, 2, 3]);
    expect(parser.tell()).toBe(3);

    // The remaining bytes are still readable
    expect(Array.from(parser.getBytes(2))).toEqual([4, 5]);
  });

  it('reads length-prefixed strings, including empty ones', () => {
    const parser = new BinaryParser(bufferOf(varstr('hello'), varstr('')));

    expect(parser.getVarString()).toBe('hello');
    expect(parser.getVarString()).toBe('');
  });

  it('decodes each byte of a fixed string as exactly one character', () => {
    // Byte 0xe2 must decode to the single character 'â', not to a UTF-8
    // sequence: the replay event texts contain mis-encoded UTF-8 arrows that
    // are repaired downstream, and that repair depends on latin1 decoding
    const parser = new BinaryParser(bufferOf([0xe2, 0x86, 0x92]));

    expect(parser.getString(3)).toBe('â\u0086\u0092');
    expect(parser.getString(0)).toBe('');
  });

  it('reads bytes until a terminator is hit, keeping the terminator', () => {
    const parser = new BinaryParser(bufferOf([5, 3, 0, 9]));

    expect(parser.getUntil(0)).toEqual([5, 3, 0]);
    expect(parser.tell()).toBe(3);
  });

  it('throws a helpful error when a read runs past the end of the buffer', () => {
    const parser = new BinaryParser(bufferOf(int32(1)));
    parser.getInt32();  // consume the whole buffer

    // Positions are rendered as zero-padded hex (4 = 0x04)
    expect(() => parser.getBytes(2)).toThrow(/Unable to read 2 bytes at position 04/);
    expect(() => parser.getInt32()).toThrow(/Unable to read 4 bytes at position 04/);
  });

  it('honors a size limit smaller than the underlying buffer', () => {
    const parser = new BinaryParser(bufferOf(int32(1), int32(2)), 4);

    expect(parser.getInt32()).toBe(1);
    expect(() => parser.getInt32()).toThrow(/Unable to read 4 bytes at position 04/);
  });
});
