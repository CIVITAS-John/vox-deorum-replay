/**
 * Leaflet entry point for the replay map.
 * Navigation stays in Leaflet while one viewport canvas composites every
 * visible map concern through ViewportLayer.
 */

import { GameEvent, TurnState } from '../replay/types';
import { GameSession } from '../replay/session';
import { hexCenter, hexRadius, hexWidth } from './hex-geometry';
import { RendererLayer, ViewportLayer } from './viewport-layer';

declare const L: any;

/**
 * Own the Leaflet camera and connect the session to the one-canvas renderer.
 */
export class ReplayMap {
	public map: any;
	public turn = -1;
	public turnState: TurnState | undefined;
	public layers: Record<string, RendererLayer> = {};
	public session: GameSession | null = null;
	public mapBounds: number[][] = [];
	public events: GameEvent[] = [];
	private renderer: ViewportLayer | null = null;
	private unsubscribeSession: (() => void) | null = null;
	private highlightedCivs = new Set<string>();

	/** Create the Leaflet camera in flat map coordinates. */
	constructor() {
		this.map = L.map(document.querySelector('.map'), {
			attributionControl: false,
			zoomControl: false,
			keyboardPanOffset: 0,
			fadeAnimation: false,
			zoomSnap: 0.1,
			zoomDelta: 0.5,
			wheelPxPerZoomLevel: 120,
			crs: L.CRS.Simple
		}).setView([0, 0], 0);
	}

	/**
	 * Create a fresh one-canvas renderer and follow the supplied session.
	 */
	initLayers(session: GameSession): void {
		this.removeRenderer();
		this.session = session;
		this.events = session.replay.events;
		const tiles = session.replay.tiles;
		const hasRivers = session.replay.dataKinds.rivers === 'history';
		this.renderer = new ViewportLayer(tiles, this.events, Boolean(session.replay.mapHeader?.wrapX), hasRivers);
		this.layers = this.renderer.layers;
		this.renderer.addTo(this.map);
		this.updateBounds(tiles);
		this.unsubscribeSession = session.subscribe((turn, state) => this.renderTurn(turn, state));
	}

	/**
	 * Return renderer flags for the layers picker without manufacturing Leaflet layers.
	 */
	getToggleableLayers(): Record<string, RendererLayer> {
		return this.layers;
	}

	/**
	 * Forward the already materialized session state to the current renderer.
	 */
	renderTurn(turn: number, state?: TurnState): void {
		if (!this.session || !this.renderer) return;
		this.turn = turn;
		this.turnState = state || this.session.stateAt(turn);
		this.renderer.setTurn(turn, this.turnState);
	}

	/**
	 * Detach the session and clear transient selection and event highlighting.
	 */
	resetTurnState(): void {
		this.turn = -1;
		this.turnState = undefined;
		if (this.unsubscribeSession) this.unsubscribeSession();
		this.unsubscribeSession = null;
		this.session = null;
		this.events = [];
		this.highlightedCivs.clear();
		this.renderer?.clearHighlights();
	}

	/**
	 * Remove the current canvas layer and release its cached geography.
	 */
	removeRenderer(): void {
		if (this.unsubscribeSession) this.unsubscribeSession();
		this.unsubscribeSession = null;
		if (this.renderer) this.map.removeLayer(this.renderer);
		this.renderer = null;
		this.layers = {};
	}

	/**
	 * Select the first supplied hex for compatibility with existing callers.
	 */
	highlightHexes(hexKeys: string[]): void {
		this.renderer?.setSelectedHex(hexKeys[0] || null);
	}

	/**
	 * Preserve legacy additive highlighting semantics for a single selection.
	 */
	addHighlightedHexes(hexKeys: string[]): void {
		if (!this.renderer?.getSelectedHex()) this.renderer?.setSelectedHex(hexKeys[0] || null);
	}

	/**
	 * Clear selection when a caller removes the selected tile.
	 */
	removeHighlightedHexes(hexKeys: string[]): void {
		if (hexKeys.includes(this.renderer?.getSelectedHex() || '')) this.renderer?.setSelectedHex(null);
	}

	/**
	 * Clear the selected plot overlay.
	 */
	clearHexHighlights(): void {
		this.renderer?.setSelectedHex(null);
	}

	/**
	 * Replace the civilization border highlight set.
	 */
	highlightCivBoundaries(civNames: string[]): void {
		this.highlightedCivs = new Set(civNames);
		this.renderer?.setHighlightedCivs(Array.from(this.highlightedCivs));
	}

	/**
	 * Keep the existing public additive method available to callers.
	 */
	addHighlightedCivs(civNames: string[]): void {
		for (const civName of civNames) this.highlightedCivs.add(civName);
		this.renderer?.setHighlightedCivs(Array.from(this.highlightedCivs));
	}

	/**
	 * Clear civilization highlights through the one-canvas renderer.
	 */
	removeHighlightedCivs(civNames: string[]): void {
		for (const civName of civNames) this.highlightedCivs.delete(civName);
		this.renderer?.setHighlightedCivs(Array.from(this.highlightedCivs));
	}

	/**
	 * Clear every civilization border highlight.
	 */
	clearCivHighlights(): void {
		this.highlightedCivs.clear();
		this.renderer?.setHighlightedCivs([]);
	}

	/**
	 * Retain the old public method while renderer colors stay fixed.
	 */
	setHighlightColors(_hexColor?: string, _boundaryColor?: string, _eventColor?: string): void {
		// Renderer colors remain fixed so rivers, borders, and events stay distinct.
	}

	/**
	 * Fit the flat shared-coordinate map bounds into the current container.
	 */
	fitMap(): void {
		if (!this.map || !this.mapBounds.length) return;
		const container = this.map.getContainer();
		if (container) container.offsetHeight;
		this.map.invalidateSize(false);
		this.map.fitBounds(this.mapBounds, { padding: [30, 30], animate: false });
	}

	/**
	 * Ask Leaflet to remeasure without changing camera position.
	 */
	invalidateSize(): void {
		if (this.map) this.map.invalidateSize(false);
	}

	/**
	 * Build bounds with the same flat hex centers used by rendering and picking.
	 */
	private updateBounds(tiles: any[][]): void {
		const height = Math.max(1, tiles.length);
		const width = Math.max(1, tiles[0]?.length || 1);
		let maxX = 0;
		let maxY = 0;
		for (let y = 0; y < height; y++) {
			const center = hexCenter({ x: width - 1, y });
			maxX = Math.max(maxX, center.x);
			maxY = Math.max(maxY, center.y);
		}
		this.mapBounds = [
			[-hexRadius, -hexWidth / 2],
			[maxY + hexRadius, maxX + hexWidth / 2]
		];
	}
}
