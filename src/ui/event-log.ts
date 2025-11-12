/**
 * event-log.ts
 * Manages the event log display for game events
 * Shows filtered messages and events from the replay based on turn and event type
 */

import { GameEvent, EventType } from '../types/replay.types';
import { MessageElement } from '../types/ui.types';

// External libraries accessed as globals - types defined in globals.d.ts

/**
 * EventLog class
 * @param {Array} events - Array of game events to display
 */
export class EventLog {
	logContainer: HTMLElement;      // Main container element for the log
	messagesEl: HTMLElement;         // Element containing message list
	events: GameEvent[];             // Array of all game events
	types: EventType[];              // Currently selected event type filters

	constructor(events: GameEvent[]) {
		this.logContainer = document.querySelector('.log-container');
		this.messagesEl = this.logContainer.querySelector('.log-messages');
		this.events = events;

		// Types
		this.types = [];

		const eventSelect = document.getElementById('event-select');
		eventSelect.addEventListener('change', (e: Event) => {
			// Bootstrap selectpicker still needs jQuery, so we'll get value through its API
			this.setTypes(($(e.target) as any).val());
		});

		this.setTypes(($(eventSelect) as any).selectpicker('val'));

		// Add events and do initial rendering
		this.addAll(events);

		this.renderTurn(events[0].turn);
	}

	// Add a single event to the log
	add(event: GameEvent) {
		// Occasionally a message is blank? Just don't include it
		if (event.type === EventType.Message && !event.text) {
			return;
		}

		const msg = document.createElement('li');
		msg.className = 'message';
		msg.setAttribute('type', String(event.type));
		msg.setAttribute('civid', String(event.civId || ''));
		msg.setAttribute('turn', String(event.turn));
		msg.textContent = event.text || '';

		// Store event data on element
		(msg as MessageElement)._eventData = event;

		if (this.types.indexOf(event.type) === -1) {
			msg.classList.add('hidden');
		}

		this.messagesEl.appendChild(msg);
	}

	// Add all events to the log
	addAll(events?: GameEvent[]) {
		this.removeAll();
		_.each(this.events, this.add.bind(this));
	}

	// Remove a single event (not implemented)
	remove() {
	}

	// Clear all events from the log
	removeAll() {
		this.messagesEl.innerHTML = '';
	}

	// Update log display to show events up to specified turn
	renderTurn(turn: number) {
		const messages = this.messagesEl.querySelectorAll('.message');

		messages.forEach((msg: MessageElement) => {
			msg.classList.remove('active');
			if (parseInt(msg.getAttribute('turn')) <= turn) {
				msg.classList.add('active');
			}
		});

		const activeMessages = this.messagesEl.querySelectorAll('.message.active');
		const lastMessage = activeMessages[activeMessages.length - 1] as MessageElement;

		if (lastMessage) {
			const messageOffset = lastMessage.offsetTop;
			const listOffset = this.messagesEl.offsetTop;
			const listScroll = this.messagesEl.scrollTop;
			const listHeight = this.messagesEl.offsetHeight;

			// Simple animation for scrolling
			const targetScroll = turn ? (listScroll + (messageOffset - listOffset) - (listHeight / 2)) : 0;
			this.smoothScroll(this.messagesEl, targetScroll, 200);
		}
	}

	// Smooth scroll animation to target position
	smoothScroll(element: HTMLElement, target: number, duration: number) {
		const start = element.scrollTop;
		const distance = target - start;
		const startTime = performance.now();

		const animateScroll = (currentTime: number) => {
			const elapsed = currentTime - startTime;
			const progress = Math.min(elapsed / duration, 1);

			// Easing function (ease-in-out)
			const easeInOut = progress < 0.5
				? 2 * progress * progress
				: 1 - Math.pow(-2 * progress + 2, 2) / 2;

			element.scrollTop = start + (distance * easeInOut);

			if (progress < 1) {
				requestAnimationFrame(animateScroll);
			}
		};

		requestAnimationFrame(animateScroll);
	}

	// Set visible event types based on filter selection
	setTypes(types: string[] | number[]) {
		// Convert to EventType array (handles both string and number inputs)
		this.types = types.map(t => Number(t) as EventType);

		const messages = this.messagesEl.querySelectorAll('.message');
		messages.forEach((msg: Element) => msg.classList.add('hidden'));

		this.types.forEach(type => {
			const typeMessages = this.messagesEl.querySelectorAll(`[type="${type}"]`);
			typeMessages.forEach((msg: Element) => msg.classList.remove('hidden'));
		});
	}
}
