/**
 * Shared flat-coordinate geometry for the replay map.
 * The renderer, river topology, borders, picking, and map fitting all use
 * these helpers so a plot has one stable location everywhere.
 */

export type HexDirection = 'NE' | 'E' | 'SE' | 'SW' | 'W' | 'NW';

export interface WorldPoint {
	x: number;
	y: number;
}

export interface HexCoordinate {
	x: number;
	y: number;
}

export interface MapGeometryOptions {
	width: number;
	height: number;
	wrapX: boolean;
}

export interface SharedEdge {
	key: string;
	direction: HexDirection;
	tile: HexCoordinate;
	neighbor: HexCoordinate | null;
	points: [WorldPoint, WorldPoint];
	seamPoints?: [WorldPoint, WorldPoint];
}

export interface RiverEdge extends SharedEdge {
	riverId: number;
}

export type MapLod = 'world' | 'regional' | 'local';

// Pointy hex dimensions in world coordinates. A radius of one keeps fitting
// and picking independent from the viewport's current pixel scale.
export const hexRadius = 1;
export const hexWidth = Math.sqrt(3) * hexRadius;
export const hexHeight = 2 * hexRadius;
export const hexRowSpacing = 1.5 * hexRadius;
export const directions: HexDirection[] = ['NE', 'E', 'SE', 'SW', 'W', 'NW'];

/**
 * Return the opposite side of a shared hex edge.
 */
export function oppositeDirection(direction: HexDirection): HexDirection {
	return directions[(directions.indexOf(direction) + 3) % directions.length];
}

/**
 * Build a stable key for a tile coordinate.
 */
export function tileKey(tile: HexCoordinate): string {
	return `${tile.x},${tile.y}`;
}

/**
 * Return the center of a pointy hex in the flat shared map coordinate system.
 */
export function hexCenter(tile: HexCoordinate): WorldPoint {
	return {
		x: (tile.x + (tile.y % 2 === 0 ? 0 : 0.5)) * hexWidth,
		y: tile.y * hexRowSpacing
	};
}

/**
 * Return the six vertices of a pointy hex, beginning at its top point.
 */
export function hexCorners(tile: HexCoordinate): WorldPoint[] {
	const center = hexCenter(tile);
	return Array.from({ length: 6 }, (_, index) => {
		const angle = Math.PI / 2 - index * Math.PI / 3;
		return {
			x: center.x + Math.cos(angle) * hexRadius,
			y: center.y + Math.sin(angle) * hexRadius
		};
	});
}

/**
 * Return the two corners that make up a direction's outward edge.
 */
export function edgeCorners(tile: HexCoordinate, direction: HexDirection): [WorldPoint, WorldPoint] {
	const corners = hexCorners(tile);
	const edgeIndex = directions.indexOf(direction);
	return [corners[edgeIndex], corners[(edgeIndex + 1) % corners.length]];
}

/**
 * Offset both endpoints of an edge toward a hex center by a world distance.
 * Borders and highlight outlines use this to keep every stroke inside its
 * own hexagon, leaving the shared edge itself free for the feature that
 * belongs to both sides, such as a river.
 */
export function insetEdgeToward(points: [WorldPoint, WorldPoint], center: WorldPoint, distance: number): [WorldPoint, WorldPoint] {
	const midpoint = { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 };
	const length = Math.hypot(center.x - midpoint.x, center.y - midpoint.y) || 1;
	const x = (center.x - midpoint.x) / length * distance;
	const y = (center.y - midpoint.y) / length * distance;
	return [
		{ x: points[0].x + x, y: points[0].y + y },
		{ x: points[1].x + x, y: points[1].y + y }
	];
}

/**
 * Look up a neighbor using the map's staggered rows and optional horizontal wrap.
 */
export function neighborFor(tile: HexCoordinate, direction: HexDirection, options: MapGeometryOptions): HexCoordinate | null {
	const oddRow = tile.y % 2 !== 0;
	const offsets: Record<HexDirection, [number, number]> = oddRow
		? { NE: [1, 1], E: [1, 0], SE: [1, -1], SW: [0, -1], W: [-1, 0], NW: [0, 1] }
		: { NE: [0, 1], E: [1, 0], SE: [0, -1], SW: [-1, -1], W: [-1, 0], NW: [-1, 1] };

	let x = tile.x + offsets[direction][0];
	const y = tile.y + offsets[direction][1];
	if (y < 0 || y >= options.height || options.width <= 0) {
		return null;
	}
	if (x < 0 || x >= options.width) {
		if (!options.wrapX) {
			return null;
		}
		x = (x + options.width) % options.width;
	}
	return { x, y };
}

/**
 * Build the canonical key for an edge, including wrapped seam neighbors.
 */
export function sharedEdgeKey(tile: HexCoordinate, direction: HexDirection, options: MapGeometryOptions): string {
	const neighbor = neighborFor(tile, direction, options);
	if (!neighbor) {
		return `${tileKey(tile)}:${direction}`;
	}
	return [tileKey(tile), tileKey(neighbor)].sort().join('|');
}

/**
 * Precompute every unique edge, retaining a second drawable segment for a
 * horizontally wrapped seam so either map edge can show that water course.
 */
export function buildSharedEdges(options: MapGeometryOptions): SharedEdge[] {
	const edges = new Map<string, SharedEdge>();
	for (let y = 0; y < options.height; y++) {
		for (let x = 0; x < options.width; x++) {
			const tile = { x, y };
			for (const direction of directions) {
				const key = sharedEdgeKey(tile, direction, options);
				if (edges.has(key)) {
					continue;
				}
				const neighbor = neighborFor(tile, direction, options);
				const edge: SharedEdge = { key, direction, tile, neighbor, points: edgeCorners(tile, direction) };
				if (neighbor && Math.abs(neighbor.x - tile.x) > 1) {
					edge.seamPoints = edgeCorners(neighbor, oppositeDirection(direction));
				}
				edges.set(key, edge);
			}
		}
	}
	return Array.from(edges.values());
}

/**
 * Deduplicate parsed river ids into drawable shared edges.
 */
export function buildRiverEdges(
	tiles: Array<Array<{ rivers?: number[] }>>,
	options: MapGeometryOptions
): RiverEdge[] {
	const edges = new Map<string, RiverEdge>();
	for (let y = 0; y < tiles.length; y++) {
		for (let x = 0; x < tiles[y].length; x++) {
			const rivers = tiles[y][x].rivers || [];
			for (let index = 0; index < directions.length; index++) {
				const riverId = rivers[index];
				if (riverId === undefined || riverId < 0) {
					continue;
				}
				const tile = { x, y };
				const direction = directions[index];
				const key = sharedEdgeKey(tile, direction, options);
				if (edges.has(key)) {
					continue;
				}
				const neighbor = neighborFor(tile, direction, options);
				const edge: RiverEdge = { key, direction, tile, neighbor, riverId, points: edgeCorners(tile, direction) };
				if (neighbor && Math.abs(neighbor.x - tile.x) > 1) {
					edge.seamPoints = edgeCorners(neighbor, oppositeDirection(direction));
				}
				edges.set(key, edge);
			}
		}
	}
	return Array.from(edges.values());
}

/**
 * Map a world point to the nearest staggered tile, then verify it is inside
 * the actual hex so gaps around corners do not select a neighboring plot.
 */
export function pickHex(point: WorldPoint, options: MapGeometryOptions): HexCoordinate | null {
	const estimatedY = Math.round(point.y / hexRowSpacing);
	for (let y = estimatedY - 1; y <= estimatedY + 1; y++) {
		if (y < 0 || y >= options.height) {
			continue;
		}
		const rowOffset = y % 2 === 0 ? 0 : 0.5;
		const estimatedX = Math.round(point.x / hexWidth - rowOffset);
		for (let x = estimatedX - 1; x <= estimatedX + 1; x++) {
			if (x < 0 || x >= options.width) {
				continue;
			}
			const center = hexCenter({ x, y });
			const dx = Math.abs(point.x - center.x);
			const dy = Math.abs(point.y - center.y);
			const horizontalLimit = Math.min(hexWidth / 2, Math.sqrt(3) * (hexRadius - dy));
			if (dx <= horizontalLimit && dy <= hexRadius) {
				return { x, y };
			}
		}
	}
	return null;
}

/**
 * Select a stable LOD, using 15 percent hysteresis after the first choice.
 */
export function nextMapLod(hexWidthPixels: number, previous: MapLod | null): MapLod {
	if (!previous) {
		return hexWidthPixels < 10 ? 'world' : hexWidthPixels < 28 ? 'regional' : 'local';
	}
	if (previous === 'world') {
		return hexWidthPixels > 32.2 ? 'local' : hexWidthPixels > 11.5 ? 'regional' : 'world';
	}
	if (previous === 'regional') {
		if (hexWidthPixels < 8.5) return 'world';
		return hexWidthPixels > 32.2 ? 'local' : 'regional';
	}
	return hexWidthPixels < 8.5 ? 'world' : hexWidthPixels < 23.8 ? 'regional' : 'local';
}
