/**
 * binary-parser.ts
 * Pure binary reader for Civilization V binary files
 * Wraps the native DataView API with little-endian defaults and position
 * tracking, with no dependency on external libraries or browser globals
 */

export class BinaryParser {
  private view: DataView;  // Native view over the file buffer
  private offset: number;  // Current read position within the buffer
  private end: number;     // One past the last readable byte

  /**
   * Create a reader over a file buffer
   * @param file The raw file contents
   * @param size Optional number of readable bytes, clamped to the buffer size
   */
  constructor(file: ArrayBuffer, size?: number) {
    this.view = new DataView(file);
    this.offset = 0;
    this.end = Math.min(size ?? file.byteLength, file.byteLength);
  }

  /**
   * Get the current read position in the buffer
   */
  tell(): number {
    return this.offset;
  }

  /**
   * Move the read position to the given byte offset
   */
  seek(position: number): void {
    this.offset = position;
  }

  /**
   * Verify that a read of the given length fits in the buffer
   */
  private checkBounds(length: number): void {
    if (this.offset < 0 || this.offset + length > this.end) {
      throw new Error(`Unable to read ${length} bytes at position ${this.decToHex(this.tell())}`);
    }
  }

  /**
   * Read raw bytes from the current position
   */
  getBytes(length: number): Uint8Array {
    this.checkBounds(length);
    const bytes = new Uint8Array(this.view.buffer, this.view.byteOffset + this.offset, length);
    this.offset += length;
    return bytes;
  }

  /**
   * Read a fixed-length string, decoding each byte as one character (latin1)
   * This preserves the raw bytes of non-ASCII text (the event mojibake repair
   * depends on it), so UTF-8 decoding must never be used here
   */
  getString(length: number): string {
    const bytes = this.getBytes(length);
    let value = '';
    for (let i = 0; i < bytes.length; i++) {
      value += String.fromCharCode(bytes[i]);
    }
    return value;
  }

  /**
   * Read a 32-bit little-endian integer and advance past it
   */
  getInt32(): number {
    this.checkBounds(4);
    const value = this.view.getInt32(this.offset, true);
    this.offset += 4;
    return value;
  }

  /**
   * Read a 16-bit little-endian integer and advance past it
   */
  getInt16(): number {
    this.checkBounds(2);
    const value = this.view.getInt16(this.offset, true);
    this.offset += 2;
    return value;
  }

  /**
   * Read an 8-bit integer and advance past it
   */
  getInt8(): number {
    this.checkBounds(1);
    const value = this.view.getInt8(this.offset);
    this.offset += 1;
    return value;
  }

  /**
   * Read single bytes until the given value is hit (the terminator is included)
   */
  getUntil(test: number): number[] {
    const result: number[] = [];
    let val: number | null = null;

    do {
      val = this.getInt8();
      result.push(val);
    } while (val !== test);

    return result;
  }

  /**
   * Read a variable-length string: a 32-bit length prefix, then that many bytes
   */
  getVarString(): string {
    const length = this.getInt32();
    return this.getString(length);
  }

  /**
   * Convert a decimal number to a hexadecimal string (for debugging)
   */
  decToHex(dec: number): string {
    // Arbitrary length decimal to hex conversion
    return parseInt(dec.toString()).toString(16).toUpperCase().padStart(2, '0');
  }
}
