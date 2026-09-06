/**
 * boundary-layer.ts
 * Custom HexLayer for rendering civilization boundaries
 * Shows territory borders with civilization colors
 * Supports highlighting specific civilizations with bright yellow
 */

import { HexLayer } from './hex-layer';
import { HexData } from './types';
import { CivColors } from '../utils/civ-colors';
import { calculateHexBorderWidth } from '../utils/hex-border-utils';

declare const _: any;

// Boundary constants
const BOUNDARY_WIDTH = 12;
const HIGHLIGHT_COLOR = 'rgba(255, 255, 0, 1)'; // Bright yellow for highlighted civs

/**
 * BoundaryLayer - Specialized HexLayer for rendering civilization boundaries
 * @extends HexLayer
 */
export const BoundaryLayer = HexLayer.extend({
	/**
	 * Initialize the boundary layer
	 * @param {Object} config - Configuration object
	 */
	initialize: function(config: any) {
		// Set up boundary-specific drawing configuration
		const boundaryConfig = _.extend({}, config, {
			zIndex: 47, // Above grid layer
			drawHex: this.drawBoundaries.bind(this),
			drawHexEdges: this.getOutwardFacingEdges.bind(this)
		});

		// Call parent initialize
		HexLayer.prototype.initialize.call(this, boundaryConfig);

		// Store state
		this.highlightedCivs = new Set<string>();
	},

	/**
	 * Setup boundary drawing style
	 * @param {CanvasRenderingContext2D} ctx - Canvas context
	 * @param {HexData} hex - Hex data
	 * @param {number} cx - Center X coordinate
	 * @param {number} cy - Center Y coordinate
	 * @param {number} x1 - Left boundary
	 * @param {number} y1 - Top boundary
	 * @param {number} x2 - Right boundary
	 * @param {number} y2 - Bottom boundary
	 */
	drawBoundaries: function(ctx: CanvasRenderingContext2D, hex: HexData, cx: number, cy: number, x1: number, y1: number, x2: number, y2: number) {
		if (!this.turnState) return;

		const hexKey = `${hex.x},${hex.y}`;
		const state = this.turnState[hexKey];
		const owner = state?.owner;

		if (!owner) return;

		// Set boundary color and width
		if (this.highlightedCivs.has(owner)) {
			// Use bright yellow for highlighted civilizations
			ctx.strokeStyle = HIGHLIGHT_COLOR;
		} else {
			// Use civilization's territory color
			const civColors = CivColors[owner];
			if (civColors) {
				const color = civColors.territory;
				ctx.strokeStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]})`;
			} else {
				// Fallback to a default color if civ color not found
				ctx.strokeStyle = 'rgba(128, 128, 128)';
			}
		}
		ctx.lineWidth = calculateHexBorderWidth(x2 - x1, BOUNDARY_WIDTH, BOUNDARY_WIDTH / 12);
		ctx.stroke();
	},

	/**
	 * Determine which edges of a hex should be drawn based on boundary conditions
	 * Returns only outward-facing edges at civilization boundaries
	 * @param {CanvasRenderingContext2D} ctx - Canvas context
	 * @param {HexData} hex - Hex data
	 * @param {number} cx - Center X coordinate
	 * @param {number} cy - Center Y coordinate
	 * @param {number} x1 - Left boundary
	 * @param {number} y1 - Top boundary
	 * @param {number} x2 - Right boundary
	 * @param {number} y2 - Bottom boundary
	 * @returns {Set<number> | null} Set of edge indices to draw (1-6), or null for no edges
	 */
	getOutwardFacingEdges: function(ctx: CanvasRenderingContext2D, hex: HexData, cx: number, cy: number): Set<number> | null {
		if (!this.turnState) return new Set<number>();

		const hexKey = `${hex.x},${hex.y}`;
		const state = this.turnState[hexKey];
		const owner = state?.owner;

		// If no owner, don't draw any edges
		if (!owner) {
			return new Set<number>();
		}

		const isEvenRow = hex.y % 2 === 0;
		const edgesToDraw = new Set<number>();

		// Define neighbor positions by direction
		const neighborsByDirection = isEvenRow ? {
			'NE': [hex.x, hex.y + 1],
			'E':  [hex.x + 1, hex.y],
			'SE': [hex.x, hex.y - 1],
			'SW': [hex.x - 1, hex.y - 1],
			'W':  [hex.x - 1, hex.y],
			'NW': [hex.x - 1, hex.y + 1]
		} : {
			'NE': [hex.x + 1, hex.y + 1],
			'E':  [hex.x + 1, hex.y],
			'SE': [hex.x + 1, hex.y - 1],
			'SW': [hex.x, hex.y - 1],
			'W':  [hex.x - 1, hex.y],
			'NW': [hex.x, hex.y + 1]
		};

		// Map directions to edge numbers
		const directionToEdge = {
			'NE': 5,
			'E':  6,
			'SE': 1,
			'SW': 2,
			'W':  3,
			'NW': 4
		};

		// Check each direction: if neighbor is not in same territory, draw the edge
		for (const [direction, [nx, ny]] of Object.entries(neighborsByDirection)) {
			const neighborKey = `${nx},${ny}`;
			const neighborState = this.turnState[neighborKey];

			// Draw edge if neighbor has different owner or no owner
			if (!neighborState || !neighborState.owner || neighborState.owner !== owner) {
				edgesToDraw.add(directionToEdge[direction as keyof typeof directionToEdge]);
			}
		}

		// Set the boundary color for this hex
		if (this.highlightedCivs.has(owner)) {
			this.config.gridStyle = HIGHLIGHT_COLOR;
		} else {
			const civColors = CivColors[owner];
			if (civColors) {
				const color = civColors.territory;
				this.config.gridStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]})`;
			} else {
				this.config.gridStyle = 'rgba(128, 128, 128, 0.5)';
			}
		}

		return edgesToDraw;
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
	 * Get the owner of a specific hex
	 * @param {string} hexKey - The hex key
	 * @returns {string | undefined} The owner or undefined
	 */
	getHexOwner: function(hexKey: string): string | undefined {
		const state = this.turnState ? this.turnState[hexKey] : null;
		return state?.owner;
	}
});