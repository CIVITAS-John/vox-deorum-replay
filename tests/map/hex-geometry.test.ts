/**
 * Geometry tests for the flat Stage 4 map coordinate system.
 */

import { describe, expect, it } from 'vitest';
import {
	buildRiverEdges,
	directions,
	hexCenter,
	hexWidth,
	neighborFor,
	nextMapLod,
	oppositeDirection,
	pickHex
} from '../../src/map/hex-geometry';

const boundedMap = { width: 5, height: 5, wrapX: false };

/**
 * Create a small river-id grid with six empty direction slots per plot.
 */
function riverGrid(width: number, height: number): Array<Array<{ rivers: number[] }>> {
	return Array.from({ length: height }, () => Array.from({ length: width }, () => ({ rivers: [-1, -1, -1, -1, -1, -1] })));
}

describe('hex geometry', () => {
	it('keeps the replay coordinate convention where raw y increases north', () => {
		const even = { x: 2, y: 2 };
		const odd = { x: 2, y: 3 };
		expect(neighborFor(even, 'NE', boundedMap)).toEqual({ x: 2, y: 3 });
		expect(neighborFor(even, 'SE', boundedMap)).toEqual({ x: 2, y: 1 });
		expect(neighborFor(odd, 'NE', boundedMap)).toEqual({ x: 3, y: 4 });
		expect(neighborFor(odd, 'SW', boundedMap)).toEqual({ x: 2, y: 2 });
	});

	it('returns to the source plot through every opposite neighbor direction', () => {
		const tile = { x: 2, y: 2 };
		for (const direction of directions) {
			const neighbor = neighborFor(tile, direction, boundedMap)!;
			expect(neighborFor(neighbor, oppositeDirection(direction), boundedMap)).toEqual(tile);
		}
	});

	it('deduplicates matched river ids for every directional edge', () => {
		const grid = riverGrid(5, 5);
		const tile = { x: 2, y: 2 };
		for (const [index, direction] of directions.entries()) {
			const neighbor = neighborFor(tile, direction, boundedMap)!;
			grid[tile.y][tile.x].rivers[index] = index;
			grid[neighbor.y][neighbor.x].rivers[directions.indexOf(oppositeDirection(direction))] = index;
		}
		const rivers = buildRiverEdges(grid, boundedMap);
		expect(rivers).toHaveLength(6);
		expect(new Set(rivers.map(river => river.riverId))).toEqual(new Set([0, 1, 2, 3, 4, 5]));
	});

	it('deduplicates horizontal seam rivers while retaining both drawable seam sides', () => {
		const map = { width: 3, height: 3, wrapX: true };
		const grid = riverGrid(3, 3);
		grid[1][0].rivers[4] = 9;
		grid[1][2].rivers[1] = 9;
		const rivers = buildRiverEdges(grid, map);
		expect(rivers).toHaveLength(1);
		expect(rivers[0].seamPoints).toBeDefined();
	});

	it('round-trips centers through picking and rejects points beyond a hex side', () => {
		const tile = { x: 3, y: 2 };
		expect(pickHex(hexCenter(tile), boundedMap)).toEqual(tile);
		const onlyTile = { width: 1, height: 1, wrapX: false };
		const center = hexCenter({ x: 0, y: 0 });
		expect(pickHex({ x: center.x + hexWidth * 0.6, y: center.y }, onlyTile)).toBeNull();
	});

	it('uses hysteresis while allowing a large zoom jump to cross both thresholds', () => {
		expect(nextMapLod(9, null)).toBe('world');
		expect(nextMapLod(11, 'world')).toBe('world');
		expect(nextMapLod(12, 'world')).toBe('regional');
		expect(nextMapLod(40, 'world')).toBe('local');
		expect(nextMapLod(25, 'local')).toBe('local');
		expect(nextMapLod(23, 'local')).toBe('regional');
		expect(nextMapLod(8, 'local')).toBe('world');
	});
});
