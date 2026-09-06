/**
 * grid-layer.ts
 * Simple HexLayer for rendering hex grid lines only
 */

import { HexLayer } from './hex-layer';
import { HexData } from './types';
import { calculateHexBorderWidth } from './utils/hex-border-utils';

declare const _: any;

// Grid constants
const DEFAULT_GRID_COLOR = 'rgba(255, 255, 255, 0.2)';
const GRID_WIDTH = 2;

/**
 * GridLayer - Simple layer for rendering hex grid lines
 * @extends HexLayer
 */
export const GridLayer = HexLayer.extend({
	/**
	 * Initialize the grid layer
	 * @param {Object} config - Configuration object
	 */
	initialize: function(config: any) {
		// Set up grid-specific drawing configuration
		const gridConfig = _.extend({}, config, {
			zIndex: 45, // Above territory but below cities
			drawHex: this.drawGrid.bind(this)
		});

		// Call parent initialize
		HexLayer.prototype.initialize.call(this, gridConfig);

		// Store state
		this.showGrid = config.showGrid;
	},

	/**
	 * Draw grid lines for a hex
	 * @param {CanvasRenderingContext2D} ctx - Canvas context
	 * @param {HexData} hex - Hex data
	 * @param {number} cx - Center X coordinate
	 * @param {number} cy - Center Y coordinate
	 * @param {number} x1 - Left boundary
	 * @param {number} y1 - Top boundary
	 * @param {number} x2 - Right boundary
	 * @param {number} y2 - Bottom boundary
	 */
	drawGrid: function(ctx: CanvasRenderingContext2D, hex: HexData, cx: number, cy: number, x1: number, y1: number, x2: number, y2: number) {
		if (!this.showGrid) return;

		// Set grid style
		ctx.strokeStyle = DEFAULT_GRID_COLOR;
		ctx.lineWidth = calculateHexBorderWidth(x2 - x1, GRID_WIDTH, GRID_WIDTH / 4);
		ctx.stroke();

		/*// Draw coordinate label
		const hexSize = x2 - x1;
		const fontSize = Math.max(10, Math.min(16, hexSize / 8));

		ctx.save();
		ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
		ctx.font = `${fontSize}px Arial`;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';

		const coordText = `${hex.x},${hex.y}`;
		ctx.fillText(coordText, cx, cy);
		ctx.restore();*/

		// Note: The actual edge drawing is handled by HexLayer's preDrawHex
	},

	/**
	 * Toggle grid visibility
	 * @param {boolean} show - Whether to show the grid
	 */
	setGridVisible: function(show: boolean) {
		if (this.showGrid !== show) {
			this.showGrid = show;
			this.redraw();
		}
	}
});