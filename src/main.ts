/**
 * main.ts
 * Entry point for the Civilization V replay viewer application
 * Initializes UI components and creates the main ReplayViewer instance
 */

import { ReplayViewer } from './core/replay-viewer';
import { Map } from './map/map';
import { HexLayer } from './map/hex-layer';
import { ControlBar } from './ui/control-bar';
import { EventLog } from './ui/event-log';

declare const $: any;

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
	'MESSAGE',
	'CITY_FOUNDED',
	'CITIES_TRANSFERRED',
	'CITY_RAZED',
	'PANTHEON_SELECTED',
	'RELIGION_FOUNDED'
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
(window as any).replayViewer = new ReplayViewer();

// Export classes to window for backward compatibility
(window as any).ReplayViewer = ReplayViewer;
(window as any).Map = Map;
(window as any).HexLayer = HexLayer;
(window as any).ControlBar = ControlBar;
(window as any).EventLog = EventLog;
