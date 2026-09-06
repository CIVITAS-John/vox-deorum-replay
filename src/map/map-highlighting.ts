/**
 * map-highlighting.ts
 * Module for managing map highlighting features
 * Handles selection highlighting and event border highlighting
 */

import { SelectionLayer } from './selection-layer';
import { EventsLayer } from './events-layer';
import { MapLayer } from './types';
import { GameEvent, EventType, Tile } from '../replay/types';

/**
 * MapHighlighting class
 * Manages different types of highlighting on the map
 */
export class MapHighlighting {
	private map: any;                              // Reference to Leaflet map instance
	private tiles: Tile[][];                        // Reference to tile data
	private selectedHex: string | null;            // Currently selected/hovered hex
	private eventHexes: Map<string, EventType>;    // First event type per hex
	private selectionLayer: MapLayer | null;       // Selection/hover highlighting layer
	private eventsLayer: MapLayer | null;          // Events border layer
	private parentMap: any;                        // Reference to parent ReplayMap instance
	private boundaryLayer: any;                    // Reference to boundary layer for civilization boundaries

	// Kept for backward compatibility
	private highlightedCivs: Set<string>;

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
	initLayers(map: any, tiles: Tile[][]) {
		this.map = map;
		this.tiles = tiles;

		// Create selection layer for mouse hover
		this.selectionLayer = new SelectionLayer({
			hexes: tiles
		});

		// Create events layer for border highlighting
		this.eventsLayer = new EventsLayer({
			hexes: tiles
		});

		// Add layers to map
		this.selectionLayer.addTo(map);
		this.eventsLayer.addTo(map);
	}

	/**
	 * Set reference to boundary layer for civilization boundary highlighting
	 */
	setBoundaryLayer(boundaryLayer: any) {
		this.boundaryLayer = boundaryLayer;
	}

	/**
	 * Get layers for layer control
	 */
	getLayers() {
		return {
			selection: this.selectionLayer,
			events: this.eventsLayer
		};
	}


	/**
	 * Clear all highlights
	 */
	clearAll() {
		this.selectedHex = null;
		this.eventHexes.clear();
		this.highlightedCivs.clear();

		if (this.selectionLayer) {
			(this.selectionLayer as any).clearSelection();
		}
		if (this.eventsLayer) {
			(this.eventsLayer as any).clearEventHighlights();
		}
		if (this.boundaryLayer) {
			this.boundaryLayer.clearCivHighlights();
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
				(this.selectionLayer as any).setSelectedHex(hexKey);
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
		// Clear and update internal tracking
		this.eventHexes.clear();
		for (const event of events) {
			const hexKeys = event.tiles?.map(t => `${t.x},${t.y}`);
			if (!hexKeys) continue;
			for (const hexKey of hexKeys) {
				if (!this.eventHexes.has(hexKey)) {
					this.eventHexes.set(hexKey, event.type);
				}
			}
		}

		// Delegate to events layer
		if (this.eventsLayer) {
			(this.eventsLayer as any).highlightEventHexes(events);
		}
	}

	/**
	 * Clear event highlights
	 */
	clearEventHighlights() {
		this.eventHexes.clear();
		if (this.eventsLayer) {
			(this.eventsLayer as any).clearEventHighlights();
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

	// Civilization boundary methods (delegated to boundary layer)

	highlightCivBoundaries(civNames: string[]) {
		this.highlightedCivs.clear();
		for (const name of civNames) {
			this.highlightedCivs.add(name);
		}
		if (this.boundaryLayer) {
			this.boundaryLayer.highlightCivBoundaries(civNames);
		}
	}

	addHighlightedCivs(civNames: string[]) {
		for (const name of civNames) {
			this.highlightedCivs.add(name);
		}
		if (this.boundaryLayer) {
			this.boundaryLayer.addHighlightedCivs(civNames);
		}
	}

	removeHighlightedCivs(civNames: string[]) {
		for (const name of civNames) {
			this.highlightedCivs.delete(name);
		}
		if (this.boundaryLayer) {
			this.boundaryLayer.removeHighlightedCivs(civNames);
		}
	}

	clearCivHighlights() {
		this.highlightedCivs.clear();
		if (this.boundaryLayer) {
			this.boundaryLayer.clearCivHighlights();
		}
	}

	setHighlightColors(hexColor?: string, boundaryColor?: string, eventColor?: string) {
		// For backward compatibility - colors are now fixed for consistency
		// Colors are no longer configurable in the individual layer modules
	}
}