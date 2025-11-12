/**
 * event-log.ts
 * Manages the event log display for game events
 * Shows filtered messages and events from the replay based on turn and event type
 */

declare const $: any;
declare const _: any;

/**
 * EventLog class
 * @param {Array} events - Array of game events to display
 */
export class EventLog {
	logContainer: any;
	messagesEl: any;
	events: any[];
	types: string[];

	constructor(events: any[]) {
		this.logContainer = document.querySelector('.log-container');
		this.messagesEl = this.logContainer.querySelector('.log-messages');
		this.events = events;

		// Types
		this.types = [];

		const eventSelect = document.getElementById('event-select');
		eventSelect.addEventListener('change', (e: any) => {
			// Bootstrap selectpicker still needs jQuery, so we'll get value through its API
			this.setTypes($(e.target).val());
		});

		this.setTypes($(eventSelect).selectpicker('val'));

		// Add events and do initial rendering
		this.addAll(events);

		this.renderTurn(events[0].turn);
	}

	add(event: any) {
		// Occasionally a message is blank? Just don't include it
		if (event.type == 'MESSAGE' && !event.text) {
			return;
		}

		const msg = document.createElement('li');
		msg.className = 'message';
		msg.setAttribute('type', event.type);
		msg.setAttribute('civid', event.civId);
		msg.setAttribute('turn', event.turn);
		msg.textContent = event.text;

		// Store event data on element
		(msg as any)._eventData = event;

		if (this.types.indexOf(event.type) == -1) {
			msg.classList.add('hidden');
		}

		this.messagesEl.appendChild(msg);
	}

	addAll(events?: any[]) {
		this.removeAll();
		_.each(this.events, this.add.bind(this));
	}

	remove() {
	}

	removeAll() {
		this.messagesEl.innerHTML = '';
	}

	renderTurn(turn: number) {
		const messages = this.messagesEl.querySelectorAll('.message');

		messages.forEach((msg: any) => {
			msg.classList.remove('active');
			if (parseInt(msg.getAttribute('turn')) <= turn) {
				msg.classList.add('active');
			}
		});

		const activeMessages = this.messagesEl.querySelectorAll('.message.active');
		const lastMessage = activeMessages[activeMessages.length - 1] as any;

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

	smoothScroll(element: any, target: number, duration: number) {
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

	setTypes(types: string[]) {
		this.types = types;

		const messages = this.messagesEl.querySelectorAll('.message');
		messages.forEach((msg: any) => msg.classList.add('hidden'));

		types.forEach(type => {
			const typeMessages = this.messagesEl.querySelectorAll(`[type="${type}"]`);
			typeMessages.forEach((msg: any) => msg.classList.remove('hidden'));
		});
	}
}
