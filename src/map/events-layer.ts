/**
 * events-layer.ts
 * Custom HexLayer for rendering event highlighting on the map
 * Shows dashed yellow borders around hexes where events occurred
 */

import { HexLayer } from './hex-layer';
import { HexData } from './types';
import { GameEvent, EventType } from '../replay/types';
import { calculateHexBorderWidth } from './utils/hex-border-utils';

declare const _: any;

// Event highlighting constants
const EVENT_COLOR = '#FFEB3B'; // Light yellow
const EVENT_WIDTH = 4;
const DASH_PATTERN = [4, 4]; // Dashed line pattern

/**
 * EventsLayer - Specialized HexLayer for rendering event highlights
 * @extends HexLayer
 */
export const EventsLayer = HexLayer.extend({
	/**
	 * Initialize the events layer
	 * @param {Object} config - Configuration object
	 */
	initialize: function(config: any) {
		// Set up events-specific drawing configuration
		const eventsConfig = _.extend({}, config, {
			zIndex: 70, // Above selection
			drawHex: this.drawEventHighlight.bind(this)
		});

		// Call parent initialize
		HexLayer.prototype.initialize.call(this, eventsConfig);

		// Store event hexes map (hex key -> event type)
		this.eventHexes = new Map<string, EventType>();
	},

	/**
	 * Draw event highlight on the hex
	 * @param {CanvasRenderingContext2D} ctx - Canvas context
	 * @param {HexData} hex - Hex data
	 * @param {number} cx - Center X coordinate
	 * @param {number} cy - Center Y coordinate
	 * @param {number} x1 - Left boundary
	 * @param {number} y1 - Top boundary
	 * @param {number} x2 - Right boundary
	 * @param {number} y2 - Bottom boundary
	 */
	drawEventHighlight: function(ctx: CanvasRenderingContext2D, hex: HexData, cx: number, cy: number, x1: number, y1: number, x2: number, y2: number) {
		const hexKey = `${hex.x},${hex.y}`;
		const eventType = this.eventHexes.get(hexKey);

		if (eventType !== undefined) {
			// Draw dashed light yellow border for event
			ctx.strokeStyle = EVENT_COLOR;
			ctx.lineWidth = calculateHexBorderWidth(x2 - x1, EVENT_WIDTH, EVENT_WIDTH / 4);
			ctx.setLineDash(DASH_PATTERN);
			ctx.stroke();
			ctx.setLineDash([]); // Reset to solid
		}
	},

	/**
	 * Highlight hexes where events occurred
	 * @param {GameEvent[]} events - Array of game events
	 */
	highlightEventHexes: function(events: GameEvent[]) {
		// Clear previous event hexes
		this.eventHexes.clear();

		// Add new event hexes (only first event per hex)
		for (const event of events) {
			const hexKeys = event.tiles?.map(t => `${t.x},${t.y}`);
			if (!hexKeys) continue;

			for (const hexKey of hexKeys) {
				// Only store if hex doesn't already have an event
				if (!this.eventHexes.has(hexKey)) {
					this.eventHexes.set(hexKey, event.type);
				}
			}
		}

		// Force redraw
		this.redraw();
	},

	/**
	 * Clear all event highlights
	 */
	clearEventHighlights: function() {
		this.eventHexes.clear();
		this.redraw();
	},

	/**
	 * Get the event type for a specific hex
	 * @param {string} hexKey - The hex key
	 * @returns {EventType | undefined} The event type or undefined
	 */
	getEventType: function(hexKey: string): EventType | undefined {
		return this.eventHexes.get(hexKey);
	}
});