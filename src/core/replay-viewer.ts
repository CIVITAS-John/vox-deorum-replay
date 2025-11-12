/**
 * replay-viewer.ts
 * Main controller for the replay viewer application
 * Handles file loading, replay processing, and coordinates map visualization and UI controls
 */

import { Map } from '../map/map';
import { EventLog } from '../ui/event-log';
import { ControlBar } from '../ui/control-bar';
import { Replay } from './replay';
import { MapLayer, MapControl } from '../types/map.types';

// External libraries accessed as globals - types defined in globals.d.ts

/**
 * ReplayViewer class
 * Initializes the replay viewer and sets up file handling
 */
export class ReplayViewer {
	map: Map;
	file: string;
	turn: string;
	replay: Replay;
	eventLog: EventLog;
	controlBar: ControlBar;

	constructor() {
		this.init();
	}

	/**
	 * Initialize the replay viewer
	 * Sets up map, file drag-and-drop support, and URL parameter handling
	 */
	init() {
		this.map = new Map();

		// Setup vanilla JavaScript drag-and-drop
		this.setupDragAndDrop();

		this.file = getParameterByName('file');
		this.turn = getParameterByName('turn');

		if (this.file) {
			this.loadFromDropbox(this.file);
		}

		function getParameterByName(name: string) {
			// Thanks StackOverflow!
			name = name.replace(/[\[]/, '\\[').replace(/[\]]/, '\\]');
			var regex = new RegExp('[\\?&]' + name + '=([^&#]*)');
			var results = regex.exec(location.search);
			return results === null ? '' : decodeURIComponent(results[1].replace(/\+/g, ' '));
		}
	}

	/**
	 * Setup drag-and-drop file handling using native HTML5 APIs
	 */
	setupDragAndDrop() {
		const dropZone = document.body;
		const self = this;

		// Prevent default drag behaviors
		const preventDefaults = (e: DragEvent) => {
			e.preventDefault();
			e.stopPropagation();
		};

		// Highlight drop zone when item is dragged over it
		const highlight = (e: DragEvent) => {
			dropZone.classList.add('drag-over');
		};

		const unhighlight = (e: DragEvent) => {
			dropZone.classList.remove('drag-over');
		};

		// Handle dropped files
		const handleDrop = (e: DragEvent) => {
			const dt = e.dataTransfer;
			const files = dt.files;

			if (files.length > 0) {
				self.handleFile(files[0]);
			}
			unhighlight(e);
		};

		// Setup event listeners
		['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
			dropZone.addEventListener(eventName, preventDefaults, false);
		});

		['dragenter', 'dragover'].forEach(eventName => {
			dropZone.addEventListener(eventName, highlight, false);
		});

		['dragleave', 'drop'].forEach(eventName => {
			dropZone.addEventListener(eventName, unhighlight, false);
		});

		dropZone.addEventListener('drop', handleDrop, false);

		// Also support file input through a click (optional enhancement)
		dropZone.addEventListener('click', (e: MouseEvent) => {
			// Only trigger file dialog if clicking on the body background, not on other elements
			if (e.target === dropZone) {
				const input = document.createElement('input');
				input.type = 'file';
				input.accept = '.Civ5Replay';
				input.onchange = (e: Event) => {
					const target = e.target as HTMLInputElement;
					if (target.files && target.files.length > 0) {
						self.handleFile(target.files[0]);
					}
				};
				input.click();
			}
		});
	}

	/**
	 * Handle a dropped or selected file
	 * @param {File} file - The file to process
	 */
	handleFile(file: File) {
		const reader = new FileReader();
		const self = this;

		reader.onloadend = function(e: ProgressEvent<FileReader>) {
			self.process(e.target!.result as ArrayBuffer, file.size);
		};

		reader.onerror = function(e: ProgressEvent<FileReader>) {
			console.error('Error reading file:', e);
			alert('Error reading file: ' + e.target.error);
		};

		// Read as ArrayBuffer to match the original behavior
		reader.readAsArrayBuffer(file);
	}

	loadFromDropbox(file: string) {
		// e.g. https://dl.dropboxusercontent.com/1/view/hrbho1q4dtro8pa/Ramesses%20II_0267%20AD-1987_42%20(9).Civ5Replay
		// file = 'hrbho1q4dtro8pa/Ramesses%20II_0267%20AD-1987_42%20(9).Civ5Replay'

		var self = this;
		var xhr = new XMLHttpRequest();

		xhr.open('GET', 'https://dl.dropboxusercontent.com/1/view/' + file, true);
		xhr.responseType = 'arraybuffer';

		xhr.onload = function (e: ProgressEvent<XMLHttpRequest>) {
			self.process(this.response, e.total);
		};

		xhr.send();
	}

	process(data: ArrayBuffer, length: number) {
		// Replay
		if (this.replay) { delete this.replay; }

		this.replay = new Replay(data, length);
		this.replay.process();

		// Event log
		if (this.eventLog) {
			const logMessages = document.querySelector('.log-messages');
			if (logMessages) {
				logMessages.innerHTML = '';
			}
			this.eventLog = null;
		}

		this.eventLog = new EventLog(this.replay.events);

		// Map
		_.each(this.map.layers, (layer: MapLayer) => {
			this.map.map.removeLayer(layer);
		});

		_.each(this.map.controls, (control: MapControl) => {
			this.map.map.removeControl(control);
		});

		this.map.initLayers(this.replay.tiles, this.replay.events);

		this.controlBar = new ControlBar({
			start: this.replay.meta.startTurn,
			end: this.replay.meta.endTurn,
			initial: this.turn === '' ? this.replay.meta.startTurn : (parseInt(this.turn) || this.replay.meta.startTurn),
			onChange: (turn: number) => {
				this.eventLog.renderTurn(turn);
				this.map.renderTurn(turn);
			}
		});

		return false;
	}
}
