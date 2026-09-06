/**
 * globals.d.ts
 * Global type declarations for the vendor libraries that index.html loads as
 * script tags: Lodash and Leaflet. Also types the app classes that main.ts
 * exposes on window for console debugging.
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
  const _: _.LoDashStatic;
  const L: any;

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
