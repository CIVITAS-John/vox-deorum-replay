/**
 * map-highlighting.ts
 * Module for managing map highlighting features
 * Handles selection highlighting and event border highlighting
 */

import { HexLayer } from './hex-layer';
import { MapLayer } from '../types/map.types';
import { GameEvent, EventType } from '../types/replay.types';

/**
 * Shared highlighting constants
 */
const HIGHLIGHT_COLOR = '#FFEB3B'; // Light yellow
const HIGHLIGHT_WIDTH = 4;

/**
 * MapHighlighting class
 * Manages different types of highlighting on the map
 */
export class MapHighlighting {
	private map: any;                              // Reference to Leaflet map instance
	private tiles: any[][];                        // Reference to tile data
	private selectedHex: string | null;            // Currently selected/hovered hex
	private eventHexes: Map<string, EventType>;    // First event type per hex
	private selectionLayer: MapLayer | null;       // Selection/hover highlighting layer
	private eventsLayer: MapLayer | null;          // Events border layer
	private parentMap: any;                        // Reference to parent ReplayMap instance

	// Kept for backward compatibility
	private highlightedCivs: Set<string>;
	private boundaryLayer: MapLayer | null;

	constructor(parentMap: any) {
		this.parentMap = parentMap;
		this.selectedHex = null;
		this.eventHexes = new Map();
		this.selectionLayer = null;
		this.eventsLayer = null;
		this.boundaryLayer = null;

		// Keep for backward compatibility
		this.highlightedCivs = new Set<string>();
	}

	/**
	 * Initialize highlighting layers
	 */
	initLayers(map: any, tiles: any[][]) {
		this.map = map;
		this.tiles = tiles;
		const self = this;

		// Create selection layer for mouse hover
		this.selectionLayer = new HexLayer({
			hexes: tiles,
			zIndex: 60,
			drawHex: function (ctx: CanvasRenderingContext2D, hex: any, cx: number, cy: number, x1: number, y1: number, x2: number, y2: number) {
				const hexKey = `${hex.x},${hex.y}`;
				if (self.selectedHex === hexKey) {
					// Draw solid light yellow border for selection
					ctx.strokeStyle = HIGHLIGHT_COLOR;
					ctx.lineWidth = HIGHLIGHT_WIDTH;
					ctx.stroke();
				}
			}
		});

		// Create events layer for border highlighting
		this.eventsLayer = new HexLayer({
			hexes: tiles,
			zIndex: 70,
			drawHex: function (ctx: CanvasRenderingContext2D, hex: any, cx: number, cy: number, x1: number, y1: number, x2: number, y2: number) {
				const hexKey = `${hex.x},${hex.y}`;
				const eventType = self.eventHexes.get(hexKey);

				if (eventType !== undefined) {
					// Draw dashed light yellow border for event
					ctx.strokeStyle = HIGHLIGHT_COLOR;
					ctx.lineWidth = HIGHLIGHT_WIDTH;
					ctx.setLineDash([4, 4]); // Dashed pattern
					ctx.stroke();
					ctx.setLineDash([]); // Reset to solid
				}
			}
		});

		// Create boundary layer for civilization boundaries (kept for backward compatibility)
		this.boundaryLayer = new HexLayer({
			hexes: tiles,
			zIndex: 65,
			overdraw: 2,
			drawHex: function (ctx: CanvasRenderingContext2D, hex: any, cx: number, cy: number, x1: number, y1: number, x2: number, y2: number) {
				if (!self.parentMap.turnState || self.highlightedCivs.size === 0) return;

				const hexKey = `${hex.x},${hex.y}`;
				const state = self.parentMap.turnState[hexKey];

				if (state && state.owner && self.highlightedCivs.has(state.owner)) {
					const adjacentKeys = self.getAdjacentHexKeys(hex.x, hex.y);
					let isBoundary = false;

					for (const adjKey of adjacentKeys) {
						const adjState = self.parentMap.turnState[adjKey];
						if (!adjState || !adjState.owner || adjState.owner !== state.owner) {
							isBoundary = true;
							break;
						}
					}

					if (isBoundary) {
						ctx.strokeStyle = 'rgba(255, 255, 0, 0.8)';
						ctx.lineWidth = 3;
						ctx.stroke();
					}
				}
			}
		});

		// Add layers to map
		this.selectionLayer.addTo(map);
		this.eventsLayer.addTo(map);
		this.boundaryLayer.addTo(map);
	}

	/**
	 * Get layers for layer control
	 */
	getLayers() {
		return {
			selection: this.selectionLayer,
			events: this.eventsLayer,
			boundaries: this.boundaryLayer
		};
	}

	/**
	 * Get adjacent hex keys for a given hex coordinate
	 */
	private getAdjacentHexKeys(x: number, y: number): string[] {
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
	}

	/**
	 * Clear all highlights
	 */
	clearAll() {
		this.selectedHex = null;
		this.eventHexes.clear();
		this.highlightedCivs.clear();
		this.redrawLayers();
	}

	/**
	 * Redraw highlighting layers
	 */
	private redrawLayers() {
		if (this.selectionLayer) {
			(this.selectionLayer as any).tileCache = {};
			this.selectionLayer.redraw();
		}
		if (this.eventsLayer) {
			(this.eventsLayer as any).tileCache = {};
			this.eventsLayer.redraw();
		}
		if (this.boundaryLayer) {
			(this.boundaryLayer as any).tileCache = {};
			this.boundaryLayer.redraw();
		}
	}

	// Selection methods

	/**
	 * Set the selected hex (for hover highlight)
	 */
	setSelectedHex(hexKey: string | null) {
		if (this.selectedHex !== hexKey) {
			this.selectedHex = hexKey;
			if (this.selectionLayer) {
				(this.selectionLayer as any).tileCache = {};
				this.selectionLayer.redraw();
			}
		}
	}

	/**
	 * Get the currently selected hex
	 */
	getSelectedHex(): string | null {
		return this.selectedHex;
	}

	// Event highlighting methods

	/**
	 * Highlight hexes where events occurred with colored borders
	 */
	highlightEventHexes(events: GameEvent[]) {
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

		if (this.eventsLayer) {
			(this.eventsLayer as any).tileCache = {};
			this.eventsLayer.redraw();
		}
	}

	/**
	 * Clear event highlights
	 */
	clearEventHighlights() {
		this.eventHexes.clear();
		if (this.eventsLayer) {
			(this.eventsLayer as any).tileCache = {};
			this.eventsLayer.redraw();
		}
	}

	// Backward compatibility methods - delegate to appropriate layer

	highlightHexes(hexKeys: string[]) {
		// For backward compatibility - treat as selection
		if (hexKeys.length > 0) {
			this.setSelectedHex(hexKeys[0]);
		}
	}

	addHighlightedHexes(hexKeys: string[]) {
		if (hexKeys.length > 0 && !this.selectedHex) {
			this.setSelectedHex(hexKeys[0]);
		}
	}

	removeHighlightedHexes(hexKeys: string[]) {
		if (hexKeys.includes(this.selectedHex || '')) {
			this.setSelectedHex(null);
		}
	}

	clearHexHighlights() {
		this.setSelectedHex(null);
	}

	// Civilization boundary methods (kept for backward compatibility)

	highlightCivBoundaries(civNames: string[]) {
		this.highlightedCivs.clear();
		for (const name of civNames) {
			this.highlightedCivs.add(name);
		}
		this.redrawLayers();
	}

	addHighlightedCivs(civNames: string[]) {
		for (const name of civNames) {
			this.highlightedCivs.add(name);
		}
		this.redrawLayers();
	}

	removeHighlightedCivs(civNames: string[]) {
		for (const name of civNames) {
			this.highlightedCivs.delete(name);
		}
		this.redrawLayers();
	}

	clearCivHighlights() {
		this.highlightedCivs.clear();
		this.redrawLayers();
	}

	setHighlightColors(hexColor?: string, boundaryColor?: string, eventColor?: string) {
		// For backward compatibility - colors are now fixed for consistency
		// Colors are no longer configurable, using shared constants instead
		this.redrawLayers();
	}
}