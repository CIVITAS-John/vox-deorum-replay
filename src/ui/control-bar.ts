/**
 * control-bar.ts
 * UI control bar for replay playback
 * Manages play/pause, speed control, and turn navigation
 */

import { ControlBarConfig } from '../types/ui.types';

// External libraries accessed as globals - types defined in globals.d.ts

/**
 * ControlBar class
 * @param {Object} config - Configuration with start/end turns and onChange callback
 */
export class ControlBar {
	config: ControlBarConfig & { start: number; end: number; initial?: number };  // Extended configuration with turn range
	playPauseBtn: HTMLElement;      // Play/pause button element
	playIntervals: number[];         // Available playback speed intervals in ms
	playInterval: number;            // Current playback interval in ms
	speedSliderEl: HTMLElement;      // Speed control slider element
	speedSlider: any;                // Bootstrap slider instance for speed
	turnSliderEl: HTMLElement;       // Turn navigation slider element
	turnSlider: any;                 // Bootstrap slider instance for turns
	playTimer: number | null;        // Timer ID for playback animation
	private initialized: boolean = false;  // Track if the control bar has been initialized
	private keydownHandler: ((e: KeyboardEvent) => void) | null = null;  // Store keydown handler for cleanup
	private playPauseHandler: (() => void) | null = null;  // Store play/pause handler for cleanup

	constructor(config?: ControlBarConfig & { start: number; end: number; initial?: number }) {
		// Allow constructor to be called without config for initial instance creation
		if (config) {
			this.initialize(config);
		}
	}

	// Initialize or reinitialize the control bar with new config
	initialize(config: ControlBarConfig & { start: number; end: number; initial?: number }) {
		this.config = config;
		this.config.onChange = (this.config.onChange || function() {}).bind(this);

		// Stop any existing playback
		this.pause();

		// Only set up event handlers on first initialization
		if (!this.initialized) {
			// Play/pause button
			this.playPauseBtn = document.getElementById('playPause');
			this.playPauseHandler = this.togglePlay.bind(this);
			this.playPauseBtn.addEventListener('click', this.playPauseHandler);

			// Speed slider
			this.playIntervals = [2000, 1000, 600, 400, 0];
			this.playInterval = this.playIntervals[2];

			this.speedSliderEl = document.getElementById('speedSlider');

			// Note: Bootstrap slider still requires jQuery internally, we'll keep using it through its API
			$(this.speedSliderEl).slider({
				id: 'speedSlider',
				min: 0,
				max: 4,
				value: 2,
				tooltip: 'hide',
				ticks: [0, 1, 2, 3, 4],
				ticks_snap_bounds: 1
			});

			this.speedSlider = $(this.speedSliderEl).data().slider;

			$(this.speedSliderEl).on('change', (e: any) => this.setSpeed((e.value.newValue as number)));

			// Turn slider
			this.turnSliderEl = document.getElementById('turnSlider');

			$(this.turnSliderEl).slider({
				id: 'turnSlider',
				min: this.config.start,
				max: this.config.end,
				value: this.config.initial || this.config.start,
				tooltip: 'always',
				tooltip_position: 'bottom'
			});

			this.turnSlider = $(this.turnSliderEl).data().slider;

			// Listen for spacebar to toggle play/pause
			this.keydownHandler = (e: KeyboardEvent) => {
				// Prevent handling if not initialized with a config
				if (!this.config) return;

				switch (e.keyCode) {
					case 32: this.togglePlay(); return; // space
					case 33: this.setTurn(this.config.start); return; // page up
					case 34: this.setTurn(this.config.end); return; // page down
					case 35: this.setTurn(this.config.end); return; // end
					case 36: this.setTurn(this.config.start); return; // home
					case 37: this.step(-1); return; // left
					case 39: this.step(1); return; // right
					case 38: this.step(-10); return; // up
					case 40: this.step(10); return; // down
					case 49: this.speedSlider.setValue(0, true, true); return; // 1
					case 50: this.speedSlider.setValue(1, true, true); return; // 2
					case 51: this.speedSlider.setValue(2, true, true); return; // 3
					case 52: this.speedSlider.setValue(3, true, true); return; // 4
					case 53: this.speedSlider.setValue(4, true, true); return; // 5
					default: return;
				}
			};
			document.addEventListener('keydown', this.keydownHandler);

			this.initialized = true;
		} else {
			// On subsequent initializations, just update the turn slider range
			// Update the slider's min, max, and value without destroying it
			this.turnSlider.setAttribute({
				min: this.config.start,
				max: this.config.end
			});
			this.turnSlider.setValue(this.config.initial || this.config.start, true, true);
		}

		// Update turn slider event handlers (remove old ones first)
		$(this.turnSliderEl).off('change').on('change', (e: any) => {
			this.config.onChange(e.value.newValue);
		});

		// Listen for slide events (fires continuously while dragging)
		$(this.turnSliderEl).off('slide').on('slide', (e: any) => {
			this.config.onChange(e.value);
		});

		this.setTurn(this.config.initial || this.config.start);
	}
	
	// Get current turn number from slider
	getTurn() {
		return this.turnSlider.getValue();
	}

	// Set turn number on slider
	setTurn(turn: number) {
		this.turnSlider.setValue(turn, true, true);
	}

	// Step forward/backward by specified number of turns
	step(step?: number) {
		if (step === undefined) {
			step = 1;
		}

		if (this.getTurn() + step < this.config.start) {
			this.setTurn(this.config.start);
		}
		else if (this.getTurn() + step > this.config.end) {
			this.setTurn(this.config.end);
		}
		else {
			this.setTurn(this.getTurn() + step);
		}
	}

	// Start automatic playback
	play() {
		if (this.playTimer) { return; }

		this.playTimer = setInterval(() => {
			this.step();
		}, this.playInterval);
	}

	// Pause automatic playback
	pause() {
		if (!this.playTimer) { return; }

		clearInterval(this.playTimer);
		this.playTimer = null;
	}

	// Toggle between play and pause states
	togglePlay() {
		const icon = this.playPauseBtn.querySelector('i');
		if (this.playTimer) {
			this.pause();
			icon.classList.remove('fa-pause');
			icon.classList.add('fa-play');
		}
		else {
			this.play();
			icon.classList.remove('fa-play');
			icon.classList.add('fa-pause');
		}
	}

	// Set playback speed (0-4 scale)
	setSpeed(speed: number) {
		speed = speed || 0;

		this.playInterval = this.playIntervals[
			Math.max(0, Math.min(Math.round(speed), this.playIntervals.length - 1))
		];

		if (this.playTimer) {
			this.pause();
			this.play();
		}
	}

	// Clear the control bar (cleanup timers)
	clear() {
		// Stop playback timer if running
		if (this.playTimer) {
			clearInterval(this.playTimer);
			this.playTimer = null;
		}

		// Reset play/pause button to play icon
		const icon = this.playPauseBtn?.querySelector('i');
		if (icon) {
			icon.classList.remove('fa-pause');
			icon.classList.add('fa-play');
		}
	}
}
