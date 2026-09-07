/**
 * Renderer support tests for static cache, frame coalescing, ownership diffs,
 * and the real example-save river topology.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SaveParser } from '../../src/parsers/save-parser';
import { buildTileGrid } from '../../src/replay/utils/replay-data';
import { TurnState, TileType } from '../../src/replay/types';
import { buildRiverEdges, directions, edgeCorners, neighborFor, oppositeDirection } from '../../src/map/hex-geometry';
import { FrameCoalescer, GeographyChunkCache, ownershipChanges } from '../../src/map/renderer-support';

/**
 * Read an example save as the ArrayBuffer production parsing receives.
 */
function loadExample(name: string): ArrayBuffer {
	const raw = readFileSync(fileURLToPath(new URL(`../../examples/${name}`, import.meta.url)));
	return raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
}

/**
 * Normalize an edge's endpoint order before comparing paired shared edges.
 */
function pointSet(points: Array<{ x: number; y: number }>): string[] {
	return points.map(point => `${point.x.toFixed(8)},${point.y.toFixed(8)}`).sort();
}

/**
 * Build the minimal raster chunk shape required by the cache without DOM work.
 */
function fakeChunk(bytes: number): any {
	return {
		key: '',
		tiles: [],
		canvas: { width: 1, height: 1 },
		minX: 0,
		maxY: 0,
		scale: 1,
		bytes,
		lastUsed: 0
	};
}

describe('viewport renderer support', () => {
	it('calls the default browser frame functions with the global receiver', () => {
		const receivers: unknown[] = [];
		/** Record the browser receiver used to request a frame. */
		function request(this: unknown): number { receivers.push(this); return 7; }
		/** Record the browser receiver used to cancel a frame. */
		function cancel(this: unknown, frame: number): void { receivers.push(this); expect(frame).toBe(7); }
		vi.stubGlobal('requestAnimationFrame', request);
		vi.stubGlobal('cancelAnimationFrame', cancel);
		try {
			const frames = new FrameCoalescer();
			frames.schedule(() => undefined);
			frames.cancelPending();
			expect(receivers).toEqual([globalThis, globalThis]);
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it('reuses raster chunks for the same static identity and invalidates them for visibility changes', () => {
		const cache = new GeographyChunkCache();
		let created = 0;
		const create = () => {
			created++;
			return fakeChunk(1024);
		};
		const first = cache.get(0, 0, 'regional', 12, 'true:true:true', create);
		const second = cache.get(0, 0, 'regional', 12, 'true:true:true', create);
		cache.get(0, 0, 'regional', 12, 'false:true:true', create);
		expect(first).toBe(second);
		expect(created).toBe(2);
	});

	it('uses only same-visibility rasters as scale warming fallbacks', () => {
		const cache = new GeographyChunkCache();
		const raster = cache.get(2, 3, 'regional', 12, 'true:true:true', () => fakeChunk(1024));
		expect(cache.find(2, 3, 'regional', 14, 'true:true:true')).toBeNull();
		expect(cache.findFallback(2, 3, 'true:true:true')).toBe(raster);
		expect(cache.findFallback(2, 3, 'false:true:true')).toBeNull();
	});

	it('evicts older raster chunks when decoded byte use exceeds the cache budget', () => {
		const cache = new GeographyChunkCache();
		cache.get(0, 0, 'local', 64, 'true:true:true', () => fakeChunk(20 * 1024 * 1024));
		cache.get(1, 0, 'local', 64, 'true:true:true', () => fakeChunk(20 * 1024 * 1024));
		expect(cache.size()).toBe(1);
	});

	it('replaces a public store key without counting its previous raster twice', () => {
		const cache = new GeographyChunkCache();
		cache.store(0, 0, 'local', 64, 'true:true:true', () => fakeChunk(20 * 1024 * 1024));
		cache.store(0, 0, 'local', 64, 'true:true:true', () => fakeChunk(20 * 1024 * 1024));
		cache.store(1, 0, 'local', 64, 'true:true:true', () => fakeChunk(5 * 1024 * 1024));
		expect(cache.size()).toBe(2);
	});

	it('coalesces repeated requests until the scheduled frame runs', () => {
		const callbacks: FrameRequestCallback[] = [];
		const frames = new FrameCoalescer((callback) => {
			callbacks.push(callback);
			return callbacks.length;
		}, () => undefined);
		let renders = 0;
		frames.schedule(() => renders++);
		frames.schedule(() => renders++);
		expect(callbacks).toHaveLength(1);
		callbacks[0](0);
		expect(renders).toBe(1);
		frames.schedule(() => renders++);
		expect(callbacks).toHaveLength(2);
	});

	it('reports only ownership changes so unaffected borders remain cached', () => {
		const previous: TurnState = { '1,1': { owner: 'Rome' }, '2,2': { owner: 'Egypt' }, '3,3': { owner: 'Rome' } };
		const next: TurnState = { '1,1': { owner: 'Rome' }, '2,2': {}, '4,4': { owner: 'Egypt' } };
		expect(ownershipChanges(previous, next)).toEqual(new Set(['2,2', '3,3', '4,4']));
	});
});

describe('example 4 river geometry', () => {
	let tiles: any[][];
	let map: { width: number; height: number; wrapX: boolean };

	beforeAll(async () => {
		const file = loadExample('4.Civ5Save');
		const data = await new SaveParser(file, file.byteLength).parseReplay();
		tiles = buildTileGrid(data.tiles, data.mapWidth);
		map = { width: data.mapHeader.width, height: data.mapHeader.height, wrapX: data.mapHeader.wrapX };
	});

	it('deduplicates paired edges and drops every edge that touches water', () => {
		let directed = 0;
		for (const row of tiles) for (const tile of row) directed += (tile.rivers || []).filter((id: number) => id >= 0).length;
		expect(directed).toBe(1060);
		const misses: string[] = [];
		for (const row of tiles) for (const tile of row) directions.forEach((direction, index) => {
			const id = tile.rivers[index];
			const neighbor = neighborFor(tile, direction, map);
			if (id >= 0 && (!neighbor || tiles[neighbor.y][neighbor.x].rivers[directions.indexOf(oppositeDirection(direction))] !== id)) misses.push(`${tile.x},${tile.y}:${direction}`);
		});
		expect(misses).toEqual(['57,10:NE', '58,10:NW', '56,11:E', '58,11:W', '57,12:SE', '58,12:SW']);
		const drawable = buildRiverEdges(tiles, map);
		expect(drawable).toHaveLength(353);
		// Lake shorelines are recorded as rivers, so every drawn edge must
		// keep land on both sides
		const water = (tile: any) => tile.type === TileType.Coast || tile.type === TileType.Ocean;
		for (const edge of drawable) {
			expect(water(tiles[edge.tile.y][edge.tile.x])).toBe(false);
			if (edge.neighbor) expect(water(tiles[edge.neighbor.y][edge.neighbor.x])).toBe(false);
		}
	});

	it('matches every real river id and geometric edge to its opposite neighbor record', () => {
		for (const row of tiles) {
			for (const tile of row) {
				for (const [index, direction] of directions.entries()) {
					const riverId = tile.rivers?.[index];
					if (riverId === undefined || riverId < 0) continue;
					const neighbor = neighborFor(tile, direction, map);
					expect(neighbor).not.toBeNull();
					const opposite = oppositeDirection(direction);
					const orphan = ['57,10:NE', '58,10:NW', '56,11:E', '58,11:W', '57,12:SE', '58,12:SW'].includes(`${tile.x},${tile.y}:${direction}`);
					if (!orphan) expect(tiles[neighbor!.y][neighbor!.x].rivers[directions.indexOf(opposite)]).toBe(riverId);
					if (Math.abs(tile.x - neighbor!.x) <= 1) expect(pointSet(edgeCorners(tile, direction))).toEqual(pointSet(edgeCorners(neighbor!, opposite)));
				}
			}
		}
	});

	it('retains seam segments for real wrapped river edges', () => {
		const seam = buildRiverEdges(tiles, map).filter(edge => edge.seamPoints);
		expect(seam.length).toBeGreaterThan(0);
	});
});
