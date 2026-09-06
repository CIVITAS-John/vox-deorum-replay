/**
 * control-bar.ts
 * The playback bar under the content area
 * Holds the transport buttons, a native range input for the timeline, and a
 * popover with a go-to field and the speed choice. The bar drives the game
 * session and follows it back, so turns changed anywhere stay in sync
 */

import { ControlBarConfig } from './types';
import { GameSession } from '../replay/session';

// One playback speed: a short label, the milliseconds between turns, and an icon
interface SpeedOption {
	label: string;
	interval: number;
	icon: string;
}

// Available speeds, from slowest to "as fast as the browser allows"
const speedOptions: SpeedOption[] = [
	{ label: '0.5x', interval: 2000, icon: 'fa-hourglass-half' },
	{ label: '1x', interval: 1000, icon: 'fa-person-walking' },
	{ label: '2x', interval: 500, icon: 'fa-person-running' },
	{ label: '4x', interval: 250, icon: 'fa-bolt' },
	{ label: 'Max', interval: 0, icon: 'fa-forward-fast' }
];

// Index of the speed the bar starts with (1x)
const defaultSpeedIndex = 1;

/**
 * ControlBar class
 * @param config - Configuration with the turn range and the session
 */
export class ControlBar {
	config: ControlBarConfig;                // Configuration with turn range and session
	session: GameSession | null;             // Game session that owns the turn
	playInterval: number;                    // Current milliseconds between turns during playback
	private speedIndex: number;              // Index of the current speed option
	private playTimer: number | null;        // Timer ID for playback animation
	private initialized: boolean = false;    // Whether the DOM controls are bound
	private keydownHandler: ((e: KeyboardEvent) => void) | null = null;   // Keyboard shortcuts
	private outsideClickHandler: ((e: MouseEvent) => void) | null = null; // Closes the popover
	private unsubscribe: (() => void) | null = null;                      // Stops following the session

	// DOM elements the bar drives
	private firstButton: HTMLButtonElement;
	private prevButton: HTMLButtonElement;
	private playPauseButton: HTMLButtonElement;
	private nextButton: HTMLButtonElement;
	private lastButton: HTMLButtonElement;
	private turnRange: HTMLInputElement;
	private turnButton: HTMLButtonElement;
	private turnLabelLong: HTMLElement;
	private turnLabelShort: HTMLElement;
	private speedChip: HTMLButtonElement;
	private speedLabel: HTMLElement;
	private turnPopover: HTMLElement;
	private gotoForm: HTMLFormElement;
	private gotoInput: HTMLInputElement;
	private speedOptionsEl: HTMLElement;

	constructor(config?: ControlBarConfig) {
		// Allow construction without a config; initialize arrives with the session
		if (config) {
			this.initialize(config);
		}
	}

	/**
	 * Initialize or reinitialize the bar with a new game session
	 */
	initialize(config: ControlBarConfig) {
		this.config = config;
		this.session = config.session;

		// Stop any running playback and follow the new session
		this.pause();
		if (this.unsubscribe) {
			this.unsubscribe();
		}
		this.unsubscribe = this.session.subscribe((turn: number) => this.syncFromSession(turn));

		// Bind the DOM controls once; later sessions only refresh the ranges
		if (!this.initialized) {
			this.bindControls();
			this.initialized = true;
		}

		// Point the range input and the labels at the new turn range
		this.turnRange.min = String(this.config.start);
		this.turnRange.max = String(this.config.end);
		this.turnRange.value = String(this.session.currentTurn);
		this.gotoInput.min = String(this.config.start);
		this.gotoInput.max = String(this.config.end);
		this.updateTurnLabels(this.session.currentTurn);
		this.hidePopover();
	}

	/**
	 * Bind click, input, and keyboard handlers to the DOM controls
	 */
	private bindControls() {
		this.firstButton = document.getElementById('firstButton') as HTMLButtonElement;
		this.prevButton = document.getElementById('prevButton') as HTMLButtonElement;
		this.playPauseButton = document.getElementById('playPauseButton') as HTMLButtonElement;
		this.nextButton = document.getElementById('nextButton') as HTMLButtonElement;
		this.lastButton = document.getElementById('lastButton') as HTMLButtonElement;
		this.turnRange = document.getElementById('turnRange') as HTMLInputElement;
		this.turnButton = document.getElementById('turnButton') as HTMLButtonElement;
		this.turnLabelLong = document.getElementById('turnLabelLong');
		this.turnLabelShort = document.getElementById('turnLabelShort');
		this.speedChip = document.getElementById('speedChip') as HTMLButtonElement;
		this.speedLabel = document.getElementById('speedLabel');
		this.turnPopover = document.getElementById('turnPopover');
		this.gotoForm = document.getElementById('gotoForm') as HTMLFormElement;
		this.gotoInput = document.getElementById('gotoInput') as HTMLInputElement;
		this.speedOptionsEl = document.getElementById('speedOptions');

		// Transport buttons
		this.firstButton.addEventListener('click', () => this.requestTurn(this.config.start));
		this.prevButton.addEventListener('click', () => this.step(-1));
		this.nextButton.addEventListener('click', () => this.step(1));
		this.lastButton.addEventListener('click', () => this.requestTurn(this.config.end));
		this.playPauseButton.addEventListener('click', () => this.togglePlay());

		// The range input drives the session while dragging
		this.turnRange.addEventListener('input', () => {
			this.requestTurn(Number(this.turnRange.value));
		});

		// Both the turn chip and the speed chip open the popover
		this.turnButton.addEventListener('click', () => this.togglePopover());
		this.speedChip.addEventListener('click', () => this.togglePopover());

		// The go-to form jumps to the entered turn
		this.gotoForm.addEventListener('submit', (e: Event) => {
			e.preventDefault();
			const target = parseInt(this.gotoInput.value, 10);
			if (!Number.isNaN(target)) {
				this.requestTurn(target);
			}
			this.hidePopover();
		});

		// Build the speed choices into the popover
		this.buildSpeedOptions();
		this.applySpeed(defaultSpeedIndex);

		// Playback shortcuts, skipped while typing in a form field
		this.keydownHandler = (e: KeyboardEvent) => {
			if (!this.session) {
				return;
			}

			const target = e.target as HTMLElement;
			if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement ||
				target instanceof HTMLSelectElement || target.isContentEditable) {
				return;
			}

			switch (e.keyCode) {
				case 32: e.preventDefault(); this.togglePlay(); return;  // space, canceled so a focused button does not also fire
				case 33: this.requestTurn(this.config.start); return; // page up
				case 34: this.requestTurn(this.config.end); return;   // page down
				case 35: this.requestTurn(this.config.end); return;   // end
				case 36: this.requestTurn(this.config.start); return; // home
				case 37: this.step(-1); return;                  // left
				case 39: this.step(1); return;                   // right
				case 38: this.step(-10); return;                 // up
				case 40: this.step(10); return;                  // down
				case 49: this.applySpeed(0); return;             // 1
				case 50: this.applySpeed(1); return;             // 2
				case 51: this.applySpeed(2); return;             // 3
				case 52: this.applySpeed(3); return;             // 4
				case 53: this.applySpeed(4); return;             // 5
				default: return;
			}
		};
		document.addEventListener('keydown', this.keydownHandler);

		// Close the popover when clicking anywhere outside it or its chips
		this.outsideClickHandler = (e: MouseEvent) => {
			if (!this.turnPopover.hidden && !this.turnPopover.contains(e.target as Node) &&
				!this.turnButton.contains(e.target as Node) && !this.speedChip.contains(e.target as Node)) {
				this.hidePopover();
			}
		};
		document.addEventListener('click', this.outsideClickHandler);

		// Escape closes the popover
		document.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key === 'Escape' && !this.turnPopover.hidden) {
				this.hidePopover();
			}
		});
	}

	/**
	 * Build one radio choice per speed option into the popover
	 */
	private buildSpeedOptions() {
		speedOptions.forEach((option, index) => {
			const label = document.createElement('label');
			label.className = 'speed-option';

			const radio = document.createElement('input');
			radio.type = 'radio';
			radio.name = 'playbackSpeed';
			radio.value = String(index);
			radio.addEventListener('change', () => this.applySpeed(index));

			const icon = document.createElement('i');
			icon.className = `fa-solid ${option.icon}`;
			icon.setAttribute('aria-hidden', 'true');

			const text = document.createElement('span');
			text.textContent = option.label;

			label.appendChild(radio);
			label.appendChild(icon);
			label.appendChild(text);
			this.speedOptionsEl.appendChild(label);
		});
	}

	/**
	 * Move the session to a turn; its notification updates the bar and the views
	 */
	private requestTurn(turn: number) {
		if (!this.session) {
			return;
		}
		this.session.setTurn(turn);
	}

	/**
	 * Track a turn that changed elsewhere, without re-triggering the range input
	 */
	private syncFromSession(turn: number) {
		if (String(turn) !== this.turnRange.value) {
			this.turnRange.value = String(turn);
		}
		this.updateTurnLabels(turn);

		// Stop playback when the timeline reaches the last turn
		if (this.playTimer && turn >= this.config.end) {
			this.pause();
		}
	}

	/**
	 * Refresh the turn chips, long form on wide screens and bare number on phones
	 */
	private updateTurnLabels(turn: number) {
		this.turnLabelLong.textContent = `Turn ${turn} / ${this.config.end}`;
		this.turnLabelShort.textContent = String(turn);
	}

	/**
	 * Step forward or backward by a number of turns, clamped to the range
	 */
	step(step?: number) {
		if (!this.session) {
			return;
		}

		const amount = step === undefined ? 1 : step;
		const target = this.session.currentTurn + amount;

		if (target < this.config.start) {
			this.requestTurn(this.config.start);
		} else if (target > this.config.end) {
			this.requestTurn(this.config.end);
		} else {
			this.requestTurn(target);
		}
	}

	/**
	 * Start automatic playback
	 */
	play() {
		if (this.playTimer || !this.session) {
			return;
		}

		// Playback that starts at the last turn restarts from the beginning
		if (this.session.currentTurn >= this.config.end) {
			this.requestTurn(this.config.start);
		}

		this.playTimer = setInterval(() => {
			this.step();
		}, this.playInterval);
		this.updatePlayButton();
	}

	/**
	 * Pause automatic playback
	 */
	pause() {
		if (!this.playTimer) {
			return;
		}

		clearInterval(this.playTimer);
		this.playTimer = null;
		this.updatePlayButton();
	}

	/**
	 * Toggle between play and pause states
	 */
	togglePlay() {
		if (this.playTimer) {
			this.pause();
		} else {
			this.play();
		}
	}

	/**
	 * Point the play button's icon and label at the current playback state
	 */
	private updatePlayButton() {
		if (!this.playPauseButton) {
			return;
		}

		const icon = this.playPauseButton.querySelector('i');
		const playing = this.playTimer !== null;

		if (playing) {
			icon.className = 'fa-solid fa-pause';
			this.playPauseButton.setAttribute('aria-label', 'Pause');
		} else {
			icon.className = 'fa-solid fa-play';
			this.playPauseButton.setAttribute('aria-label', 'Play');
		}

		document.body.classList.toggle('playing', playing);
	}

	/**
	 * Apply a speed option by index, refreshing the radios, the chip, and a running timer
	 */
	private applySpeed(index: number) {
		const clamped = Math.max(0, Math.min(Math.round(index), speedOptions.length - 1));
		this.speedIndex = clamped;
		this.playInterval = speedOptions[clamped].interval;
		this.speedLabel.textContent = speedOptions[clamped].label;

		// Keep the radios in the popover in sync, also when set via keyboard
		const radios = this.speedOptionsEl.querySelectorAll<HTMLInputElement>('input[name="playbackSpeed"]');
		radios.forEach(radio => {
			radio.checked = Number(radio.value) === clamped;
		});

		// A running timer picks up the new interval
		if (this.playTimer) {
			clearInterval(this.playTimer);
			this.playTimer = null;
			this.play();
		}
	}

	/**
	 * Show or hide the turn and speed popover
	 */
	private togglePopover() {
		if (this.turnPopover.hidden) {
			this.turnPopover.hidden = false;
			this.turnButton.setAttribute('aria-expanded', 'true');
			this.speedChip.setAttribute('aria-expanded', 'true');
			this.gotoInput.value = String(this.session ? this.session.currentTurn : this.config.start);
			this.gotoInput.focus();
		} else {
			this.hidePopover();
		}
	}

	/**
	 * Hide the popover and drop its open state from the chips
	 */
	private hidePopover() {
		if (!this.initialized) {
			return;
		}

		this.turnPopover.hidden = true;
		this.turnButton.setAttribute('aria-expanded', 'false');
		this.speedChip.setAttribute('aria-expanded', 'false');
	}

	/**
	 * Clear the bar: stop playback and stop following the session
	 */
	clear() {
		if (this.playTimer) {
			clearInterval(this.playTimer);
			this.playTimer = null;
		}

		if (this.unsubscribe) {
			this.unsubscribe();
			this.unsubscribe = null;
		}
		this.session = null;

		this.hidePopover();
		this.updatePlayButton();
	}
}
