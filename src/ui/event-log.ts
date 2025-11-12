/**
 * event-log.ts
 * Manages the event log display for game events
 * Shows filtered messages and events from the replay based on turn and event type
 */

import { GameEvent, EventType } from '../types/replay.types';
import { Replay } from '../core/replay';

// External libraries accessed as globals - types defined in globals.d.ts

/**
 * EventLog class
 * Manages and displays game events with filtering and turn-based navigation
 */
export class EventLog {
	private readonly logContainer: HTMLElement;
	private readonly messagesEl: HTMLElement;
	private readonly events: GameEvent[];
	private readonly replay: Replay;
	private types: Set<EventType> = new Set();

	// WeakMap for associating DOM elements with their event data
	private readonly elementToEvent = new WeakMap<HTMLElement, GameEvent>();
	private readonly eventToElement = new Map<GameEvent, HTMLElement>();

	// Track current turn for scrolling optimization
	private currentTurn: number = 0;

	// Track turn separator elements for scrolling
	private readonly turnSeparators = new Map<number, HTMLElement>();

	constructor(events: GameEvent[], replay: Replay) {
		this.logContainer = document.querySelector('.log-container');
		this.messagesEl = this.logContainer.querySelector('.log-messages');
		this.events = events;
		this.replay = replay;

		this.initializeEventFilter();
		this.renderEvents();

		if (events.length > 0) {
			this.renderTurn(events[0].turn);
		}
	}

	/**
	 * Initialize event type filtering
	 */
	private initializeEventFilter(): void {
		const eventSelect = document.getElementById('event-select');

		// Bootstrap selectpicker event handling
		$(eventSelect).on('changed.bs.select', (e: any) => {
			const selectedValues = $(e.target).val() || [];
			console.log('Event filter changed:', selectedValues);
			this.updateTypeFilter(selectedValues);
		});

		// Set initial filter values
		const initialValues = ($(eventSelect) as any).selectpicker('val') || [];
		this.updateTypeFilter(initialValues);
	}

	/**
	 * Update the type filter with new values
	 */
	private updateTypeFilter(types: (string | number)[]): void {
		this.types.clear();
		types.forEach(type => this.types.add(Number(type) as EventType));

		console.log('Setting types:', Array.from(this.types));
		this.applyTypeFilter();
	}

	/**
	 * Apply type filter to all message elements
	 */
	private applyTypeFilter(): void {
		const messages = this.messagesEl.querySelectorAll<HTMLElement>('.message');
		console.log('Total messages:', messages.length);

		messages.forEach(msg => {
			const event = this.elementToEvent.get(msg);
			if (event && this.types.has(event.type)) {
				msg.classList.remove('hidden');
			} else {
				msg.classList.add('hidden');
			}
		});
	}

	/**
	 * Create a message element for an event
	 */
	private renderEvent(event: GameEvent): HTMLElement | null {
		// Skip empty messages
		if (event.type === EventType.Message && !event.text) {
			return null;
		}

		const msg = document.createElement('li');
		msg.className = 'message';
		msg.dataset.type = String(event.type);
		msg.dataset.civId = String(event.civId || '');
		msg.dataset.turn = String(event.turn);

		// Add civilization header if civId exists
		if (event.civId !== undefined && event.civId >= 0) {
			const civName = this.replay.getCivName(event.civId);
			const civColor = this.replay.getCivColor(event.civId);

			if (civName) {
				// Create civ header
				const civHeader = document.createElement('div');
				civHeader.className = 'civ-header';

				if (civColor) {
					// Major civ - use colored circle
					const circle = document.createElement('span');
					circle.className = 'civ-circle';
					circle.style.backgroundColor = `rgb(${civColor.city[0]}, ${civColor.city[1]}, ${civColor.city[2]})`;
					civHeader.appendChild(circle);
				} else {
					// Minor civ - use rectangle with default color
					const rect = document.createElement('span');
					rect.className = 'civ-rectangle';
					civHeader.appendChild(rect);
				}

				// Create civ name text
				const civNameEl = document.createElement('span');
				civNameEl.className = 'civ-name';
				civNameEl.textContent = civName;

				civHeader.appendChild(civNameEl);
				msg.appendChild(civHeader);
			}
		}

		// Add event text
		const eventText = document.createElement('div');
		eventText.className = 'event-text';
		eventText.textContent = event.text || '';
		msg.appendChild(eventText);

		// Store bidirectional association using WeakMap and Map
		this.elementToEvent.set(msg, event);
		this.eventToElement.set(event, msg);

		// Apply initial filter
		if (!this.types.has(event.type)) {
			msg.classList.add('hidden');
		}

		return msg;
	}

	/**
	 * Create a turn separator element
	 */
	private createTurnSeparator(turn: number): HTMLElement {
		const separator = document.createElement('div');
		separator.className = 'turn-separator';
		separator.dataset.turn = String(turn);
		separator.textContent = `Turn ${turn}`;
		return separator;
	}

	/**
	 * Render all events
	 */
	private renderEvents(): void {
		this.clear();

		// If no events, return early
		if (this.events.length === 0) {
			return;
		}

		const fragment = document.createDocumentFragment();

		// Find the range of turns
		let minTurn = Infinity;
		let maxTurn = -Infinity;

		this.events.forEach(event => {
			if (event.turn < minTurn) minTurn = event.turn;
			if (event.turn > maxTurn) maxTurn = event.turn;
		});

		// Handle case where all events were empty and got filtered
		if (minTurn === Infinity || maxTurn === -Infinity) {
			return;
		}

		// Group events by turn for easier processing
		const eventsByTurn = new Map<number, GameEvent[]>();
		this.events.forEach(event => {
			// Skip empty message events
			if (event.type === EventType.Message && !event.text) {
				return;
			}

			if (!eventsByTurn.has(event.turn)) {
				eventsByTurn.set(event.turn, []);
			}
			eventsByTurn.get(event.turn)!.push(event);
		});

		// Create turn separators for all turns in range
		for (let turn = minTurn; turn <= maxTurn; turn++) {
			// Add turn separator for every turn
			const separator = this.createTurnSeparator(turn);
			this.turnSeparators.set(turn, separator);
			fragment.appendChild(separator);

			// Add events for this turn if they exist
			const turnEvents = eventsByTurn.get(turn) || [];
			turnEvents.forEach(event => {
				const element = this.renderEvent(event);
				if (element) {
					fragment.appendChild(element);
				}
			});
		}

		this.messagesEl.appendChild(fragment);
	}

	/**
	 * Clear all events from the log
	 */
	clear(): void {
		// Clear associations
		this.eventToElement.clear();
		this.turnSeparators.clear();
		// WeakMap will be garbage collected automatically

		this.messagesEl.innerHTML = '';
	}

	/**
	 * Update log display to show events up to specified turn
	 * and scroll to the turn separator for that turn
	 */
	renderTurn(turn: number): void {
		const messages = this.messagesEl.querySelectorAll<HTMLElement>('.message');
		const separators = this.messagesEl.querySelectorAll<HTMLElement>('.turn-separator');

		// Update active state for messages
		messages.forEach(msg => {
			const msgTurn = parseInt(msg.dataset.turn || '0');

			if (msgTurn <= turn) {
				msg.classList.add('active');
			} else {
				msg.classList.remove('active');
			}
		});

		// Update active state for turn separators
		separators.forEach(sep => {
			const sepTurn = parseInt(sep.dataset.turn || '0');

			if (sepTurn <= turn) {
				sep.classList.add('active');
			} else {
				sep.classList.remove('active');
			}
		});

		// Scroll to the turn separator if it exists
		if (turn === 0) {
			// Scroll to top when at turn 0
			this.messagesEl.scrollTop = 0;
			this.currentTurn = turn;
			return;
		}

		// Try to get the turn separator for this turn
		const turnSeparator = this.turnSeparators.get(turn);

		if (turnSeparator) this.scrollToElement(turnSeparator);

		this.currentTurn = turn;
	}

	/**
	 * Scroll to a specific element in the messages container
	 */
	private scrollToElement(element: HTMLElement): void {
		const containerRect = this.messagesEl.getBoundingClientRect();
		const elementRect = element.getBoundingClientRect();

		// Calculate the scroll position to put the element at the top
		const relativeTop = elementRect.top - containerRect.top;
		const scrollOffset = this.messagesEl.scrollTop + relativeTop;

		// Direct scroll without animation
		this.messagesEl.scrollTop = Math.max(0, scrollOffset);
	}

	/**
	 * Set visible event types based on filter selection
	 * @deprecated Use updateTypeFilter instead
	 */
	setTypes(types: string[] | number[]): void {
		this.updateTypeFilter(types);
	}

	/**
	 * Get event data for a message element
	 */
	getEventData(element: HTMLElement): GameEvent | undefined {
		return this.elementToEvent.get(element);
	}

	/**
	 * Get message element for an event
	 */
	getElementForEvent(event: GameEvent): HTMLElement | undefined {
		return this.eventToElement.get(event);
	}
}