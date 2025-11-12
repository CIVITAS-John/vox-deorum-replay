/**
 * map.ts
 * Manages the Leaflet map display for the replay viewer
 * Handles rendering of terrain, cities, territories, and turn-based state changes
 */

import { HexLayer } from './hex-layer';
import { CivColors } from '../config/civ-colors';
import { TurnState, MapLayer, MapControl, HexData } from '../types/map.types';
import { Tile, GameEvent, EventType, TileType, FeatureType, ElevationType } from '../types/replay.types';
import { getTileTypeName, getFeatureName, getElevationName } from '../utils/enum-names';
import { Replay } from '../core/replay';

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
	mapBounds: any;                       // Stored bounds for refitting the map

	constructor(replay?: Replay) {
		this.replay = replay || null;
		this.map = L.map(document.querySelector('.map'), {
			attributionControl: false,
			keyboardPanOffset: 0,
			zoomSnap: 0.2          // Allow fractional zoom levels with 0.25 increments
		}).setView([0, 0], 0);

		this.turn = 0;
	}

	// Initialize map layers and process turn states from events
	initLayers(tiles: Tile[][], events: GameEvent[], replay?: Replay) {
		// Store replay reference if provided
		if (replay) {
			this.replay = replay;
		}
		var self = this;

		// Track the state of each tile at every turn
		this.turnStates = [];
		var eventsByTurn = _.groupBy(events, 'turn');
		var lastState: TurnState = {} as TurnState;

		for (var t = events[0].turn; t <= events[events.length - 1].turn; t++) {
			// Start by copying last state
			var state = _.clone(lastState, true);

			var turnEvents = eventsByTurn[t] || [];

			for (var e = 0; e < turnEvents.length; e++) {
				var event = turnEvents[e];

				switch (event.type) {
					case EventType.CityFounded:
						var index = [event.x, event.y].join(',');
						var civName = self.replay ? self.replay.getCivName(event.civId) : null;
						state[index] = { owner: civName, city: event.city.name };
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
							state[index].owner = civName;
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
				cacheKeySuffix: function () {
					return '-territory-' + self.turn;
				},
				drawHex: function (ctx: CanvasRenderingContext2D, hex: HexData, cx: number, cy: number, x1: number, y1: number, x2: number, y2: number) {
					if (!this.turnState) { return; }
					var state = this.turnState[hex.x + ',' + hex.y];
					if (!state) { return; }
					var land = hex.type !== TileType.Coast && hex.type !== TileType.Ocean;
					if (state.owner) {
						var civColors = CivColors[state.owner];
						var color = civColors ? civColors.territory : [0, 0, 0];
						ctx.fillStyle = `rgba(${color.join(',')}, ${(land ? 0.7 : 0.2)})`;
						ctx.fill();
					}
				}
			}),

			city: new HexLayer({
				hexes: tiles,
				zIndex: 40,
				cacheKeySuffix: function () {
					return '-city-' + self.turn;
				},
				drawHex: function (ctx: CanvasRenderingContext2D, hex: HexData, cx: number, cy: number, x1: number, y1: number, x2: number, y2: number) {
					if (!this.turnState) { return; }
					var state = this.turnState[hex.x + ',' + hex.y];
					if (!state) { return; }

					if (state.city) {
						var civColors = CivColors[state.owner];
						var color = civColors ? civColors.city : [255, 255, 255];
						ctx.fillStyle = `rgba(${color.join(',')}, 0.9)`;
						ctx.fill();
					}
				}
			}),

			grid: new HexLayer({
				zIndex: 50,
				width: tiles[0].length,
				height: tiles.length,
				gridStyle: 'rgba(255, 255, 255, 0.1)',
				drawHex: function (ctx: CanvasRenderingContext2D, hex: HexData, cx: number, cy: number) { }
			})
		};

		_.each(this.layers, (layer: MapLayer) => layer.addTo(this.map));

		// Add layer switcher
		var overlays = {
			Terrain: this.layers.terrain,
			Elevation: this.layers.elevation,
			Features: this.layers.feature,
			Territory: this.layers.territory,
			Cities: this.layers.city,
			Grid: this.layers.grid
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

		var bounds = [[south, west], [north, east]];
		// Store bounds for later use when map needs to be refit
		this.mapBounds = bounds;

		// Don't fit bounds here - let it be done after the replay loads
		// to ensure the container is properly sized
	}

	// Get hexes that have changed between two turns
	getChangedHexes(fromTurn: number, toTurn: number): string[] {
		const changedHexes: string[] = [];
		const fromState = this.turnStates[fromTurn] || {};
		const toState = this.turnStates[toTurn] || {};

		// Check for changes in toState
		for (const hexKey in toState) {
			const fromHex = fromState[hexKey];
			const toHex = toState[hexKey];

			// Check if hex is new or has changed
			if (!fromHex ||
				fromHex.owner !== toHex.owner ||
				fromHex.city !== toHex.city) {
				changedHexes.push(hexKey);
			}
		}

		// Check for removed hexes
		for (const hexKey in fromState) {
			if (!toState[hexKey]) {
				changedHexes.push(hexKey);
			}
		}

		return changedHexes;
	}

	// Update map display for specified turn
	renderTurn(turn: number) {
		const previousTurn = this.turn;
		this.turn = turn;
		this.turnState = this.turnStates[turn];

		this.layers.city.turnState = this.turnState;
		this.layers.territory.turnState = this.turnState;

		// Only redraw changed hexes if we have a valid previous turn
		if (previousTurn >= 0 && previousTurn < this.turnStates.length) {
			const changedHexes = this.getChangedHexes(previousTurn, turn);

			if (changedHexes.length > 0) {
				// Use selective redraw for changed hexes only
				if (this.layers.city._map) {
					this.layers.city.redrawHexes(changedHexes);
				}
				if (this.layers.territory._map) {
					this.layers.territory.redrawHexes(changedHexes);
				}
			}
		} else {
			// Full redraw for initial load or invalid turns
			if (this.layers.city._map) { this.layers.city.redraw(); }
			if (this.layers.territory._map) { this.layers.territory.redraw(); }
		}
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
