/**
 * replay-map.ts
 * Manages the Leaflet map display for the replay viewer
 * Handles rendering of terrain, cities, territories, and turn-based state changes
 * Includes highlighting features for hexes and civilization boundaries
 */

import { HexLayer } from './hex-layer';
import { CityLayer } from './city-layer';
import { GridLayer } from './grid-layer';
import { BoundaryLayer } from './boundary-layer';
import { MapHighlighting } from './map-highlighting';
import { CivColors } from '../utils/civ-colors';
import { TurnState, MapLayer, MapControl, HexData } from '../types/map.types';
import { Tile, GameEvent, EventType, TileType, FeatureType, ElevationType } from '../types/replay.types';
import { getTileTypeName, getFeatureName, getElevationName } from '../utils/enum-names';
import { Replay } from '../core/replay';
import { throttle } from '../utils/throttle';

// External libraries accessed as globals - types defined in globals.d.ts

/**
 * ReplayMap class
 * Creates and initializes the Leaflet map instance
 */
export class ReplayMap {
	map: any;                             // Leaflet Map instance
	turn: number;                         // Current turn being displayed
	turnStates: TurnState[];              // Array of tile states for each turn
	turnState: TurnState;                 // Current turn's tile state
	layers: Record<string, MapLayer>;    // Map visualization layers by name
	controls: Record<string, MapControl>; // Map UI controls by name
	replay: Replay | null;               // Reference to replay instance for civ name lookups
	mapBounds: number[][];               // Stored bounds for refitting the map
	renderTurnThrottled: (turn: number) => void; // Throttled version of renderTurn
	highlighting: MapHighlighting;       // Highlighting module instance
	events: GameEvent[];                 // Reference to all events for turn-based highlighting

	constructor(replay?: Replay) {
		this.replay = replay || null;
		this.map = L.map(document.querySelector('.map'), {
			attributionControl: false,
			keyboardPanOffset: 0,
			fadeAnimation: false,  // Disable fade animation to prevent transparency transitions during redraw
			zoomSnap: 0.2          // Allow fractional zoom levels with 0.25 increments
		}).setView([0, 0], 0);

		this.turn = -1; // Initialize to -1 so first renderTurn always triggers a redraw
		this.events = []; // Will be populated when initLayers is called

		// Initialize highlighting module
		this.highlighting = new MapHighlighting(this);

		// Create throttled version of renderTurn to prevent excessive rendering
		// when dragging through many turns quickly (e.g., slider dragging)
		// 100ms throttle provides smooth visual feedback while limiting render calls
		this.renderTurnThrottled = throttle(this.renderTurn.bind(this), 100);
	}

	// Initialize map layers and process turn states from events
	initLayers(tiles: Tile[][], events: GameEvent[], replay?: Replay) {
		// Store replay reference if provided
		if (replay) {
			this.replay = replay;
		}
		var self = this;

		// Store events for turn-based highlighting
		this.events = events;

		// Track the state of each tile at every turn
		this.turnStates = [];
		var eventsByTurn = _.groupBy(events, 'turn');
		var lastState: TurnState = {};

		// Always start from turn 0, regardless of when first event occurs
		const lastTurn = events[events.length - 1].turn;

		for (var t = 0; t <= lastTurn; t++) {
			// Start by copying last state
			var state: TurnState = _.clone(lastState, true);

			// Get events for this turn
			var turnEvents = eventsByTurn[t] || [];

			for (var e = 0; e < turnEvents.length; e++) {
				var event = turnEvents[e];

				switch (event.type) {
					case EventType.CityFounded:
						var index = [event.x, event.y].join(',');
						var civName = self.replay ? self.replay.getCivName(event.civId) : null;
						state[index] = { owner: civName || undefined, city: event.city.name };
						break;

					case EventType.TilesClaimed:
						for (var i = 0; i < event.tiles.length; i++) {
							var tile = event.tiles[i];
							var index = [tile.x, tile.y].join(',');
							state[index] = state[index] || {};

							var civName = self.replay ? self.replay.getCivName(event.civId) : null;
							if (civName) {
								state[index].owner = civName;
							}
							else {
								delete state[index];
							}
						}

						break;

					case EventType.CitiesTransferred:
						for (var i = 0; i < event.tiles.length; i++) {
							var tile = event.tiles[i];
							var index = [tile.x, tile.y].join(',');
							state[index] = state[index] || {};
							var civName = self.replay ? self.replay.getCivName(event.civId) : null;
							if (civName) {
								state[index].owner = civName;
							}
						}

						break;

					case EventType.CityRazed:
						var index = [event.x, event.y].join(',');

						if (state[index]) {
							delete state[index].city;
						}

						break;

					default: break;
				}
			}

			this.turnStates.push(state);

			lastState = state;
		}

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

		// Connect grid layer to highlighting for boundary functionality
		this.highlighting.setGridLayer(this.layers.grid);

		// Get highlighting layers for overlay controls
		const highlightLayers = this.highlighting.getLayers();

		// Add layer switcher
		var overlays = {
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

		this.controls = {
			switcher: L.control.layers({}, overlays, {
				autoZIndex: false
			})
		};

		this.controls.switcher.addTo(this.map);

		this.renderTurn(events[0].turn);

		var north = 85;
		var west = -180;
		var south = north - (tiles.length * 0.3888888889);
		var east = west + (tiles[0].length * 2.4285714286);

		function onMapClick(e: any) {
			console.log(e.latlng);
		}

		this.map.on('click', onMapClick);

		// Remove the zoomend redraw - the city layer will handle its own rendering
		// through the standard tile update mechanism

		var bounds = [[south, west], [north, east]];
		// Store bounds for later use when map needs to be refit
		this.mapBounds = bounds;

		// Don't fit bounds here - let it be done after the replay loads
		// to ensure the container is properly sized
	}


	// Update map display for specified turn
	renderTurn(turn: number) {
		// Turn is now directly the array index (0-based)
		const turnIndex = turn;
		this.turnState = this.turnStates[turnIndex];

		// Also update turn state for highlighting module (which will update grid layer's boundary highlighting)
		this.highlighting.updateTurnState(this.turnState);

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

		console.log(`Rendering turn ${turn}, previous turn was ${this.turn}`);
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

	// Reset turn tracking state
	resetTurnState() {
		// Reset turn to -1 so the first renderTurn will trigger a full redraw
		this.turn = -1;
		// Note: We can't cancel pending throttled calls, but resetting turn to -1
		// ensures the next renderTurn will perform a full redraw regardless

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
}
