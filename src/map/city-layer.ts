/**
 * city-layer.ts
 * Custom HexLayer for rendering cities on the map
 * Shows city locations with colored circles and name labels
 */

import { HexLayer } from './hex-layer';
import { CivColors } from '../utils/civ-colors';
import { TurnState, HexData } from '../types/map.types';
import { calculateTextOutlineWidth } from '../utils/hex-border-utils';

declare const L: any;
declare const _: any;

/**
 * CityLayer - Specialized HexLayer for rendering cities
 * @extends HexLayer
 */
export const CityLayer = HexLayer.extend({
	/**
	 * Initialize the city layer
	 * @param {Object} config - Configuration object
	 */
	initialize: function(config: any) {
		// Set up city-specific drawing configuration
		const cityConfig = _.extend({}, config, {
			zIndex: 40, // Above territory but below grid
			clipHexes: false, // Don't clip city rendering
			drawHex: this.drawCity.bind(this)
		});

		// Call parent initialize
		HexLayer.prototype.initialize.call(this, cityConfig);

		// Store config for city rendering options
		this.showNames = config.showNames !== false; // Default to true
		this.cityRadius = config.cityRadius || 0.1; // Radius as fraction of hex size
	},

	/**
	 * Draw a city on the hex
	 * @param {CanvasRenderingContext2D} ctx - Canvas context
	 * @param {HexData} hex - Hex data
	 * @param {number} cx - Center X coordinate
	 * @param {number} cy - Center Y coordinate
	 * @param {number} x1 - Left boundary
	 * @param {number} y1 - Top boundary
	 * @param {number} x2 - Right boundary
	 * @param {number} y2 - Bottom boundary
	 */
	drawCity: function(ctx: CanvasRenderingContext2D, hex: HexData, cx: number, cy: number, x1: number, y1: number, x2: number, y2: number) {
		// Check if this hex has a city
		if (!this.turnState) return;

		const hexKey = `${hex.x},${hex.y}`;
		const state = this.turnState[hexKey];

		if (!state || !state.city) return;

		// Get civilization color
		const civColors = state.owner ? CivColors[state.owner] : null;
		const cityColor = civColors ? civColors.city : [200, 200, 200]; // Default gray if no civ

		// Calculate city circle dimensions
		const hexWidth = x2 - x1;
		const radius = hexWidth * this.cityRadius;

		// Draw city circle with border
		ctx.save();

		// Draw white border/outline
		ctx.beginPath();
		ctx.arc(cx, cy, radius + 1, 0, 2 * Math.PI);
		ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
		ctx.fill();

		// Draw colored city circle
		ctx.beginPath();
		ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
		ctx.fillStyle = `rgb(${cityColor[0]}, ${cityColor[1]}, ${cityColor[2]})`;
		ctx.fill();

		// Draw city name if enabled
		if (this.showNames && state.city && hexWidth >= 16) {
			// Use hex-relative font size to avoid flickering during zoom
			// The font will naturally scale with the tile/hex size
			const fontSize = Math.sqrt(hexWidth) * 2.5; // Font size relative to hex height

			// Set up text style
			ctx.font = `bold ${fontSize}px Arial`;
			ctx.textAlign = 'left';
			ctx.textBaseline = 'middle';

			// Position text to the right of the circle with padding
			const textX = cx + radius + Math.sqrt(hexWidth);
			const textY = cy;

			// Draw text shadow/outline for readability
			ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
			ctx.lineWidth = calculateTextOutlineWidth(hexWidth);
			ctx.strokeText(state.city, textX, textY);

			// Draw white text
			ctx.fillStyle = 'white';
			ctx.fillText(state.city, textX, textY);
		}

		ctx.restore();
	},

	/**
	 * Update turn state and redraw
	 * @param {TurnState} turnState - New turn state
	 */
	setTurnState: function(turnState: TurnState) {
		this.turnState = turnState;
		this.redraw();
	}
});