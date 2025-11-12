/**
 * globals.d.ts
 * Global type declarations for external libraries
 */

/// <reference types="lodash" />
/// <reference types="jquery" />
/// <reference types="leaflet" />

// Declare global variables for libraries loaded as scripts
declare const _: _.LoDashStatic;
declare const $: JQueryStatic;

// jDataView - library for binary parsing
interface jDataViewStatic {
  new (buffer: ArrayBuffer, byteOffset?: number, byteLength?: number, littleEndian?: boolean): jDataView;
}

interface jDataView {
  seek(byteOffset: number): void;
  tell(): number;
  getInt8(byteOffset?: number): number;
  getUint8(byteOffset?: number): number;
  getInt16(byteOffset?: number, littleEndian?: boolean): number;
  getUint16(byteOffset?: number, littleEndian?: boolean): number;
  getInt32(byteOffset?: number, littleEndian?: boolean): number;
  getUint32(byteOffset?: number, littleEndian?: boolean): number;
  getFloat32(byteOffset?: number, littleEndian?: boolean): number;
  getFloat64(byteOffset?: number, littleEndian?: boolean): number;
  getString(length: number, byteOffset?: number, encoding?: string): string;
  getBytes(length: number, byteOffset?: number, littleEndian?: boolean): Uint8Array;
}

declare const jDataView: jDataViewStatic;

// Bootstrap Slider - jQuery plugin for sliders
interface BootstrapSliderOptions {
  id?: string;
  min?: number;
  max?: number;
  value?: number | number[];
  tooltip?: 'show' | 'hide' | 'always';
  tooltip_position?: 'top' | 'bottom' | 'left' | 'right';
  ticks?: number[];
  ticks_snap_bounds?: number;
}

interface BootstrapSliderInstance {
  setValue(value: number | number[], triggerSlideEvent?: boolean, triggerChangeEvent?: boolean): void;
  getValue(): number | number[];
  enable(): void;
  disable(): void;
  destroy(): void;
}

interface BootstrapSliderEvent extends JQuery.Event {
  value: {
    oldValue: number | number[];
    newValue: number | number[];
  };
}

// Extend JQuery interface for Bootstrap Slider
interface JQuery {
  slider(options?: BootstrapSliderOptions): JQuery;
  slider(method: 'getValue'): number | number[];
  slider(method: 'setValue', value: number | number[]): JQuery;
  slider(method: string, ...args: any[]): any;
  data(key: 'slider'): BootstrapSliderInstance;
}

// Import types for window extensions
import { ReplayViewer } from '../core/replay-viewer';
import { Map } from '../map/map';
import { HexLayer } from '../map/hex-layer';
import { ControlBar } from '../ui/control-bar';
import { EventLog } from '../ui/event-log';

// Global window extensions
interface Window {
  replayViewer: ReplayViewer;
  ReplayViewer: typeof ReplayViewer;
  Map: typeof Map;
  HexLayer: typeof HexLayer;
  ControlBar: typeof ControlBar;
  EventLog: typeof EventLog;
}