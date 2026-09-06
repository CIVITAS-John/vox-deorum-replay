/**
 * control-bar.ts
 * UI control bar for replay playback
 * Manages play/pause, speed control, and turn navigation
 * The bar drives the game session and follows it back, so turns changed
 * anywhere stay in sync with the slider
 */

import { ControlBarConfig } from './types';
import { GameSession } from '../replay/session';

// External libraries accessed as globals - types defined in globals.d.ts

/**
 * ControlBar class
 * @param {Object} config - Configuration with the turn range and the session
 */
export class ControlBar {
	config: ControlBarConfig;        // Configuration with turn range and session
	session: GameSession | null;     // Game session that owns the turn
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
	private unsubscribe: (() => void) | null = null;  // Stops following the session

	constructor(config?: ControlBarConfig) {
		// Allow constructor to be called without config for initial instance creation
		if (config) {
			this.initialize(config);
		}
	}

	// Initialize or reinitialize the control bar with a new game session
	initialize(config: ControlBarConfig) {
		this.config = config;
		this.session = config.session;

		// Stop any existing playback
		this.pause();

		// Follow the session so the slider tracks turns changed elsewhere
		if (this.unsubscribe) {
			this.unsubscribe();
		}
		this.unsubscribe = this.session.subscribe((turn: number) => this.syncSlider(turn));

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
				value: this.config.start,
				tooltip: 'always',
				tooltip_position: 'bottom'
			});

			this.turnSlider = $(this.turnSliderEl).data().slider;

			// Listen for playback shortcuts
			this.keydownHandler = (e: KeyboardEvent) => {
				// Prevent handling when no replay is loaded
				if (!this.session) return;

				switch (e.keyCode) {
					case 32: this.togglePlay(); return; // space
					case 33: this.requestTurn(this.config.start); return; // page up
					case 34: this.requestTurn(this.config.end); return; // page down
					case 35: this.requestTurn(this.config.end); return; // end
					case 36: this.requestTurn(this.config.start); return; // home
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
		}

		// Update the turn slider range for the newly loaded replay. The slider
		// library takes one attribute per call.
		this.turnSlider.setAttribute('min', this.config.start);
		this.turnSlider.setAttribute('max', this.config.end);

		// Slider events drive the session
		$(this.turnSliderEl).off('change').on('change', (e: any) => {
			this.requestTurn((e.value.newValue as number));
		});

		// Listen for slide events (fires continuously while dragging)
		$(this.turnSliderEl).off('slide').on('slide', (e: any) => {
			this.requestTurn(e.value as number);
		});

		// Park the slider on the first turn until the session moves it
		this.turnSlider.setValue(this.config.start, false, false);
	}

	// Get current turn number from slider
	getTurn() {
		return this.turnSlider.getValue();
	}

	// Move the session to a turn; its notification updates the slider and the views
	private requestTurn(turn: number) {
		if (!this.session) return;
		this.session.setTurn(turn);
	}

	// Track a turn that changed elsewhere, without re-triggering slider events
	private syncSlider(turn: number) {
		if (this.turnSlider && this.getTurn() !== turn) {
			this.turnSlider.setValue(turn, false, false);
		}
	}

	// Step forward/backward by specified number of turns
	step(step?: number) {
		if (!this.session) return;
		if (step === undefined) {
			step = 1;
		}

		const target = (this.getTurn() as number) + step;
		if (target < this.config.start) {
			this.requestTurn(this.config.start);
		}
		else if (target > this.config.end) {
			this.requestTurn(this.config.end);
		}
		else {
			this.requestTurn(target);
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

	// Clear the control bar (stop playback and stop following the session)
	clear() {
		// Stop playback timer if running
		if (this.playTimer) {
			clearInterval(this.playTimer);
			this.playTimer = null;
		}

		// Stop following the session
		if (this.unsubscribe) {
			this.unsubscribe();
			this.unsubscribe = null;
		}
		this.session = null;

		// Reset play/pause button to play icon
		const icon = this.playPauseBtn?.querySelector('i');
		if (icon) {
			icon.classList.remove('fa-pause');
			icon.classList.add('fa-play');
		}
	}
}
