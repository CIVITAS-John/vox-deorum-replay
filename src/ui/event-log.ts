/**
 * event-log.ts
 * Manages the event log display for game events
 * Shows filtered messages and events from the replay based on turn and event type
 */

import { GameEvent, EventType } from '../types/replay.types';

// External libraries accessed as globals - types defined in globals.d.ts

/**
 * EventLog class
 * Manages and displays game events with filtering and turn-based navigation
 */
export class EventLog {
	private readonly logContainer: HTMLElement;
	private readonly messagesEl: HTMLElement;
	private readonly events: GameEvent[];
	private types: Set<EventType> = new Set();

	// WeakMap for associating DOM elements with their event data
	private readonly elementToEvent = new WeakMap<HTMLElement, GameEvent>();
	private readonly eventToElement = new Map<GameEvent, HTMLElement>();

	// Track current turn for scrolling optimization
	private currentTurn: number = 0;

	constructor(events: GameEvent[]) {
		this.logContainer = document.querySelector('.log-container');
		this.messagesEl = this.logContainer.querySelector('.log-messages');
		this.events = events;

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
		msg.textContent = event.text || '';

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
	 * Render all events
	 */
	private renderEvents(): void {
		this.clear();

		const fragment = document.createDocumentFragment();
		this.events.forEach(event => {
			const element = this.renderEvent(event);
			if (element) {
				fragment.appendChild(element);
			}
		});

		this.messagesEl.appendChild(fragment);
	}

	/**
	 * Clear all events from the log
	 */
	clear(): void {
		// Clear associations
		this.eventToElement.clear();
		// WeakMap will be garbage collected automatically

		this.messagesEl.innerHTML = '';
	}

	/**
	 * Update log display to show events up to specified turn
	 * and scroll to the first event of the new turn
	 */
	renderTurn(turn: number): void {
		const messages = this.messagesEl.querySelectorAll<HTMLElement>('.message');
		let firstNewTurnElement: HTMLElement | null = null;
		let lastActiveElement: HTMLElement | null = null;

		messages.forEach(msg => {
			const msgTurn = parseInt(msg.dataset.turn || '0');

			if (msgTurn <= turn) {
				msg.classList.add('active');
				lastActiveElement = msg;

				// Find first element of the new turn (when advancing)
				if (!firstNewTurnElement && msgTurn === turn && turn > this.currentTurn) {
					firstNewTurnElement = msg;
				}
			} else {
				msg.classList.remove('active');
			}
		});

		// Determine which element to scroll to
		let targetElement: HTMLElement | null = null;

		if (turn === 0) {
			// Scroll to top when at turn 0
			this.messagesEl.scrollTop = 0;
			this.currentTurn = turn;
			return;
		}

		if (turn > this.currentTurn) {
			// Moving forward: scroll to first element of new turn
			targetElement = firstNewTurnElement || lastActiveElement;
		} else if (turn < this.currentTurn) {
			// Moving backward: find first element of this turn
			const turnElements = Array.from(messages).filter(msg =>
				parseInt(msg.dataset.turn || '0') === turn
			);
			targetElement = turnElements[0] as HTMLElement || lastActiveElement;
		} else {
			// Same turn, no scrolling needed
			return;
		}

		// Perform scrolling
		if (targetElement) {
			this.scrollToElement(targetElement);
		}

		this.currentTurn = turn;
	}

	/**
	 * Scroll to a specific element in the messages container
	 */
	private scrollToElement(element: HTMLElement): void {
		const containerRect = this.messagesEl.getBoundingClientRect();
		const elementRect = element.getBoundingClientRect();

		// Calculate the scroll position to center the element in view
		const relativeTop = elementRect.top - containerRect.top;
		const scrollOffset = this.messagesEl.scrollTop + relativeTop - (containerRect.height / 3);

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