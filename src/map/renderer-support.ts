/**
 * Testable support primitives for the one-canvas map renderer.
 */

import { Tile, TurnState } from '../replay/types';
import { MapLod } from './hex-geometry';

export interface GeographyChunk {
	key: string;
	tiles: Tile[];
	canvas: HTMLCanvasElement;
	minX: number;
	maxY: number;
	scale: number;
	bytes: number;
	lastUsed: number;
}

const geographyCacheByteLimit = 32 * 1024 * 1024;

/**
 * Return only plots whose ownership changed between two session snapshots.
 */
export function ownershipChanges(previous: TurnState, next: TurnState): Set<string> {
	const changed = new Set<string>();
	for (const key of new Set([...Object.keys(previous), ...Object.keys(next)])) {
		if (previous[key]?.owner !== next[key]?.owner) changed.add(key);
	}
	return changed;
}

/**
 * Coalesce repeated update requests until the browser runs one frame callback.
 */
export class FrameCoalescer {
	private frame: number | null = null;

	/**
	 * Accept browser scheduling functions, or deterministic test substitutes.
	 */
	constructor(
		private readonly request: (callback: FrameRequestCallback) => number = (callback) => globalThis.requestAnimationFrame(callback),
		private readonly cancel: (frame: number) => void = (frame) => globalThis.cancelAnimationFrame(frame)
	) {}

	/**
	 * Schedule one frame unless one is already waiting.
	 */
	schedule(callback: FrameRequestCallback): void {
		if (this.frame !== null) return;
		this.frame = this.request((time) => {
			this.frame = null;
			callback(time);
		});
	}

	/**
	 * Cancel a queued frame during renderer teardown.
	 */
	cancelPending(): void {
		if (this.frame === null) return;
		this.cancel(this.frame);
		this.frame = null;
	}
}

/**
 * Keep a bounded least-recently-used cache of decoded static raster chunks.
 */
export class GeographyChunkCache {
	private readonly cache = new Map<string, GeographyChunk>();
	private bytes = 0;

	/**
	 * Return one raster chunk, creating it only for a new static identity.
	 */
	get(chunkX: number, chunkY: number, lod: MapLod, scale: number, visibilityKey: string, create: () => GeographyChunk): GeographyChunk {
		const existing = this.find(chunkX, chunkY, lod, scale, visibilityKey);
		if (existing) {
			return existing;
		}
		return this.store(chunkX, chunkY, lod, scale, visibilityKey, create);
	}

	/**
	 * Return a chunk at the exact LOD, scale, and visibility identity if cached.
	 */
	find(chunkX: number, chunkY: number, lod: MapLod, scale: number, visibilityKey: string): GeographyChunk | null {
		const key = `${lod}:${scale}:${visibilityKey}:${chunkX},${chunkY}`;
		const existing = this.cache.get(key);
		if (existing) existing.lastUsed = performance.now();
		return existing || null;
	}

	/**
	 * Reuse any older raster for this chunk and static visibility while a new
	 * scale or LOD is warming within the renderer's frame budget.
	 */
	findFallback(chunkX: number, chunkY: number, visibilityKey: string): GeographyChunk | null {
		const suffix = `:${visibilityKey}:${chunkX},${chunkY}`;
		let newest: GeographyChunk | null = null;
		for (const chunk of this.cache.values()) {
			if (!chunk.key.endsWith(suffix)) continue;
			if (!newest || chunk.lastUsed > newest.lastUsed) newest = chunk;
		}
		if (newest) newest.lastUsed = performance.now();
		return newest;
	}

	/**
	 * Store a newly rasterized chunk under its complete static cache identity.
	 */
	store(chunkX: number, chunkY: number, lod: MapLod, scale: number, visibilityKey: string, create: () => GeographyChunk): GeographyChunk {
		const key = `${lod}:${scale}:${visibilityKey}:${chunkX},${chunkY}`;
		const previous = this.cache.get(key);
		if (previous) this.bytes -= previous.bytes;
		const chunk = create();
		chunk.key = key;
		chunk.lastUsed = performance.now();
		this.cache.set(key, chunk);
		this.bytes += chunk.bytes;
		this.evict();
		return chunk;
	}

	/**
	 * Clear retained geography when a file is replaced.
	 */
	clear(): void {
		this.cache.clear();
		this.bytes = 0;
	}

	/**
	 * Report cache entries for focused tests and diagnostics.
	 */
	size(): number {
		return this.cache.size;
	}

	/**
	 * Remove the least recently used chunk when decoded bytes exceed the cap.
	 */
	private evict(): void {
		while (this.bytes > geographyCacheByteLimit && this.cache.size > 1) {
			let oldest: GeographyChunk | null = null;
			for (const chunk of this.cache.values()) {
				if (!oldest || chunk.lastUsed < oldest.lastUsed) oldest = chunk;
			}
			if (oldest) {
				this.cache.delete(oldest.key);
				this.bytes -= oldest.bytes;
			}
		}
	}
}
