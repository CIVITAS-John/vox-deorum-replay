/**
 * main.ts
 * Entry point for the Civilization V replay viewer application
 * Initializes UI components and creates the main ReplayViewer instance
 */

import { ReplayViewer } from './ui/replay-viewer';
import { ReplayMap } from './map/replay-map';
import { HexLayer } from './map/hex-layer';
import { ControlBar } from './ui/control-bar';
import { EventLog } from './ui/event-log';
import { EventType } from './types';

// External libraries accessed as globals - types defined in globals.d.ts

// Init event selectpicker
// Note: Bootstrap components require jQuery, so we keep it for vendor libraries only
$('#event-select').selectpicker({
	width: 275,
	noneSelectedText: 'No event types selected',
	countSelectedText: function (numSelected: number, numTotal: number) {
		return (numSelected == 1) ? '{0} item selected' : '{0} event types selected';
	}
});

$('#event-select').selectpicker('val', [
	EventType.Message,
	EventType.Strategies,
	EventType.CityFounded,
	EventType.CitiesTransferred,
	EventType.CityRazed,
	EventType.PantheonSelected,
	EventType.ReligionFounded
]);


// Init the sliders to get the styling
$('#speedSlider').slider({
	id: 'speedSlider',
	min: 0,
	max: 0,
	value: 0,
	tooltip: 'hide'
});

$('#turnSlider').slider({
	id: 'turnSlider',
	min: 0,
	max: 0,
	value: 0,
	tooltip: 'hide'
});

// Create the replay viewer instance
window.replayViewer = new ReplayViewer();

// Export classes to window for backward compatibility
window.ReplayViewer = ReplayViewer;
window.ReplayMap = ReplayMap;
window.HexLayer = HexLayer;
window.ControlBar = ControlBar;
window.EventLog = EventLog;
