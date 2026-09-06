/**
 * replay-map.ts
 * Manages the Leaflet map display for the replay viewer
 * Renders terrain, cities, and territories for the turn the session sits on
 * Includes highlighting features for hexes and civilization boundaries
 */

import { HexLayer } from './hex-layer';
import { CityLayer } from './city-layer';
import { GridLayer } from './grid-layer';
import { BoundaryLayer } from './boundary-layer';
import { MapHighlighting } from './map-highlighting';
import { CivColors } from '../utils/civ-colors';
import { MapLayer, HexData } from './types';
import { GameEvent, TileType, FeatureType, ElevationType, TurnState } from '../replay/types';
import { getTileTypeName, getFeatureName, getElevationName } from './utils/enum-names';
import { GameSession } from '../replay/session';

// External libraries accessed as globals - types defined in globals.d.ts

/**
 * ReplayMap class
 * Creates and initializes the Leaflet map instance
 */
export class ReplayMap {
	map: any;                             // Leaflet Map instance
	turn: number;                         // Current turn being displayed
	turnState: TurnState | undefined;     // Current turn's tile state, from the session
	layers: Record<string, MapLayer>;    // Map visualization layers by name
	session: GameSession | null;         // Game session that owns the turn and the per-turn state
	mapBounds: number[][];               // Stored bounds for refitting the map
	highlighting: MapHighlighting;       // Highlighting module instance
	events: GameEvent[];                 // Reference to all events for turn-based highlighting
	private unsubscribeSession: (() => void) | null;  // Stops following the session

	constructor() {
		this.map = L.map(document.querySelector('.map'), {
			attributionControl: false,
			zoomControl: false,   // The map buttons in the interface replace Leaflet's zoom control
			keyboardPanOffset: 0,
			fadeAnimation: false,  // Disable fade animation to prevent transparency transitions during redraw
			zoomSnap: 0.2          // Allow fractional zoom levels with 0.25 increments
		}).setView([0, 0], 0);

		this.turn = -1; // Initialize to -1 so first renderTurn always triggers a redraw
		this.events = []; // Will be populated when initLayers is called
		this.session = null;
		this.unsubscribeSession = null;

		// Initialize highlighting module
		this.highlighting = new MapHighlighting(this);
	}

	// Initialize map layers and follow the given game session
	initLayers(session: GameSession) {
		this.session = session;

		const replay = session.replay;
		const tiles = replay.tiles;

		// Store events for turn-based highlighting
		this.events = replay.events;

		this.layers = {
			terrain: new HexLayer({
				hexes: tiles,
				zIndex: 10,
				drawHex: function (ctx: CanvasRenderingContext2D, hex: HexData, cx: number, cy: number, x1: number, y1: number, x2: number, y2: number) {
					// Convert enum to texture name for rendering
					const textureName = getTileTypeName(hex.type as TileType).toUpperCase();
					switch (hex.type) {
						case TileType.Grassland:
						case TileType.Plains:
						case TileType.Desert:
						case TileType.Tundra:
						case TileType.Snow:
						case TileType.Coast:
						case TileType.Ocean:
							this.drawImage(ctx, textureName, x1, y1, x2 - x1, y2 - y1);
							break;
						default:
							break;
					}
				}
			}),

			feature: new HexLayer({
				hexes: tiles,
				zIndex: 20,
				drawHex: function (ctx: CanvasRenderingContext2D, hex: HexData, cx: number, cy: number, x1: number, y1: number, x2: number, y2: number) {
					// Convert enum to texture name for rendering
					const textureName = getFeatureName(hex.feature as FeatureType).toUpperCase().replace(' ', '_');
					switch (hex.feature) {
						case FeatureType.Ice:
						case FeatureType.Jungle:
						// case FeatureType.Marsh:
						// case FeatureType.Oasis:
						// case FeatureType.FloodPlains:
						case FeatureType.Forest:
							this.drawImage(ctx, textureName, x1, y1, x2 - x1, y2 - y1);
							break;
						default:
							break;
					}
				}
			}),

			elevation: new HexLayer({
				hexes: tiles,
				zIndex: 20,
				drawHex: function (ctx: CanvasRenderingContext2D, hex: HexData, cx: number, cy: number, x1: number, y1: number, x2: number, y2: number) {
					// Convert enum to texture name for rendering
					const textureName = getElevationName(hex.elevation as ElevationType).toUpperCase().replace(' ', '_');
					switch (hex.elevation) {
						case ElevationType.Mountain:
						case ElevationType.Hills:
							this.drawImage(ctx, textureName, x1, y1, x2 - x1, y2 - y1);
							break;
						default:
							break;
					}
				}
			}),

			territory: new HexLayer({
				hexes: tiles,
				zIndex: 30,
				overdraw: 1,
				drawHex: function (ctx: CanvasRenderingContext2D, hex: HexData, cx: number, cy: number, x1: number, y1: number, x2: number, y2: number) {
					if (!this.turnState) { return; }
					var state = this.turnState[hex.x + ',' + hex.y];
					if (!state) { return; }
					var land = hex.type !== TileType.Coast && hex.type !== TileType.Ocean;
					if (state.owner) {
						var civColors = CivColors[state.owner];
						var color = civColors ? civColors.territory : [0, 0, 0];
						ctx.fillStyle = `rgba(${color.join(',')}, ${(land ? 0.6 : 0.2)})`;
						ctx.fill();
					}
				}
			}),

			city: new CityLayer({
				hexes: tiles,
				zIndex: 40, // Above territory but below grid
				showNames: true
			}),

			grid: new GridLayer({
				hexes: tiles,
				zIndex: 45,
				showGrid: true
			}),

			boundary: new BoundaryLayer({
				hexes: tiles,
				zIndex: 46
			})
		};

		_.each(this.layers, (layer: MapLayer) => layer.addTo(this.map));

		// Initialize highlighting layers
		this.highlighting.initLayers(this.map, tiles);

		// Connect boundary layer to highlighting for civilization boundary highlighting
		this.highlighting.setBoundaryLayer(this.layers.boundary);

		// Follow the session: every turn change re-renders the map
		if (this.unsubscribeSession) {
			this.unsubscribeSession();
		}
		this.unsubscribeSession = session.subscribe((turn: number) => this.renderTurn(turn));

		var north = 85;
		var west = -180;
		// Saves without usable map dimensions can carry an empty hex grid, so
		// guard the bounds math against missing rows
		var south = north - ((tiles.length ? tiles.length : 1) * 0.3888888889);
		var east = west + ((tiles.length && tiles[0].length ? tiles[0].length : 1) * 2.4285714286);

		var bounds = [[south, west], [north, east]];
		// Store bounds for later use when map needs to be refit
		this.mapBounds = bounds;

		// Don't fit bounds here - let it be done after the replay loads
		// to ensure the container is properly sized
	}

	// The layers the layers panel can toggle, with their display labels
	getToggleableLayers() {
		const highlightLayers = this.highlighting.getLayers();
		return {
			Terrain: this.layers.terrain,
			Elevation: this.layers.elevation,
			Features: this.layers.feature,
			Territory: this.layers.territory,
			Cities: this.layers.city,
			Grid: this.layers.grid,
			Boundaries: this.layers.boundary,
			Selection: highlightLayers.selection,
			Events: highlightLayers.events
		};
	}


	// Update map display for the session's current turn
	renderTurn(turn: number) {
		if (!this.session) {
			return;
		}

		// The session holds the per-turn state derived from the events
		this.turnState = this.session.stateAt(turn);

		// Skip if turn hasn't changed
		if (this.turn === turn) {
			return;
		}

		// Highlight events from the current turn
		if (this.events && this.highlighting) {
			// Get events for this specific turn
			const turnEvents = this.events.filter(e => e.turn === turn);
			this.highlighting.highlightEventHexes(turnEvents);
		}

		this.turn = turn;

		// Batch update turn state for all layers that support it
		const layersWithTurnState = ['territory', 'city', 'grid', 'boundary'];
		for (const layerName of layersWithTurnState) {
			if (this.layers[layerName]) {
				this.layers[layerName].turnState = this.turnState;
				this.layers[layerName].redraw();
			}
		}
	}

	// Detach from the session and reset turn tracking state
	resetTurnState() {
		// Reset turn to -1 so the first renderTurn will trigger a full redraw
		this.turn = -1;
		this.turnState = undefined;

		// Stop following the previous session
		if (this.unsubscribeSession) {
			this.unsubscribeSession();
			this.unsubscribeSession = null;
		}
		this.session = null;
		this.events = [];

		// Clear all highlighting
		if (this.highlighting) {
			this.highlighting.clearAll();
		}
	}

	// Delegate highlighting methods to the highlighting module

	highlightHexes(hexKeys: string[]) {
		this.highlighting.highlightHexes(hexKeys);
	}

	addHighlightedHexes(hexKeys: string[]) {
		this.highlighting.addHighlightedHexes(hexKeys);
	}

	removeHighlightedHexes(hexKeys: string[]) {
		this.highlighting.removeHighlightedHexes(hexKeys);
	}

	clearHexHighlights() {
		this.highlighting.clearHexHighlights();
	}

	highlightCivBoundaries(civNames: string[]) {
		this.highlighting.highlightCivBoundaries(civNames);
	}

	addHighlightedCivs(civNames: string[]) {
		this.highlighting.addHighlightedCivs(civNames);
	}

	removeHighlightedCivs(civNames: string[]) {
		this.highlighting.removeHighlightedCivs(civNames);
	}

	clearCivHighlights() {
		this.highlighting.clearCivHighlights();
	}

	setHighlightColors(hexColor?: string, boundaryColor?: string, eventColor?: string) {
		this.highlighting.setHighlightColors(hexColor, boundaryColor, eventColor);
	}

	// Refit map to container and bounds
	fitMap() {
		if (this.map && this.mapBounds) {
			// Force a synchronous reflow to ensure container dimensions are calculated
			const container = this.map.getContainer();
			if (container) {
				// Force layout recalculation
				container.offsetHeight;
			}

			// Invalidate the size to ensure Leaflet recalculates container dimensions
			this.map.invalidateSize(false);

			// Fit to bounds with padding
			// Add padding to ensure the map fits well within the container
			// Don't set maxZoom to allow fractional zoom calculation
			this.map.fitBounds(this.mapBounds, {
				padding: [30, 30, 30, 30],
				animate: false
			});
		}
	}

	// Ask Leaflet to re-measure its container, e.g. after a tab change or a
	// window resize, without moving the place the user is exploring
	invalidateSize() {
		if (this.map) {
			this.map.invalidateSize(false);
		}
	}
}
