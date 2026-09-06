/**
 * event-log.ts
 * The event log in the side panel
 * Shows filtered events from the replay grouped by turn, follows the session,
 * and shows civilization annotations next to civilization names
 */

import { GameEvent, EventType } from '../replay/types';
import { Replay } from '../replay/replay';
import { GameSession } from '../replay/session';
import { parseStrategyEvent, renderStrategyEvent } from './utils/strategy-parser';
import { formatGameText, hasGameMarkup } from './utils/text-formatter';
import { CivAnnotations, annotationFor } from './annotations';

// One entry in the event type filter: the type, its label, and its icon
interface FilterableType {
	type: EventType;
	label: string;
	icon: string;
}

// The event types the filter offers, in display order
const filterableTypes: FilterableType[] = [
	{ type: EventType.Message, label: 'Messages', icon: 'fa-comment-dots' },
	{ type: EventType.Strategies, label: 'Strategies', icon: 'fa-chess-knight' },
	{ type: EventType.CityFounded, label: 'New cities', icon: 'fa-city' },
	{ type: EventType.CitiesTransferred, label: 'City transfers', icon: 'fa-right-left' },
	{ type: EventType.CityRazed, label: 'City razings', icon: 'fa-fire' },
	{ type: EventType.PantheonSelected, label: 'Pantheons', icon: 'fa-hands-praying' },
	{ type: EventType.ReligionFounded, label: 'Religions', icon: 'fa-star-and-crescent' },
	{ type: EventType.TilesClaimed, label: 'Tile claims', icon: 'fa-draw-polygon' }
];

// Types shown when the log first appears: everything except tile claims,
// which are noisy on large maps
const defaultTypes: EventType[] = [
	EventType.Message,
	EventType.Strategies,
	EventType.CityFounded,
	EventType.CitiesTransferred,
	EventType.CityRazed,
	EventType.PantheonSelected,
	EventType.ReligionFounded
];

/**
 * EventLog class
 * Renders the session's events and filters them by type
 */
export class EventLog {
	private readonly messagesEl: HTMLElement;
	private readonly events: GameEvent[];
	private readonly replay: Replay;
	private readonly annotations: CivAnnotations;
	private readonly filterPanel: HTMLElement;
	private readonly filterDetails: HTMLDetailsElement;
	private readonly filterCount: HTMLElement;
	private types: Set<EventType> = new Set();

	// Associations between DOM elements and their event data
	private readonly elementToEvent = new WeakMap<HTMLElement, GameEvent>();
	private readonly eventToElement = new Map<GameEvent, HTMLElement>();

	// Turn separator elements by turn, for scrolling
	private readonly turnSeparators = new Map<number, HTMLElement>();

	// Stops following the session
	private unsubscribe: (() => void) | null = null;

	// Closes the filter dropdown on outside clicks
	private outsideClickHandler: ((e: MouseEvent) => void) | null = null;

	constructor(session: GameSession, annotations: CivAnnotations = {}) {
		this.messagesEl = document.getElementById('logMessages');
		this.filterPanel = document.getElementById('filterPanel');
		this.filterDetails = document.getElementById('eventsFilter') as HTMLDetailsElement;
		this.filterCount = document.getElementById('filterCount');
		this.events = session.replay.events;
		this.replay = session.replay;
		this.annotations = annotations;

		this.buildFilter();
		this.renderEvents();

		// Follow the session: every turn change scrolls and activates the log
		this.unsubscribe = session.subscribe((turn: number) => this.renderTurn(turn));
	}

	/**
	 * Stop following the session and empty the log, called when the session
	 * is discarded
	 */
	destroy(): void {
		if (this.unsubscribe) {
			this.unsubscribe();
			this.unsubscribe = null;
		}
		if (this.outsideClickHandler) {
			document.removeEventListener('click', this.outsideClickHandler);
			this.outsideClickHandler = null;
		}
		this.clear();
	}

	/**
	 * Build the filter checkbox for every offered event type
	 */
	private buildFilter(): void {
		filterableTypes.forEach(entry => {
			const label = document.createElement('label');
			label.className = 'filter-option';

			const checkbox = document.createElement('input');
			checkbox.type = 'checkbox';
			checkbox.checked = defaultTypes.includes(entry.type);
			checkbox.addEventListener('change', () => {
				if (checkbox.checked) {
					this.types.add(entry.type);
				} else {
					this.types.delete(entry.type);
				}
				this.updateFilterCount();
				this.applyTypeFilter();
			});

			const icon = document.createElement('i');
			icon.className = `fa-solid ${entry.icon}`;
			icon.setAttribute('aria-hidden', 'true');

			const text = document.createElement('span');
			text.textContent = entry.label;

			label.appendChild(checkbox);
			label.appendChild(icon);
			label.appendChild(text);
			this.filterPanel.appendChild(label);

			if (checkbox.checked) {
				this.types.add(entry.type);
			}
		});

		this.updateFilterCount();

		// Close the dropdown when clicking anywhere outside it
		this.outsideClickHandler = (e: MouseEvent) => {
			if (this.filterDetails.open && !this.filterDetails.contains(e.target as Node)) {
				this.filterDetails.open = false;
			}
		};
		document.addEventListener('click', this.outsideClickHandler);
	}

	/**
	 * Refresh the count shown on the filter button
	 */
	private updateFilterCount(): void {
		this.filterCount.textContent = this.types.size === filterableTypes.length
			? 'All types'
			: `${this.types.size} types`;
	}

	/**
	 * Apply the type filter to all message elements
	 */
	private applyTypeFilter(): void {
		const messages = this.messagesEl.querySelectorAll<HTMLElement>('.message');

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
				const civHeader = document.createElement('div');
				civHeader.className = 'civ-header';

				if (civColor) {
					// Major civ: colored circle in the territory color
					const circle = document.createElement('span');
					circle.className = 'civ-circle';
					circle.style.backgroundColor = `rgb(${civColor.territory[0]}, ${civColor.territory[1]}, ${civColor.territory[2]})`;
					civHeader.appendChild(circle);
				} else {
					// Minor civ: gray rectangle
					const rect = document.createElement('span');
					rect.className = 'civ-rectangle';
					civHeader.appendChild(rect);
				}

				const civNameEl = document.createElement('span');
				civNameEl.className = 'civ-name';
				civNameEl.textContent = civName;
				civHeader.appendChild(civNameEl);

				// URL annotation for this civilization, e.g. "· GLM"
				const annotation = annotationFor(this.annotations, event.civId);
				if (annotation) {
					const annotationEl = document.createElement('span');
					annotationEl.className = 'civ-annotation';
					annotationEl.textContent = `· ${annotation}`;
					civHeader.appendChild(annotationEl);
				}

				msg.appendChild(civHeader);
			}
		}

		// Add event text
		if (event.text) {
			// Try to parse as strategy event first
			const parsed = parseStrategyEvent(event.text);

			if (parsed) {
				// Render as formatted strategy change
				const strategyElement = renderStrategyEvent(parsed);
				msg.appendChild(strategyElement);
			} else if (hasGameMarkup(event.text)) {
				// Text contains game markup (icons/colors)
				const formattedElement = formatGameText(event.text);
				formattedElement.classList.add('event-text');
				msg.appendChild(formattedElement);
			} else {
				// Render as plain text
				const eventText = document.createElement('div');
				eventText.className = 'event-text';
				eventText.textContent = event.text;
				msg.appendChild(eventText);
			}
		}

		// Store bidirectional association
		this.elementToEvent.set(msg, event);
		this.eventToElement.set(event, msg);

		// Apply the current filter
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
	 * Render all events grouped by turn
	 */
	private renderEvents(): void {
		this.clear();

		if (this.events.length === 0) {
			return;
		}

		const fragment = document.createDocumentFragment();

		// Find the range of turns that carry events
		let minTurn = Infinity;
		let maxTurn = -Infinity;

		this.events.forEach(event => {
			if (event.turn < minTurn) minTurn = event.turn;
			if (event.turn > maxTurn) maxTurn = event.turn;
		});

		// Handle the case where all events were empty and got filtered
		if (minTurn === Infinity || maxTurn === -Infinity) {
			return;
		}

		// Group events by turn
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

		// Create a separator for every turn in range, then its events
		for (let turn = minTurn; turn <= maxTurn; turn++) {
			const separator = this.createTurnSeparator(turn);
			this.turnSeparators.set(turn, separator);
			fragment.appendChild(separator);

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
		this.eventToElement.clear();
		this.turnSeparators.clear();
		// The WeakMap garbage collects itself

		this.messagesEl.innerHTML = '';
	}

	/**
	 * Update the log for the session's turn: mark past events active and
	 * scroll to the turn separator
	 */
	renderTurn(turn: number): void {
		const messages = this.messagesEl.querySelectorAll<HTMLElement>('.message');
		const separators = this.messagesEl.querySelectorAll<HTMLElement>('.turn-separator');

		// Update active state for messages
		messages.forEach(msg => {
			const msgTurn = parseInt(msg.dataset.turn || '0', 10);
			msg.classList.toggle('active', msgTurn <= turn);
		});

		// Update active state for turn separators
		separators.forEach(sep => {
			const sepTurn = parseInt(sep.dataset.turn || '0', 10);
			sep.classList.toggle('active', sepTurn <= turn);
		});

		// Scroll to the top when the timeline sits before the first event
		if (turn === 0) {
			this.messagesEl.scrollTop = 0;
			return;
		}

		// Otherwise put the turn's separator at the top of the list
		const turnSeparator = this.turnSeparators.get(turn);
		if (turnSeparator) {
			this.scrollToElement(turnSeparator);
		}
	}

	/**
	 * Scroll to a specific element in the messages container
	 */
	private scrollToElement(element: HTMLElement): void {
		const containerRect = this.messagesEl.getBoundingClientRect();
		const elementRect = element.getBoundingClientRect();

		// Calculate the scroll position that puts the element at the top
		const relativeTop = elementRect.top - containerRect.top;
		const scrollOffset = this.messagesEl.scrollTop + relativeTop;

		this.messagesEl.scrollTop = Math.max(0, scrollOffset);
	}

	/**
	 * Set visible event types based on a filter selection
	 */
	setTypes(types: string[] | number[]): void {
		this.types.clear();
		types.forEach(type => this.types.add(Number(type) as EventType));

		this.updateFilterCount();
		this.applyTypeFilter();
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
