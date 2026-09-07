/**
 * One Leaflet-managed viewport canvas for the complete replay map.
 * Static geography is grouped into bounded chunks while turn-dependent
 * ownership, cities, borders, selection, and events are drawn in one pass.
 */

import { CivColors } from '../utils/civ-colors';
import { ElevationType, FeatureType, GameEvent, Tile, TurnState, TileType } from '../replay/types';
import { FrameCoalescer, GeographyChunk, GeographyChunkCache, ownershipChanges } from './renderer-support';
import {
	buildRiverEdges,
	directions,
	edgeCorners,
	hexCenter,
	hexCorners,
	hexRadius,
	hexWidth,
	MapGeometryOptions,
	MapLod,
	neighborFor,
	nextMapLod,
	pickHex,
	RiverEdge,
	sharedEdgeKey,
	tileKey,
	WorldPoint
} from './hex-geometry';

declare const L: any;

export type RendererLayerName = 'terrain' | 'relief' | 'features' | 'rivers' | 'territory' | 'borders' | 'cities' | 'grid' | 'selection' | 'events';

export interface RendererLayer {
	label: string;
	visible: boolean;
	disabled?: boolean;
	disabledReason?: string;
	setVisible(visible: boolean): void;
}

interface BorderSegment {
	points: [WorldPoint, WorldPoint];
	owner: string;
	tile: Tile;
	river: boolean;
}

interface CityMarker {
	tile: Tile;
	name: string;
	owner?: string;
}

const geographyChunkSize = 12;
const geographyBuildBudgetMs = 4;
const terrainColors: Record<number, string> = {
	[TileType.Grassland]: '#6f9c58',
	[TileType.Plains]: '#b8a65b',
	[TileType.Desert]: '#d6bd75',
	[TileType.Tundra]: '#91a283',
	[TileType.Snow]: '#e6edf0',
	[TileType.Coast]: '#4f91ab',
	[TileType.Ocean]: '#2d6684'
};
const terrainImages: Record<number, string> = {
	[TileType.Grassland]: 'GRASSLAND',
	[TileType.Plains]: 'PLAINS',
	[TileType.Desert]: 'DESERT',
	[TileType.Tundra]: 'TUNDRA',
	[TileType.Snow]: 'SNOW',
	[TileType.Coast]: 'COAST',
	[TileType.Ocean]: 'OCEAN'
};
const reliefImages: Record<number, string> = {
	[ElevationType.Mountain]: 'MOUNTAIN',
	[ElevationType.Hills]: 'HILLS'
};
const featureImages: Record<number, string> = {
	[FeatureType.Ice]: 'ICE',
	[FeatureType.Jungle]: 'JUNGLE',
	[FeatureType.Forest]: 'FOREST'
};

/**
 * Provide a Layer-control compatible rendering flag without creating a
 * second Leaflet canvas layer.
 */
class RendererFlag implements RendererLayer {
	public visible: boolean;

	/** Initialize a visibility flag and its redraw callback. */
	constructor(
		public readonly label: string,
		visible: boolean,
		private readonly onChange: () => void,
		public readonly disabled = false,
		public readonly disabledReason?: string
	) {
		this.visible = visible;
	}

	/**
	 * Change a rendering flag and request the one shared canvas frame.
	 */
	setVisible(visible: boolean): void {
		if (this.disabled || this.visible === visible) return;
		this.visible = visible;
		this.onChange();
	}
}

/**
 * Render the map through one viewport-sized canvas while Leaflet continues to
 * own camera movement, touch input, controls, and container sizing.
 */
export class ViewportLayer extends L.Layer {
	public readonly layers: Record<RendererLayerName, RendererLayer>;
	private map: any = null;
	private canvas: HTMLCanvasElement | null = null;
	private context: CanvasRenderingContext2D | null = null;
	private readonly frames = new FrameCoalescer();
	private lod: MapLod | null = null;
	private turnState: TurnState = {};
	private previousState: TurnState = {};
	private readonly geometry: MapGeometryOptions;
	private readonly rivers: RiverEdge[];
	private readonly riverKeys = new Set<string>();
	private readonly eventsByTurn = new Map<number, GameEvent[]>();
	private readonly staticCache = new GeographyChunkCache();
	private readonly borderCache = new Map<string, BorderSegment[]>();
	private cityMarkers: CityMarker[] = [];
	private eventHexes = new Set<string>();
	private selectedHex: string | null = null;
	private highlightedCivs = new Set<string>();
	private readonly assetLoadHandlers: Array<{ image: HTMLImageElement; handler: () => void }> = [];
	private pendingGeography = false;
	private zoomAnimating = false;
	private paintedView: { center: any; zoom: number; width: number; height: number } | null = null;
	/** Request a redraw when Leaflet changes the camera. */
	private readonly onCameraChange = () => this.scheduleRender();
	/** Animate the existing bitmap with Leaflet before drawing the settled view. */
	private readonly onZoomAnimation = (event: any) => {
		if (!this.canvas || !this.paintedView) return;
		this.zoomAnimating = true;
		this.frames.cancelPending();
		const view = this.paintedView;
		const scale = this.map.getZoomScale(event.zoom, view.zoom);
		const oldCenter = this.map.project(view.center, event.zoom);
		const newCenter = this.map.project(event.center, event.zoom);
		const size = this.map.getSize();
		const x = size.x / 2 - view.width / 2 * scale + oldCenter.x - newCenter.x;
		const y = size.y / 2 - view.height / 2 * scale + oldCenter.y - newCenter.y;
		this.canvas.style.transition = 'transform 250ms cubic-bezier(0, 0, 0.25, 1)';
		this.canvas.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
	};
	/** Replace the scaled bitmap with a crisp rendering at the final camera position. */
	private readonly onZoomEnd = () => {
		if (!this.canvas || !this.zoomAnimating) return;
		this.zoomAnimating = false;
		this.canvas.style.transition = 'none';
		this.canvas.style.transform = '';
		this.render();
	};

	/** Prepare static map topology, events, and layer visibility. */
	constructor(private readonly tiles: Tile[][], events: GameEvent[], wrapX: boolean, hasRivers: boolean) {
		super();
		this.geometry = { width: tiles[0]?.length || 0, height: tiles.length, wrapX };
		this.rivers = hasRivers ? buildRiverEdges(tiles as unknown as Array<Array<{ rivers?: number[] }>>, this.geometry) : [];
		for (const river of this.rivers) this.riverKeys.add(river.key);
		for (const event of events) {
			const turnEvents = this.eventsByTurn.get(event.turn) || [];
			turnEvents.push(event);
			this.eventsByTurn.set(event.turn, turnEvents);
		}
		this.layers = {
			terrain: new RendererFlag('Terrain', true, () => this.scheduleRender()),
			relief: new RendererFlag('Relief', true, () => this.scheduleRender()),
			features: new RendererFlag('Features', true, () => this.scheduleRender()),
			rivers: new RendererFlag('Rivers', hasRivers, () => this.scheduleRender(), !hasRivers, hasRivers ? undefined : 'Rivers are available from save files.'),
			territory: new RendererFlag('Territory', true, () => this.scheduleRender()),
			borders: new RendererFlag('Borders', true, () => this.scheduleRender()),
			cities: new RendererFlag('Cities', true, () => this.scheduleRender()),
			grid: new RendererFlag('Grid', false, () => this.scheduleRender()),
			selection: new RendererFlag('Selection', true, () => this.scheduleRender()),
			events: new RendererFlag('Events', true, () => this.scheduleRender())
		};
	}

	/**
	 * Create and attach the only map canvas once Leaflet owns the layer.
	 */
	onAdd(map: any): void {
		this.map = map;
		this.canvas = document.createElement('canvas');
		this.canvas.className = 'replay-map-canvas leaflet-zoom-animated';
		this.canvas.style.transformOrigin = '0 0';
		this.canvas.style.position = 'absolute';
		this.canvas.style.inset = '0';
		this.canvas.style.width = '100%';
		this.canvas.style.height = '100%';
		this.canvas.style.pointerEvents = 'none';
		this.canvas.style.zIndex = '400';
		this.context = this.canvas.getContext('2d');
		map.getContainer().appendChild(this.canvas);
		map.on('move zoom resize viewreset', this.onCameraChange);
		map.on('zoomanim', this.onZoomAnimation);
		map.on('zoomend', this.onZoomEnd);
		this.bindAssetRefresh();
		this.scheduleRender();
	}

	/**
	 * Release canvas references, cached chunks, and scheduled work on reload.
	 */
	onRemove(map: any): void {
		map.off('move zoom resize viewreset', this.onCameraChange);
		map.off('zoomanim', this.onZoomAnimation);
		map.off('zoomend', this.onZoomEnd);
		this.zoomAnimating = false;
		this.paintedView = null;
		this.frames.cancelPending();
		this.staticCache.clear();
		this.borderCache.clear();
		for (const { image, handler } of this.assetLoadHandlers) image.removeEventListener('load', handler);
		this.assetLoadHandlers.length = 0;
		this.canvas?.remove();
		this.canvas = null;
		this.context = null;
		this.map = null;
	}

	/**
	 * Update dynamic state from the session callback, retaining static geography.
	 */
	setTurn(turn: number, state: TurnState): void {
		this.previousState = this.turnState;
		this.turnState = state;
		this.updateBorders();
		this.updateCities();
		this.eventHexes = this.eventKeysFor(this.eventsByTurn.get(turn) || []);
		this.scheduleRender();
	}

	/**
	 * Highlight one tile through the shared selection overlay.
	 */
	setSelectedHex(hexKey: string | null): void {
		if (this.selectedHex === hexKey) return;
		this.selectedHex = hexKey;
		this.scheduleRender();
	}

	/**
	 * Return the selected tile key for existing replay-map callers.
	 */
	getSelectedHex(): string | null {
		return this.selectedHex;
	}

	/**
	 * Change highlighted political borders without creating another layer.
	 */
	setHighlightedCivs(civNames: string[]): void {
		this.highlightedCivs = new Set(civNames);
		this.scheduleRender();
	}

	/**
	 * Clear all session-dependent map highlights.
	 */
	clearHighlights(): void {
		this.selectedHex = null;
		this.highlightedCivs.clear();
		this.eventHexes.clear();
		this.scheduleRender();
	}

	/**
	 * Convert a Leaflet lat-lng to the map's shared flat coordinate system.
	 */
	worldFromLatLng(latLng: any): WorldPoint {
		return { x: latLng.lng, y: latLng.lat };
	}

	/**
	 * Convert a shared flat point to a Leaflet lat-lng.
	 */
	latLngFromWorld(point: WorldPoint): any {
		return L.latLng(point.y, point.x);
	}

	/**
	 * Find the map plot under a Leaflet lat-lng for future inspection controls.
	 */
	pickLatLng(latLng: any): { x: number; y: number } | null {
		return pickHex(this.worldFromLatLng(latLng), this.geometry);
	}

	/**
	 * Request one animation frame. Multiple camera and timeline updates collapse
	 * into the latest state instead of queuing obsolete scrub renders.
	 */
	private scheduleRender(): void {
		if (!this.map || this.zoomAnimating) return;
		this.frames.schedule(() => this.render());
	}

	/**
	 * Size the backing store, select a stable LOD, and draw geography then overlays.
	 */
	private render(): void {
		if (!this.map || !this.canvas || !this.context || this.zoomAnimating) return;
		const container = this.map.getContainer();
		const width = Math.max(1, container.clientWidth);
		const height = Math.max(1, container.clientHeight);
		this.paintedView = { center: this.map.getCenter(), zoom: this.map.getZoom(), width, height };
		const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
		const backingWidth = Math.round(width * pixelRatio);
		const backingHeight = Math.round(height * pixelRatio);
		if (this.canvas.width !== backingWidth || this.canvas.height !== backingHeight) {
			this.canvas.width = backingWidth;
			this.canvas.height = backingHeight;
		}
		this.context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
		this.context.clearRect(0, 0, width, height);
		const center = hexCenter({ x: 0, y: 0 });
		const left = this.screenPoint({ x: center.x - hexWidth / 2, y: center.y });
		const right = this.screenPoint({ x: center.x + hexWidth / 2, y: center.y });
		this.lod = nextMapLod(Math.abs(right.x - left.x), this.lod);
		const visibleChunks = this.visibleChunks();
		const visibleTiles = visibleChunks.reduce((all, chunk) => all.concat(chunk.tiles), [] as Tile[]);
		this.drawGeography(visibleChunks);
		this.drawTerritory(visibleTiles);
		this.drawRivers();
		this.drawBorders();
		this.drawCities();
		this.drawGrid(visibleTiles);
		this.drawHighlights();
		if (this.pendingGeography) this.scheduleRender();
	}

	/**
	 * Return raster chunks intersecting the camera bounds at a quantized scale.
	 */
	private visibleChunks(): GeographyChunk[] {
		if (!this.map) return [];
		this.pendingGeography = false;
		const deadline = performance.now() + geographyBuildBudgetMs;
		const size = this.map.getSize();
		const upperLeft = this.worldFromLatLng(this.map.containerPointToLatLng([0, 0]));
		const lowerRight = this.worldFromLatLng(this.map.containerPointToLatLng([size.x, size.y]));
		const minX = Math.min(upperLeft.x, lowerRight.x) - hexWidth;
		const maxX = Math.max(upperLeft.x, lowerRight.x) + hexWidth;
		const minY = Math.min(upperLeft.y, lowerRight.y) - hexWidth;
		const maxY = Math.max(upperLeft.y, lowerRight.y) + hexWidth;
		const minRow = Math.max(0, Math.floor(minY / 1.5) - 1);
		const maxRow = Math.min(this.tiles.length - 1, Math.ceil(maxY / 1.5) + 1);
		const staticVisibility = `${this.layers.terrain.visible}:${this.layers.relief.visible}:${this.layers.features.visible}`;
		const scale = this.quantizedScale();
		const result: GeographyChunk[] = [];
		const minColumn = Math.max(0, Math.floor(minX / hexWidth) - 1);
		const maxColumn = Math.min(this.geometry.width - 1, Math.ceil(maxX / hexWidth) + 1);
		const minChunkY = Math.floor(minRow / geographyChunkSize);
		const maxChunkY = Math.floor(maxRow / geographyChunkSize);
		const minChunkX = Math.floor(minColumn / geographyChunkSize);
		const maxChunkX = Math.floor(maxColumn / geographyChunkSize);
		for (let chunkY = minChunkY; chunkY <= maxChunkY; chunkY++) {
			for (let chunkX = minChunkX; chunkX <= maxChunkX; chunkX++) {
				let chunk = this.staticCache.find(chunkX, chunkY, this.lod || 'world', scale, staticVisibility);
				if (!chunk && performance.now() < deadline) {
					chunk = this.staticCache.store(chunkX, chunkY, this.lod || 'world', scale, staticVisibility, () => this.createGeographyChunk(chunkX, chunkY, scale));
				}
				if (!chunk) {
					chunk = this.staticCache.findFallback(chunkX, chunkY, staticVisibility);
					this.pendingGeography = true;
				}
				if (!chunk) continue;
				result.push(chunk);
			}
		}
		return result;
	}

	/**
	 * Blit cached static geography chunks at the current camera scale.
	 */
	private drawGeography(chunks: GeographyChunk[]): void {
		if (!this.context) return;
		const currentScale = this.worldScale();
		for (const chunk of chunks) {
			const origin = this.screenPoint({ x: chunk.minX, y: chunk.maxY });
			const factor = currentScale / chunk.scale;
			this.context.drawImage(chunk.canvas, origin.x, origin.y, chunk.canvas.width * factor, chunk.canvas.height * factor);
		}
	}

	/**
	 * Rasterize immutable terrain, relief, and features into a bounded chunk.
	 */
	private createGeographyChunk(chunkX: number, chunkY: number, scale: number): GeographyChunk {
		const tiles: Tile[] = [];
		const startY = chunkY * geographyChunkSize;
		const startX = chunkX * geographyChunkSize;
		for (let y = startY; y < Math.min(startY + geographyChunkSize, this.tiles.length); y++) {
			for (let x = startX; x < Math.min(startX + geographyChunkSize, this.tiles[y].length); x++) tiles.push(this.tiles[y][x]);
		}
		const points = tiles.reduce((all, tile) => all.concat(hexCorners(tile)), [] as WorldPoint[]);
		const minX = Math.min(...points.map(point => point.x));
		const maxX = Math.max(...points.map(point => point.x));
		const minY = Math.min(...points.map(point => point.y));
		const maxY = Math.max(...points.map(point => point.y));
		const padding = 2;
		const canvas = document.createElement('canvas');
		canvas.width = Math.max(1, Math.ceil((maxX - minX) * scale) + padding * 2);
		canvas.height = Math.max(1, Math.ceil((maxY - minY) * scale) + padding * 2);
		const context = canvas.getContext('2d')!;
		context.imageSmoothingEnabled = true;
		context.imageSmoothingQuality = 'high';
		for (const tile of tiles) this.drawStaticTile(context, tile, minX, maxY, scale, padding);
		return { key: '', tiles, canvas, minX: minX - padding / scale, maxY: maxY + padding / scale, scale, bytes: canvas.width * canvas.height * 4, lastUsed: 0 };
	}

	/**
	 * Draw one tile's immutable geography into a chunk-local coordinate system.
	 */
	private drawStaticTile(context: CanvasRenderingContext2D, tile: Tile, minX: number, maxY: number, scale: number, padding: number): void {
		if (this.layers.terrain.visible) {
			this.drawStaticHex(context, tile, minX, maxY, scale, padding, () => {
				context.fillStyle = terrainColors[tile.type] || '#777';
				context.fill();
				context.strokeStyle = terrainColors[tile.type] || '#777';
				context.lineWidth = 1;
				context.stroke();
			});
			if (this.lod !== 'world') this.drawStaticTexture(context, terrainImages[tile.type], tile, minX, maxY, scale, padding);
		}
		if (this.lod !== 'world' && this.layers.relief.visible) this.drawStaticTexture(context, reliefImages[tile.elevation], tile, minX, maxY, scale, padding);
		if (this.lod !== 'world' && this.layers.features.visible) this.drawStaticFeature(context, tile, minX, maxY, scale, padding);
	}

	/**
	 * Draw a chunk-local hex path and clip its supplied content.
	 */
	private drawStaticHex(context: CanvasRenderingContext2D, tile: Tile, minX: number, maxY: number, scale: number, padding: number, draw: () => void): void {
		const corners = hexCorners(tile).map(point => ({ x: (point.x - minX) * scale + padding, y: (maxY - point.y) * scale + padding }));
		context.save();
		context.beginPath();
		context.moveTo(corners[0].x, corners[0].y);
		for (let index = 1; index < corners.length; index++) context.lineTo(corners[index].x, corners[index].y);
		context.closePath();
		context.clip();
		draw();
		context.restore();
	}

	/**
	 * Draw an existing source image inside a clipped local hex.
	 */
	private drawStaticTexture(context: CanvasRenderingContext2D, imageId: string | undefined, tile: Tile, minX: number, maxY: number, scale: number, padding: number): void {
		if (!imageId) return;
		const image = document.getElementById(imageId) as HTMLImageElement | null;
		if (!image || !image.complete || !image.naturalWidth) return;
		this.drawStaticHex(context, tile, minX, maxY, scale, padding, () => {
			const center = hexCenter(tile);
			const width = hexWidth * scale;
			context.drawImage(image, (center.x - hexWidth / 2 - minX) * scale + padding, (maxY - center.y - hexRadius) * scale + padding, width, width * 2 / Math.sqrt(3));
		});
	}

	/**
	 * Draw static feature art or the simple approved placeholder marks.
	 */
	private drawStaticFeature(context: CanvasRenderingContext2D, tile: Tile, minX: number, maxY: number, scale: number, padding: number): void {
		const imageId = featureImages[tile.feature];
		if (imageId) {
			this.drawStaticTexture(context, imageId, tile, minX, maxY, scale, padding);
			return;
		}
		if (tile.feature === FeatureType.NoFeature) return;
		const center = hexCenter(tile);
		const x = (center.x - minX) * scale + padding;
		const y = (maxY - center.y) * scale + padding;
		if (tile.feature === FeatureType.Marsh || tile.feature === FeatureType.FloodPlains) {
			context.fillStyle = 'rgba(66, 104, 76, 0.35)';
			context.beginPath();
			context.ellipse(x, y, hexWidth * scale * 0.28, hexWidth * scale * 0.16, 0, 0, Math.PI * 2);
			context.fill();
		} else if (tile.feature === FeatureType.Oasis) {
			context.fillStyle = 'rgba(37, 130, 154, 0.75)';
			context.beginPath();
			context.arc(x, y, Math.max(2, hexWidth * scale * 0.12), 0, Math.PI * 2);
			context.fill();
		} else if (tile.feature === FeatureType.Atoll) {
			context.strokeStyle = 'rgba(226, 239, 221, 0.8)';
			context.lineWidth = Math.max(1, hexWidth * scale * 0.05);
			context.beginPath();
			context.arc(x, y, Math.max(2, hexWidth * scale * 0.18), 0, Math.PI * 2);
			context.stroke();
		} else if (tile.feature === FeatureType.CerroDePotosi || tile.feature === FeatureType.SriPada || tile.feature === FeatureType.MtSinai) {
			context.fillStyle = '#f4df77';
			context.font = `${Math.max(10, hexWidth * scale * 0.34)}px sans-serif`;
			context.textAlign = 'center';
			context.textBaseline = 'middle';
			context.fillText('◆', x, y);
		}
	}

	/**
	 * Fill owned plots with the lower-opacity territory tint proposed for Stage 4.
	 */
	private drawTerritory(tiles: Tile[]): void {
		if (!this.context || !this.layers.territory.visible) return;
		for (const tile of tiles) {
			const state = this.turnState[tileKey(tile)];
			if (!state?.owner) continue;
			const color = CivColors[state.owner]?.territory || [80, 80, 80];
			const water = tile.type === TileType.Coast || tile.type === TileType.Ocean;
			this.drawHex(tile, () => {
				this.context!.fillStyle = `rgba(${color.join(',')}, ${water ? 0.1 : 0.2})`;
				this.context!.fill();
			});
		}
	}

	/**
	 * Draw water after territory so river color remains distinct from borders.
	 */
	private drawRivers(): void {
		if (!this.context || !this.layers.rivers.visible) return;
		const width = this.riverWidth();
		this.context.save();
		this.context.strokeStyle = 'rgba(74, 167, 202, 0.96)';
		this.context.lineWidth = width;
		this.context.lineCap = 'round';
		this.context.lineJoin = 'round';
		for (const river of this.rivers) {
			this.strokeSegment(river.points);
			if (river.seamPoints) this.strokeSegment(river.seamPoints);
		}
		this.context.restore();
	}

	/**
	 * Draw precomputed outward border segments using their owner's territory color.
	 */
	private drawBorders(): void {
		if (!this.context || !this.layers.borders.visible) return;
		this.context.save();
		this.context.lineWidth = this.lod === 'world' ? 1 : 2;
		this.context.lineCap = 'round';
		for (const segments of this.borderCache.values()) {
			for (const segment of segments) {
				const color = this.highlightedCivs.has(segment.owner)
					? [255, 235, 59]
					: CivColors[segment.owner]?.territory || [120, 120, 120];
				this.context.strokeStyle = `rgb(${color.join(',')})`;
				this.strokeSegment(segment.river ? this.offsetRiverBorder(segment) : segment.points);
			}
		}
		this.context.restore();
	}

	/**
	 * Draw city dots and collision-filtered labels at local detail.
	 */
	private drawCities(): void {
		if (!this.context || !this.layers.cities.visible) return;
		const usedLabels: Array<{ left: number; top: number; right: number; bottom: number }> = [];
		const markers = this.cityMarkers.slice().sort((left, right) => Number(this.selectedHex === tileKey(right.tile)) - Number(this.selectedHex === tileKey(left.tile)));
		for (const marker of markers) {
			const center = this.screenPoint(hexCenter(marker.tile));
			const radius = Math.max(2, Math.min(7, this.hexPixelWidth(marker.tile) * 0.12));
			const color = marker.owner ? CivColors[marker.owner]?.city || [210, 210, 210] : [210, 210, 210];
			this.context.beginPath();
			this.context.arc(center.x, center.y, radius + 1, 0, Math.PI * 2);
			this.context.fillStyle = 'rgba(255,255,255,0.9)';
			this.context.fill();
			this.context.beginPath();
			this.context.arc(center.x, center.y, radius, 0, Math.PI * 2);
			this.context.fillStyle = `rgb(${color.join(',')})`;
			this.context.fill();
			if (this.lod === 'local' || (this.selectedHex === tileKey(marker.tile) && this.lod === 'regional')) {
				this.drawCityLabel(marker, center, radius, usedLabels);
			}
		}
	}

	/**
	 * Draw a city name only when it will not collide with an earlier label.
	 */
	private drawCityLabel(marker: CityMarker, center: { x: number; y: number }, radius: number, usedLabels: Array<{ left: number; top: number; right: number; bottom: number }>): void {
		if (!this.context) return;
		const fontSize = Math.max(12, Math.min(18, this.hexPixelWidth(marker.tile) * 0.28));
		this.context.font = `${fontSize}px EB Garamond, serif`;
		this.context.textAlign = 'left';
		this.context.textBaseline = 'middle';
		const width = this.context.measureText(marker.name).width;
		const box = { left: center.x + radius + 4, top: center.y - fontSize / 2, right: center.x + radius + 4 + width, bottom: center.y + fontSize / 2 };
		const selected = this.selectedHex === tileKey(marker.tile);
		if (!selected && usedLabels.some(other => box.left < other.right && box.right > other.left && box.top < other.bottom && box.bottom > other.top)) return;
		usedLabels.push(box);
		this.context.strokeStyle = 'rgba(25, 29, 28, 0.8)';
		this.context.lineWidth = 3;
		this.context.lineJoin = 'round';
		this.context.strokeText(marker.name, box.left, center.y);
		this.context.fillStyle = '#fffdf4';
		this.context.fillText(marker.name, box.left, center.y);
	}

	/**
	 * Draw the optional grid only above world detail.
	 */
	private drawGrid(tiles: Tile[]): void {
		if (!this.context || !this.layers.grid.visible || this.lod === 'world') return;
		this.context.save();
		this.context.strokeStyle = 'rgba(35, 45, 45, 0.18)';
		this.context.lineWidth = 1;
		for (const tile of tiles) this.drawHex(tile, () => this.context!.stroke());
		this.context.restore();
	}

	/**
	 * Draw current-turn events and the selected plot above all map content.
	 */
	private drawHighlights(): void {
		if (!this.context) return;
		if (this.layers.events.visible) {
			this.context.save();
			this.context.strokeStyle = '#ffeb3b';
			this.context.lineWidth = this.lod === 'world' ? 0.8 : 3;
			this.context.setLineDash(this.lod === 'world' ? [1.5, 1.5] : [5, 4]);
			for (const key of this.eventHexes) this.drawKeyHex(key, () => this.context!.stroke());
			this.context.restore();
		}
		if (this.layers.selection.visible && this.selectedHex) {
			this.context.save();
			this.context.strokeStyle = '#ffeb3b';
			this.context.lineWidth = this.lod === 'world' ? 1 : 3;
			this.drawKeyHex(this.selectedHex, () => this.context!.stroke());
			this.context.restore();
		}
	}

	/**
	 * Recompute changed tile borders and their neighbors, preserving unaffected paths.
	 */
	private updateBorders(): void {
		const changed = ownershipChanges(this.previousState, this.turnState);
		if (this.borderCache.size === 0) {
			for (const row of this.tiles) for (const tile of row) this.updateTileBorders(tile);
			return;
		}
		const affected = new Set<string>();
		for (const key of changed) {
			const [x, y] = key.split(',').map(Number);
			if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
			const tile = this.tiles[y]?.[x];
			if (!tile) continue;
			affected.add(tileKey(tile));
			for (const direction of directions) {
				const neighbor = neighborFor(tile, direction, this.geometry);
				if (neighbor && this.tiles[neighbor.y]?.[neighbor.x]) affected.add(tileKey(neighbor));
			}
		}
		for (const key of affected) {
			const [x, y] = key.split(',').map(Number);
			const tile = this.tiles[y]?.[x];
			if (tile) this.updateTileBorders(tile);
		}
	}

	/**
	 * Rebuild one tile's outward segments from current ownership.
	 */
	private updateTileBorders(tile: Tile): void {
		const state = this.turnState[tileKey(tile)];
		if (!state?.owner) {
			this.borderCache.delete(tileKey(tile));
			return;
		}
		const segments: BorderSegment[] = [];
		for (const direction of directions) {
			const neighbor = neighborFor(tile, direction, this.geometry);
			const neighborOwner = neighbor ? this.turnState[tileKey(neighbor)]?.owner : undefined;
			if (neighborOwner !== state.owner) {
				segments.push({ points: edgeCorners(tile, direction), owner: state.owner, tile, river: this.riverKeys.has(sharedEdgeKey(tile, direction, this.geometry)) });
			}
		}
		this.borderCache.set(tileKey(tile), segments);
	}

	/**
	 * Rebuild a compact city marker list once per turn instead of per frame.
	 */
	private updateCities(): void {
		this.cityMarkers = [];
		for (const [key, state] of Object.entries(this.turnState)) {
			if (!state.city) continue;
			const [x, y] = key.split(',').map(Number);
			const tile = this.tiles[y]?.[x];
			if (tile) this.cityMarkers.push({ tile, name: state.city, owner: state.owner });
		}
	}

	/**
	 * Convert current-turn events to their highlighted plot keys once per turn.
	 */
	private eventKeysFor(events: GameEvent[]): Set<string> {
		const keys = new Set<string>();
		for (const event of events) {
			for (const tile of event.tiles || []) keys.add(tileKey(tile));
			if (event.x !== undefined && event.y !== undefined) keys.add(`${event.x},${event.y}`);
		}
		return keys;
	}

	/**
	 * Build a tile polygon before drawing its supplied overlay content.
	 */
	private drawHex(tile: Tile, draw: () => void): void {
		if (!this.context) return;
		const corners = hexCorners(tile).map(point => this.screenPoint(point));
		this.context.save();
		this.context.beginPath();
		this.context.moveTo(corners[0].x, corners[0].y);
		for (let index = 1; index < corners.length; index++) this.context.lineTo(corners[index].x, corners[index].y);
		this.context.closePath();
		draw();
		this.context.restore();
	}

	/**
	 * Stroke an edge through the shared world-to-screen conversion.
	 */
	private strokeSegment(points: [WorldPoint, WorldPoint]): void {
		if (!this.context) return;
		const first = this.screenPoint(points[0]);
		const second = this.screenPoint(points[1]);
		this.context.beginPath();
		this.context.moveTo(first.x, first.y);
		this.context.lineTo(second.x, second.y);
		this.context.stroke();
	}

	/**
	 * Offset a political edge toward its owner by a few screen pixels so a
	 * river shared with that border remains visible between the two strokes.
	 */
	private offsetRiverBorder(segment: BorderSegment): [WorldPoint, WorldPoint] {
		const center = hexCenter(segment.tile);
		const midpoint = { x: (segment.points[0].x + segment.points[1].x) / 2, y: (segment.points[0].y + segment.points[1].y) / 2 };
		const length = Math.hypot(center.x - midpoint.x, center.y - midpoint.y) || 1;
		const distance = (this.riverWidth() / 2 + 1.5) / this.worldScale();
		const x = (center.x - midpoint.x) / length * distance;
		const y = (center.y - midpoint.y) / length * distance;
		return [
			{ x: segment.points[0].x + x, y: segment.points[0].y + y },
			{ x: segment.points[1].x + x, y: segment.points[1].y + y }
		];
	}

	/**
	 * Draw a key-addressed hex when it exists in the loaded grid.
	 */
	private drawKeyHex(key: string, draw: () => void): void {
		const [x, y] = key.split(',').map(Number);
		const tile = this.tiles[y]?.[x];
		if (tile) this.drawHex(tile, draw);
	}

	/**
	 * Project a shared world point to CSS pixels in the Leaflet container.
	 */
	private screenPoint(point: WorldPoint): { x: number; y: number } {
		const origin = this.map.latLngToContainerPoint(this.latLngFromWorld({ x: 0, y: 0 }));
		const scale = this.worldScale();
		return { x: origin.x + point.x * scale, y: origin.y - point.y * scale };
	}

	/**
	 * Measure a plot's projected width in CSS pixels for labels and markers.
	 */
	private hexPixelWidth(tile: Tile): number {
		const center = hexCenter(tile);
		const left = this.screenPoint({ x: center.x - hexWidth / 2, y: center.y });
		const right = this.screenPoint({ x: center.x + hexWidth / 2, y: center.y });
		return Math.abs(right.x - left.x);
	}

	/**
	 * Measure the current CSS pixels per shared world unit for raster blitting.
	 */
	private worldScale(): number {
		return Math.max(0.001, Math.pow(2, this.map.getZoom()));
	}

	/** Widen rivers continuously with the visible hex size, keeping world views light. */
	private riverWidth(): number {
		return Math.max(0.8, Math.min(8, this.worldScale() * hexWidth * 0.1));
	}

	/**
	 * Quantize static raster resolution so continuous Leaflet zoom does not
	 * rebuild every visible terrain chunk for tiny camera scale changes.
	 */
	private quantizedScale(): number {
		return Math.min(64, Math.max(1, Math.round(this.worldScale() / 2) * 2));
	}

	/**
	 * Rebuild only static chunks when a source image finishes loading after the
	 * map has already appeared, avoiding a permanently blank cached texture.
	 */
	private bindAssetRefresh(): void {
		const imageIds = new Set([...Object.values(terrainImages), ...Object.values(reliefImages), ...Object.values(featureImages)]);
		for (const imageId of imageIds) {
			const image = document.getElementById(imageId) as HTMLImageElement | null;
			if (!image || image.complete) continue;
			const handler = () => {
				this.staticCache.clear();
				this.scheduleRender();
			};
			image.addEventListener('load', handler, { once: true });
			this.assetLoadHandlers.push({ image, handler });
		}
	}
}
