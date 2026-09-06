/**
 * globals.d.ts
 * Global type declarations for the vendor libraries that index.html loads as
 * script tags: jQuery, Lodash, Leaflet, Bootstrap's selectpicker, and
 * bootstrap-slider. Also types the app classes that main.ts exposes on
 * window for console debugging.
 *
 * The imports below turn this file into a module, so the declarations sit
 * inside declare global to reach the program's global scope.
 */

import { ReplayViewer } from './ui/replay-viewer';
import { ReplayMap } from './map/replay-map';
import { HexLayer } from './map/hex-layer';
import { ControlBar } from './ui/control-bar';
import { EventLog } from './ui/event-log';

declare global {
  // Script-tag globals
  const $: JQueryStatic;
  const _: _.LoDashStatic;
  const L: any;

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

  // jQuery plugin methods provided by the vendored libraries
  interface JQuery {
    selectpicker(options?: any): JQuery;
    selectpicker(method: string, ...args: any[]): JQuery;
    slider(options?: BootstrapSliderOptions): JQuery;
    slider(method: 'getValue'): number | number[];
    slider(method: 'setValue', value: number | number[]): JQuery;
    slider(method: string, ...args: any[]): any;
    data(key: 'slider'): BootstrapSliderInstance;
  }

  // App classes exposed on window for console debugging
  interface Window {
    replayViewer: ReplayViewer;
    ReplayViewer: typeof ReplayViewer;
    ReplayMap: typeof ReplayMap;
    HexLayer: typeof HexLayer;
    ControlBar: typeof ControlBar;
    EventLog: typeof EventLog;
  }
}

export {};
