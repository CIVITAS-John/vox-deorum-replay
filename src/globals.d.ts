/**
 * Global type declarations for external libraries and global variables
 * These libraries are loaded via script tags in index.html
 */

// jQuery
declare const $: any;
declare const jQuery: any;

// Lodash
declare const _: any;

// Leaflet
declare const L: any;

// jDataView for binary parsing
declare class jDataView {
  constructor(buffer: ArrayBuffer, byteOffset?: number, byteLength?: number, littleEndian?: boolean);
  tell(): number;
  seek(position: number): void;
  getBytes(length: number): any;
  getString(length: number): string;
  getInt32(byteOffset?: number, littleEndian?: boolean): number;
  getInt16(byteOffset?: number, littleEndian?: boolean): number;
  getInt8(byteOffset?: number): number;
}

// Bootstrap components
interface JQuery {
  selectpicker(options?: any): JQuery;
  selectpicker(method: string, ...args: any[]): JQuery;
  slider(options?: any): JQuery;
  slider(method: string, ...args: any[]): JQuery;
}

// Add toHex extension to arrays (used in binary parser)
interface Array<T> {
  toHex(): string;
}

// Global window exports from our application
interface Window {
  replayViewer: any;
  ReplayViewer: any;
  Map: any;
  HexLayer: any;
  ControlBar: any;
  EventLog: any;
  Replay: any;
  BinaryParser: any;
  CIV_COLORS: any;
}