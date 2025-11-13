/**
 * selection-layer.ts
 * Custom HexLayer for rendering selection/hover highlighting on the map
 * Shows a solid yellow border around the selected/hovered hex
 */

import { HexLayer } from './hex-layer';
import { HexData } from '../types/map.types';
import { calculateHexBorderWidth } from '../utils/hex-border-utils';

declare const _: any;

// Selection highlighting constants
const SELECTION_COLOR = '#FFEB3B'; // Light yellow
const SELECTION_WIDTH = 4;

/**
 * SelectionLayer - Specialized HexLayer for rendering hex selection/hover
 * @extends HexLayer
 */
export const SelectionLayer = HexLayer.extend({
	/**
	 * Initialize the selection layer
	 * @param {Object} config - Configuration object
	 */
	initialize: function(config: any) {
		// Set up selection-specific drawing configuration
		const selectionConfig = _.extend({}, config, {
			zIndex: 65, // Above cities but below events
			drawHex: this.drawSelection.bind(this)
		});

		// Call parent initialize
		HexLayer.prototype.initialize.call(this, selectionConfig);

		// Store selection state
		this.selectedHex = null;
	},

	/**
	 * Draw selection highlight on the hex
	 * @param {CanvasRenderingContext2D} ctx - Canvas context
	 * @param {HexData} hex - Hex data
	 * @param {number} cx - Center X coordinate
	 * @param {number} cy - Center Y coordinate
	 * @param {number} x1 - Left boundary
	 * @param {number} y1 - Top boundary
	 * @param {number} x2 - Right boundary
	 * @param {number} y2 - Bottom boundary
	 */
	drawSelection: function(ctx: CanvasRenderingContext2D, hex: HexData, cx: number, cy: number, x1: number, y1: number, x2: number, y2: number) {
		const hexKey = `${hex.x},${hex.y}`;

		if (this.selectedHex === hexKey) {
			// Draw solid light yellow border for selection
			ctx.strokeStyle = SELECTION_COLOR;
			ctx.lineWidth = calculateHexBorderWidth(x2 - x1, SELECTION_WIDTH);
			ctx.stroke();
		}
	},

	/**
	 * Set the selected hex
	 * @param {string | null} hexKey - The hex key to select, or null to clear
	 */
	setSelectedHex: function(hexKey: string | null) {
		if (this.selectedHex !== hexKey) {
			this.selectedHex = hexKey;
			this.redraw();
		}
	},

	/**
	 * Get the currently selected hex
	 * @returns {string | null} The selected hex key or null
	 */
	getSelectedHex: function(): string | null {
		return this.selectedHex;
	},

	/**
	 * Clear the selection
	 */
	clearSelection: function() {
		this.setSelectedHex(null);
	}
});