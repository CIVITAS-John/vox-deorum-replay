/**
 * main.ts
 * Entry point for the Civilization V replay viewer application
 * Creates the replay viewer and exposes the app classes on window for
 * console debugging
 */

import { ReplayViewer } from './ui/replay-viewer';
import { ReplayMap } from './map/replay-map';
import { HexLayer } from './map/hex-layer';
import { ControlBar } from './ui/control-bar';
import { EventLog } from './ui/event-log';

// External libraries (Lodash, Leaflet) are loaded as script tags by index.html
// and typed in globals.d.ts

// Create the replay viewer instance
window.replayViewer = new ReplayViewer();

// Export classes to window for backward compatibility
window.ReplayViewer = ReplayViewer;
window.ReplayMap = ReplayMap;
window.HexLayer = HexLayer;
window.ControlBar = ControlBar;
window.EventLog = EventLog;
