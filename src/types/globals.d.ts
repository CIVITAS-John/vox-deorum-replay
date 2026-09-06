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
  setAttribute(attribute: string, value: any): BootstrapSliderInstance;
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
import { ReplayViewer } from '../ui/replay-viewer';
import { ReplayMap } from '../map/replay-map';
import { HexLayer } from '../map/hex-layer';
import { ControlBar } from '../ui/control-bar';
import { EventLog } from '../ui/event-log';

// Global window extensions
interface Window {
  replayViewer: ReplayViewer;
  ReplayViewer: typeof ReplayViewer;
  ReplayMap: typeof ReplayMap;
  HexLayer: typeof HexLayer;
  ControlBar: typeof ControlBar;
  EventLog: typeof EventLog;
}