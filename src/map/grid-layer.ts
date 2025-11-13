/**
 * grid-layer.ts
 * Custom HexLayer for rendering hex grid and civilization boundaries
 * Shows grid lines with civilization territory colors at boundaries
 * Supports highlighting specific civilizations with bright yellow
 */

import { HexLayer } from './hex-layer';
import { HexData } from '../types/map.types';
import { CivColors } from '../utils/civ-colors';
import { calculateHexBorderWidth } from '../utils/hex-border-utils';

declare const _: any;

// Grid and boundary constants
const DEFAULT_GRID_COLOR = 'rgba(255, 255, 255, 0.1)'; // Default semi-transparent white
const HIGHLIGHT_COLOR = 'rgba(255, 255, 0, 0.8)'; // Bright yellow for highlighted civs
const BOUNDARY_WIDTH = 4;
const HIGHLIGHT_WIDTH = 4;
const GRID_WIDTH = 2;

/**
 * GridLayer - Specialized HexLayer for rendering hex grid with civilization boundaries
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
			zIndex: 45, // Above territory and cities but below selection
			drawHex: this.drawGridWithBoundaries.bind(this)
		});

		// Call parent initialize
		HexLayer.prototype.initialize.call(this, gridConfig);

		// Store state
		this.turnState = null;
		this.highlightedCivs = new Set<string>();
		this.showGrid = config.showGrid !== false; // Default to true
	},

	/**
	 * Draw grid with civilization boundaries
	 * @param {CanvasRenderingContext2D} ctx - Canvas context
	 * @param {HexData} hex - Hex data
	 * @param {number} cx - Center X coordinate
	 * @param {number} cy - Center Y coordinate
	 * @param {number} x1 - Left boundary
	 * @param {number} y1 - Top boundary
	 * @param {number} x2 - Right boundary
	 * @param {number} y2 - Bottom boundary
	 */
	drawGridWithBoundaries: function(ctx: CanvasRenderingContext2D, hex: HexData, cx: number, cy: number, x1: number, y1: number, x2: number, y2: number) {
		if (!this.showGrid && !this.turnState) return;

		const hexKey = `${hex.x},${hex.y}`;
		const state = this.turnState ? this.turnState[hexKey] : null;
		const owner = state?.owner;

		// Check if this hex is on a boundary
		if (owner && this.turnState) {
			const isBoundary = this.isOnBoundary(hex.x, hex.y, owner);

			if (isBoundary) {
				// Hex is on a boundary - draw with civ color or highlight color
				if (this.highlightedCivs.has(owner)) {
					// Use bright yellow for highlighted civilizations
					ctx.strokeStyle = HIGHLIGHT_COLOR;
					ctx.lineWidth = calculateHexBorderWidth(x2 - x1, HIGHLIGHT_WIDTH);
				} else {
					// Use civilization's territory color
					const civColors = CivColors[owner];
					if (civColors) {
						const color = civColors.territory;
						ctx.strokeStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]})`;
					} else {
						ctx.strokeStyle = DEFAULT_GRID_COLOR;
					}
					ctx.lineWidth = calculateHexBorderWidth(x2 - x1, BOUNDARY_WIDTH);
				}
				ctx.stroke();
			} else if (this.showGrid) {
				// Not on boundary - draw regular grid if enabled
				ctx.strokeStyle = DEFAULT_GRID_COLOR;
				ctx.lineWidth = calculateHexBorderWidth(x2 - x1, GRID_WIDTH);
				ctx.stroke();
			}
		} else if (this.showGrid) {
			// No owner or no turn state - draw regular grid if enabled
			ctx.strokeStyle = DEFAULT_GRID_COLOR;
			ctx.lineWidth = calculateHexBorderWidth(x2 - x1, GRID_WIDTH);
			ctx.stroke();
		}
	},

	/**
	 * Check if a hex is on a civilization boundary
	 * @param {number} x - X coordinate
	 * @param {number} y - Y coordinate
	 * @param {string} owner - Owner of the hex
	 * @returns {boolean} True if on a boundary
	 */
	isOnBoundary: function(x: number, y: number, owner: string): boolean {
		const adjacentKeys = this.getAdjacentHexKeys(x, y);

		// Check each adjacent hex
		for (const adjKey of adjacentKeys) {
			const adjState = this.turnState[adjKey];
			if (!adjState || !adjState.owner || adjState.owner !== owner) {
				return true;
			}
		}

		return false;
	},

	/**
	 * Get adjacent hex keys for a given hex coordinate
	 * @param {number} x - X coordinate
	 * @param {number} y - Y coordinate
	 * @returns {string[]} Array of adjacent hex keys
	 */
	getAdjacentHexKeys: function(x: number, y: number): string[] {
		const adjacentKeys: string[] = [];
		const isEvenRow = y % 2 === 0;

		const neighbors = isEvenRow ? [
			[x - 1, y],      // West
			[x + 1, y],      // East
			[x - 1, y - 1],  // Northwest
			[x, y - 1],      // Northeast
			[x - 1, y + 1],  // Southwest
			[x, y + 1]       // Southeast
		] : [
			[x - 1, y],      // West
			[x + 1, y],      // East
			[x, y - 1],      // Northwest
			[x + 1, y - 1],  // Northeast
			[x, y + 1],      // Southwest
			[x + 1, y + 1]   // Southeast
		];

		for (const [nx, ny] of neighbors) {
			adjacentKeys.push(`${nx},${ny}`);
		}

		return adjacentKeys;
	},

	/**
	 * Highlight specific civilizations with bright yellow
	 * @param {string[]} civNames - Array of civilization names to highlight
	 */
	highlightCivBoundaries: function(civNames: string[]) {
		this.highlightedCivs.clear();
		for (const name of civNames) {
			this.highlightedCivs.add(name);
		}
		this.redraw();
	},

	/**
	 * Add civilizations to highlight
	 * @param {string[]} civNames - Array of civilization names
	 */
	addHighlightedCivs: function(civNames: string[]) {
		let changed = false;
		for (const name of civNames) {
			if (!this.highlightedCivs.has(name)) {
				this.highlightedCivs.add(name);
				changed = true;
			}
		}
		if (changed) {
			this.redraw();
		}
	},

	/**
	 * Remove civilizations from highlight
	 * @param {string[]} civNames - Array of civilization names
	 */
	removeHighlightedCivs: function(civNames: string[]) {
		let changed = false;
		for (const name of civNames) {
			if (this.highlightedCivs.delete(name)) {
				changed = true;
			}
		}
		if (changed) {
			this.redraw();
		}
	},

	/**
	 * Clear all civilization highlights
	 */
	clearCivHighlights: function() {
		if (this.highlightedCivs.size > 0) {
			this.highlightedCivs.clear();
			this.redraw();
		}
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
	},

	/**
	 * Get the owner of a specific hex
	 * @param {string} hexKey - The hex key
	 * @returns {string | undefined} The owner or undefined
	 */
	getHexOwner: function(hexKey: string): string | undefined {
		const state = this.turnState ? this.turnState[hexKey] : null;
		return state?.owner;
	}
});