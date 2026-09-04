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
  ReplayMap: any;
  HexLayer: any;
  ControlBar: any;
  EventLog: any;
  Replay: any;
  BinaryParser: any;
}