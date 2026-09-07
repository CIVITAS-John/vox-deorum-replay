(function () {
    'use strict';

    /**
     * Shared flat-coordinate geometry for the replay map.
     * The renderer, river topology, borders, picking, and map fitting all use
     * these helpers so a plot has one stable location everywhere.
     */
    // Pointy hex dimensions in world coordinates. A radius of one keeps fitting
    // and picking independent from the viewport's current pixel scale.
    const hexRadius = 1;
    const hexWidth = Math.sqrt(3) * hexRadius;
    const hexRowSpacing = 1.5 * hexRadius;
    const directions = ['NE', 'E', 'SE', 'SW', 'W', 'NW'];
    /**
     * Return the opposite side of a shared hex edge.
     */
    function oppositeDirection(direction) {
        return directions[(directions.indexOf(direction) + 3) % directions.length];
    }
    /**
     * Build a stable key for a tile coordinate.
     */
    function tileKey(tile) {
        return `${tile.x},${tile.y}`;
    }
    /**
     * Return the center of a pointy hex in the flat shared map coordinate system.
     */
    function hexCenter(tile) {
        return {
            x: (tile.x + (tile.y % 2 === 0 ? 0 : 0.5)) * hexWidth,
            y: tile.y * hexRowSpacing
        };
    }
    /**
     * Return the six vertices of a pointy hex, beginning at its top point.
     */
    function hexCorners(tile) {
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
    function edgeCorners(tile, direction) {
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
    function insetEdgeToward(points, center, distance) {
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
    function neighborFor(tile, direction, options) {
        const oddRow = tile.y % 2 !== 0;
        const offsets = oddRow
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
    function sharedEdgeKey(tile, direction, options) {
        const neighbor = neighborFor(tile, direction, options);
        if (!neighbor) {
            return `${tileKey(tile)}:${direction}`;
        }
        return [tileKey(tile), tileKey(neighbor)].sort().join('|');
    }
    /**
     * Deduplicate parsed river ids into drawable shared edges.
     */
    function buildRiverEdges(tiles, options) {
        const edges = new Map();
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
                    const edge = { key, direction, tile, neighbor, riverId, points: edgeCorners(tile, direction) };
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
    function pickHex(point, options) {
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
    function nextMapLod(hexWidthPixels, previous) {
        if (!previous) {
            return hexWidthPixels < 10 ? 'world' : hexWidthPixels < 28 ? 'regional' : 'local';
        }
        if (previous === 'world') {
            return hexWidthPixels > 32.2 ? 'local' : hexWidthPixels > 11.5 ? 'regional' : 'world';
        }
        if (previous === 'regional') {
            if (hexWidthPixels < 8.5)
                return 'world';
            return hexWidthPixels > 32.2 ? 'local' : 'regional';
        }
        return hexWidthPixels < 8.5 ? 'world' : hexWidthPixels < 23.8 ? 'regional' : 'local';
    }

    /**
     * civ-colors.ts
     * Defines color mappings for each civilization in Civilization V
     * Each civilization has two color sets: city (for city markers) and territory (for borders)
     * Colors are defined as RGB arrays [R, G, B] with values 0-255
     * Note: Replay files don't include color data, so these are hardcoded defaults
     */
    const CivColors = {
        America: { city: [255, 255, 255], territory: [31, 51, 120] },
        Arabia: { city: [146, 221, 9], territory: [43, 87, 45] },
        Assyria: { city: [255, 168, 12], territory: [255, 243, 173] },
        Austria: { city: [255, 255, 255], territory: [234, 0, 0] },
        Babylon: { city: [200, 248, 255], territory: [43, 81, 97] },
        Brazil: { city: [41, 83, 44], territory: [149, 221, 10] },
        Byzantium: { city: [60, 0, 108], territory: [113, 161, 232] },
        Carthage: { city: [80, 0, 136], territory: [204, 204, 204] },
        China: { city: [255, 255, 255], territory: [0, 148, 82] },
        Denmark: { city: [239, 231, 179], territory: [108, 42, 20] },
        Egypt: { city: [82, 0, 208], territory: [255, 251, 3] },
        England: { city: [255, 255, 255], territory: [108, 2, 0] },
        Ethiopia: { city: [255, 45, 45], territory: [1, 39, 14] },
        France: { city: [235, 235, 138], territory: [65, 141, 253] },
        Germany: { city: [36, 43, 32], territory: [179, 177, 184] },
        Greece: { city: [65, 141, 253], territory: [255, 255, 255] },
        India: { city: [255, 153, 49], territory: [18, 135, 6] },
        Indonesia: { city: [158, 46, 28], territory: [110, 210, 217] },
        Japan: { city: [184, 0, 0], territory: [255, 255, 255] },
        Korea: { city: [255, 0, 0], territory: [26, 32, 96] },
        Mongolia: { city: [255, 120, 0], territory: [81, 0, 8] },
        Morocco: { city: [39, 178, 79], territory: [144, 2, 0] },
        Persia: { city: [245, 230, 55], territory: [176, 7, 3] },
        Poland: { city: [56, 0, 0], territory: [244, 5, 0] },
        Polynesia: { city: [255, 255, 74], territory: [217, 88, 0] },
        Portugal: { city: [3, 20, 124], territory: [255, 255, 255] },
        Rome: { city: [239, 198, 0], territory: [70, 0, 118] },
        Russia: { city: [0, 0, 0], territory: [238, 238, 238] },
        Siam: { city: [176, 7, 3], territory: [245, 230, 55] },
        Songhai: { city: [90, 0, 9], territory: [213, 145, 19] },
        Spain: { city: [244, 168, 168], territory: [83, 26, 26] },
        Sweden: { city: [248, 246, 2], territory: [7, 7, 165] },
        Venice: { city: [255, 254, 215], territory: [102, 33, 161] },
        'The Aztecs': { city: [136, 238, 212], territory: [161, 57, 34] },
        'The Celts': { city: [147, 169, 255], territory: [21, 91, 62] },
        'The Huns': { city: [69, 0, 3], territory: [179, 177, 163] },
        'The Inca': { city: [6, 159, 119], territory: [255, 184, 33] },
        'The Iroquois': { city: [251, 201, 129], territory: [65, 86, 86] },
        'The Maya': { city: [23, 62, 65], territory: [197, 140, 98] },
        'The Netherlands': { city: [255, 255, 255], territory: [255, 143, 0] },
        'The Ottomans': { city: [18, 82, 30], territory: [247, 248, 199] },
        'The Shoshone': { city: [24, 239, 206], territory: [73, 58, 45] },
        'The Zulus': { city: [106, 49, 24], territory: [255, 231, 213] }
    };
    /**
     * Look up the color pair of a civilization by name
     */
    function getCivColors(civName) {
        return CivColors[civName] || null;
    }

    /**
      * types.ts
     * Type definitions for replay data structures
     */
    // Event type enum for better type safety
    var EventType;
    (function (EventType) {
        EventType[EventType["Message"] = 0] = "Message";
        EventType[EventType["CityFounded"] = 1] = "CityFounded";
        EventType[EventType["TilesClaimed"] = 2] = "TilesClaimed";
        EventType[EventType["CitiesTransferred"] = 3] = "CitiesTransferred";
        EventType[EventType["CityRazed"] = 4] = "CityRazed";
        EventType[EventType["ReligionFounded"] = 5] = "ReligionFounded";
        EventType[EventType["PantheonSelected"] = 6] = "PantheonSelected";
        EventType[EventType["Strategies"] = 7] = "Strategies";
    })(EventType || (EventType = {}));
    // Whether a piece of data is known at every turn or only at the loaded save's turn
    var DataKind;
    (function (DataKind) {
        DataKind["History"] = "history";
        DataKind["Snapshot"] = "snapshot"; // Known only at the turn the save was taken
    })(DataKind || (DataKind = {}));
    // Elevation type enum
    var ElevationType;
    (function (ElevationType) {
        ElevationType[ElevationType["Mountain"] = 0] = "Mountain";
        ElevationType[ElevationType["Hills"] = 1] = "Hills";
        ElevationType[ElevationType["AboveSeaLevel"] = 2] = "AboveSeaLevel";
        ElevationType[ElevationType["BelowSeaLevel"] = 3] = "BelowSeaLevel";
    })(ElevationType || (ElevationType = {}));
    // Tile type enum
    var TileType;
    (function (TileType) {
        TileType[TileType["Grassland"] = 0] = "Grassland";
        TileType[TileType["Plains"] = 1] = "Plains";
        TileType[TileType["Desert"] = 2] = "Desert";
        TileType[TileType["Tundra"] = 3] = "Tundra";
        TileType[TileType["Snow"] = 4] = "Snow";
        TileType[TileType["Coast"] = 5] = "Coast";
        TileType[TileType["Ocean"] = 6] = "Ocean";
    })(TileType || (TileType = {}));
    // Feature type enum
    var FeatureType;
    (function (FeatureType) {
        FeatureType[FeatureType["NoFeature"] = -1] = "NoFeature";
        FeatureType[FeatureType["Ice"] = 0] = "Ice";
        FeatureType[FeatureType["Jungle"] = 1] = "Jungle";
        FeatureType[FeatureType["Marsh"] = 2] = "Marsh";
        FeatureType[FeatureType["Oasis"] = 3] = "Oasis";
        FeatureType[FeatureType["FloodPlains"] = 4] = "FloodPlains";
        FeatureType[FeatureType["Forest"] = 5] = "Forest";
        FeatureType[FeatureType["CerroDePotosi"] = 15] = "CerroDePotosi";
        FeatureType[FeatureType["Atoll"] = 17] = "Atoll";
        FeatureType[FeatureType["SriPada"] = 18] = "SriPada";
        FeatureType[FeatureType["MtSinai"] = 19] = "MtSinai";
    })(FeatureType || (FeatureType = {}));

    /**
     * Testable support primitives for the one-canvas map renderer.
     */
    const geographyCacheByteLimit = 32 * 1024 * 1024;
    /**
     * Return only plots whose ownership changed between two session snapshots.
     */
    function ownershipChanges(previous, next) {
        var _a, _b;
        const changed = new Set();
        for (const key of new Set([...Object.keys(previous), ...Object.keys(next)])) {
            if (((_a = previous[key]) === null || _a === void 0 ? void 0 : _a.owner) !== ((_b = next[key]) === null || _b === void 0 ? void 0 : _b.owner))
                changed.add(key);
        }
        return changed;
    }
    /**
     * Coalesce repeated update requests until the browser runs one frame callback.
     */
    class FrameCoalescer {
        /**
         * Accept browser scheduling functions, or deterministic test substitutes.
         */
        constructor(request = (callback) => globalThis.requestAnimationFrame(callback), cancel = (frame) => globalThis.cancelAnimationFrame(frame)) {
            this.request = request;
            this.cancel = cancel;
            this.frame = null;
        }
        /**
         * Schedule one frame unless one is already waiting.
         */
        schedule(callback) {
            if (this.frame !== null)
                return;
            this.frame = this.request((time) => {
                this.frame = null;
                callback(time);
            });
        }
        /**
         * Cancel a queued frame during renderer teardown.
         */
        cancelPending() {
            if (this.frame === null)
                return;
            this.cancel(this.frame);
            this.frame = null;
        }
    }
    /**
     * Keep a bounded least-recently-used cache of decoded static raster chunks.
     */
    class GeographyChunkCache {
        constructor() {
            this.cache = new Map();
            this.bytes = 0;
        }
        /**
         * Return one raster chunk, creating it only for a new static identity.
         */
        get(chunkX, chunkY, lod, scale, visibilityKey, create) {
            const existing = this.find(chunkX, chunkY, lod, scale, visibilityKey);
            if (existing) {
                return existing;
            }
            return this.store(chunkX, chunkY, lod, scale, visibilityKey, create);
        }
        /**
         * Return a chunk at the exact LOD, scale, and visibility identity if cached.
         */
        find(chunkX, chunkY, lod, scale, visibilityKey) {
            const key = `${lod}:${scale}:${visibilityKey}:${chunkX},${chunkY}`;
            const existing = this.cache.get(key);
            if (existing)
                existing.lastUsed = performance.now();
            return existing || null;
        }
        /**
         * Reuse any older raster for this chunk and static visibility while a new
         * scale or LOD is warming within the renderer's frame budget.
         */
        findFallback(chunkX, chunkY, visibilityKey) {
            const suffix = `:${visibilityKey}:${chunkX},${chunkY}`;
            let newest = null;
            for (const chunk of this.cache.values()) {
                if (!chunk.key.endsWith(suffix))
                    continue;
                if (!newest || chunk.lastUsed > newest.lastUsed)
                    newest = chunk;
            }
            if (newest)
                newest.lastUsed = performance.now();
            return newest;
        }
        /**
         * Store a newly rasterized chunk under its complete static cache identity.
         */
        store(chunkX, chunkY, lod, scale, visibilityKey, create) {
            const key = `${lod}:${scale}:${visibilityKey}:${chunkX},${chunkY}`;
            const previous = this.cache.get(key);
            if (previous)
                this.bytes -= previous.bytes;
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
        clear() {
            this.cache.clear();
            this.bytes = 0;
        }
        /**
         * Report cache entries for focused tests and diagnostics.
         */
        size() {
            return this.cache.size;
        }
        /**
         * Remove the least recently used chunk when decoded bytes exceed the cap.
         */
        evict() {
            while (this.bytes > geographyCacheByteLimit && this.cache.size > 1) {
                let oldest = null;
                for (const chunk of this.cache.values()) {
                    if (!oldest || chunk.lastUsed < oldest.lastUsed)
                        oldest = chunk;
                }
                if (oldest) {
                    this.cache.delete(oldest.key);
                    this.bytes -= oldest.bytes;
                }
            }
        }
    }

    /**
     * One Leaflet-managed viewport canvas for the complete replay map.
     * Static geography is grouped into bounded chunks while turn-dependent
     * ownership, cities, borders, selection, and events are drawn in one pass.
     */
    const geographyChunkSize = 12;
    const geographyBuildBudgetMs = 4;
    const terrainColors = {
        [TileType.Grassland]: '#6f9c58',
        [TileType.Plains]: '#b8a65b',
        [TileType.Desert]: '#d6bd75',
        [TileType.Tundra]: '#91a283',
        [TileType.Snow]: '#e6edf0',
        [TileType.Coast]: '#4f91ab',
        [TileType.Ocean]: '#2d6684'
    };
    const terrainImages = {
        [TileType.Grassland]: 'GRASSLAND',
        [TileType.Plains]: 'PLAINS',
        [TileType.Desert]: 'DESERT',
        [TileType.Tundra]: 'TUNDRA',
        [TileType.Snow]: 'SNOW',
        [TileType.Coast]: 'COAST',
        [TileType.Ocean]: 'OCEAN'
    };
    const reliefImages = {
        [ElevationType.Mountain]: 'MOUNTAIN',
        [ElevationType.Hills]: 'HILLS'
    };
    const featureImages = {
        [FeatureType.Ice]: 'ICE',
        [FeatureType.Jungle]: 'JUNGLE',
        [FeatureType.Forest]: 'FOREST'
    };
    /**
     * Provide a Layer-control compatible rendering flag without creating a
     * second Leaflet canvas layer.
     */
    class RendererFlag {
        /** Initialize a visibility flag and its redraw callback. */
        constructor(label, visible, onChange, disabled = false, disabledReason) {
            this.label = label;
            this.onChange = onChange;
            this.disabled = disabled;
            this.disabledReason = disabledReason;
            this.visible = visible;
        }
        /**
         * Change a rendering flag and request the one shared canvas frame.
         */
        setVisible(visible) {
            if (this.disabled || this.visible === visible)
                return;
            this.visible = visible;
            this.onChange();
        }
    }
    /**
     * Render the map through one viewport-sized canvas while Leaflet continues to
     * own camera movement, touch input, controls, and container sizing.
     */
    class ViewportLayer extends L.Layer {
        /** Prepare static map topology, events, and layer visibility. */
        constructor(tiles, events, wrapX, hasRivers) {
            var _a;
            super();
            this.tiles = tiles;
            this.map = null;
            this.canvas = null;
            this.context = null;
            this.frames = new FrameCoalescer();
            this.lod = null;
            this.turnState = {};
            this.previousState = {};
            this.riverKeys = new Set();
            this.eventsByTurn = new Map();
            this.staticCache = new GeographyChunkCache();
            this.borderCache = new Map();
            this.cityMarkers = [];
            this.eventHexes = new Set();
            this.selectedHex = null;
            this.highlightedCivs = new Set();
            this.assetLoadHandlers = [];
            this.pendingGeography = false;
            this.zoomAnimating = false;
            this.paintedView = null;
            /** Request a redraw when Leaflet changes the camera. */
            this.onCameraChange = () => this.scheduleRender();
            /** Animate the existing bitmap with Leaflet before drawing the settled view. */
            this.onZoomAnimation = (event) => {
                if (!this.canvas || !this.paintedView)
                    return;
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
            this.onZoomEnd = () => {
                if (!this.canvas || !this.zoomAnimating)
                    return;
                this.zoomAnimating = false;
                this.canvas.style.transition = 'none';
                this.canvas.style.transform = '';
                this.render();
            };
            this.geometry = { width: ((_a = tiles[0]) === null || _a === void 0 ? void 0 : _a.length) || 0, height: tiles.length, wrapX };
            this.rivers = hasRivers ? buildRiverEdges(tiles, this.geometry) : [];
            for (const river of this.rivers)
                this.riverKeys.add(river.key);
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
        onAdd(map) {
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
        onRemove(map) {
            var _a;
            map.off('move zoom resize viewreset', this.onCameraChange);
            map.off('zoomanim', this.onZoomAnimation);
            map.off('zoomend', this.onZoomEnd);
            this.zoomAnimating = false;
            this.paintedView = null;
            this.frames.cancelPending();
            this.staticCache.clear();
            this.borderCache.clear();
            for (const { image, handler } of this.assetLoadHandlers)
                image.removeEventListener('load', handler);
            this.assetLoadHandlers.length = 0;
            (_a = this.canvas) === null || _a === void 0 ? void 0 : _a.remove();
            this.canvas = null;
            this.context = null;
            this.map = null;
        }
        /**
         * Update dynamic state from the session callback, retaining static geography.
         */
        setTurn(turn, state) {
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
        setSelectedHex(hexKey) {
            if (this.selectedHex === hexKey)
                return;
            this.selectedHex = hexKey;
            this.scheduleRender();
        }
        /**
         * Return the selected tile key for existing replay-map callers.
         */
        getSelectedHex() {
            return this.selectedHex;
        }
        /**
         * Change highlighted political borders without creating another layer.
         */
        setHighlightedCivs(civNames) {
            this.highlightedCivs = new Set(civNames);
            this.scheduleRender();
        }
        /**
         * Clear all session-dependent map highlights.
         */
        clearHighlights() {
            this.selectedHex = null;
            this.highlightedCivs.clear();
            this.eventHexes.clear();
            this.scheduleRender();
        }
        /**
         * Convert a Leaflet lat-lng to the map's shared flat coordinate system.
         */
        worldFromLatLng(latLng) {
            return { x: latLng.lng, y: latLng.lat };
        }
        /**
         * Convert a shared flat point to a Leaflet lat-lng.
         */
        latLngFromWorld(point) {
            return L.latLng(point.y, point.x);
        }
        /**
         * Find the map plot under a Leaflet lat-lng for future inspection controls.
         */
        pickLatLng(latLng) {
            return pickHex(this.worldFromLatLng(latLng), this.geometry);
        }
        /**
         * Request one animation frame. Multiple camera and timeline updates collapse
         * into the latest state instead of queuing obsolete scrub renders.
         */
        scheduleRender() {
            if (!this.map || this.zoomAnimating)
                return;
            this.frames.schedule(() => this.render());
        }
        /**
         * Size the backing store, select a stable LOD, and draw geography then overlays.
         */
        render() {
            if (!this.map || !this.canvas || !this.context || this.zoomAnimating)
                return;
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
            const visibleTiles = visibleChunks.reduce((all, chunk) => all.concat(chunk.tiles), []);
            this.drawGeography(visibleChunks);
            this.drawTerritory(visibleTiles);
            this.drawRivers();
            this.drawBorders();
            this.drawCities();
            this.drawGrid(visibleTiles);
            this.drawHighlights();
            if (this.pendingGeography)
                this.scheduleRender();
        }
        /**
         * Return raster chunks intersecting the camera bounds at a quantized scale.
         */
        visibleChunks() {
            if (!this.map)
                return [];
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
            const result = [];
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
                    if (!chunk)
                        continue;
                    result.push(chunk);
                }
            }
            return result;
        }
        /**
         * Blit cached static geography chunks at the current camera scale.
         */
        drawGeography(chunks) {
            if (!this.context)
                return;
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
        createGeographyChunk(chunkX, chunkY, scale) {
            const tiles = [];
            const startY = chunkY * geographyChunkSize;
            const startX = chunkX * geographyChunkSize;
            for (let y = startY; y < Math.min(startY + geographyChunkSize, this.tiles.length); y++) {
                for (let x = startX; x < Math.min(startX + geographyChunkSize, this.tiles[y].length); x++)
                    tiles.push(this.tiles[y][x]);
            }
            const points = tiles.reduce((all, tile) => all.concat(hexCorners(tile)), []);
            const minX = Math.min(...points.map(point => point.x));
            const maxX = Math.max(...points.map(point => point.x));
            const minY = Math.min(...points.map(point => point.y));
            const maxY = Math.max(...points.map(point => point.y));
            const padding = 2;
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.ceil((maxX - minX) * scale) + padding * 2);
            canvas.height = Math.max(1, Math.ceil((maxY - minY) * scale) + padding * 2);
            const context = canvas.getContext('2d');
            context.imageSmoothingEnabled = true;
            context.imageSmoothingQuality = 'high';
            for (const tile of tiles)
                this.drawStaticTile(context, tile, minX, maxY, scale, padding);
            return { key: '', tiles, canvas, minX: minX - padding / scale, maxY: maxY + padding / scale, scale, bytes: canvas.width * canvas.height * 4, lastUsed: 0 };
        }
        /**
         * Draw one tile's immutable geography into a chunk-local coordinate system.
         */
        drawStaticTile(context, tile, minX, maxY, scale, padding) {
            if (this.layers.terrain.visible) {
                this.drawStaticHex(context, tile, minX, maxY, scale, padding, () => {
                    context.fillStyle = terrainColors[tile.type] || '#777';
                    context.fill();
                    context.strokeStyle = terrainColors[tile.type] || '#777';
                    context.lineWidth = 1;
                    context.stroke();
                });
                if (this.lod !== 'world')
                    this.drawStaticTexture(context, terrainImages[tile.type], tile, minX, maxY, scale, padding);
            }
            if (this.lod !== 'world' && this.layers.relief.visible)
                this.drawStaticTexture(context, reliefImages[tile.elevation], tile, minX, maxY, scale, padding);
            if (this.lod !== 'world' && this.layers.features.visible)
                this.drawStaticFeature(context, tile, minX, maxY, scale, padding);
        }
        /**
         * Draw a chunk-local hex path and clip its supplied content.
         */
        drawStaticHex(context, tile, minX, maxY, scale, padding, draw) {
            const corners = hexCorners(tile).map(point => ({ x: (point.x - minX) * scale + padding, y: (maxY - point.y) * scale + padding }));
            context.save();
            context.beginPath();
            context.moveTo(corners[0].x, corners[0].y);
            for (let index = 1; index < corners.length; index++)
                context.lineTo(corners[index].x, corners[index].y);
            context.closePath();
            context.clip();
            draw();
            context.restore();
        }
        /**
         * Draw an existing source image inside a clipped local hex.
         */
        drawStaticTexture(context, imageId, tile, minX, maxY, scale, padding) {
            if (!imageId)
                return;
            const image = document.getElementById(imageId);
            if (!image || !image.complete || !image.naturalWidth)
                return;
            this.drawStaticHex(context, tile, minX, maxY, scale, padding, () => {
                const center = hexCenter(tile);
                const width = hexWidth * scale;
                context.drawImage(image, (center.x - hexWidth / 2 - minX) * scale + padding, (maxY - center.y - hexRadius) * scale + padding, width, width * 2 / Math.sqrt(3));
            });
        }
        /**
         * Draw static feature art or the simple approved placeholder marks.
         */
        drawStaticFeature(context, tile, minX, maxY, scale, padding) {
            const imageId = featureImages[tile.feature];
            if (imageId) {
                this.drawStaticTexture(context, imageId, tile, minX, maxY, scale, padding);
                return;
            }
            if (tile.feature === FeatureType.NoFeature)
                return;
            const center = hexCenter(tile);
            const x = (center.x - minX) * scale + padding;
            const y = (maxY - center.y) * scale + padding;
            if (tile.feature === FeatureType.Marsh || tile.feature === FeatureType.FloodPlains) {
                context.fillStyle = 'rgba(66, 104, 76, 0.35)';
                context.beginPath();
                context.ellipse(x, y, hexWidth * scale * 0.28, hexWidth * scale * 0.16, 0, 0, Math.PI * 2);
                context.fill();
            }
            else if (tile.feature === FeatureType.Oasis) {
                context.fillStyle = 'rgba(37, 130, 154, 0.75)';
                context.beginPath();
                context.arc(x, y, Math.max(2, hexWidth * scale * 0.12), 0, Math.PI * 2);
                context.fill();
            }
            else if (tile.feature === FeatureType.Atoll) {
                context.strokeStyle = 'rgba(226, 239, 221, 0.8)';
                context.lineWidth = Math.max(1, hexWidth * scale * 0.05);
                context.beginPath();
                context.arc(x, y, Math.max(2, hexWidth * scale * 0.18), 0, Math.PI * 2);
                context.stroke();
            }
            else if (tile.feature === FeatureType.CerroDePotosi || tile.feature === FeatureType.SriPada || tile.feature === FeatureType.MtSinai) {
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
        drawTerritory(tiles) {
            var _a;
            if (!this.context || !this.layers.territory.visible)
                return;
            for (const tile of tiles) {
                const state = this.turnState[tileKey(tile)];
                if (!(state === null || state === void 0 ? void 0 : state.owner))
                    continue;
                const color = ((_a = CivColors[state.owner]) === null || _a === void 0 ? void 0 : _a.territory) || [80, 80, 80];
                const water = tile.type === TileType.Coast || tile.type === TileType.Ocean;
                this.drawHex(tile, () => {
                    this.context.fillStyle = `rgba(${color.join(',')}, ${water ? 0.1 : 0.2})`;
                    this.context.fill();
                });
            }
        }
        /**
         * Draw water after territory so river color remains distinct from borders.
         */
        drawRivers() {
            if (!this.context || !this.layers.rivers.visible)
                return;
            const width = this.riverWidth();
            this.context.save();
            this.context.strokeStyle = 'rgba(74, 167, 202, 0.96)';
            this.context.lineWidth = width;
            this.context.lineCap = 'round';
            this.context.lineJoin = 'round';
            for (const river of this.rivers) {
                this.strokeSegment(river.points);
                if (river.seamPoints)
                    this.strokeSegment(river.seamPoints);
            }
            this.context.restore();
        }
        /**
         * Draw precomputed outward border segments using their owner's territory
         * color. Every segment is inset into its owner's hexagon by half the line
         * width, so both sides of a shared frontier stay visible side by side and
         * no stroke crosses a hexagon boundary. Segments that follow a river keep
         * the wider inset that leaves the water visible between the two stripes.
         */
        drawBorders() {
            var _a;
            if (!this.context || !this.layers.borders.visible)
                return;
            const borderWidth = this.lod === 'world' ? 1 : 2;
            this.context.save();
            this.context.lineWidth = borderWidth;
            this.context.lineCap = 'round';
            for (const segments of this.borderCache.values()) {
                for (const segment of segments) {
                    const color = this.highlightedCivs.has(segment.owner)
                        ? [255, 235, 59]
                        : ((_a = CivColors[segment.owner]) === null || _a === void 0 ? void 0 : _a.territory) || [120, 120, 120];
                    this.context.strokeStyle = `rgb(${color.join(',')})`;
                    const inset = segment.river ? this.riverWidth() / 2 + 1.5 : borderWidth / 2;
                    this.strokeSegment(insetEdgeToward(segment.points, hexCenter(segment.tile), inset / this.worldScale()));
                }
            }
            this.context.restore();
        }
        /**
         * Draw city dots and collision-filtered labels at local detail.
         */
        drawCities() {
            var _a;
            if (!this.context || !this.layers.cities.visible)
                return;
            const usedLabels = [];
            const markers = this.cityMarkers.slice().sort((left, right) => Number(this.selectedHex === tileKey(right.tile)) - Number(this.selectedHex === tileKey(left.tile)));
            for (const marker of markers) {
                const center = this.screenPoint(hexCenter(marker.tile));
                const radius = Math.max(2, Math.min(7, this.hexPixelWidth(marker.tile) * 0.12));
                const color = marker.owner ? ((_a = CivColors[marker.owner]) === null || _a === void 0 ? void 0 : _a.city) || [210, 210, 210] : [210, 210, 210];
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
        drawCityLabel(marker, center, radius, usedLabels) {
            if (!this.context)
                return;
            const fontSize = Math.max(12, Math.min(18, this.hexPixelWidth(marker.tile) * 0.28));
            this.context.font = `${fontSize}px EB Garamond, serif`;
            this.context.textAlign = 'left';
            this.context.textBaseline = 'middle';
            const width = this.context.measureText(marker.name).width;
            const box = { left: center.x + radius + 4, top: center.y - fontSize / 2, right: center.x + radius + 4 + width, bottom: center.y + fontSize / 2 };
            const selected = this.selectedHex === tileKey(marker.tile);
            if (!selected && usedLabels.some(other => box.left < other.right && box.right > other.left && box.top < other.bottom && box.bottom > other.top))
                return;
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
        drawGrid(tiles) {
            if (!this.context || !this.layers.grid.visible || this.lod === 'world')
                return;
            this.context.save();
            this.context.strokeStyle = 'rgba(35, 45, 45, 0.18)';
            this.context.lineWidth = 1;
            for (const tile of tiles)
                this.drawHex(tile, () => this.context.stroke());
            this.context.restore();
        }
        /**
         * Draw current-turn events and the selected plot above all map content.
         * Each highlighted group is drawn as one region: only the edges facing
         * unhighlighted neighbors are stroked, and each stroke is inset into the
         * highlighted hexagon, so the outline hugs the inside of the region and
         * never doubles up or bleeds into neighboring plots.
         */
        drawHighlights() {
            if (!this.context)
                return;
            if (this.layers.events.visible && this.eventHexes.size > 0) {
                this.drawHighlightRegion(this.eventHexes, this.lod === 'world' ? 0.8 : 3, this.lod === 'world' ? [1.5, 1.5] : [5, 4]);
            }
            if (this.layers.selection.visible && this.selectedHex) {
                this.drawHighlightRegion(new Set([this.selectedHex]), this.lod === 'world' ? 1 : 3, []);
            }
        }
        /**
         * Outline the boundary of a set of highlighted hexes with one shared style.
         * Edges shared with another highlighted hex are skipped so interior cell
         * boundaries disappear and the group reads as a single outlined shape.
         */
        drawHighlightRegion(keys, width, dash) {
            var _a;
            if (!this.context)
                return;
            this.context.save();
            this.context.strokeStyle = '#ffeb3b';
            this.context.lineWidth = width;
            this.context.setLineDash(dash);
            this.context.lineCap = 'round';
            for (const key of keys) {
                const [x, y] = key.split(',').map(Number);
                const tile = (_a = this.tiles[y]) === null || _a === void 0 ? void 0 : _a[x];
                if (!tile)
                    continue;
                for (const direction of directions) {
                    const neighbor = neighborFor(tile, direction, this.geometry);
                    if (neighbor && keys.has(tileKey(neighbor)))
                        continue;
                    const inset = width / 2 / this.worldScale();
                    this.strokeSegment(insetEdgeToward(edgeCorners(tile, direction), hexCenter(tile), inset));
                }
            }
            this.context.restore();
        }
        /**
         * Recompute changed tile borders and their neighbors, preserving unaffected paths.
         */
        updateBorders() {
            var _a, _b, _c;
            const changed = ownershipChanges(this.previousState, this.turnState);
            if (this.borderCache.size === 0) {
                for (const row of this.tiles)
                    for (const tile of row)
                        this.updateTileBorders(tile);
                return;
            }
            const affected = new Set();
            for (const key of changed) {
                const [x, y] = key.split(',').map(Number);
                if (!Number.isFinite(x) || !Number.isFinite(y))
                    continue;
                const tile = (_a = this.tiles[y]) === null || _a === void 0 ? void 0 : _a[x];
                if (!tile)
                    continue;
                affected.add(tileKey(tile));
                for (const direction of directions) {
                    const neighbor = neighborFor(tile, direction, this.geometry);
                    if (neighbor && ((_b = this.tiles[neighbor.y]) === null || _b === void 0 ? void 0 : _b[neighbor.x]))
                        affected.add(tileKey(neighbor));
                }
            }
            for (const key of affected) {
                const [x, y] = key.split(',').map(Number);
                const tile = (_c = this.tiles[y]) === null || _c === void 0 ? void 0 : _c[x];
                if (tile)
                    this.updateTileBorders(tile);
            }
        }
        /**
         * Rebuild one tile's outward segments from current ownership.
         */
        updateTileBorders(tile) {
            var _a;
            const state = this.turnState[tileKey(tile)];
            if (!(state === null || state === void 0 ? void 0 : state.owner)) {
                this.borderCache.delete(tileKey(tile));
                return;
            }
            const segments = [];
            for (const direction of directions) {
                const neighbor = neighborFor(tile, direction, this.geometry);
                const neighborOwner = neighbor ? (_a = this.turnState[tileKey(neighbor)]) === null || _a === void 0 ? void 0 : _a.owner : undefined;
                if (neighborOwner !== state.owner) {
                    segments.push({ points: edgeCorners(tile, direction), owner: state.owner, tile, river: this.riverKeys.has(sharedEdgeKey(tile, direction, this.geometry)) });
                }
            }
            this.borderCache.set(tileKey(tile), segments);
        }
        /**
         * Rebuild a compact city marker list once per turn instead of per frame.
         */
        updateCities() {
            var _a;
            this.cityMarkers = [];
            for (const [key, state] of Object.entries(this.turnState)) {
                if (!state.city)
                    continue;
                const [x, y] = key.split(',').map(Number);
                const tile = (_a = this.tiles[y]) === null || _a === void 0 ? void 0 : _a[x];
                if (tile)
                    this.cityMarkers.push({ tile, name: state.city, owner: state.owner });
            }
        }
        /**
         * Convert current-turn events to their highlighted plot keys once per turn.
         */
        eventKeysFor(events) {
            const keys = new Set();
            for (const event of events) {
                for (const tile of event.tiles || [])
                    keys.add(tileKey(tile));
                if (event.x !== undefined && event.y !== undefined)
                    keys.add(`${event.x},${event.y}`);
            }
            return keys;
        }
        /**
         * Build a tile polygon before drawing its supplied overlay content.
         */
        drawHex(tile, draw) {
            if (!this.context)
                return;
            const corners = hexCorners(tile).map(point => this.screenPoint(point));
            this.context.save();
            this.context.beginPath();
            this.context.moveTo(corners[0].x, corners[0].y);
            for (let index = 1; index < corners.length; index++)
                this.context.lineTo(corners[index].x, corners[index].y);
            this.context.closePath();
            draw();
            this.context.restore();
        }
        /**
         * Stroke an edge through the shared world-to-screen conversion.
         */
        strokeSegment(points) {
            if (!this.context)
                return;
            const first = this.screenPoint(points[0]);
            const second = this.screenPoint(points[1]);
            this.context.beginPath();
            this.context.moveTo(first.x, first.y);
            this.context.lineTo(second.x, second.y);
            this.context.stroke();
        }
        /**
         * Project a shared world point to CSS pixels in the Leaflet container.
         */
        screenPoint(point) {
            const origin = this.map.latLngToContainerPoint(this.latLngFromWorld({ x: 0, y: 0 }));
            const scale = this.worldScale();
            return { x: origin.x + point.x * scale, y: origin.y - point.y * scale };
        }
        /**
         * Measure a plot's projected width in CSS pixels for labels and markers.
         */
        hexPixelWidth(tile) {
            const center = hexCenter(tile);
            const left = this.screenPoint({ x: center.x - hexWidth / 2, y: center.y });
            const right = this.screenPoint({ x: center.x + hexWidth / 2, y: center.y });
            return Math.abs(right.x - left.x);
        }
        /**
         * Measure the current CSS pixels per shared world unit for raster blitting.
         */
        worldScale() {
            return Math.max(0.001, Math.pow(2, this.map.getZoom()));
        }
        /** Widen rivers continuously with the visible hex size, keeping world views light. */
        riverWidth() {
            return Math.max(0.8, Math.min(8, this.worldScale() * hexWidth * 0.1));
        }
        /**
         * Quantize static raster resolution so continuous Leaflet zoom does not
         * rebuild every visible terrain chunk for tiny camera scale changes.
         */
        quantizedScale() {
            return Math.min(64, Math.max(1, Math.round(this.worldScale() / 2) * 2));
        }
        /**
         * Rebuild only static chunks when a source image finishes loading after the
         * map has already appeared, avoiding a permanently blank cached texture.
         */
        bindAssetRefresh() {
            const imageIds = new Set([...Object.values(terrainImages), ...Object.values(reliefImages), ...Object.values(featureImages)]);
            for (const imageId of imageIds) {
                const image = document.getElementById(imageId);
                if (!image || image.complete)
                    continue;
                const handler = () => {
                    this.staticCache.clear();
                    this.scheduleRender();
                };
                image.addEventListener('load', handler, { once: true });
                this.assetLoadHandlers.push({ image, handler });
            }
        }
    }

    /**
     * Leaflet entry point for the replay map.
     * Navigation stays in Leaflet while one viewport canvas composites every
     * visible map concern through ViewportLayer.
     */
    /**
     * Own the Leaflet camera and connect the session to the one-canvas renderer.
     */
    class ReplayMap {
        /** Create the Leaflet camera in flat map coordinates. */
        constructor() {
            this.turn = -1;
            this.layers = {};
            this.session = null;
            this.mapBounds = [];
            this.events = [];
            this.renderer = null;
            this.unsubscribeSession = null;
            this.highlightedCivs = new Set();
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
        initLayers(session) {
            var _a;
            this.removeRenderer();
            this.session = session;
            this.events = session.replay.events;
            const tiles = session.replay.tiles;
            const hasRivers = session.replay.dataKinds.rivers === 'history';
            this.renderer = new ViewportLayer(tiles, this.events, Boolean((_a = session.replay.mapHeader) === null || _a === void 0 ? void 0 : _a.wrapX), hasRivers);
            this.layers = this.renderer.layers;
            this.renderer.addTo(this.map);
            this.updateBounds(tiles);
            this.unsubscribeSession = session.subscribe((turn, state) => this.renderTurn(turn, state));
        }
        /**
         * Return renderer flags for the layers picker without manufacturing Leaflet layers.
         */
        getToggleableLayers() {
            return this.layers;
        }
        /**
         * Forward the already materialized session state to the current renderer.
         */
        renderTurn(turn, state) {
            if (!this.session || !this.renderer)
                return;
            this.turn = turn;
            this.turnState = state || this.session.stateAt(turn);
            this.renderer.setTurn(turn, this.turnState);
        }
        /**
         * Detach the session and clear transient selection and event highlighting.
         */
        resetTurnState() {
            var _a;
            this.turn = -1;
            this.turnState = undefined;
            if (this.unsubscribeSession)
                this.unsubscribeSession();
            this.unsubscribeSession = null;
            this.session = null;
            this.events = [];
            this.highlightedCivs.clear();
            (_a = this.renderer) === null || _a === void 0 ? void 0 : _a.clearHighlights();
        }
        /**
         * Remove the current canvas layer and release its cached geography.
         */
        removeRenderer() {
            if (this.unsubscribeSession)
                this.unsubscribeSession();
            this.unsubscribeSession = null;
            if (this.renderer)
                this.map.removeLayer(this.renderer);
            this.renderer = null;
            this.layers = {};
        }
        /**
         * Select the first supplied hex for compatibility with existing callers.
         */
        highlightHexes(hexKeys) {
            var _a;
            (_a = this.renderer) === null || _a === void 0 ? void 0 : _a.setSelectedHex(hexKeys[0] || null);
        }
        /**
         * Preserve legacy additive highlighting semantics for a single selection.
         */
        addHighlightedHexes(hexKeys) {
            var _a, _b;
            if (!((_a = this.renderer) === null || _a === void 0 ? void 0 : _a.getSelectedHex()))
                (_b = this.renderer) === null || _b === void 0 ? void 0 : _b.setSelectedHex(hexKeys[0] || null);
        }
        /**
         * Clear selection when a caller removes the selected tile.
         */
        removeHighlightedHexes(hexKeys) {
            var _a, _b;
            if (hexKeys.includes(((_a = this.renderer) === null || _a === void 0 ? void 0 : _a.getSelectedHex()) || ''))
                (_b = this.renderer) === null || _b === void 0 ? void 0 : _b.setSelectedHex(null);
        }
        /**
         * Clear the selected plot overlay.
         */
        clearHexHighlights() {
            var _a;
            (_a = this.renderer) === null || _a === void 0 ? void 0 : _a.setSelectedHex(null);
        }
        /**
         * Replace the civilization border highlight set.
         */
        highlightCivBoundaries(civNames) {
            var _a;
            this.highlightedCivs = new Set(civNames);
            (_a = this.renderer) === null || _a === void 0 ? void 0 : _a.setHighlightedCivs(Array.from(this.highlightedCivs));
        }
        /**
         * Keep the existing public additive method available to callers.
         */
        addHighlightedCivs(civNames) {
            var _a;
            for (const civName of civNames)
                this.highlightedCivs.add(civName);
            (_a = this.renderer) === null || _a === void 0 ? void 0 : _a.setHighlightedCivs(Array.from(this.highlightedCivs));
        }
        /**
         * Clear civilization highlights through the one-canvas renderer.
         */
        removeHighlightedCivs(civNames) {
            var _a;
            for (const civName of civNames)
                this.highlightedCivs.delete(civName);
            (_a = this.renderer) === null || _a === void 0 ? void 0 : _a.setHighlightedCivs(Array.from(this.highlightedCivs));
        }
        /**
         * Clear every civilization border highlight.
         */
        clearCivHighlights() {
            var _a;
            this.highlightedCivs.clear();
            (_a = this.renderer) === null || _a === void 0 ? void 0 : _a.setHighlightedCivs([]);
        }
        /**
         * Retain the old public method while renderer colors stay fixed.
         */
        setHighlightColors(_hexColor, _boundaryColor, _eventColor) {
            // Renderer colors remain fixed so rivers, borders, and events stay distinct.
        }
        /**
         * Fit the flat shared-coordinate map bounds into the current container.
         */
        fitMap() {
            if (!this.map || !this.mapBounds.length)
                return;
            const container = this.map.getContainer();
            if (container)
                container.offsetHeight;
            this.map.invalidateSize(false);
            this.map.fitBounds(this.mapBounds, { padding: [30, 30], animate: false });
        }
        /**
         * Ask Leaflet to remeasure without changing camera position.
         */
        invalidateSize() {
            if (this.map)
                this.map.invalidateSize(false);
        }
        /**
         * Build bounds with the same flat hex centers used by rendering and picking.
         */
        updateBounds(tiles) {
            var _a;
            const height = Math.max(1, tiles.length);
            const width = Math.max(1, ((_a = tiles[0]) === null || _a === void 0 ? void 0 : _a.length) || 1);
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

    /**
     * strategy-parser.ts
     * Parses strategy change events and formats them for display
     */
    /**
     * Configurable patterns for different strategy change types
     * Add new patterns here to support additional event types
     */
    const PATTERN_CONFIGS = [
        {
            type: 'strategies',
            prefix: 'Changed strategies:',
            isComplex: true
        },
        {
            type: 'persona',
            prefix: 'Changed persona values:',
            isComplex: true
        },
        {
            type: 'research',
            prefix: 'Changed next research:',
            displayLabel: 'Next Research'
        },
        {
            type: 'policy_branch',
            prefix: 'Changed next policy branch:',
            displayLabel: 'Next Policy Branch'
        },
        {
            type: 'policy',
            prefix: 'Changed next policy:',
            displayLabel: 'Next Policy'
        }
    ];
    /**
     * Parse rationale from text
     * Extracts the rationale portion after "Rationale:" marker
     */
    function parseRationale(text) {
        const rationaleMatch = text.match(/\.\s*Rationale:\s*(.+?)$/);
        if (rationaleMatch) {
            const mainText = text.substring(0, rationaleMatch.index);
            const rationale = rationaleMatch[1].trim();
            return { mainText, rationale };
        }
        return { mainText: text, rationale: null };
    }
    /**
     * Parse complex strategy changes from the main text
     * Handles format: "GrandStrategy: None → Conquest; EconomicStrategies: [None] → [EarlyExpansion]"
     */
    function parseComplexChanges(text) {
        const changes = [];
        // Split by semicolon to get individual strategy changes
        const parts = text.split(';');
        for (const part of parts) {
            const colonIndex = part.indexOf(':');
            if (colonIndex === -1)
                continue;
            const key = part.substring(0, colonIndex).trim();
            const values = part.substring(colonIndex + 1).trim();
            // Look for arrow
            const arrowMatch = values.match(/(.+?)\s*→\s*(.+)/);
            if (arrowMatch) {
                changes.push({
                    key: key,
                    from: arrowMatch[1].trim(),
                    to: arrowMatch[2].trim()
                });
            }
        }
        return changes;
    }
    /**
     * Parse a simple change
     * Handles format: "None → Pottery" or "None → Tradition"
     */
    function parseSimpleChange(text, displayLabel) {
        const arrowMatch = text.match(/(.+?)\s*→\s*(.+)/);
        if (arrowMatch) {
            return [{
                    key: displayLabel,
                    from: arrowMatch[1].trim(),
                    to: arrowMatch[2].trim()
                }];
        }
        return [];
    }
    /**
     * Parse strategy event text containing arrow notation
     * Returns null if the text doesn't match expected patterns
     */
    function parseStrategyEvent(text) {
        // Check if text contains arrow notation
        if (!text.includes('→')) {
            return null;
        }
        // First, extract rationale if present
        const { mainText, rationale } = parseRationale(text);
        // Try each configured pattern
        for (const config of PATTERN_CONFIGS) {
            if (mainText.startsWith(config.prefix)) {
                const contentText = mainText.substring(config.prefix.length).trim();
                let changes;
                if (config.isComplex) {
                    // Complex pattern with multiple possible changes
                    changes = parseComplexChanges(contentText);
                }
                else {
                    // Simple pattern with single change
                    changes = parseSimpleChange(contentText, config.displayLabel);
                }
                if (changes.length > 0) {
                    return {
                        type: config.type,
                        changes,
                        rationale
                    };
                }
            }
        }
        // Fallback: try to parse as generic strategy changes if it has colons and arrows
        if (mainText.includes(':') && mainText.includes('→')) {
            const changes = parseComplexChanges(mainText);
            if (changes.length > 0) {
                return {
                    type: 'other',
                    changes,
                    rationale
                };
            }
        }
        return null;
    }
    /**
     * Create DOM elements for a parsed strategy event
     */
    function renderStrategyEvent(parsed) {
        const container = document.createElement('div');
        container.className = 'strategy-change';
        // Render each change
        parsed.changes.forEach(change => {
            const item = document.createElement('div');
            item.className = 'strategy-change-item';
            // Key
            const keyEl = document.createElement('span');
            keyEl.className = 'strategy-key';
            keyEl.textContent = change.key + ':';
            item.appendChild(keyEl);
            // From value
            const fromEl = document.createElement('span');
            fromEl.className = 'strategy-from';
            fromEl.textContent = change.from;
            item.appendChild(fromEl);
            // Arrow
            const arrowEl = document.createElement('span');
            arrowEl.className = 'strategy-arrow';
            arrowEl.textContent = '→';
            item.appendChild(arrowEl);
            // To value
            const toEl = document.createElement('span');
            toEl.className = 'strategy-to';
            toEl.textContent = change.to;
            item.appendChild(toEl);
            container.appendChild(item);
        });
        // Render rationale if present
        if (parsed.rationale) {
            const rationaleEl = document.createElement('div');
            rationaleEl.className = 'strategy-rationale';
            const label = document.createElement('span');
            label.className = 'rationale-label';
            label.textContent = 'Rationale: ';
            rationaleEl.appendChild(label);
            const text = document.createElement('span');
            text.textContent = parsed.rationale;
            rationaleEl.appendChild(text);
            container.appendChild(rationaleEl);
        }
        return container;
    }

    /**
     * text-formatter.ts
     * Formats game text with icons and colors
     * Converts game-specific markup to HTML with Font Awesome icons and styled spans
     */
    /**
     * Mapping of game icons to Font Awesome icon classes (v4.4.0)
     * Based on Civilization V icon conventions
     */
    const ICON_MAP = {
        // Resources and Yields
        'ICON_FOOD': 'fa-leaf',
        'ICON_PRODUCTION': 'fa-cog',
        'ICON_GOLD': 'fa-circle', // Will style as gold coin
        'ICON_RESEARCH': 'fa-flask',
        'ICON_SCIENCE': 'fa-flask',
        'ICON_CULTURE': 'fa-music',
        'ICON_PEACE': 'fa-dove', // Faith/Religion icon
        'ICON_FAITH': 'fa-star',
        'ICON_HAPPINESS': 'fa-smile-o',
        'ICON_HAPPINESS_1': 'fa-smile-o',
        'ICON_HAPPINESS_2': 'fa-smile-o',
        'ICON_HAPPINESS_3': 'fa-smile-o',
        'ICON_HAPPINESS_4': 'fa-smile-o',
        'ICON_UNHAPPY': 'fa-frown-o',
        'ICON_GOLDEN_AGE': 'fa-sun',
        'ICON_GREAT_PEOPLE': 'fa-user',
        'ICON_GREAT_PERSON': 'fa-user',
        'ICON_TOURISM': 'fa-suitcase',
        'ICON_INFLUENCE': 'fa-star-o',
        // Military
        'ICON_STRENGTH': 'fa-shield',
        'ICON_RANGED_STRENGTH': 'fa-crosshairs',
        'ICON_MOVES': 'fa-arrows',
        'ICON_MOVEMENT': 'fa-arrows',
        'ICON_HP': 'fa-heart',
        // City and Territory
        'ICON_CITIZEN': 'fa-user',
        'ICON_CAPITAL': 'fa-star', // Capital star
        'ICON_CITY': 'fa-building-o',
        'ICON_OCCUPIED': 'fa-flag',
        'ICON_BLOCKADED': 'fa-ban',
        'ICON_POPULATION': 'fa-users',
        // Trade and Diplomacy
        'ICON_TRADE': 'fa-exchange',
        'ICON_TRADE_ROUTE': 'fa-road',
        'ICON_INTERNATIONAL_TRADE': 'fa-globe',
        'ICON_CARGO_SHIP': 'fa-ship',
        'ICON_CARAVAN': 'fa-truck',
        // Units
        'ICON_WORKER': 'fa-wrench',
        'ICON_SPY': 'fa-user-secret',
        'ICON_MISSIONARY': 'fa-book',
        'ICON_GREAT_GENERAL': 'fa-star',
        'ICON_GREAT_ADMIRAL': 'fa-anchor',
        // Improvements and Buildings
        'ICON_GREAT_WORK': 'fa-picture-o',
        'ICON_ARTIFACT': 'fa-archive',
        'ICON_WONDER': 'fa-university',
        // Default fallback
        'DEFAULT': 'fa-circle-o'
    };
    /**
     * Color definitions for text styling
     */
    const COLOR_MAP = {
        // Positive/Negative
        'COLOR_POSITIVE_TEXT': '#4CAF50',
        'COLOR_NEGATIVE_TEXT': '#F44336',
        'COLOR_WARNING_TEXT': '#FF9800',
        'COLOR_HIGHLIGHT_TEXT': '#FFD700',
        // Player colors
        'COLOR_PLAYER_BLUE_TEXT': '#2196F3',
        'COLOR_PLAYER_RED_TEXT': '#FF5252',
        'COLOR_PLAYER_GREEN_TEXT': '#66BB6A',
        'COLOR_PLAYER_YELLOW_TEXT': '#FFC107',
        'COLOR_PLAYER_PURPLE_TEXT': '#9C27B0',
        'COLOR_PLAYER_CYAN_TEXT': '#00BCD4',
        'COLOR_PLAYER_ORANGE_TEXT': '#FF9800',
        'COLOR_PLAYER_PINK_TEXT': '#E91E63',
        // Yield-specific colors
        'COLOR_YIELD_FOOD': '#8BC34A',
        'COLOR_YIELD_GOLD': '#FFC107',
        'COLOR_YIELD_PRODUCTION': '#FF9800',
        'COLOR_YIELD_SCIENCE': '#00BCD4',
        'COLOR_YIELD_CULTURE': '#9C27B0',
        'COLOR_YIELD_FAITH': '#FFFFC8',
        // Basic colors
        'COLOR_WHITE': '#FFFFFF',
        'COLOR_BLACK': '#000000',
        'COLOR_GREEN': '#4CAF50',
        'COLOR_RED': '#F44336',
        'COLOR_BLUE': '#2196F3',
        'COLOR_YELLOW': '#FFC107',
        // Game-specific colors (legacy)
        'COLOR_SCIENCE_TEXT': '#00BCD4',
        'COLOR_CULTURE_TEXT': '#9C27B0',
        'COLOR_GOLD_TEXT': '#FFC107',
        'COLOR_FAITH_TEXT': '#FFFFC8',
        'COLOR_PRODUCTION_TEXT': '#FF9800',
        'COLOR_FOOD_TEXT': '#8BC34A',
        // Default
        'COLOR_DEFAULT': '#FFFFC8'
    };
    /**
     * Parse and format text with game markup
     * Converts [ICON_XXX], [COLOR_XXX]...[ENDCOLOR], and other markup to HTML
     */
    function formatGameText(text) {
        const container = document.createElement('div');
        container.className = 'formatted-text';
        // Process the text in segments
        let remaining = text;
        let currentParent = container;
        while (remaining.length > 0) {
            // Check for color tags
            const colorMatch = remaining.match(/\[([A-Z_]+)\](.*?)\[END\1\]/);
            if (colorMatch && remaining.indexOf(colorMatch[0]) === 0) {
                const [fullMatch, colorTag, content] = colorMatch;
                // Create colored span
                const coloredSpan = document.createElement('span');
                coloredSpan.className = 'colored-text';
                const color = COLOR_MAP[colorTag] || COLOR_MAP['COLOR_DEFAULT'];
                coloredSpan.style.color = color;
                // Process content within color tags for icons
                processTextSegment(content, coloredSpan);
                currentParent.appendChild(coloredSpan);
                remaining = remaining.substring(fullMatch.length);
                continue;
            }
            // Alternative color format: [COLOR_XXX]...[ENDCOLOR]
            const altColorMatch = remaining.match(/\[(COLOR_[A-Z_]+)\](.*?)\[ENDCOLOR\]/);
            if (altColorMatch && remaining.indexOf(altColorMatch[0]) === 0) {
                const [fullMatch, colorTag, content] = altColorMatch;
                // Create colored span
                const coloredSpan = document.createElement('span');
                coloredSpan.className = 'colored-text';
                const color = COLOR_MAP[colorTag] || COLOR_MAP['COLOR_DEFAULT'];
                coloredSpan.style.color = color;
                // Process content within color tags for icons
                processTextSegment(content, coloredSpan);
                currentParent.appendChild(coloredSpan);
                remaining = remaining.substring(fullMatch.length);
                continue;
            }
            // Check for icon tags
            const iconMatch = remaining.match(/\[(ICON_[A-Z_0-9]+)\]/);
            if (iconMatch && remaining.indexOf(iconMatch[0]) === 0) {
                const [fullMatch, iconTag] = iconMatch;
                // Create icon element
                const icon = createIconElement(iconTag);
                currentParent.appendChild(icon);
                remaining = remaining.substring(fullMatch.length);
                continue;
            }
            // Find next special tag
            const nextIconIndex = remaining.search(/\[ICON_[A-Z_0-9]+\]/);
            const nextColorIndex = remaining.search(/\[(COLOR_[A-Z_]+|[A-Z_]+)\]/);
            let nextSpecialIndex = -1;
            if (nextIconIndex >= 0 && nextColorIndex >= 0) {
                nextSpecialIndex = Math.min(nextIconIndex, nextColorIndex);
            }
            else if (nextIconIndex >= 0) {
                nextSpecialIndex = nextIconIndex;
            }
            else if (nextColorIndex >= 0) {
                nextSpecialIndex = nextColorIndex;
            }
            // Add plain text up to next special tag
            if (nextSpecialIndex > 0) {
                const textNode = document.createTextNode(remaining.substring(0, nextSpecialIndex));
                currentParent.appendChild(textNode);
                remaining = remaining.substring(nextSpecialIndex);
            }
            else if (nextSpecialIndex === -1) {
                // No more special tags, add rest as text
                const textNode = document.createTextNode(remaining);
                currentParent.appendChild(textNode);
                remaining = '';
            }
            else {
                // Should not reach here, but handle edge case
                remaining = remaining.substring(1);
            }
        }
        return container;
    }
    /**
     * Process a text segment for icons only (used within colored spans)
     */
    function processTextSegment(text, parent) {
        let remaining = text;
        while (remaining.length > 0) {
            const iconMatch = remaining.match(/\[(ICON_[A-Z_0-9]+)\]/);
            if (iconMatch && remaining.indexOf(iconMatch[0]) === 0) {
                const [fullMatch, iconTag] = iconMatch;
                // Create icon element
                const icon = createIconElement(iconTag);
                parent.appendChild(icon);
                remaining = remaining.substring(fullMatch.length);
            }
            else {
                // Find next icon
                const nextIconIndex = remaining.search(/\[ICON_[A-Z_0-9]+\]/);
                if (nextIconIndex > 0) {
                    const textNode = document.createTextNode(remaining.substring(0, nextIconIndex));
                    parent.appendChild(textNode);
                    remaining = remaining.substring(nextIconIndex);
                }
                else {
                    // No more icons, add rest as text
                    const textNode = document.createTextNode(remaining);
                    parent.appendChild(textNode);
                    remaining = '';
                }
            }
        }
    }
    /**
     * Create an icon element for a given icon tag
     */
    function createIconElement(iconTag) {
        const iconClass = ICON_MAP[iconTag] || ICON_MAP['DEFAULT'];
        const icon = document.createElement('i');
        icon.className = `fa ${iconClass} game-icon`;
        icon.setAttribute('aria-label', iconTag.replace('ICON_', '').toLowerCase().replace(/_/g, ' '));
        icon.setAttribute('title', iconTag.replace('ICON_', '').replace(/_/g, ' ').toLowerCase());
        // Add specific styling based on icon type
        if (iconTag === 'ICON_GOLD') {
            icon.style.color = '#FFC107';
        }
        else if (iconTag === 'ICON_SCIENCE' || iconTag === 'ICON_RESEARCH') {
            icon.style.color = '#00BCD4';
        }
        else if (iconTag === 'ICON_CULTURE') {
            icon.style.color = '#9C27B0';
        }
        else if (iconTag === 'ICON_FAITH' || iconTag === 'ICON_PEACE') {
            icon.style.color = '#FFFFC8';
        }
        else if (iconTag === 'ICON_PRODUCTION') {
            icon.style.color = '#FF9800';
        }
        else if (iconTag === 'ICON_FOOD') {
            icon.style.color = '#8BC34A';
        }
        else if (iconTag.includes('ICON_HAPPINESS')) {
            icon.style.color = '#FFD700';
        }
        else if (iconTag === 'ICON_UNHAPPY') {
            icon.style.color = '#F44336';
        }
        else if (iconTag === 'ICON_GOLDEN_AGE') {
            icon.style.color = '#FFD700';
        }
        return icon;
    }
    /**
     * Check if text contains game markup
     */
    function hasGameMarkup(text) {
        return /\[(ICON_[A-Z_0-9]+|COLOR_[A-Z_]+|ENDCOLOR)\]/.test(text);
    }

    /**
     * annotations.ts
     * Civilization annotations supplied through the address bar
     *
     * A shared link can label each civilization with who was playing it, for
     * example "?player0=Qwen&player1=GLM". Player numbering starts at zero, so
     * player0 annotates the first civilization in the file, player1 the second,
     * and so on. The annotations appear next to civilization names in the event
     * log and as a summary line in the header.
     *
     * The same family carries the winner parameter, which asserts who won a
     * game whose file cannot prove the result, for example a save taken one
     * turn before the game was won.
     */
    // Matches playerN URL parameters, capturing the civilization id N
    const playerParamPattern = /^player(\d+)$/;
    // Longest annotation we accept, so headers and log entries stay readable
    const maxAnnotationLength = 40;
    /**
     * Parse playerN parameters (player0, player1, ...) into a civ id to label map
     * @param params The URL search parameters to read from
     * @returns The parsed annotations, empty when none are present
     */
    function parseCivAnnotations(params) {
        const annotations = {};
        params.forEach((value, key) => {
            const match = playerParamPattern.exec(key);
            if (!match) {
                return;
            }
            // URLSearchParams already decodes the value; trim and cap its length
            const label = value.trim().slice(0, maxAnnotationLength);
            if (!label) {
                return;
            }
            annotations[Number(match[1])] = label;
        });
        return annotations;
    }
    /**
     * Look up the annotation for a civilization id
     * @param annotations The parsed annotations
     * @param civId The civilization id to look up
     * @returns The annotation, or null when the civilization has none
     */
    function annotationFor(annotations, civId) {
        if (civId === undefined || !(civId in annotations)) {
            return null;
        }
        return annotations[civId];
    }
    /**
     * Build the header summary line, for example "Rome: GLM · Egypt: Qwen"
     * @param civNames Civilization names indexed by civilization id
     * @param annotations The parsed annotations
     * @returns The joined line, empty when no civilization is annotated
     */
    function formatAnnotationLine(civNames, annotations) {
        const parts = [];
        for (let civId = 0; civId < civNames.length; civId++) {
            const label = annotations[civId];
            if (label) {
                parts.push(`${civNames[civId]}: ${label}`);
            }
        }
        return parts.join(' · ');
    }
    /**
     * Resolve the winner parameter to a civilization id
     * A plain number is the civilization index, numbered like the playerN
     * parameters (player0 annotates civilization 0, so winner=0 names the same
     * civilization). Anything else is matched against those annotations, so
     * "winner=GLM" names the civilization that a playerN parameter labeled GLM
     * @param raw The winner parameter value, null when the link carries none
     * @param annotations The parsed playerN annotations
     * @param civCount The number of civilizations in the loaded file
     * @returns The civilization id, or -1 when the parameter is absent or names
     * no civilization of the loaded file
     */
    function resolveWinnerCivId(raw, annotations, civCount) {
        if (raw === null) {
            return -1;
        }
        const value = raw.trim().slice(0, maxAnnotationLength);
        if (!value) {
            return -1;
        }
        // A plain number addresses the civilization directly
        if (/^\d+$/.test(value)) {
            const civId = parseInt(value, 10);
            return civId >= 0 && civId < civCount ? civId : -1;
        }
        // Anything else must be one of the playerN labels
        for (const civId of Object.keys(annotations)) {
            const id = Number(civId);
            if (id < civCount && annotations[id] === value) {
                return id;
            }
        }
        return -1;
    }

    /**
     * event-log.ts
     * The event log in the side panel
     * Shows filtered events from the replay grouped by turn, follows the session,
     * and shows civilization annotations next to civilization names
     */
    // The event types the filter offers, in display order
    const filterableTypes = [
        { type: EventType.Message, label: 'Messages', icon: 'fa-comment-dots' },
        { type: EventType.Strategies, label: 'Strategies', icon: 'fa-chess-knight' },
        { type: EventType.CityFounded, label: 'New cities', icon: 'fa-city' },
        { type: EventType.CitiesTransferred, label: 'City transfers', icon: 'fa-right-left' },
        { type: EventType.CityRazed, label: 'City razings', icon: 'fa-fire' },
        { type: EventType.PantheonSelected, label: 'Pantheons', icon: 'fa-hands-praying' },
        { type: EventType.ReligionFounded, label: 'Religions', icon: 'fa-star-and-crescent' },
        { type: EventType.TilesClaimed, label: 'Tile claims', icon: 'fa-draw-polygon' }
    ];
    // Types shown when the log first appears: everything except tile claims,
    // which are noisy on large maps
    const defaultTypes = [
        EventType.Message,
        EventType.Strategies,
        EventType.CityFounded,
        EventType.CitiesTransferred,
        EventType.CityRazed,
        EventType.PantheonSelected,
        EventType.ReligionFounded
    ];
    /**
     * EventLog class
     * Renders the session's events and filters them by type
     */
    class EventLog {
        constructor(session, annotations = {}) {
            this.types = new Set();
            // Associations between DOM elements and their event data
            this.elementToEvent = new WeakMap();
            this.eventToElement = new Map();
            // Turn separator elements by turn, for scrolling
            this.turnSeparators = new Map();
            // Stops following the session
            this.unsubscribe = null;
            // Closes the filter dropdown on outside clicks
            this.outsideClickHandler = null;
            this.messagesEl = document.getElementById('logMessages');
            this.filterPanel = document.getElementById('filterPanel');
            this.filterDetails = document.getElementById('eventsFilter');
            this.filterCount = document.getElementById('filterCount');
            this.events = session.replay.events;
            this.replay = session.replay;
            this.annotations = annotations;
            this.buildFilter();
            this.renderEvents();
            // Follow the session: every turn change scrolls and activates the log
            this.unsubscribe = session.subscribe((turn) => this.renderTurn(turn));
        }
        /**
         * Stop following the session and empty the log, called when the session
         * is discarded
         */
        destroy() {
            if (this.unsubscribe) {
                this.unsubscribe();
                this.unsubscribe = null;
            }
            if (this.outsideClickHandler) {
                document.removeEventListener('click', this.outsideClickHandler);
                this.outsideClickHandler = null;
            }
            this.clear();
        }
        /**
         * Build the filter checkbox for every offered event type
         */
        buildFilter() {
            filterableTypes.forEach(entry => {
                const label = document.createElement('label');
                label.className = 'filter-option';
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.checked = defaultTypes.includes(entry.type);
                checkbox.addEventListener('change', () => {
                    if (checkbox.checked) {
                        this.types.add(entry.type);
                    }
                    else {
                        this.types.delete(entry.type);
                    }
                    this.updateFilterCount();
                    this.applyTypeFilter();
                });
                const icon = document.createElement('i');
                icon.className = `fa-solid ${entry.icon}`;
                icon.setAttribute('aria-hidden', 'true');
                const text = document.createElement('span');
                text.textContent = entry.label;
                label.appendChild(checkbox);
                label.appendChild(icon);
                label.appendChild(text);
                this.filterPanel.appendChild(label);
                if (checkbox.checked) {
                    this.types.add(entry.type);
                }
            });
            this.updateFilterCount();
            // Close the dropdown when clicking anywhere outside it
            this.outsideClickHandler = (e) => {
                if (this.filterDetails.open && !this.filterDetails.contains(e.target)) {
                    this.filterDetails.open = false;
                }
            };
            document.addEventListener('click', this.outsideClickHandler);
        }
        /**
         * Refresh the count shown on the filter button
         */
        updateFilterCount() {
            this.filterCount.textContent = this.types.size === filterableTypes.length
                ? 'All types'
                : `${this.types.size} types`;
        }
        /**
         * Apply the type filter to all message elements
         */
        applyTypeFilter() {
            const messages = this.messagesEl.querySelectorAll('.message');
            messages.forEach(msg => {
                const event = this.elementToEvent.get(msg);
                if (event && this.types.has(event.type)) {
                    msg.classList.remove('hidden');
                }
                else {
                    msg.classList.add('hidden');
                }
            });
        }
        /**
         * Create a message element for an event
         */
        renderEvent(event) {
            // Skip empty messages
            if (event.type === EventType.Message && !event.text) {
                return null;
            }
            const msg = document.createElement('li');
            msg.className = 'message';
            msg.dataset.type = String(event.type);
            msg.dataset.civId = String(event.civId || '');
            msg.dataset.turn = String(event.turn);
            // Add civilization header if civId exists
            if (event.civId !== undefined && event.civId >= 0) {
                const civName = this.replay.getCivName(event.civId);
                const civColor = this.replay.getCivColor(event.civId);
                if (civName) {
                    const civHeader = document.createElement('div');
                    civHeader.className = 'civ-header';
                    if (civColor) {
                        // Major civ: colored circle in the territory color
                        const circle = document.createElement('span');
                        circle.className = 'civ-circle';
                        circle.style.backgroundColor = `rgb(${civColor.territory[0]}, ${civColor.territory[1]}, ${civColor.territory[2]})`;
                        civHeader.appendChild(circle);
                    }
                    else {
                        // Minor civ: gray rectangle
                        const rect = document.createElement('span');
                        rect.className = 'civ-rectangle';
                        civHeader.appendChild(rect);
                    }
                    const civNameEl = document.createElement('span');
                    civNameEl.className = 'civ-name';
                    civNameEl.textContent = civName;
                    civHeader.appendChild(civNameEl);
                    // URL annotation for this civilization, e.g. "· GLM"
                    const annotation = annotationFor(this.annotations, event.civId);
                    if (annotation) {
                        const annotationEl = document.createElement('span');
                        annotationEl.className = 'civ-annotation';
                        annotationEl.textContent = `· ${annotation}`;
                        civHeader.appendChild(annotationEl);
                    }
                    msg.appendChild(civHeader);
                }
            }
            // Add event text
            if (event.text) {
                // Try to parse as strategy event first
                const parsed = parseStrategyEvent(event.text);
                if (parsed) {
                    // Render as formatted strategy change
                    const strategyElement = renderStrategyEvent(parsed);
                    msg.appendChild(strategyElement);
                }
                else if (hasGameMarkup(event.text)) {
                    // Text contains game markup (icons/colors)
                    const formattedElement = formatGameText(event.text);
                    formattedElement.classList.add('event-text');
                    msg.appendChild(formattedElement);
                }
                else {
                    // Render as plain text
                    const eventText = document.createElement('div');
                    eventText.className = 'event-text';
                    eventText.textContent = event.text;
                    msg.appendChild(eventText);
                }
            }
            // Store bidirectional association
            this.elementToEvent.set(msg, event);
            this.eventToElement.set(event, msg);
            // Apply the current filter
            if (!this.types.has(event.type)) {
                msg.classList.add('hidden');
            }
            return msg;
        }
        /**
         * Create a turn separator element
         */
        createTurnSeparator(turn) {
            const separator = document.createElement('div');
            separator.className = 'turn-separator';
            separator.dataset.turn = String(turn);
            separator.textContent = `Turn ${turn}`;
            return separator;
        }
        /**
         * Render all events grouped by turn
         */
        renderEvents() {
            this.clear();
            if (this.events.length === 0) {
                return;
            }
            const fragment = document.createDocumentFragment();
            // Find the range of turns that carry events
            let minTurn = Infinity;
            let maxTurn = -Infinity;
            this.events.forEach(event => {
                if (event.turn < minTurn)
                    minTurn = event.turn;
                if (event.turn > maxTurn)
                    maxTurn = event.turn;
            });
            // Handle the case where all events were empty and got filtered
            if (minTurn === Infinity || maxTurn === -Infinity) {
                return;
            }
            // Group events by turn
            const eventsByTurn = new Map();
            this.events.forEach(event => {
                // Skip empty message events
                if (event.type === EventType.Message && !event.text) {
                    return;
                }
                if (!eventsByTurn.has(event.turn)) {
                    eventsByTurn.set(event.turn, []);
                }
                eventsByTurn.get(event.turn).push(event);
            });
            // Create a separator for every turn in range, then its events
            for (let turn = minTurn; turn <= maxTurn; turn++) {
                const separator = this.createTurnSeparator(turn);
                this.turnSeparators.set(turn, separator);
                fragment.appendChild(separator);
                const turnEvents = eventsByTurn.get(turn) || [];
                turnEvents.forEach(event => {
                    const element = this.renderEvent(event);
                    if (element) {
                        fragment.appendChild(element);
                    }
                });
            }
            this.messagesEl.appendChild(fragment);
        }
        /**
         * Clear all events from the log
         */
        clear() {
            this.eventToElement.clear();
            this.turnSeparators.clear();
            // The WeakMap garbage collects itself
            this.messagesEl.innerHTML = '';
        }
        /**
         * Update the log for the session's turn: mark past events active and
         * scroll to the turn separator
         */
        renderTurn(turn) {
            const messages = this.messagesEl.querySelectorAll('.message');
            const separators = this.messagesEl.querySelectorAll('.turn-separator');
            // Update active state for messages
            messages.forEach(msg => {
                const msgTurn = parseInt(msg.dataset.turn || '0', 10);
                msg.classList.toggle('active', msgTurn <= turn);
            });
            // Update active state for turn separators
            separators.forEach(sep => {
                const sepTurn = parseInt(sep.dataset.turn || '0', 10);
                sep.classList.toggle('active', sepTurn <= turn);
            });
            // Scroll to the top when the timeline sits before the first event
            if (turn === 0) {
                this.messagesEl.scrollTop = 0;
                return;
            }
            // Otherwise put the turn's separator at the top of the list
            const turnSeparator = this.turnSeparators.get(turn);
            if (turnSeparator) {
                this.scrollToElement(turnSeparator);
            }
        }
        /**
         * Scroll to a specific element in the messages container
         */
        scrollToElement(element) {
            const containerRect = this.messagesEl.getBoundingClientRect();
            const elementRect = element.getBoundingClientRect();
            // Calculate the scroll position that puts the element at the top
            const relativeTop = elementRect.top - containerRect.top;
            const scrollOffset = this.messagesEl.scrollTop + relativeTop;
            this.messagesEl.scrollTop = Math.max(0, scrollOffset);
        }
        /**
         * Set visible event types based on a filter selection
         */
        setTypes(types) {
            this.types.clear();
            types.forEach(type => this.types.add(Number(type)));
            this.updateFilterCount();
            this.applyTypeFilter();
        }
        /**
         * Get event data for a message element
         */
        getEventData(element) {
            return this.elementToEvent.get(element);
        }
        /**
         * Get message element for an event
         */
        getElementForEvent(event) {
            return this.eventToElement.get(event);
        }
    }

    /**
     * control-bar.ts
     * The playback bar under the content area
     * Holds the transport buttons, a native range input for the timeline, and a
     * popover with a go-to field and the speed choice. The bar drives the game
     * session and follows it back, so turns changed anywhere stay in sync
     */
    // Available speeds, from slowest to "as fast as the browser allows"
    const speedOptions = [
        { label: '0.5x', interval: 2000, icon: 'fa-hourglass-half' },
        { label: '1x', interval: 1000, icon: 'fa-person-walking' },
        { label: '2x', interval: 500, icon: 'fa-person-running' },
        { label: '4x', interval: 250, icon: 'fa-bolt' },
        { label: 'Max', interval: 0, icon: 'fa-forward-fast' }
    ];
    // Index of the speed the bar starts with (1x)
    const defaultSpeedIndex = 1;
    /**
     * ControlBar class
     * @param config - Configuration with the turn range and the session
     */
    class ControlBar {
        constructor(config) {
            this.initialized = false; // Whether the DOM controls are bound
            this.keydownHandler = null; // Keyboard shortcuts
            this.outsideClickHandler = null; // Closes the popover
            this.unsubscribe = null; // Stops following the session
            // Allow construction without a config; initialize arrives with the session
            if (config) {
                this.initialize(config);
            }
        }
        /**
         * Initialize or reinitialize the bar with a new game session
         */
        initialize(config) {
            this.config = config;
            this.session = config.session;
            // Stop any running playback and follow the new session
            this.pause();
            if (this.unsubscribe) {
                this.unsubscribe();
            }
            this.unsubscribe = this.session.subscribe((turn) => this.syncFromSession(turn));
            // Bind the DOM controls once; later sessions only refresh the ranges
            if (!this.initialized) {
                this.bindControls();
                this.initialized = true;
            }
            // Point the range input and the labels at the new turn range
            this.turnRange.min = String(this.config.start);
            this.turnRange.max = String(this.config.end);
            this.turnRange.value = String(this.session.currentTurn);
            this.gotoInput.min = String(this.config.start);
            this.gotoInput.max = String(this.config.end);
            this.updateTurnLabels(this.session.currentTurn);
            this.hidePopover();
        }
        /**
         * Bind click, input, and keyboard handlers to the DOM controls
         */
        bindControls() {
            this.firstButton = document.getElementById('firstButton');
            this.prevButton = document.getElementById('prevButton');
            this.playPauseButton = document.getElementById('playPauseButton');
            this.nextButton = document.getElementById('nextButton');
            this.lastButton = document.getElementById('lastButton');
            this.turnRange = document.getElementById('turnRange');
            this.turnButton = document.getElementById('turnButton');
            this.turnLabelLong = document.getElementById('turnLabelLong');
            this.turnLabelShort = document.getElementById('turnLabelShort');
            this.speedChip = document.getElementById('speedChip');
            this.speedLabel = document.getElementById('speedLabel');
            this.turnPopover = document.getElementById('turnPopover');
            this.gotoForm = document.getElementById('gotoForm');
            this.gotoInput = document.getElementById('gotoInput');
            this.speedOptionsEl = document.getElementById('speedOptions');
            // Transport buttons
            this.firstButton.addEventListener('click', () => this.requestTurn(this.config.start));
            this.prevButton.addEventListener('click', () => this.step(-1));
            this.nextButton.addEventListener('click', () => this.step(1));
            this.lastButton.addEventListener('click', () => this.requestTurn(this.config.end));
            this.playPauseButton.addEventListener('click', () => this.togglePlay());
            // The range input drives the session while dragging
            this.turnRange.addEventListener('input', () => {
                this.requestTurn(Number(this.turnRange.value));
            });
            // Both the turn chip and the speed chip open the popover
            this.turnButton.addEventListener('click', () => this.togglePopover());
            this.speedChip.addEventListener('click', () => this.togglePopover());
            // The go-to form jumps to the entered turn
            this.gotoForm.addEventListener('submit', (e) => {
                e.preventDefault();
                const target = parseInt(this.gotoInput.value, 10);
                if (!Number.isNaN(target)) {
                    this.requestTurn(target);
                }
                this.hidePopover();
            });
            // Build the speed choices into the popover
            this.buildSpeedOptions();
            this.applySpeed(defaultSpeedIndex);
            // Playback shortcuts, skipped while typing in a form field
            this.keydownHandler = (e) => {
                if (!this.session) {
                    return;
                }
                const target = e.target;
                if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement ||
                    target instanceof HTMLSelectElement || target.isContentEditable) {
                    return;
                }
                switch (e.keyCode) {
                    case 32:
                        e.preventDefault();
                        this.togglePlay();
                        return; // space, canceled so a focused button does not also fire
                    case 33:
                        this.requestTurn(this.config.start);
                        return; // page up
                    case 34:
                        this.requestTurn(this.config.end);
                        return; // page down
                    case 35:
                        this.requestTurn(this.config.end);
                        return; // end
                    case 36:
                        this.requestTurn(this.config.start);
                        return; // home
                    case 37:
                        this.step(-1);
                        return; // left
                    case 39:
                        this.step(1);
                        return; // right
                    case 38:
                        this.step(-10);
                        return; // up
                    case 40:
                        this.step(10);
                        return; // down
                    case 49:
                        this.applySpeed(0);
                        return; // 1
                    case 50:
                        this.applySpeed(1);
                        return; // 2
                    case 51:
                        this.applySpeed(2);
                        return; // 3
                    case 52:
                        this.applySpeed(3);
                        return; // 4
                    case 53:
                        this.applySpeed(4);
                        return; // 5
                    default: return;
                }
            };
            document.addEventListener('keydown', this.keydownHandler);
            // Close the popover when clicking anywhere outside it or its chips
            this.outsideClickHandler = (e) => {
                if (!this.turnPopover.hidden && !this.turnPopover.contains(e.target) &&
                    !this.turnButton.contains(e.target) && !this.speedChip.contains(e.target)) {
                    this.hidePopover();
                }
            };
            document.addEventListener('click', this.outsideClickHandler);
            // Escape closes the popover
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && !this.turnPopover.hidden) {
                    this.hidePopover();
                }
            });
        }
        /**
         * Build one radio choice per speed option into the popover
         */
        buildSpeedOptions() {
            speedOptions.forEach((option, index) => {
                const label = document.createElement('label');
                label.className = 'speed-option';
                const radio = document.createElement('input');
                radio.type = 'radio';
                radio.name = 'playbackSpeed';
                radio.value = String(index);
                radio.addEventListener('change', () => this.applySpeed(index));
                const icon = document.createElement('i');
                icon.className = `fa-solid ${option.icon}`;
                icon.setAttribute('aria-hidden', 'true');
                const text = document.createElement('span');
                text.textContent = option.label;
                label.appendChild(radio);
                label.appendChild(icon);
                label.appendChild(text);
                this.speedOptionsEl.appendChild(label);
            });
        }
        /**
         * Move the session to a turn; its notification updates the bar and the views
         */
        requestTurn(turn) {
            if (!this.session) {
                return;
            }
            this.session.setTurn(turn);
        }
        /**
         * Track a turn that changed elsewhere, without re-triggering the range input
         */
        syncFromSession(turn) {
            if (String(turn) !== this.turnRange.value) {
                this.turnRange.value = String(turn);
            }
            this.updateTurnLabels(turn);
            // Stop playback when the timeline reaches the last turn
            if (this.playTimer && turn >= this.config.end) {
                this.pause();
            }
        }
        /**
         * Refresh the turn chips, long form on wide screens and bare number on phones
         */
        updateTurnLabels(turn) {
            this.turnLabelLong.textContent = `Turn ${turn} / ${this.config.end}`;
            this.turnLabelShort.textContent = String(turn);
        }
        /**
         * Step forward or backward by a number of turns, clamped to the range
         */
        step(step) {
            if (!this.session) {
                return;
            }
            const amount = step === undefined ? 1 : step;
            const target = this.session.currentTurn + amount;
            if (target < this.config.start) {
                this.requestTurn(this.config.start);
            }
            else if (target > this.config.end) {
                this.requestTurn(this.config.end);
            }
            else {
                this.requestTurn(target);
            }
        }
        /**
         * Start automatic playback
         */
        play() {
            if (this.playTimer || !this.session) {
                return;
            }
            // Playback that starts at the last turn restarts from the beginning
            if (this.session.currentTurn >= this.config.end) {
                this.requestTurn(this.config.start);
            }
            this.playTimer = setInterval(() => {
                this.step();
            }, this.playInterval);
            this.updatePlayButton();
        }
        /**
         * Pause automatic playback
         */
        pause() {
            if (!this.playTimer) {
                return;
            }
            clearInterval(this.playTimer);
            this.playTimer = null;
            this.updatePlayButton();
        }
        /**
         * Toggle between play and pause states
         */
        togglePlay() {
            if (this.playTimer) {
                this.pause();
            }
            else {
                this.play();
            }
        }
        /**
         * Point the play button's icon and label at the current playback state
         */
        updatePlayButton() {
            if (!this.playPauseButton) {
                return;
            }
            const icon = this.playPauseButton.querySelector('i');
            const playing = this.playTimer !== null;
            if (playing) {
                icon.className = 'fa-solid fa-pause';
                this.playPauseButton.setAttribute('aria-label', 'Pause');
            }
            else {
                icon.className = 'fa-solid fa-play';
                this.playPauseButton.setAttribute('aria-label', 'Play');
            }
            document.body.classList.toggle('playing', playing);
        }
        /**
         * Apply a speed option by index, refreshing the radios, the chip, and a running timer
         */
        applySpeed(index) {
            const clamped = Math.max(0, Math.min(Math.round(index), speedOptions.length - 1));
            this.speedIndex = clamped;
            this.playInterval = speedOptions[clamped].interval;
            this.speedLabel.textContent = speedOptions[clamped].label;
            // Keep the radios in the popover in sync, also when set via keyboard
            const radios = this.speedOptionsEl.querySelectorAll('input[name="playbackSpeed"]');
            radios.forEach(radio => {
                radio.checked = Number(radio.value) === clamped;
            });
            // A running timer picks up the new interval
            if (this.playTimer) {
                clearInterval(this.playTimer);
                this.playTimer = null;
                this.play();
            }
        }
        /**
         * Show or hide the turn and speed popover
         */
        togglePopover() {
            if (this.turnPopover.hidden) {
                this.turnPopover.hidden = false;
                this.turnButton.setAttribute('aria-expanded', 'true');
                this.speedChip.setAttribute('aria-expanded', 'true');
                this.gotoInput.value = String(this.session ? this.session.currentTurn : this.config.start);
                this.gotoInput.focus();
            }
            else {
                this.hidePopover();
            }
        }
        /**
         * Hide the popover and drop its open state from the chips
         */
        hidePopover() {
            if (!this.initialized) {
                return;
            }
            this.turnPopover.hidden = true;
            this.turnButton.setAttribute('aria-expanded', 'false');
            this.speedChip.setAttribute('aria-expanded', 'false');
        }
        /**
         * Clear the bar: stop playback and stop following the session
         */
        clear() {
            if (this.playTimer) {
                clearInterval(this.playTimer);
                this.playTimer = null;
            }
            if (this.unsubscribe) {
                this.unsubscribe();
                this.unsubscribe = null;
            }
            this.session = null;
            this.hidePopover();
            this.updatePlayButton();
        }
    }

    /**
     * layers-control.ts
     * The map's layer picker
     * A button on the map opens a dropdown panel with one checkbox per
     * toggleable layer. Checking a box changes a renderer visibility flag.
     * Replaces Leaflet's built-in layers control so the picker
     * matches the rest of the interface.
     */
    /**
     * LayersControl class
     * Builds and drives the layer checkbox panel
     */
    class LayersControl {
        constructor(map, layers) {
            this.outsideClickHandler = null; // Closes the panel
            this.map = map;
            this.layers = layers;
            this.panel = document.getElementById('layersPanel');
            this.details = document.getElementById('layersControl');
            this.buildPanel();
            // Close the panel when clicking anywhere outside it
            this.outsideClickHandler = (e) => {
                if (this.details.open && !this.details.contains(e.target)) {
                    this.details.open = false;
                }
            };
            document.addEventListener('click', this.outsideClickHandler);
        }
        /**
         * Build one checkbox row per layer into the panel
         */
        buildPanel() {
            this.layers.forEach(entry => {
                const label = document.createElement('label');
                label.className = 'layer-option';
                // Renderer flags start visible unless the map configuration disables them
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.checked = entry.layer.visible;
                checkbox.disabled = Boolean(entry.layer.disabled);
                if (entry.layer.disabledReason)
                    label.title = entry.layer.disabledReason;
                checkbox.addEventListener('change', () => {
                    entry.layer.setVisible(checkbox.checked);
                });
                const text = document.createElement('span');
                text.textContent = entry.layer.disabledReason ? `${entry.label} (${entry.layer.disabledReason})` : entry.label;
                label.appendChild(checkbox);
                label.appendChild(text);
                this.panel.appendChild(label);
            });
        }
        /**
         * Tear the control down when its session is discarded
         */
        destroy() {
            if (this.outsideClickHandler) {
                document.removeEventListener('click', this.outsideClickHandler);
                this.outsideClickHandler = null;
            }
            this.panel.innerHTML = '';
            this.details.open = false;
        }
    }

    /**
     * binary-parser.ts
     * Pure binary reader for Civilization V binary files
     * Wraps the native DataView API with little-endian defaults and position
     * tracking, with no dependency on external libraries or browser globals
     */
    class BinaryParser {
        /**
         * Create a reader over a file buffer
         * @param file The raw file contents
         * @param size Optional number of readable bytes, clamped to the buffer size
         */
        constructor(file, size) {
            this.view = new DataView(file);
            this.offset = 0;
            this.end = Math.min(size !== null && size !== void 0 ? size : file.byteLength, file.byteLength);
        }
        /**
         * Get the current read position in the buffer
         */
        tell() {
            return this.offset;
        }
        /**
         * Get the number of bytes left to read
         */
        remaining() {
            return this.end - this.offset;
        }
        /**
         * Move the read position to the given byte offset
         */
        seek(position) {
            this.offset = position;
        }
        /**
         * Verify that a read of the given length fits in the buffer
         */
        checkBounds(length) {
            if (this.offset < 0 || this.offset + length > this.end) {
                throw new Error(`Unable to read ${length} bytes at position ${this.decToHex(this.tell())}`);
            }
        }
        /**
         * Read raw bytes from the current position
         */
        getBytes(length) {
            this.checkBounds(length);
            const bytes = new Uint8Array(this.view.buffer, this.view.byteOffset + this.offset, length);
            this.offset += length;
            return bytes;
        }
        /**
         * Read a fixed-length string, decoding each byte as one character (latin1)
         * This preserves the raw bytes of non-ASCII text (the event mojibake repair
         * depends on it), so UTF-8 decoding must never be used here
         */
        getString(length) {
            const bytes = this.getBytes(length);
            let value = '';
            for (let i = 0; i < bytes.length; i++) {
                value += String.fromCharCode(bytes[i]);
            }
            return value;
        }
        /**
         * Read a 32-bit little-endian integer and advance past it
         */
        getInt32() {
            this.checkBounds(4);
            const value = this.view.getInt32(this.offset, true);
            this.offset += 4;
            return value;
        }
        /**
         * Read a 16-bit little-endian integer and advance past it
         */
        getInt16() {
            this.checkBounds(2);
            const value = this.view.getInt16(this.offset, true);
            this.offset += 2;
            return value;
        }
        /**
         * Read a 32-bit little-endian float and advance past it
         */
        getFloat32() {
            this.checkBounds(4);
            const value = this.view.getFloat32(this.offset, true);
            this.offset += 4;
            return value;
        }
        /**
         * Read an 8-bit integer and advance past it
         */
        getInt8() {
            this.checkBounds(1);
            const value = this.view.getInt8(this.offset);
            this.offset += 1;
            return value;
        }
        /**
         * Read single bytes until the given value is hit (the terminator is included)
         */
        getUntil(test) {
            const result = [];
            let val = null;
            do {
                val = this.getInt8();
                result.push(val);
            } while (val !== test);
            return result;
        }
        /**
         * Read a variable-length string: a 32-bit length prefix, then that many bytes
         */
        getVarString() {
            const length = this.getInt32();
            return this.getString(length);
        }
        /**
         * Convert a decimal number to a hexadecimal string (for debugging)
         */
        decToHex(dec) {
            // Arbitrary length decimal to hex conversion
            return parseInt(dec.toString()).toString(16).toUpperCase().padStart(2, '0');
        }
    }

    /**
     * base-parser.ts
     * General purpose, format-agnostic parser base for Civilization V binary files
     * A subclass supplies a FileConfig schema describing the binary layout of its
     * file format and gets schema-driven parsing in return: the replay parser and
     * the upcoming savegame parser both build on this class
     */
    class BaseParser {
        /**
         * Create a parser over a file buffer
         * @param file The raw file contents
         * @param size The size of the file data within the buffer
         * @param fileConfig Schema describing the binary layout of the file
         */
        constructor(file, size, fileConfig) {
            this.parser = new BinaryParser(file, size);
            this.fileConfig = fileConfig;
        }
        /**
         * Parse the whole file according to the schema
         * @param includeJunk Whether to include unknown/debug fields (keys prefixed with an underscore)
         */
        parse(includeJunk = false) {
            return this.parseItems(this.fileConfig, includeJunk);
        }
        /**
         * Get the current read position in the buffer
         */
        tell() {
            return this.parser.tell();
        }
        /**
         * Move the read position to the given byte offset
         */
        seek(position) {
            this.parser.seek(position);
        }
        /**
         * Read raw bytes from the current position
         */
        getBytes(length) {
            return this.parser.getBytes(length);
        }
        /**
         * Read a fixed-length string from the current position
         */
        getString(length) {
            return this.parser.getString(length);
        }
        /**
         * Read a variable-length string from the current position
         */
        getVarString() {
            return this.parser.getVarString();
        }
        /**
         * Read a 32-bit little-endian integer from the current position
         */
        getInt32() {
            return this.parser.getInt32();
        }
        /**
         * Read a 16-bit little-endian integer from the current position
         */
        getInt16() {
            return this.parser.getInt16();
        }
        /**
         * Read an 8-bit integer from the current position
         */
        getInt8() {
            return this.parser.getInt8();
        }
        /**
         * Read a 32-bit little-endian float from the current position
         */
        getFloat32() {
            return this.parser.getFloat32();
        }
        /**
         * Convert a decimal number to a hexadecimal string (for debugging)
         */
        decToHex(dec) {
            return this.parser.decToHex(dec);
        }
        /**
         * Parse a single schema entry
         * @param itemConfig A type name, a config object, or a custom function
         * @param includeJunk Whether to include unknown/debug fields
         */
        parseItem(itemConfig, includeJunk) {
            if (typeof itemConfig === 'string') {
                itemConfig = { type: itemConfig };
            }
            // Custom parse hooks run against this parser and may return a value
            if (typeof itemConfig === 'function') {
                return itemConfig.call(this);
            }
            const config = itemConfig;
            switch (config.type) {
                case 'byte': return this.parser.getBytes(config.length);
                case 'str': return this.parser.getString(config.length);
                case 'varstr': return this.parser.getVarString();
                case 'int32': return this.parser.getInt32();
                case 'int16': return this.parser.getInt16();
                case 'int8': return this.parser.getInt8();
                case 'float32': return this.parser.getFloat32();
                case 'until': return this.parser.getUntil(config.value);
                case 'tell': return this.tell();
                case 'array': return this.getArray(config.items, includeJunk);
                default:
                    return undefined;
            }
        }
        /**
         * Parse a dictionary of schema entries into a data object
         * @param itemConfigs A schema dictionary, or a nested array config
         * @param includeJunk Whether to include unknown/debug fields
         */
        parseItems(itemConfigs, includeJunk) {
            // An array config reads its own length prefix and recurses
            if ('type' in itemConfigs && itemConfigs.type === 'array') {
                return this.parseItem(itemConfigs, includeJunk);
            }
            // Otherwise we have a dictionary of named fields, parsed in order
            const data = {};
            Object.keys(itemConfigs).forEach((key) => {
                const pointer = this.tell();
                try {
                    const value = this.parseItem(itemConfigs[key], includeJunk);
                    // Bail if we don't want to include junk data
                    if (key.startsWith('_') && !includeJunk) {
                        return;
                    }
                    data[key] = value;
                }
                catch (e) {
                    // Seek back to the pointer before inspecting the damage
                    this.seek(pointer);
                    console.error(`Error parsing key "${key}" at position ${this.decToHex(pointer)}: ${e}`);
                    // Print the next 200 bytes and the data collected so far, but never
                    // let diagnostics mask the original error
                    try {
                        const bytes = this.getBytes(200);
                        const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
                        console.log(`Next 200 bytes: ${hex.toUpperCase()}`);
                        console.log(data);
                    }
                    catch (e2) {
                        // Not enough bytes left for diagnostics, nothing more to do
                    }
                    throw e;
                }
            });
            return data;
        }
        /**
         * Read an array: a 32-bit length prefix followed by that many records
         * @param config Schema for each record
         * @param includeJunk Whether to include unknown/debug fields
         */
        getArray(config, includeJunk) {
            const length = this.parser.getInt32();
            const records = [];
            for (let i = 0; i < length; i++) {
                let record = {};
                if (typeof config === 'function') {
                    record = config.call(this, i, includeJunk);
                }
                else if (typeof config === 'string') {
                    record = this.parseItem(config, includeJunk);
                }
                else if (typeof config === 'object') {
                    record = this.parseItems(config, includeJunk);
                }
                records.push(record);
            }
            return records;
        }
    }

    /**
     * replay-parser.ts
     * Parser for Civilization V (Vox Populi) replay files
     * Supplies the replay file schema to the general purpose BaseParser
     */
    /**
     * Default file configuration for Vox Populi replay files
     * Defines the binary structure and data types
     */
    const DEFAULT_FILE_CONFIG = {
        game: { type: 'str', length: 0x04 }, // CIV5
        _0: 'int32', // 01 00 00 00
        version: 'varstr',
        build: 'varstr',
        _1: { type: 'byte', length: 0x05 }, // 41 01 00 00 01 ?
        playerCiv: 'varstr',
        difficulty: 'varstr',
        eraStart: 'varstr',
        eraEnd: 'varstr',
        gameSpeed: 'varstr',
        worldSize: 'varstr',
        mapScript: 'varstr',
        dlc: {
            type: 'array',
            items: {
                id: { type: 'str', length: 0x10 },
                enabled: 'int32',
                name: 'varstr'
            }
        },
        mods: {
            type: 'array',
            items: {
                id: 'varstr',
                version: 'int32',
                name: 'varstr'
            }
        },
        _2: 'varstr', // 00 00 00 00
        _3: 'varstr', // 00 00 00 00
        playerColor: 'varstr',
        // 4 bytes for Vox Populi - not sure why, instead of 8
        _4: { type: 'byte', length: 4 },
        mapScript2: 'varstr',
        _5: function () {
            // Heuristic to get around something I don't understand :-(
            // This section still stumps me - it's variable length, but doesn't
            // seem to follow the conventions of the rest of the file.
            let unknown = 0;
            while (Math.abs(unknown) < 100000) {
                unknown = this.getInt32();
            }
            // We've hit the start year, need to rewind
            this.seek(this.tell() - 7);
            console.log(`Found the start year: ${this.decToHex(this.tell())}`);
        },
        startTurn: 'int32',
        startYear: 'int32',
        endTurn: 'int32',
        endYear: 'varstr',
        zeroStartYear: 'int32',
        zeroEndYear: 'int32',
        civs: {
            type: 'array',
            items: {
                _1: 'int32',
                _2: 'int32',
                _3: 'int32',
                _4: 'int32',
                leader: 'varstr',
                longName: 'varstr',
                name: 'varstr',
                demonym: 'varstr'
            }
        },
        datasets: {
            type: 'array',
            items: {
                key: 'varstr'
            }
        },
        datasetValues: {
            type: 'array',
            items: {
                type: 'array',
                items: {
                    type: 'array',
                    items: {
                        turn: 'int32',
                        value: 'int32'
                    }
                }
            }
        },
        // _7: 'int32', // this is not present in VP saves
        events: {
            type: 'array',
            items: {
                turn: 'int32',
                type: 'int32',
                tiles: {
                    type: 'array',
                    items: {
                        x: 'int16',
                        y: 'int16'
                    }
                },
                civId: 'int32',
                text: 'varstr'
            }
        },
        mapWidth: 'int32',
        mapHeight: 'int32',
        tiles: {
            type: 'array',
            items: {
                _1: 'int32', // always 1?
                _2: 'int32', // always 267?
                elevation: 'int8',
                type: 'int8',
                feature: 'int8',
                _5: 'int8'
            }
        }
    };
    /**
     * ReplayParser class
     * Parses binary replay files using the Civ5 replay schema
     */
    class ReplayParser extends BaseParser {
        /**
         * Create a replay parser
         * @param file The raw replay file contents
         * @param size The size of the replay data within the buffer
         * @param fileConfig Optional schema override
         */
        constructor(file, size, fileConfig) {
            super(file, size, fileConfig !== null && fileConfig !== void 0 ? fileConfig : DEFAULT_FILE_CONFIG);
        }
        /**
         * Get the default replay file configuration
         */
        static getDefaultFileConfig() {
            return DEFAULT_FILE_CONFIG;
        }
    }

    /**
     * inflate.ts
     * Inflates the zlib compressed body of Civilization V save files
     * The save writer chunks its deflate stream: every 65536 bytes of compressed
     * data are followed by a four byte little endian size word that is not part
     * of the stream, so the words have to be stripped before inflating. The
     * stream itself ends with a sync flush instead of a final block, so it
     * carries no adler32 trailer and cannot be inflated by a naive one shot
     * call. The workaround: strip the two byte zlib header, append a final empty
     * stored block, and inflate as raw deflate. This uses the native
     * DecompressionStream API, so it needs a 2022+ browser or Node 22+ and keeps
     * the project free of new dependencies.
     */
    // A final empty stored block: bfinal=1, btype=00, padding, LEN=0, NLEN=0xFFFF
    const finalEmptyStoredBlock = [0x01, 0x00, 0x00, 0xff, 0xff];
    /** Size of one compressed chunk as written by the save game writer */
    const CHUNK_SIZE = 0x10000;
    /**
     * Remove the chunk size words interleaved into the compressed payload. Every
     * full 65536 byte chunk of deflate data is followed by an int32 holding the
     * size of the next chunk, which the game reader consumes but which would be
     * decoded as compressed data by a plain inflater. The words are validated on
     * the way: each one must be a plausible chunk size, otherwise the payload is
     * left untouched so other zlib streams still inflate normally
     * @param payload The zlib stream bytes, starting at the 0x78 header
     * @returns The payload with the size words removed
     */
    function stripChunkMarkers(payload) {
        const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
        // Walk the chunk layout and validate every size word on the way: 65536
        // data bytes, then an int32 with the size of the next chunk
        const dataLengths = [];
        let markerCount = 0;
        let pos = 0;
        while (pos < payload.length) {
            const take = Math.min(CHUNK_SIZE, payload.length - pos);
            dataLengths.push(take);
            pos += take;
            if (pos + 4 <= payload.length) {
                const size = view.getUint32(pos, true);
                if (size <= 0 || size > CHUNK_SIZE)
                    return payload;
                markerCount++;
                pos += 4;
            }
        }
        if (markerCount === 0)
            return payload;
        // Copy the chunks, leaving out the words
        const clean = new Uint8Array(payload.length - markerCount * 4);
        let writePos = 0;
        let readPos = 0;
        for (const length of dataLengths) {
            clean.set(payload.subarray(readPos, readPos + length), writePos);
            writePos += length;
            readPos += length + 4;
        }
        return clean;
    }
    /**
     * Inflate a zlib payload that may end with a sync flush instead of a proper
     * stream termination
     * @param payload The zlib stream bytes, starting at the 0x78 header
     * @returns The complete decompressed data
     */
    async function inflateZlib(payload) {
        // Sanity check the zlib header up front: the compression method must be
        // deflate. This keeps garbage inputs from ever reaching the stream API,
        // where they can surface as unhandled stream errors
        if (payload.length < 6 || (payload[0] & 0x0f) !== 8) {
            throw new Error('Not a zlib stream');
        }
        // The normal Civ5 case: the stream is sync flushed, so append a synthetic
        // final block to terminate it cleanly
        try {
            return await rawInflate(appendTermination(stripChunkMarkers(payload)));
        }
        catch (e) {
            // Fall through to the alternatives below
        }
        // A stream that already ended with a final block needs no additions
        try {
            return await rawInflate(stripChunkMarkers(payload).subarray(2));
        }
        catch (e) {
            // Fall through
        }
        // A fully well formed zlib stream (header plus adler32 checksum)
        return streamInflate(stripChunkMarkers(payload), 'deflate');
    }
    /**
     * Append the final empty stored block to a zlib payload with its header stripped
     * @param payload The zlib stream bytes
     * @returns The raw deflate bytes with a terminating final block
     */
    function appendTermination(payload) {
        const raw = payload.subarray(2);
        const terminated = new Uint8Array(raw.length + finalEmptyStoredBlock.length);
        terminated.set(raw, 0);
        terminated.set(finalEmptyStoredBlock, raw.length);
        return terminated;
    }
    /**
     * Inflate raw deflate bytes through the native API
     * @param raw The deflate bytes without zlib header or checksum
     * @returns The decompressed data
     */
    async function rawInflate(raw) {
        return streamInflate(raw, 'deflate-raw');
    }
    /**
     * Pipe bytes through a DecompressionStream and collect the output
     * @param input The compressed bytes
     * @param format The compression format to decode with
     * @returns The decompressed data, rejects if the stream is corrupt
     */
    async function streamInflate(input, format) {
        const decompressor = new DecompressionStream(format);
        // Drain the readable side while the write side is still feeding data, so
        // large payloads never stall on a full internal queue
        const chunks = [];
        let totalLength = 0;
        let readError = null;
        const reading = (async () => {
            const reader = decompressor.readable.getReader();
            try {
                for (;;) {
                    const result = await reader.read();
                    if (result.done)
                        break;
                    chunks.push(result.value);
                    totalLength += result.value.byteLength;
                }
            }
            catch (e) {
                readError = e;
            }
            finally {
                reader.releaseLock();
            }
        })();
        try {
            const writer = decompressor.writable.getWriter();
            await writer.write(input);
            await writer.close();
        }
        catch (e) {
            // Ignore write side errors: a read side error is the real verdict
        }
        await reading;
        if (readError) {
            throw readError instanceof Error ? readError : new Error(String(readError));
        }
        const output = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
            output.set(chunk, offset);
            offset += chunk.byteLength;
        }
        return output;
    }

    /**
     * civ-names.ts
     * Derives human readable civilization names from the database type strings
     * stored in save files. Replay files carry localized display names, but
     * saves only carry type keys like CIVILIZATION_ARABIA or MINOR_CIV_KABUL,
     * so the display names are rebuilt from the key with a small override
     * table for the names that do not follow mechanically.
     */
    // Overrides for names that cannot be derived by title casing the type key.
    // The articles ("The Zulus") match the names the game itself uses, and the
    // renamings match the current localization ("Kyiv").
    const civNameOverrides = {
        AZTEC: 'The Aztecs',
        CELTS: 'The Celts',
        HUNS: 'The Huns',
        INCA: 'The Inca',
        IROQUOIS: 'The Iroquois',
        KIEV: 'Kyiv',
        MAYA: 'The Maya',
        NETHERLANDS: 'The Netherlands',
        OTTOMANS: 'The Ottomans',
        SHOSHONE: 'The Shoshone',
        ZULU: 'The Zulus'
    };
    /**
     * Convert a civilization type key to its display name
     * @param type The type key, e.g. CIVILIZATION_ARABIA or MINOR_CIV_BAN_CHIANG
     * @returns The display name, e.g. "Arabia" or "Ban Chiang"
     */
    function getCivNameFromType(type) {
        const stripped = type.replace(/^(CIVILIZATION_|MINOR_CIV_)/, '');
        if (civNameOverrides[stripped]) {
            return civNameOverrides[stripped];
        }
        // Title case each underscore separated word
        return stripped
            .split('_')
            .filter(word => word.length > 0)
            .map(word => word.charAt(0) + word.slice(1).toLowerCase())
            .join(' ');
    }

    /**
     * save-parser.ts
     * Parser for Civilization V (Vox Populi) save game files
     * Saves do not embed a finished replay, they embed the raw ingredients: the
     * event log inside the game section, and one replay data cluster per player
     * slot. This parser extracts those, rebuilds the civilization list from the
     * uncompressed pregame section, and assembles the same data shape the
     * replay parser produces so the rest of the application cannot tell the
     * difference.
     *
     * Beyond the replay content, the parser reads the save-only snapshot data
     * that sits at known offsets: the victory result from the game section
     * prelude, the map header (wrap flags and map-wide counts) in front of the
     * plot records, and the per plot snapshot fields (owner, resource,
     * improvement, route, city flag, owning city) inside each plot record.
     *
     * Layout of a save, top to bottom:
     * - An uncompressed engine header (shared front half with replay files)
     * - The uncompressed CvPreGame section (slot setup and game options)
     * - An 8 byte compression marker, then one zlib stream to end of file
     * - Inside the stream: the game section (with the event log early on and the
     *   embedded SQLite database at its end), the map section right after the
     *   database, then one section per player slot in slot order
     */
    /** Dataset name prefix used for every replay stat series */
    const DATASET_PREFIX = 'REPLAYDATASET_';
    /** First bytes of the SQLite database embedded at the end of the game section */
    const SQLITE_MAGIC = 'SQLite format 3';
    /** The event list sits near the start of the game section, well within this window */
    const EVENTS_SCAN_LIMIT = 0x40000;
    /**
     * When a cluster is damaged, parsing resumes at the next dataset name within
     * this distance. Real datasets sit a few kilobytes apart, while the gap
     * between two player sections is over a hundred kilobytes, so this bound
     * keeps a damaged cluster from swallowing the next one
     */
    const CLUSTER_RESYNC_LIMIT = 0x10000;
    /** Highest player slot id (barbarians) */
    const MAX_PLAYER_SLOT = 63;
    /**
     * The plot record array of the map section, decoded with the exact
     * CvPlot::Serialize layout of the game DLL. The constants below describe one
     * record: a small counter prefix, the river id list, the terrain fields, a
     * per team visibility block, the revealed bits, and a tail of counted pieces
     */
    /** Size of the map header in front of the two resource count tables */
    const MAP_HEADER_SIZE = 47;
    /** Both resource count tables together take four bytes per resource type */
    const MAP_RESOURCE_ENTRY_SIZE = 8;
    /** How many resource types the first record search tries at most */
    const MAP_MAX_RESOURCE_TYPES = 300;
    /** Length of the shortest possible plot record, every variable part empty */
    const PLOT_MIN_RECORD_SIZE = 1422;
    /** Offset of the river id list count word inside a plot record */
    const PLOT_RIVER_COUNT_OFFSET = 17;
    /** A plot holds one river id per hex direction and the list stays short */
    const PLOT_MAX_RIVERS = 64;
    /** Offset of the owner byte behind the river id list */
    const PLOT_OWNER_OFFSET = 7;
    /** Offset of the plot type byte behind the river id list */
    const PLOT_PLOT_TYPE_OFFSET = 8;
    /** Offset of the terrain type byte behind the river id list */
    const PLOT_TERRAIN_OFFSET = 9;
    /** Offset of the feature word behind the river id list, stored as a full enum */
    const PLOT_FEATURE_OFFSET = 10;
    /** Offset of the resource word behind the river id list, stored as a full enum */
    const PLOT_RESOURCE_OFFSET = 14;
    /** Offset of the improvement word behind the river id list, stored as a full enum */
    const PLOT_IMPROVEMENT_OFFSET = 18;
    /** Offset of the route byte behind the river id list */
    const PLOT_ROUTE_OFFSET = 30;
    /** Offset of the city flag byte behind the river id list */
    const PLOT_IS_CITY_OFFSET = 38;
    /** Offset of the owning city pair behind the river id list: owner then city id, both int32 */
    const PLOT_OWNING_CITY_OFFSET = 39;
    /**
     * Distance from the end of the river id list to the river crossing byte of
     * the record tail: the packed flag word, the counter and enum fields, the
     * owning city pairs, the yields, the team block, and the revealed bits
     */
    const PLOT_TAIL_START = 1352;
    /** Closing fields behind the unit list: continent, archaeology, trade route, build turn, spawned resource */
    const PLOT_CLOSING_FIELDS_SIZE = 31;
    /** A candidate head must chain into this many followers to count as the array start */
    const PLOT_TRIAL_RECORDS = 30;
    /**
     * Decode one plot record following the exact CvPlot::Serialize layout of the
     * game DLL. Every counted piece of the tail must carry a plausible size
     * word, otherwise the bytes are not a record and the walk must stop
     * @param body The decompressed game state
     * @param view Little endian view over the game state
     * @param s Record start
     * @returns The record fields and the position of the next record, or null
     * when the bytes do not follow the layout
     */
    function decodePlotRecord(body, view, s) {
        if (s < 0 || s + PLOT_MIN_RECORD_SIZE > body.length)
            return null;
        // The river id list starts with a count word, the all ones value marks an
        // empty list, then comes one river id per hex direction
        const riverWord = view.getUint32(s + PLOT_RIVER_COUNT_OFFSET, true);
        if (riverWord !== 0xFFFFFFFF && riverWord > PLOT_MAX_RIVERS)
            return null;
        const riverCount = riverWord === 0xFFFFFFFF ? 0 : riverWord;
        const rivers = [];
        for (let i = 0; i < riverCount; i++) {
            rivers.push(view.getInt32(s + 21 + i * 4, true));
        }
        // Behind the river id list every field sits at a fixed offset
        const base = s + 21 + riverCount * 4;
        const owner = view.getInt8(base + PLOT_OWNER_OFFSET);
        const plotType = view.getInt8(base + PLOT_PLOT_TYPE_OFFSET);
        const terrain = view.getInt8(base + PLOT_TERRAIN_OFFSET);
        const feature = view.getInt32(base + PLOT_FEATURE_OFFSET, true);
        const resource = view.getInt32(base + PLOT_RESOURCE_OFFSET, true);
        const improvement = view.getInt32(base + PLOT_IMPROVEMENT_OFFSET, true);
        const route = view.getInt8(base + PLOT_ROUTE_OFFSET);
        const isCity = body[base + PLOT_IS_CITY_OFFSET];
        const owningCityOwner = view.getInt32(base + PLOT_OWNING_CITY_OFFSET, true);
        const owningCityId = view.getInt32(base + PLOT_OWNING_CITY_OFFSET + 4, true);
        // The counted tail pieces. Script data exists only behind a flag byte,
        // the other pieces always carry their count word
        let p = base + PLOT_TAIL_START;
        p += 1; // river crossing
        const scriptFlag = body[p];
        p += 1;
        if (scriptFlag !== 0) {
            const len = view.getUint32(p, true);
            if (len === 0xFFFFFFFF)
                p += 4;
            else if (len <= 10000)
                p += 4 + len;
            else
                return null;
        }
        // Build progress: pairs of build type and remaining work
        const buildCount = view.getUint32(p, true);
        if (buildCount === 0xFFFFFFFF)
            p += 4;
        else if (buildCount <= 20)
            p += 4 + buildCount * 8;
        else
            return null;
        // Invisible visibility unit counts: pairs of team and count
        const invisibleUnits = view.getUint32(p, true);
        if (invisibleUnits === 0xFFFFFFFF)
            p += 4;
        else if (invisibleUnits <= 200)
            p += 4 + invisibleUnits * 8;
        else
            return null;
        // Invisible visibility counts: pairs of team and a counted int vector
        const invisiblePlots = view.getUint32(p, true);
        if (invisiblePlots === 0xFFFFFFFF)
            p += 4;
        else if (invisiblePlots <= 200) {
            p += 4;
            for (let i = 0; i < invisiblePlots; i++) {
                p += 4; // the team id
                const inner = view.getUint32(p, true);
                if (inner === 0xFFFFFFFF)
                    p += 4;
                else if (inner <= 500)
                    p += 4 + inner * 4;
                else
                    return null;
            }
        }
        else
            return null;
        // Units: pairs of owner and unit id
        const unitCount = view.getUint32(p, true);
        if (unitCount === 0xFFFFFFFF)
            p += 4;
        else if (unitCount <= 500)
            p += 4 + unitCount * 8;
        else
            return null;
        p += PLOT_CLOSING_FIELDS_SIZE;
        if (p > body.length)
            return null;
        return { end: p, plotType, terrain, feature, rivers, owner, resource, improvement, route, isCity, owningCityOwner, owningCityId };
    }
    /**
     * Extract the map terrain by decoding the plot records of the map section.
     * The records sit row by row behind the map header and the two resource
     * count tables. The table size depends on the mod set, so the first record
     * is found by trying every possible table size until a plausible head chains
     * cleanly across the whole map. When no candidate covers the map, the best
     * partial walk is returned and the caller decides through the coverage gate
     * whether the terrain is trustworthy
     * @param body The decompressed game state
     * @param mapPos Byte offset of the map section header
     * @param width Map width in plots
     * @param height Map height in plots
     * @returns The terrain tiles, null where a record failed to decode, plus walk statistics
     */
    function extractMapTerrain(body, mapPos, width, height) {
        const numPlots = width * height;
        const empty = new Array(numPlots).fill(null);
        const stats = { arrayStart: -1, slotsFilled: 0, riverPlots: 0 };
        if (numPlots <= 0)
            return { tiles: empty, stats };
        const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
        // Decode records from the given start until the map is full or a record
        // breaks the layout
        const walk = (start) => {
            const tiles = new Array(numPlots).fill(null);
            const walkStats = { arrayStart: start, slotsFilled: 0, riverPlots: 0 };
            let p = start;
            for (let i = 0; i < numPlots; i++) {
                const record = decodePlotRecord(body, view, p);
                if (!record)
                    break;
                tiles[i] = {
                    elevation: record.plotType,
                    type: record.terrain,
                    feature: record.feature,
                    rivers: record.rivers,
                    owner: record.owner,
                    resource: record.resource,
                    improvement: record.improvement,
                    route: record.route,
                    isCity: record.isCity,
                    owningCityOwner: record.owningCityOwner,
                    owningCityId: record.owningCityId
                };
                if (record.rivers.some(id => id >= 0))
                    walkStats.riverPlots++;
                walkStats.slotsFilled++;
                p = record.end;
            }
            return { tiles, stats: walkStats };
        };
        // A valid start decodes as a plausible terrain head and chains into
        // further records. Resource table bytes never survive both checks
        const looksLikeRecord = (pos) => {
            const first = decodePlotRecord(body, view, pos);
            if (!first)
                return false;
            if (first.plotType < 0 || first.plotType > 3)
                return false;
            if (first.terrain < 0 || first.terrain > 15)
                return false;
            if (first.feature < -1 || first.feature > 200)
                return false;
            let p = first.end;
            for (let i = 1; i < PLOT_TRIAL_RECORDS; i++) {
                const record = decodePlotRecord(body, view, p);
                if (!record)
                    return false;
                p = record.end;
            }
            return true;
        };
        // Candidates are tried from the largest table size downward. A start inside
        // the resource tables can only chain when a table word happens to mimic a
        // river count and lands the field base on the real first record, so the
        // deepest candidate that chains is the true first record
        let best = null;
        for (let resources = MAP_MAX_RESOURCE_TYPES; resources >= 1; resources--) {
            const candidate = mapPos + MAP_HEADER_SIZE + resources * MAP_RESOURCE_ENTRY_SIZE;
            if (candidate + PLOT_MIN_RECORD_SIZE > body.length)
                continue;
            if (!looksLikeRecord(candidate))
                continue;
            const walked = walk(candidate);
            if (walked.stats.slotsFilled === numPlots)
                return walked;
            if (!best || walked.stats.slotsFilled > best.stats.slotsFilled)
                best = walked;
        }
        return best !== null && best !== void 0 ? best : { tiles: empty, stats };
    }
    /**
     * Skip a CvBaseInfo block: an int32 id followed by eight strings
     */
    function skipBaseInfo() {
        this.getInt32();
        for (let i = 0; i < 8; i++) {
            this.getVarString();
        }
    }
    /**
     * Skip a CvClimateInfo block: a base info plus four ints and seven floats
     */
    function skipClimateInfo() {
        skipBaseInfo.call(this);
        for (let i = 0; i < 4; i++) {
            this.getInt32();
        }
        for (let i = 0; i < 7; i++) {
            this.getFloat32();
        }
    }
    /**
     * Skip a CvSeaLevelInfo block: a base info plus one int
     */
    function skipSeaLevelInfo() {
        skipBaseInfo.call(this);
        this.getInt32();
    }
    /**
     * Skip a CvTurnTimerInfo block: a base info plus four ints
     */
    function skipTurnTimerInfo() {
        skipBaseInfo.call(this);
        for (let i = 0; i < 4; i++) {
            this.getInt32();
        }
    }
    /**
     * Skip a CvWorldInfo block: a base info plus twenty three ints
     */
    function skipWorldInfo() {
        skipBaseInfo.call(this);
        for (let i = 0; i < 23; i++) {
            this.getInt32();
        }
    }
    /**
     * Read the known players table, probing the element width (uint32 vs uint64
     * bitmasks depending on the compiled civ limit) by checking which stride
     * lands on the archive version marker that follows the table. The table is
     * empty unless the "keep unmet players unknown" game option was enabled.
     */
    function readKnownPlayersTable() {
        const count = this.getInt32();
        if (count <= 0) {
            return 0;
        }
        const afterTable = this.tell();
        for (const width of [8, 4]) {
            const candidate = afterTable + count * width;
            this.seek(candidate);
            if (this.getInt32() === 6) {
                // Positioned right before the archive version, which the schema reads next
                this.seek(candidate);
                return count;
            }
        }
        // Unknown layout, leave the cursor untouched and let the walk fail loudly
        this.seek(afterTable);
        return count;
    }
    /**
     * Schema for the uncompressed part of a save: the engine header, the
     * CvPreGame slot hints, and the CvPreGame archive. Junk fields carry an
     * underscore prefix and stay hidden unless junk parsing is requested.
     */
    const SAVE_FILE_CONFIG = {
        // Engine header, shared front half with replay files
        game: { type: 'str', length: 0x04 }, // CIV5
        _formatVersion: 'int32', // 8 for saves, 1 for replays
        version: 'varstr',
        build: 'varstr',
        headerTurn: 'int32', // game turn at save time
        _flag: 'int8',
        playerCiv: 'varstr',
        difficulty: 'varstr',
        eraStart: 'varstr',
        eraEnd: 'varstr',
        gameSpeed: 'varstr',
        worldSize: 'varstr',
        mapScript: 'varstr',
        dlc: {
            type: 'array',
            items: {
                id: { type: 'str', length: 0x10 },
                enabled: 'int32',
                name: 'varstr'
            }
        },
        mods: {
            type: 'array',
            items: {
                id: 'varstr',
                version: 'int32',
                name: 'varstr'
            }
        },
        _empty1: 'varstr',
        _empty2: 'varstr',
        playerColor: 'varstr',
        _hash1: { type: 'byte', length: 0x10 },
        _engineVersion: 'varstr', // "1.0.0"
        _hash2: { type: 'byte', length: 0x10 },
        _engineTrailingInt: 'int32',
        // CvPreGame slot hints (version 3)
        _hintVersion: 'int32',
        _hintGameSpeed: 'int32',
        _hintWorldSize: 'int32',
        pregameMapScript: 'varstr',
        _slotCivs: { type: 'array', items: 'int32' },
        _nicknames: { type: 'array', items: 'varstr' },
        _slotStatus: { type: 'array', items: 'int32' },
        _slotClaims: { type: 'array', items: 'int32' },
        _teamTypes: { type: 'array', items: 'int32' },
        _handicaps: { type: 'array', items: 'int32' },
        civilizationKeys: { type: 'array', items: 'varstr' },
        leaderKeys: { type: 'array', items: 'varstr' },
        _knownPlayersTable: readKnownPlayersTable,
        // CvPreGame archive (version 6)
        _archiveVersion: 'int32',
        activePlayer: 'int32',
        _adminPassword: 'varstr',
        _alias: 'varstr',
        _artStyles: { type: 'array', items: 'int32' },
        _autorun: 'int8',
        _autorunTurnDelay: 'float32',
        _autorunTurnLimit: 'int32',
        _bandwidth: 'int32',
        calendar: 'int32',
        _calendarInfo: skipBaseInfo,
        _civAdjectives: { type: 'array', items: 'varstr' },
        _civDescriptions: { type: 'array', items: 'varstr' },
        _civPasswords: { type: 'array', items: 'varstr' },
        _civShortDescriptions: { type: 'array', items: 'varstr' },
        climate: 'int32',
        _climateInfo: skipClimateInfo,
        era: 'int32',
        _emailAddresses: { type: 'array', items: 'varstr' },
        _endTurnTimerLength: 'float32',
        _flagDecals: { type: 'array', items: 'varstr' },
        _forceControls: { type: 'array', items: 'int8' },
        _gameMode: 'int32',
        gameName: 'varstr',
        _archiveGameSpeed: 'int32',
        _gameStarted: 'int8',
        gameTurn: 'int32',
        _gameType: 'int8', // GameTypes serializes as a single byte
        _gameMapType: 'int32',
        _gameUpdateTime: 'int32',
        _handicaps2: { type: 'array', items: 'int32' },
        _lastHumanHandicaps: { type: 'array', items: 'int32' },
        _isEarthMap: 'int8',
        _isInternetGame: 'int8',
        _leaderNames: { type: 'array', items: 'varstr' },
        _loadFileName: 'varstr',
        _localPlayerEmailAddress: 'varstr',
        _mapNoPlayers: 'int8',
        _mapRandomSeed: 'int32',
        _loadWBScenario: 'int8',
        _overrideScenarioHandicap: 'int8',
        _archiveMapScript: 'varstr',
        _maxCityElimination: 'int32',
        _maxTurns: 'int32',
        _numMinorCivs: 'int32',
        minorCivTypes: { type: 'array', items: 'varstr' },
        _minorNationCivs: { type: 'array', items: 'int8' },
        _dummyvalue: 'int8',
        _multiplayerOptions: { type: 'array', items: 'int8' },
        _netIDs: { type: 'array', items: 'int32' },
        _nicknames2: { type: 'array', items: 'varstr' },
        _numVictoryInfos: 'int32',
        _pitBossTurnTime: 'int32',
        _playableCivs: { type: 'array', items: 'int8' },
        playerColors: { type: 'array', items: 'varstr' },
        _privateGame: 'int8',
        _quickCombat: 'int8',
        _quickCombatDefault: 'int8',
        _quickHandicap: 'int32',
        _quickstart: 'int8',
        _randomWorldSize: 'int8',
        _randomMapScript: 'int8',
        _readyPlayers: { type: 'array', items: 'int8' },
        seaLevel: 'int32',
        _seaLevelInfo: skipSeaLevelInfo,
        _dummyvalue2: 'int8',
        _slotClaims2: { type: 'array', items: 'int32' },
        _slotStatus2: { type: 'array', items: 'int32' },
        _smtpHost: 'varstr',
        _syncRandomSeed: 'int32',
        _targetScore: 'int32',
        _teamTypes2: { type: 'array', items: 'int32' },
        _transferredMap: 'int8',
        _turnTimer: skipTurnTimerInfo,
        _turnTimerType: 'int32',
        _cityScreenBlocked: 'int8',
        _victories: { type: 'array', items: 'int8' },
        _whiteFlags: { type: 'array', items: 'int8' },
        _worldInfo: skipWorldInfo,
        _archiveWorldSize: 'int32',
        gameOptions: {
            type: 'array',
            items: {
                name: 'varstr',
                value: 'int32'
            }
        },
        mapOptions: {
            type: 'array',
            items: {
                name: 'varstr',
                value: 'int32'
            }
        },
        _versionString: 'varstr',
        _turnNotifySteamInvite: { type: 'array', items: 'int8' },
        _turnNotifyEmail: { type: 'array', items: 'int8' },
        _turnNotifyEmailAddress: { type: 'array', items: 'varstr' }
    };
    /**
     * Encode an ASCII string as bytes, for searching the decompressed buffer
     * @param text The string to encode
     */
    function stringToBytes(text) {
        const bytes = new Uint8Array(text.length);
        for (let i = 0; i < text.length; i++) {
            bytes[i] = text.charCodeAt(i) & 0xff;
        }
        return bytes;
    }
    /**
     * Find the first occurrence of a byte sequence at or after a position
     * @param haystack The buffer to search
     * @param needle The sequence to find
     * @param from The position to start from
     * @returns The position of the match, or -1 when not found
     */
    function findBytes(haystack, needle, from) {
        const last = haystack.length - needle.length;
        for (let pos = from; pos <= last; pos++) {
            if (haystack[pos] !== needle[0]) {
                continue;
            }
            let matched = true;
            for (let i = 1; i < needle.length; i++) {
                if (haystack[pos + i] !== needle[i]) {
                    matched = false;
                    break;
                }
            }
            if (matched) {
                return pos;
            }
        }
        return -1;
    }
    /**
     * Detect whether a buffer holds a save file rather than a replay file
     * @param file The raw file contents
     * @returns True when the buffer should be handled by SaveParser
     */
    function isSaveFile(file) {
        if (file.byteLength < 8) {
            return false;
        }
        const view = new DataView(file);
        const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
        return magic === 'CIV5' && view.getInt32(4, true) !== 1;
    }
    /**
     * SaveParser class
     * Parses save files and rebuilds the replay data they contain
     */
    class SaveParser extends BaseParser {
        /**
         * Create a save parser
         * @param file The raw save file contents
         * @param size The size of the save data within the buffer
         */
        constructor(file, size) {
            super(file, size, SAVE_FILE_CONFIG);
            this.decompressed = new Uint8Array(0);
            this.diagnostics = {
                decompressedSize: 0,
                eventListPos: 0,
                clusterCount: 0,
                damagedClusters: 0,
                unattachedClusters: 0,
                mapDimsSource: 'none',
                terrainCoverage: 0,
                terrainTrusted: 0,
                terrainGatePassed: false
            };
            this.fileSize = size;
        }
        /**
         * Get the default save file configuration
         */
        static getDefaultFileConfig() {
            return SAVE_FILE_CONFIG;
        }
        /**
         * Get diagnostic counters from the last parseReplay run
         */
        getDiagnostics() {
            return this.diagnostics;
        }
        /**
         * Parse the whole save and assemble the replay data
         * The uncompressed header is parsed by the inherited schema driven parse,
         * then the compressed body is inflated and scanned for the replay content
         * @returns A data object shaped like the replay parser output
         */
        async parseReplay() {
            // Stage 1 and 2: engine header plus the whole CvPreGame section
            const header = this.parse();
            // Stage 3: locate the compression marker and inflate the body
            const body = await this.readCompressedBody();
            this.decompressed = body;
            this.diagnostics.decompressedSize = body.byteLength;
            const state = new BinaryParser(body.buffer, body.byteLength);
            // Stage 4: the game section prelude carries the turn and year anchors
            const prelude = this.parseGamePrelude(state, header.headerTurn);
            const endTurn = prelude.endTurn;
            // Stage 5: the event log sits early in the game section
            const eventList = this.findEventList(state, endTurn, prelude.startTurn);
            // Stage 6: the civ list comes from the event slots plus the pregame names
            const civSlots = this.collectCivSlots(eventList.messages);
            const civs = this.buildCivList(header, civSlots);
            const slotToIndex = new Map();
            civSlots.forEach((slot, index) => slotToIndex.set(slot, index));
            // The victory result needs the event log and the slot mapping
            const victory = this.buildVictoryInfo(prelude, eventList.messages, slotToIndex);
            // Stage 7: replay data clusters, one per player slot in slot order
            const clusters = this.scanClusters(state, eventList.endPos, endTurn);
            const citySeries = this.predictCityCounts(eventList.messages, civSlots, endTurn);
            const deaths = this.analyzeDeaths(eventList.messages, civSlots);
            const clusterBySlot = this.assignClusters(clusters, civSlots, citySeries, deaths, endTurn);
            // Stage 8: the map section header, then assemble the output shape
            const mapDims = this.readMapSection(state, eventList.messages);
            // Stage 9: decode the plot records for terrain when the map section was found
            let terrain = null;
            if (mapDims.mapPos >= 0 && mapDims.width > 0 && mapDims.height > 0) {
                terrain = extractMapTerrain(this.decompressed, mapDims.mapPos, mapDims.width, mapDims.height);
                const coverage = terrain.stats.slotsFilled / (mapDims.width * mapDims.height);
                this.diagnostics.terrainCoverage = coverage;
                this.diagnostics.terrainTrusted = terrain.stats.slotsFilled;
                // A save from a different game version can leave the walk short.
                // Only render terrain when the walk covered nearly the whole map,
                // otherwise fall back to blank hexes
                this.diagnostics.terrainGatePassed = coverage >= 0.9;
                if (!this.diagnostics.terrainGatePassed) {
                    console.warn(`Save terrain unreliable: the plot walk covered ${(coverage * 100).toFixed(1)}% of the map, rendering blank hexes`);
                    terrain = null;
                }
            }
            else {
                this.diagnostics.terrainCoverage = 0;
                this.diagnostics.terrainGatePassed = false;
            }
            return this.assembleRawData(header, prelude, victory, civs, civSlots, slotToIndex, eventList.messages, clusters, clusterBySlot, mapDims, terrain);
        }
        /**
         * Read and inflate the compressed body that follows the pregame section
         * @returns The decompressed game state
         */
        async readCompressedBody() {
            // The schema cursor sits exactly on the compression marker
            const compressionType = this.getInt32();
            if (compressionType !== 2) {
                throw new Error(`Expected the zlib compression marker at position ${this.decToHex(this.tell() - 4)}, found ${compressionType}`);
            }
            this.getInt32(); // Chunk size hint, not needed
            const payload = this.getBytes(this.fileSize - this.tell());
            return inflateZlib(payload);
        }
        /**
         * Parse the fixed prelude of the game section: save version, data hash,
         * version string, then the game fields including the turn counters, the
         * start year, and the victory result. Every field up to the victory block
         * has a fixed size, so the read is one straight walk following
         * CvGame::Serialize in the game DLL
         * @param state Reader over the decompressed game state
         * @param headerTurn The game turn from the engine header, for cross checking
         */
        parseGamePrelude(state, headerTurn) {
            state.getInt32(); // Save version, always 0
            state.getBytes(16); // Game data hash
            state.getVarString(); // Game core version string
            state.getInt32(); // End turn messages sent
            const elapsedGameTurns = state.getInt32();
            const startTurn = state.getInt32();
            const winningTurn = state.getInt32();
            const startYear = state.getInt32();
            // Turn estimates, slice counters, and score counters up to the civ counts
            for (let i = 0; i < 28; i++) {
                state.getInt32();
            }
            // Six bools: score dirty, circumnavigated, and friends
            for (let i = 0; i < 6; i++) {
                state.getInt8();
            }
            state.getInt32(); // Observer UI override player
            // Five bools: tuner, saved once, tutorial, and friends
            for (let i = 0; i < 5; i++) {
                state.getInt8();
            }
            // Advisor messages viewed: a counted set of hashes
            const advisorMessages = state.getInt32();
            if (advisorMessages < 0 || advisorMessages > 100000) {
                throw new Error(`Implausible advisor message count ${advisorMessages} in the game prelude`);
            }
            state.getBytes(advisorMessages * 4);
            state.getInt32(); // Handicap
            state.getInt32(); // Pause player
            state.getInt32(); // AI auto play return player
            state.getInt32(); // Best land unit
            const winnerTeam = state.getInt32();
            const victoryType = state.getInt32();
            const gameState = state.getInt32();
            const endTurn = elapsedGameTurns;
            if (endTurn !== headerTurn) {
                console.warn(`Save turn mismatch: header says ${headerTurn}, game section says ${endTurn}`);
            }
            return { startTurn, endTurn, startYear, winningTurn, winnerTeam, victoryType, gameState };
        }
        /**
         * Build the victory result from the prelude fields and the event log
         * A result counts as reliable only when the header claims a winner and the
         * event log carries the matching victory message at the winning turn; the
         * winner civilization comes from that message, whose slot is mapped to the
         * dense civ index
         * @param prelude The parsed game prelude
         * @param messages The raw event log, with original player slots
         * @param slotToIndex Mapping from player slots to dense civ indices
         */
        buildVictoryInfo(prelude, messages, slotToIndex) {
            var _a;
            // The header claims a winner when the winning turn is past the start and
            // the victory fields are set; m_iWinningTurn stays 0 until someone wins
            const claimed = prelude.winningTurn > 0 && prelude.victoryType >= 0 &&
                prelude.winnerTeam >= 0 && prelude.gameState !== 0;
            // The event log must confirm the claim with a victory message at the
            // winning turn, which also names the winning civilization
            const victoryEvent = claimed
                ? messages.find(m => m.turn === prelude.winningTurn && m.civId >= 0 && m.text.includes(' has won a '))
                : undefined;
            const winnerSlot = victoryEvent ? victoryEvent.civId : -1;
            const winnerCivId = winnerSlot >= 0 ? ((_a = slotToIndex.get(winnerSlot)) !== null && _a !== void 0 ? _a : -1) : -1;
            return {
                winningTurn: claimed ? prelude.winningTurn : -1,
                winnerTeam: prelude.winnerTeam,
                victoryType: prelude.victoryType,
                gameState: prelude.gameState,
                winnerCivId,
                reliable: victoryEvent !== undefined && winnerCivId >= 0,
                source: 'file'
            };
        }
        /**
         * Locate and parse the replay event list
         * The list has no fixed offset within the game section, so the search
         * anchors on the first city founding text and then tries list headers in
         * the bytes just before it, validating each candidate by fully parsing
         * it. A real list satisfies every field constraint across all of its
         * messages and always contains the founding text it was anchored on
         * @param state Reader over the decompressed game state
         * @param endTurn The current game turn, upper bound for event turns
         * @param startTurn The turn the game started on
         */
        findEventList(state, endTurn, startTurn) {
            const anchor = stringToBytes(' is founded.');
            const scanLimit = Math.min(EVENTS_SCAN_LIMIT, state.remaining());
            const body = this.decompressed;
            let pos = 0;
            while ((pos = findBytes(body, anchor, pos)) !== -1 && pos < scanLimit) {
                // The list header (a count) sits within a few hundred bytes before
                // the founding text, no matter how long the city name is
                const windowStart = Math.max(0, pos - 256);
                for (let countPos = pos - 4; countPos >= windowStart; countPos--) {
                    const candidate = this.tryParseEventList(state, countPos, endTurn, startTurn);
                    if (candidate && candidate.messages.some(m => m.text.includes(' is founded.'))) {
                        this.diagnostics.eventListPos = countPos;
                        return candidate;
                    }
                }
                pos++;
            }
            throw new Error('Unable to locate the replay event list inside the save');
        }
        /**
         * Try to parse a complete event list starting at a candidate position
         * @returns The messages and the end position, or null when any field fails validation
         */
        tryParseEventList(state, pos, endTurn, startTurn) {
            const cursor = state.tell();
            state.seek(pos);
            try {
                const count = state.getInt32();
                if (count < 1 || count > 200000) {
                    return null;
                }
                const messages = [];
                for (let i = 0; i < count; i++) {
                    const turn = state.getInt32();
                    if (turn < 0 || turn > endTurn + 10) {
                        return null;
                    }
                    const type = state.getInt32();
                    if (type < 0 || type > 6) {
                        return null;
                    }
                    const tileCount = state.getInt32();
                    if (tileCount < 0 || tileCount > 2000) {
                        return null;
                    }
                    const tiles = [];
                    for (let t = 0; t < tileCount; t++) {
                        const x = state.getInt16();
                        const y = state.getInt16();
                        if (x < -1 || x > 2048 || y < -1 || y > 2048) {
                            return null;
                        }
                        tiles.push({ x, y });
                    }
                    const civId = state.getInt32();
                    if (civId < -1 || civId > MAX_PLAYER_SLOT) {
                        return null;
                    }
                    const textLength = state.getInt32();
                    if (textLength < 0 || textLength > 10000) {
                        return null;
                    }
                    const text = state.getString(textLength);
                    messages.push({ turn, type, tiles, civId, text });
                }
                // The log always begins at or near the game start
                if (messages[0].turn > startTurn + 5) {
                    return null;
                }
                return { messages, endPos: state.tell() };
            }
            catch (e) {
                // Out of bounds reads just disqualify the candidate
                return null;
            }
            finally {
                state.seek(cursor);
            }
        }
        /**
         * Collect the sorted list of player slots that ever appeared in the events
         * @param messages The parsed event log
         */
        collectCivSlots(messages) {
            const slots = new Set();
            for (const message of messages) {
                // The topmost slot is the barbarian horde: it records events but it
                // is not a civilization, so it stays out of the viewer's civ list
                if (message.civId >= 0 && message.civId < MAX_PLAYER_SLOT) {
                    slots.add(message.civId);
                }
            }
            return Array.from(slots).sort((a, b) => a - b);
        }
        /**
         * Build the civilization list for the viewer
         * Majors are named from the civilization keys, city states from the minor
         * civ types of their slot
         * @param header The parsed pregame data
         * @param civSlots The ever alive player slots, in slot order
         */
        buildCivList(header, civSlots) {
            const civKeys = header.civilizationKeys || [];
            const minorTypes = header.minorCivTypes || [];
            return civSlots.map(slot => {
                const civKey = civKeys[slot] || '';
                const minorKey = minorTypes[slot] || '';
                // Minor slots carry a generic civ key, the specific identity lives in
                // the minor civ type list
                const type = minorKey || civKey;
                return { name: getCivNameFromType(type) };
            });
        }
        /**
         * Scan the decompressed state for replay data clusters
         * Every player slot carries one cluster in slot order, in one of three
         * shapes: a full dataset map for civs that played, a single score series
         * for slots that never joined the game, or nothing at all when the data
         * was wiped
         * @param state Reader over the decompressed game state
         * @param minPos Clusters live after the event list, so scanning starts there
         * @param endTurn The current game turn, upper bound for entry turns
         */
        scanClusters(state, minPos, endTurn) {
            const candidates = this.findDatasetNameCandidates(minPos);
            const clusters = [];
            let lastEnd = minPos;
            let index = 0;
            while (index < candidates.length) {
                const startPos = candidates[index];
                if (startPos < lastEnd) {
                    index++;
                    continue;
                }
                const cluster = this.parseClusterAt(state, candidates, index, endTurn);
                if (!cluster) {
                    index++;
                    continue;
                }
                clusters.push(cluster);
                lastEnd = cluster.endPos;
                // Always consume at least the starting candidate: a region can chain
                // to nothing and end where it began, and the scan must still advance
                index++;
                while (index < candidates.length && candidates[index] < lastEnd) {
                    index++;
                }
            }
            this.diagnostics.clusterCount = clusters.length;
            return clusters;
        }
        /**
         * Find the positions of all dataset name length prefixes, the anchors from
         * which cluster parsing starts
         * @param minPos Position to start scanning from
         */
        findDatasetNameCandidates(minPos) {
            const body = this.decompressed;
            const needle = stringToBytes(DATASET_PREFIX);
            const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
            const candidates = [];
            let pos = minPos;
            while ((pos = findBytes(body, needle, pos)) !== -1) {
                const lengthPos = pos - 4;
                if (lengthPos >= 0) {
                    const length = view.getInt32(lengthPos, true);
                    if (length >= 15 && length <= 60) {
                        candidates.push(lengthPos);
                    }
                }
                pos++;
            }
            return candidates;
        }
        /**
         * Parse one cluster starting at a dataset name length prefix
         * Damaged datasets keep their byte layout but can carry nonsense values,
         * and a damaged entry count forces a resync at the next dataset name
         * @param state Reader over the decompressed game state
         * @param candidates All dataset name positions in the buffer
         * @param index The candidate index to start from
         * @param endTurn The current game turn
         */
        parseClusterAt(state, candidates, index, endTurn) {
            const startPos = candidates[index];
            const datasets = new Map();
            let damagedEntries = 0;
            let validEntries = 0;
            let nameCount = 0;
            let scoreLastNonzeroTurn = -1;
            let endPos = startPos;
            // Walk dataset records back to back, resyncing at the next candidate
            // when a record is too damaged to follow
            let current = index;
            while (current < candidates.length) {
                const namePos = candidates[current];
                if (current > index && namePos - endPos > CLUSTER_RESYNC_LIMIT) {
                    // The next dataset name is too far away: the cluster ends here
                    break;
                }
                state.seek(namePos);
                const length = state.getInt32();
                if (length < 15 || length > 60) {
                    break;
                }
                const name = state.getString(length);
                if (!name.startsWith(DATASET_PREFIX)) {
                    break;
                }
                nameCount++;
                const entryCount = state.getInt32();
                if (entryCount < 0 || entryCount > 100000) {
                    // Damaged entry count: skip to the next dataset name
                    endPos = namePos;
                    damagedEntries++;
                    current++;
                    continue;
                }
                const entries = [];
                let lastTurn = -1;
                for (let e = 0; e < entryCount; e++) {
                    const turn = state.getInt32();
                    const value = state.getInt32();
                    // Keep only entries a healthy map could have produced: turns inside
                    // the game, strictly ascending. Data corrupted in memory fails here
                    // and is dropped rather than repaired
                    if (turn >= 0 && turn <= endTurn && turn > lastTurn) {
                        entries.push({ turn, value });
                        lastTurn = turn;
                        // The score series is written every turn for every player, so its
                        // last nonzero value marks the death turn even when other values
                        // rotted
                        if (name === DATASET_PREFIX + 'SCORE' && value !== 0) {
                            scoreLastNonzeroTurn = turn;
                        }
                    }
                    else {
                        damagedEntries++;
                    }
                }
                datasets.set(name, entries);
                validEntries += entries.length;
                endPos = state.tell();
                current++;
            }
            // A chain with no dataset names at all is a byte coincidence, for
            // example a stray string inside script data. A chain with names but no
            // surviving entries is a real region whose values were wiped, and it
            // still occupies a player slot in the sequence
            if (nameCount === 0) {
                return null;
            }
            // A region holding anything beyond the bare score series belongs to a
            // civ that actually played
            const hasGameData = validEntries > 0 && (datasets.size > 1 || !datasets.has(DATASET_PREFIX + 'SCORE'));
            return { startPos, endPos, datasets, damagedEntries, validEntries, nameCount, scoreLastNonzeroTurn, hasGameData };
        }
        /**
         * Predict each civ's city count per turn from the event log, used to
         * attribute clusters to slots when wiped slots create gaps in the sequence
         * @param messages The parsed event log
         * @param civSlots The ever alive player slots
         * @param endTurn The current game turn
         */
        predictCityCounts(messages, civSlots, endTurn) {
            const cityOwner = new Map();
            const counts = new Map(civSlots.map(slot => [slot, 0]));
            const series = new Map(civSlots.map(slot => [slot, new Int32Array(endTurn + 1)]));
            let index = 0;
            for (let turn = 0; turn <= endTurn; turn++) {
                // Events are appended in game order, so a single sweep covers the turn
                while (index < messages.length && messages[index].turn <= turn) {
                    const message = messages[index];
                    const civId = message.civId;
                    if (civId >= 0 && counts.has(civId)) {
                        if (message.type === 1 && message.tiles.length > 0) {
                            // City founded
                            const key = `${message.tiles[0].x},${message.tiles[0].y}`;
                            counts.set(civId, counts.get(civId) + 1);
                            cityOwner.set(key, civId);
                        }
                        else if (message.type === 3) {
                            // City captured: the winner gains what the loser loses
                            for (const tile of message.tiles) {
                                const key = `${tile.x},${tile.y}`;
                                const previous = cityOwner.get(key);
                                if (previous !== undefined && previous !== civId) {
                                    counts.set(previous, counts.get(previous) - 1);
                                }
                                if (previous !== civId) {
                                    counts.set(civId, counts.get(civId) + 1);
                                    cityOwner.set(key, civId);
                                }
                            }
                        }
                        else if (message.type === 4) {
                            // City razed: the current owner loses it
                            for (const tile of message.tiles) {
                                const key = `${tile.x},${tile.y}`;
                                const previous = cityOwner.get(key);
                                if (previous !== undefined) {
                                    counts.set(previous, counts.get(previous) - 1);
                                    cityOwner.delete(key);
                                }
                            }
                        }
                    }
                    index++;
                }
                for (const [slot, line] of series) {
                    line[turn] = Math.max(0, counts.get(slot) || 0);
                }
            }
            return series;
        }
        /**
         * Detect the death turn of every civ that died for good
         * A civ counts as dead when its very last event is its own conquest
         * message. A civ that was conquered but came back keeps producing events,
         * so its last event is something else entirely
         * @param messages The parsed event log
         * @param civSlots The ever alive player slots
         */
        analyzeDeaths(messages, civSlots) {
            const slotSet = new Set(civSlots);
            const lastTurn = new Map();
            const lastIsConquest = new Map();
            for (const message of messages) {
                if (slotSet.has(message.civId)) {
                    // Events arrive in game order, so the last write per civ wins
                    lastTurn.set(message.civId, message.turn);
                    lastIsConquest.set(message.civId, message.type === 0 && message.text.includes('has been conquered'));
                }
            }
            const deaths = new Map();
            for (const slot of civSlots) {
                if (lastIsConquest.get(slot)) {
                    deaths.set(slot, lastTurn.get(slot));
                }
            }
            return deaths;
        }
        /**
         * Assign clusters to player slots
         * Clusters appear in slot order, one region per slot that has any replay
         * data at all. Full regions belong to ever alive slots, bare score regions
         * to slots that never joined, and regions whose values were wiped still
         * occupy their slot in the sequence. When a full region could belong to
         * either of the next ever alive slots (a wiped slot in between), two
         * signals pick the owner: how well its city count series matches the
         * trajectory predicted from the events, and how well its score series
         * death signature matches the candidate's expected end
         * @param clusters The parsed regions in stream order
         * @param civSlots The ever alive player slots, in slot order
         * @param citySeries Predicted city counts per slot and turn
         * @param deaths Death turns per slot, for civs that died for good
         * @param endTurn The current game turn
         */
        assignClusters(clusters, civSlots, citySeries, deaths, endTurn) {
            const slotSet = new Set(civSlots);
            const neverAlive = [];
            for (let slot = 0; slot <= MAX_PLAYER_SLOT; slot++) {
                if (!slotSet.has(slot)) {
                    neverAlive.push(slot);
                }
            }
            const clusterBySlot = new Map();
            let civIndex = 0;
            let neverAliveIndex = 0;
            let unattached = 0;
            for (const cluster of clusters) {
                if (cluster.hasGameData) {
                    if (civIndex >= civSlots.length) {
                        unattached++;
                        continue;
                    }
                    // Compare the next few ever alive slots and let the data decide
                    // when a wiped slot makes the nearest candidate the wrong one
                    let chosen = 0;
                    const candidateCount = Math.min(3, civSlots.length - civIndex);
                    if (candidateCount > 1) {
                        const scores = [];
                        for (let k = 0; k < candidateCount; k++) {
                            const slot = civSlots[civIndex + k];
                            const trajectory = this.cityTrajectoryScore(cluster, slot, citySeries, endTurn);
                            const death = this.deathFit(cluster, slot, deaths, endTurn);
                            scores.push(0.5 * (trajectory < 0 ? 0 : trajectory) + 0.5 * death);
                        }
                        let best = 0;
                        for (let k = 1; k < scores.length; k++) {
                            if (scores[k] > scores[best]) {
                                best = k;
                            }
                        }
                        // Skipping a slot needs strong evidence, otherwise the nearest
                        // slot wins and wiped slots stay empty
                        if (best > 0 && scores[best] - scores[0] > 0.15) {
                            chosen = best;
                        }
                    }
                    const slot = civSlots[civIndex + chosen];
                    clusterBySlot.set(slot, cluster);
                    civIndex += chosen + 1;
                }
                else if (cluster.validEntries === 0 && cluster.nameCount > 1) {
                    // A region with many dataset names but no surviving values belongs
                    // to a civ that played: its slot is consumed even though nothing
                    // can be salvaged from it
                    if (civIndex < civSlots.length) {
                        civIndex++;
                    }
                    else {
                        unattached++;
                    }
                }
                else {
                    // A bare or wiped score series marks a slot that never joined the
                    // game, with a fallback for civs that only ever recorded a score
                    if (neverAliveIndex < neverAlive.length) {
                        neverAliveIndex++;
                    }
                    else if (civIndex < civSlots.length) {
                        civIndex++;
                    }
                    else {
                        unattached++;
                    }
                }
            }
            this.diagnostics.damagedClusters = clusters.filter(c => c.damagedEntries > 0).length;
            this.diagnostics.unattachedClusters = unattached;
            if (unattached > 0) {
                console.warn(`${unattached} replay data clusters could not be matched to a player slot`);
            }
            return clusterBySlot;
        }
        /**
         * Score how well a cluster's score series death signature matches a
         * candidate's expected end
         * The score series is written every turn for every player and drops to
         * zero for good after death, so its last nonzero turn should land on the
         * candidate's death turn, or on the final turn for a survivor
         * @returns A fit between 0 and 1, or 0 when the signature is unreadable
         */
        deathFit(cluster, slot, deaths, endTurn) {
            if (cluster.scoreLastNonzeroTurn < 0) {
                return 0;
            }
            const expected = deaths.has(slot) ? deaths.get(slot) : endTurn;
            return Math.max(0, 1 - Math.abs(cluster.scoreLastNonzeroTurn - expected) / 20);
        }
        /**
         * Score how well a cluster's city count series matches the city trajectory
         * predicted from the events of one slot
         * @returns The fraction of matching turns, or -1 when there is too little
         * clean data to judge
         */
        cityTrajectoryScore(cluster, slot, citySeries, endTurn) {
            const entries = cluster.datasets.get(DATASET_PREFIX + 'CITYCOUNT');
            const line = citySeries.get(slot);
            if (!entries || !line || entries.length === 0) {
                return -1;
            }
            let comparable = 0;
            let matches = 0;
            for (const entry of entries) {
                if (entry.turn <= endTurn) {
                    comparable++;
                    if (entry.value === line[entry.turn]) {
                        matches++;
                    }
                }
            }
            return comparable >= 30 ? matches / comparable : -1;
        }
        /**
         * Read the map section: dimensions from the grid header right after the
         * savegame database, plus the rest of the header (land and owned plot
         * counts, natural wonders, latitudes, wrap flags). The header fields can
         * carry corrupted high bytes, so both dimensions are masked to their low
         * sixteen bits. When the landmark does not validate, the event coordinates
         * provide a fallback estimate and no header is returned. The section
         * position is returned alongside so the terrain walker can start from there
         * @param state Reader over the decompressed game state
         * @param messages The parsed event log
         */
        readMapSection(state, messages) {
            const body = this.decompressed;
            const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
            // First choice: the grid header right after the savegame database
            const dbPos = findBytes(body, stringToBytes(SQLITE_MAGIC), 0);
            if (dbPos > 4) {
                const dbSize = view.getInt32(dbPos - 4, true);
                const mapPos = dbPos + dbSize;
                if (dbSize > 0 && mapPos + MAP_HEADER_SIZE <= body.byteLength) {
                    state.seek(mapPos);
                    const width = state.getInt32() & 0xffff;
                    const height = state.getInt32() & 0xffff;
                    if (this.validateMapDims(width, height, messages)) {
                        // The rest of the 47 byte header: plot counts, natural wonders,
                        // latitudes, wrap flags, a 16 byte GUID, and the generated flag
                        const landPlots = state.getInt32();
                        const ownedPlots = state.getInt32();
                        const numNaturalWonders = state.getInt32();
                        const topLatitude = state.getInt32();
                        const bottomLatitude = state.getInt32();
                        const wrapX = state.getInt8() !== 0;
                        const wrapY = state.getInt8() !== 0;
                        state.getBytes(16); // Map GUID, of no use to the viewer
                        const mapGenerated = state.getInt8() !== 0;
                        this.diagnostics.mapDimsSource = 'map-section';
                        const header = { width, height, landPlots, ownedPlots, numNaturalWonders, topLatitude, bottomLatitude, wrapX, wrapY, mapGenerated };
                        return { width, height, mapPos, header };
                    }
                }
            }
            // Fallback: the largest coordinates seen in the events
            let maxX = 0;
            let maxY = 0;
            for (const message of messages) {
                for (const tile of message.tiles) {
                    if (tile.x > maxX)
                        maxX = tile.x;
                    if (tile.y > maxY)
                        maxY = tile.y;
                }
            }
            if (maxX > 0 && maxY > 0) {
                this.diagnostics.mapDimsSource = 'events';
                return { width: maxX + 1, height: maxY + 1, mapPos: -1, header: null };
            }
            this.diagnostics.mapDimsSource = 'none';
            return { width: 0, height: 0, mapPos: -1, header: null };
        }
        /**
         * Check that map dimensions are plausible given the event coordinates
         */
        validateMapDims(width, height, messages) {
            if (width < 16 || width > 512 || height < 16 || height > 512) {
                return false;
            }
            for (const message of messages) {
                for (const tile of message.tiles) {
                    if (tile.x >= width || tile.y >= height) {
                        return false;
                    }
                }
            }
            return true;
        }
        /**
         * Assemble the output in the same shape the replay parser produces, plus
         * the save-only extras: the map header, the victory result, the player
         * slots behind the civilization list, and the per civ dataset diagnostics
         */
        assembleRawData(header, prelude, victory, civs, civSlots, slotToIndex, messages, clusters, clusterBySlot, mapDims, terrain) {
            // Union of all dataset names, alphabetical like the replay file order
            const datasetNames = new Set();
            for (const cluster of clusters) {
                for (const name of cluster.datasets.keys()) {
                    datasetNames.add(name);
                }
            }
            const datasets = Array.from(datasetNames).sort().map(key => ({ key }));
            // Per civ value tables aligned with the dataset name list
            const datasetValues = civSlots.map(slot => {
                const cluster = clusterBySlot.get(slot);
                return datasets.map(d => (cluster && cluster.datasets.get(d.key)) || []);
            });
            // Per civ dataset quality, so statistics can label uncertain series
            const datasetDiagnostics = civSlots.map(slot => {
                const cluster = clusterBySlot.get(slot);
                return { attached: cluster !== undefined, damagedEntries: cluster ? cluster.damagedEntries : 0 };
            });
            // Remap the raw slot ids in the events to dense civ indices
            const events = messages.map(message => {
                var _a;
                return ({
                    turn: message.turn,
                    type: message.type,
                    tiles: message.tiles,
                    civId: message.civId >= 0 ? ((_a = slotToIndex.get(message.civId)) !== null && _a !== void 0 ? _a : -1) : message.civId,
                    text: message.text
                });
            });
            // Tiles from the plot walk when it passed the quality gate, otherwise
            // placeholders: the hex grid renders without textures while cities,
            // borders and event highlights stay fully functional
            const tiles = [];
            if (mapDims.width > 0 && mapDims.height > 0) {
                for (let i = 0; i < mapDims.width * mapDims.height; i++) {
                    const t = terrain && terrain.tiles[i];
                    if (t) {
                        tiles.push({
                            elevation: t.elevation, type: t.type, feature: t.feature, rivers: t.rivers,
                            owner: t.owner, resource: t.resource, improvement: t.improvement, route: t.route,
                            isCity: t.isCity, owningCityOwner: t.owningCityOwner, owningCityId: t.owningCityId
                        });
                    }
                    else {
                        tiles.push({
                            elevation: -1, type: -1, feature: -1, rivers: [],
                            owner: -1, resource: -1, improvement: -1, route: -1,
                            isCity: 0, owningCityOwner: -1, owningCityId: -1
                        });
                    }
                }
            }
            return {
                game: header.game,
                version: header.version,
                build: header.build,
                playerCiv: header.playerCiv,
                playerColor: header.playerColor,
                difficulty: header.difficulty,
                eraStart: header.eraStart,
                eraEnd: header.eraEnd,
                gameSpeed: header.gameSpeed,
                worldSize: header.worldSize,
                mapScript: header.mapScript,
                dlc: header.dlc,
                mods: header.mods,
                startTurn: prelude.startTurn,
                startYear: prelude.startYear,
                endTurn: prelude.endTurn,
                endYear: `Turn ${prelude.endTurn}`,
                civs,
                civSlots,
                datasets,
                datasetValues,
                datasetDiagnostics,
                events,
                mapWidth: mapDims.width,
                mapHeight: mapDims.height,
                mapHeader: mapDims.header,
                victory,
                tiles
            };
        }
    }

    /**
     * event-parser.ts
     * Handles parsing and processing of game events
     * Adds human-readable information and manages city tracking
     */
    /**
     * EventParser class
     * Processes raw game events and enriches them with contextual information
     */
    class EventParser {
        constructor(replay) {
            this.cities = {};
            this.replay = replay;
        }
        /**
         * Process game events and add human-readable information
         * @param events Raw events from replay data
         * @returns Processed events with enriched data
         */
        processEvents(events) {
            this.cities = {};
            const processedEvents = [];
            events.forEach((event, index) => {
                const eventsToAdd = [event];
                event.index = index;
                // Add x/y reference for single-tile events
                if (event.tiles && event.tiles.length === 1 &&
                    event.type !== EventType.TilesClaimed) {
                    event.x = event.tiles[0].x;
                    event.y = event.tiles[0].y;
                }
                // Process specific event types
                if (event.type === EventType.CityFounded) {
                    this.processCityFoundedEvent(event);
                }
                else if (event.type === EventType.CityRazed) {
                    eventsToAdd.push(...this.processCityRazedEvents(event));
                }
                else if (event.type === EventType.CitiesTransferred) {
                    this.processCitiesTransferredEvent(event);
                }
                else if (event.type === EventType.TilesClaimed) {
                    this.processTilesClaimedEvent(event);
                }
                else if (event.type === EventType.Message) {
                    this.processMessageEvent(event);
                }
                processedEvents.push(...eventsToAdd);
            });
            return processedEvents;
        }
        /**
         * Process city founded event
         */
        processCityFoundedEvent(event) {
            const cityName = (event.text || '').replace(' is founded.', '');
            const civName = this.replay.getCivName(event.civId);
            event.city = { name: cityName, owner: civName };
            if (event.x !== undefined && event.y !== undefined) {
                this.cities[`${event.x},${event.y}`] = event.city;
            }
            event.text = `Founded the city of ${cityName}.`;
        }
        /**
         * Process city razed events (can be multiple if mass razing)
         */
        processCityRazedEvents(event) {
            const additionalEvents = [];
            if (event.tiles && event.tiles.length > 0) {
                event.x = event.tiles[0].x;
                event.y = event.tiles[0].y;
                event.city = this.cities[`${event.x},${event.y}`];
                if (event.city) {
                    event.text = `Burned ${event.city.name} to the ground!`;
                }
                // Handle mass razings
                event.tiles.slice(1).forEach((tile) => {
                    const eventCopy = Object.assign({}, event);
                    eventCopy.x = tile.x;
                    eventCopy.y = tile.y;
                    eventCopy.city = this.cities[`${tile.x},${tile.y}`];
                    if (eventCopy.city) {
                        eventCopy.text = `Burned ${eventCopy.city.name} to the ground!`;
                    }
                    additionalEvents.push(eventCopy);
                });
            }
            return additionalEvents;
        }
        /**
         * Process cities transferred event
         */
        processCitiesTransferredEvent(event) {
            if (!event.tiles)
                return;
            const cityNames = event.tiles.map((tile) => {
                const city = this.cities[`${tile.x},${tile.y}`];
                return city ? city.name : 'Unknown';
            });
            if (cityNames.length === 1) {
                event.text = `Controls the city of ${cityNames[0]}.`;
            }
            else if (cityNames.length > 1) {
                const lastCity = cityNames.pop();
                const citiesString = cityNames.length === 1 ? cityNames[0] : cityNames.join(', ') + ',';
                event.text = `Controls the cities of ${citiesString} and ${lastCity}.`;
            }
        }
        /**
         * Process tiles claimed event
         */
        processTilesClaimedEvent(event) {
            if (!event.tiles)
                return;
            const tileCount = event.tiles.length;
            const action = this.replay.getCivName(event.civId) === null ? 'Released' : 'Claimed';
            event.text = `${action} ${tileCount} tile${tileCount > 1 ? 's' : ''}.`;
        }
        /**
         * Process message event
         */
        processMessageEvent(event) {
            if (!event.text)
                return;
            // Find the mistakenly encoded UTF8 arrow and replace it
            if (event.text.includes("â")) {
                event.text = event.text.replace(/â\u0086\u0092/g, "→");
                event.type = EventType.Strategies;
            }
        }
        /**
         * Get the cities registry
         * @returns Record of city coordinates to city data
         */
        getCities() {
            return this.cities;
        }
    }

    /**
     * arrays.ts
     * Array helpers shared across the app
     */
    /**
     * Split an array into fixed-size chunks, with the last chunk taking the remainder
     */
    function chunk(array, size) {
        const result = [];
        for (let i = 0; i < array.length; i += size) {
            result.push(array.slice(i, i + size));
        }
        return result;
    }
    /**
     * Binary search for the last item whose turn is at or before the given turn
     * The items must be sorted by turn
     */
    function lastAtOrBefore(items, turn) {
        let low = 0;
        let high = items.length - 1;
        let found;
        while (low <= high) {
            const mid = (low + high) >> 1;
            if (items[mid].turn <= turn) {
                found = items[mid];
                low = mid + 1;
            }
            else {
                high = mid - 1;
            }
        }
        return found;
    }

    /**
     * replay-data.ts
     * Shapes raw parser output into the structures the Replay hub stores
     */
    /**
     * Index the per-civilization dataset tables by dataset name
     * Each dataset becomes one series of turn and value pairs per civilization
     */
    function indexDatasets(datasets, datasetValues) {
        if (!datasets || !datasetValues) {
            return {};
        }
        const indexed = {};
        datasets.forEach((dataset, index) => {
            indexed[dataset.key] = datasetValues.map((civData) => civData[index] || []);
        });
        return indexed;
    }
    /**
     * Convert raw parsed tiles into the hex grid: enum-typed tiles chunked into
     * rows of mapWidth and stamped with their grid coordinates
     */
    function buildTileGrid(tiles, mapWidth) {
        const processed = tiles.map((tile) => {
            var _a, _b;
            const converted = {
                x: 0, // Filled in below, once the row structure exists
                y: 0,
                elevation: ((_a = tile.elevationId) !== null && _a !== void 0 ? _a : ElevationType.AboveSeaLevel),
                type: tile.type,
                feature: ((_b = tile.featureId) !== null && _b !== void 0 ? _b : FeatureType.NoFeature)
            };
            // Copy any additional raw properties
            Object.keys(tile).forEach(key => {
                converted[key] = tile[key];
            });
            return converted;
        });
        const rows = chunk(processed, mapWidth);
        for (let y = 0; y < rows.length; y++) {
            for (let x = 0; x < rows[y].length; x++) {
                rows[y][x].x = x;
                rows[y][x].y = y;
            }
        }
        return rows;
    }

    /**
     * replay.ts
     * Data hub for Civilization V (Vox Populi) replay files
     * Manages parsed replay data and provides utility functions for data access
     */
    /**
     * Replay class - Data hub for replay information
     * Provides centralized access to all replay data and utility functions
     */
    class Replay {
        constructor() {
            // Core metadata (absorbed from ReplayMetadata)
            this.startTurn = 0;
            this.endTurn = 0;
            this.startYear = 0;
            this.endYear = '';
            this.mapWidth = 0;
            this.mapHeight = 0;
            // Which kind of file this data came from
            this.source = 'replay';
            // Kind of every data area the loaded file carries, so views never have to
            // guess whether something is available at every turn (history) or only at
            // the save's turn (snapshot). Built per load in processRawData: a replay
            // file never has snapshot areas, and a save whose terrain walk failed has
            // neither rivers nor the plot snapshot.
            this.dataKinds = {};
            // Game configuration (absorbed from RawReplayData)
            this.game = '';
            this.version = '';
            this.build = '';
            this.playerCiv = '';
            this.playerColor = '';
            this.difficulty = '';
            this.eraStart = '';
            this.eraEnd = '';
            this.gameSpeed = '';
            this.worldSize = '';
            this.mapScript = '';
            this.dlc = [];
            this.mods = [];
            // Core game data
            this.civs = [];
            this.cities = {};
            this.events = [];
            this.datasets = {};
            this.tiles = [];
            // Save-only extras, null or empty when the source is a replay file
            /** Player slot behind each civilization, so snapshot slot ids can be mapped to civs */
            this.civSlots = [];
            /** Map header of the save (wrap flags and map-wide counts), null when unavailable */
            this.mapHeader = null;
            /** Victory result, proven by the file or asserted by a shared link; only reliable results may be presented */
            this.victory = null;
            /** Dataset quality per civilization, aligned with the civs list */
            this.datasetDiagnostics = [];
        }
        /**
         * Load replay data from a binary file
         * Replay files parse synchronously, save files are routed through the
         * save parser which inflates the compressed game state first
         * @param file The raw file contents
         * @param size The size of the file data within the buffer
         */
        async loadFromFile(file, size) {
            const fromSave = isSaveFile(file);
            this.source = fromSave ? 'save' : 'replay';
            const rawData = fromSave
                ? await new SaveParser(file, size).parseReplay()
                : new ReplayParser(file, size).parse(false);
            this.processRawData(rawData);
        }
        /**
         * Process raw parsed data and populate the replay instance
         */
        processRawData(rawData) {
            var _a, _b;
            // Store metadata fields
            this.startTurn = rawData.startTurn;
            this.endTurn = rawData.endTurn;
            this.startYear = rawData.startYear;
            this.endYear = rawData.endYear;
            this.mapWidth = rawData.mapWidth;
            this.mapHeight = rawData.mapHeight;
            // Store game configuration
            this.game = rawData.game;
            this.version = rawData.version;
            this.build = rawData.build;
            this.playerCiv = rawData.playerCiv;
            this.playerColor = rawData.playerColor;
            this.difficulty = rawData.difficulty;
            this.eraStart = rawData.eraStart;
            this.eraEnd = rawData.eraEnd;
            this.gameSpeed = rawData.gameSpeed;
            this.worldSize = rawData.worldSize;
            this.mapScript = rawData.mapScript;
            this.dlc = rawData.dlc || [];
            this.mods = rawData.mods || [];
            // Store civilizations
            this.civs = rawData.civs || [];
            // Store the save-only extras. Replay files carry byte exact series, so
            // every civilization starts with clean dataset diagnostics there
            this.civSlots = rawData.civSlots || [];
            this.mapHeader = (_a = rawData.mapHeader) !== null && _a !== void 0 ? _a : null;
            this.victory = (_b = rawData.victory) !== null && _b !== void 0 ? _b : null;
            this.datasetDiagnostics = rawData.datasetDiagnostics ||
                this.civs.map(() => ({ attached: true, damagedEntries: 0 }));
            // Index the datasets by name
            this.datasets = indexDatasets(rawData.datasets, rawData.datasetValues);
            // Process events
            this.processEvents(rawData.events || []);
            // Build the tile grid
            this.tiles = buildTileGrid(rawData.tiles || [], this.mapWidth);
            // Mark the kind of every data area this file carries. Terrain, rivers,
            // and the map header are fixed when the map is generated, so they count
            // as history even though only save files carry them; the plot snapshot
            // fields describe the save's game state and count as snapshot. The
            // terrain walk fills the tiles from the first record onward, so a real
            // first tile (not the -1 placeholder) means the walk succeeded
            const kinds = {
                terrain: DataKind.History,
                events: DataKind.History,
                datasets: DataKind.History,
                ownership: DataKind.History
            };
            if (this.source === 'save') {
                if (this.mapHeader) {
                    kinds.mapHeader = DataKind.History;
                }
                const firstTile = this.tiles.length > 0 && this.tiles[0].length > 0 ? this.tiles[0][0] : null;
                if (firstTile && firstTile.elevation !== -1) {
                    kinds.rivers = DataKind.History;
                    kinds.plotSnapshot = DataKind.Snapshot;
                }
            }
            this.dataKinds = kinds;
        }
        /**
         * Process game events and add human-readable information
         */
        processEvents(events) {
            const eventParser = new EventParser(this);
            this.events = eventParser.processEvents(events);
            this.cities = eventParser.getCities();
        }
        // ========== UTILITY FUNCTIONS ==========
        /**
         * Get civilization name from ID
         */
        getCivName(civId) {
            if (civId === undefined || civId < 0 || civId >= this.civs.length) {
                return null;
            }
            return this.civs[civId].name;
        }
        /**
         * Map a raw player slot from snapshot data to a civilization index
         * @returns The civilization index, or -1 when no civilization uses the slot
         */
        getCivIdForSlot(slot) {
            return this.civSlots.indexOf(slot);
        }
        /**
         * Apply a winner asserted through the winner parameter of a shared link
         * A save taken before the game was won carries no proof of the result,
         * so the sharer can pass it externally. The link only fills the gap: a
         * result the file itself proved always stands, and the applied result is
         * marked as link sourced so the interface can attribute it
         * @param winnerCivId The winning civilization index
         * @returns True when the link winner was applied
         */
        applyLinkVictory(winnerCivId) {
            if (this.victory !== null && this.victory.reliable && this.victory.source === 'file') {
                return false;
            }
            if (winnerCivId < 0 || winnerCivId >= this.civs.length) {
                return false;
            }
            this.victory = {
                winningTurn: -1,
                winnerTeam: -1,
                victoryType: -1,
                gameState: -1,
                winnerCivId,
                reliable: true,
                source: 'link'
            };
            return true;
        }
        /**
         * Get civilization color from ID or name
         */
        getCivColor(civIdOrName) {
            const civName = typeof civIdOrName === 'number'
                ? this.getCivName(civIdOrName)
                : civIdOrName;
            if (!civName) {
                return null;
            }
            return getCivColors(civName);
        }
        /**
         * Get city at specific coordinates
         */
        getCityAt(x, y) {
            return this.cities[`${x},${y}`] || null;
        }
        /**
         * Get tile at specific coordinates
         */
        getTileAt(x, y) {
            if (y >= 0 && y < this.tiles.length && x >= 0 && x < this.tiles[y].length) {
                return this.tiles[y][x];
            }
            return null;
        }
        /**
         * Get all events for a specific turn
         */
        getEventsForTurn(turn) {
            return this.events.filter(event => event.turn === turn);
        }
        /**
         * Get the value series of a dataset for a specific civilization
         */
        getDatasetForCiv(datasetName, civId) {
            const dataset = this.datasets[datasetName];
            if (!dataset || !dataset[civId]) {
                return [];
            }
            return dataset[civId];
        }
    }

    /**
     * ownership.ts
     * Compact per-turn tile ownership derived from the replay events
     * Instead of a full copy of the tile state for every turn, each tile keeps
     * a short list of changes, and the state at any turn comes from the last
     * change recorded at or before that turn
     */
    /**
     * OwnershipTimeline class
     * Answers which civilization owns each tile and which city stands on it at
     * any turn, built once from the event log
     */
    class OwnershipTimeline {
        constructor(events, getCivName) {
            // Change lists per tile key ("x,y"), each ordered by turn
            this.changesByTile = new Map();
            // The last materialized turn state, so repeated requests for the same turn
            // share one object and identity checks in the map layers keep working
            this.cachedTurn = -1;
            this.cachedState = {};
            this.build(events, getCivName);
        }
        /**
         * Total number of recorded changes, one per actual ownership or city change
         */
        get changeCount() {
            let total = 0;
            for (const changes of this.changesByTile.values()) {
                total += changes.length;
            }
            return total;
        }
        /**
         * Tile state at a turn: every tile whose last change at or before that
         * turn left it owned or carrying a city
         */
        stateAt(turn) {
            if (turn === this.cachedTurn) {
                return this.cachedState;
            }
            const state = {};
            for (const [key, changes] of this.changesByTile) {
                const change = lastAtOrBefore(changes, turn);
                if (change === undefined) {
                    continue;
                }
                const info = {};
                if (change.owner !== undefined) {
                    info.owner = change.owner;
                }
                if (change.city !== undefined) {
                    info.city = change.city;
                }
                if (info.owner !== undefined || info.city !== undefined) {
                    state[key] = info;
                }
            }
            this.cachedTurn = turn;
            this.cachedState = state;
            return state;
        }
        /**
         * Walk the events in order and record each tile's visible state whenever
         * it changes, mirroring how the renderer used to fold events into per-turn
         * copies of the map
         */
        build(events, getCivName) {
            // The tile states as of the event currently being processed
            const current = new Map();
            // Records the tile's current state as the situation from this turn on,
            // skipping tiles whose visible state did not actually change
            const record = (key, turn) => {
                const entry = current.get(key);
                const owner = entry && entry.owner;
                const city = entry && entry.city;
                const changes = this.changesByTile.get(key);
                if (changes) {
                    const last = changes[changes.length - 1];
                    if (last.owner === owner && last.city === city) {
                        return;
                    }
                }
                const change = { turn };
                if (owner !== undefined) {
                    change.owner = owner;
                }
                if (city !== undefined) {
                    change.city = city;
                }
                if (changes) {
                    changes.push(change);
                }
                else {
                    this.changesByTile.set(key, [change]);
                }
            };
            for (const event of events) {
                switch (event.type) {
                    case EventType.CityFounded: {
                        if (event.x === undefined || event.y === undefined || !event.city) {
                            break;
                        }
                        // A founding resets the tile: the new city stands on it and the
                        // founder becomes its owner
                        const key = `${event.x},${event.y}`;
                        const civName = getCivName(event.civId);
                        const entry = { city: event.city.name };
                        if (civName) {
                            entry.owner = civName;
                        }
                        current.set(key, entry);
                        record(key, event.turn);
                        break;
                    }
                    case EventType.TilesClaimed: {
                        if (!event.tiles) {
                            break;
                        }
                        const civName = getCivName(event.civId);
                        for (const tile of event.tiles) {
                            const key = `${tile.x},${tile.y}`;
                            if (civName) {
                                const entry = current.get(key) || {};
                                entry.owner = civName;
                                current.set(key, entry);
                                record(key, event.turn);
                            }
                            else if (current.has(key)) {
                                // Clear ownership without erasing a city that has not been razed.
                                const entry = current.get(key);
                                delete entry.owner;
                                if (!entry.city)
                                    current.delete(key);
                                record(key, event.turn);
                            }
                        }
                        break;
                    }
                    case EventType.CitiesTransferred: {
                        if (!event.tiles) {
                            break;
                        }
                        const civName = getCivName(event.civId);
                        if (!civName) {
                            break;
                        }
                        for (const tile of event.tiles) {
                            // A transfer moves ownership and leaves any city in place
                            const key = `${tile.x},${tile.y}`;
                            const entry = current.get(key) || {};
                            entry.owner = civName;
                            current.set(key, entry);
                            record(key, event.turn);
                        }
                        break;
                    }
                    case EventType.CityRazed: {
                        if (event.x === undefined || event.y === undefined) {
                            break;
                        }
                        // A razing removes the city and keeps the owner
                        const key = `${event.x},${event.y}`;
                        const entry = current.get(key);
                        if (entry && entry.city !== undefined) {
                            delete entry.city;
                            record(key, event.turn);
                        }
                        break;
                    }
                }
            }
        }
    }

    /**
     * session.ts
     * The game session model: one loaded game, the current turn, the selection,
     * and the per-turn state derived from the events
     * The map, the event log, and the timeline subscribe to the session instead
     * of calling each other
     */
    /**
     * GameSession class
     * Owns the loaded game and the current turn, and lets the views follow both
     */
    class GameSession {
        constructor(replay) {
            this.listeners = new Set();
            this.replay = replay;
            this.currentTurn = replay.startTurn;
            this.selection = { kind: 'none' };
            this.ownership = new OwnershipTimeline(replay.events, (civId) => replay.getCivName(civId));
        }
        /**
         * First turn available on the timeline
         */
        get startTurn() {
            return this.replay.startTurn;
        }
        /**
         * Last turn available on the timeline
         */
        get endTurn() {
            return this.replay.endTurn;
        }
        /**
         * Tile ownership and cities at a turn, derived from the events up to it
         */
        stateAt(turn) {
            return this.ownership.stateAt(turn);
        }
        /**
         * Number of ownership changes the timeline stores, a measure of how
         * compactly the per-turn state is kept
         */
        ownershipChangeCount() {
            return this.ownership.changeCount;
        }
        /**
         * Move to a turn, clamped to the replay's range, and notify subscribers
         */
        setTurn(turn) {
            const clamped = Math.min(Math.max(turn, this.startTurn), this.endTurn);
            this.currentTurn = clamped;
            const state = this.ownership.stateAt(clamped);
            for (const listener of this.listeners) {
                listener(clamped, state);
            }
        }
        /**
         * Change what the user is inspecting; views read this on demand
         */
        setSelection(selection) {
            this.selection = selection;
        }
        /**
         * Subscribe to turn changes
         * @returns A function that unsubscribes the listener again
         */
        subscribe(listener) {
            this.listeners.add(listener);
            return () => {
                this.listeners.delete(listener);
            };
        }
    }

    /**
     * throttle.ts
     * Utility function to throttle function execution
     * Prevents a function from being called more than once within a specified time period
     */
    /**
     * Creates a throttled version of a function that limits execution frequency
     * @param func - The function to throttle
     * @param delay - The minimum delay in milliseconds between executions
     * @returns A throttled version of the function
     */
    function throttle(func, delay) {
        let timeoutId = null;
        let lastExecutionTime = 0;
        let pendingArgs = null;
        return function (...args) {
            const currentTime = Date.now();
            const timeSinceLastExecution = currentTime - lastExecutionTime;
            const context = this;
            // Clear any existing timeout
            if (timeoutId !== null) {
                clearTimeout(timeoutId);
                timeoutId = null;
            }
            // If enough time has passed, execute immediately
            if (timeSinceLastExecution >= delay) {
                lastExecutionTime = currentTime;
                func.apply(context, args);
            }
            else {
                // Otherwise, store the args and schedule execution
                pendingArgs = args;
                const remainingDelay = delay - timeSinceLastExecution;
                timeoutId = setTimeout(() => {
                    if (pendingArgs !== null) {
                        lastExecutionTime = Date.now();
                        func.apply(context, pendingArgs);
                        pendingArgs = null;
                    }
                    timeoutId = null;
                }, remainingDelay);
            }
        };
    }

    /**
     * replay-viewer.ts
     * Top-level UI component for the replay viewer
     * Owns file opening (dialog, drag and drop, shared links, bundled examples),
     * the loading and error feedback, the header summary, the destination tabs,
     * and the address bar state. Connects the loaded game session to the map,
     * the event log, the layers panel, and the playback bar.
     */
    // The example games offered in the empty state
    const exampleGames = [
        { label: 'Game 1', file: 'examples/1.Civ5Replay', kind: 'replay' },
        { label: 'Game 2', file: 'examples/2.Civ5Replay', kind: 'replay' },
        { label: 'Game 3', file: 'examples/3.Civ5Replay', kind: 'replay' },
        { label: 'Game 4', file: 'examples/4.Civ5Save', kind: 'save' },
        { label: 'Game 5', file: 'examples/5.Civ5Save', kind: 'save' }
    ];
    // How long an error banner stays on screen before dismissing itself
    const errorBannerTimeoutMs = 10000;
    // How often the address bar is refreshed while the turn changes
    const urlSyncThrottleMs = 400;
    /**
     * Turn a raw file enum value into a display name, so "GAMESPEED_STANDARD"
     * reads as "Standard" and "WORLDSIZE_SMALL" as "Small"
     */
    function prettifyEnumValue(value) {
        // Keep only the part after the last underscore
        const name = value.split('_').pop() || value;
        // Title case the remaining words
        return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
    }
    /**
     * ReplayViewer class
     * Handles user interactions and connects the loaded game session to the
     * visualization components
     */
    class ReplayViewer {
        constructor() {
            this.session = null; // Game session for the loaded game
            this.eventLog = null; // Event log UI component
            this.layersControl = null; // Map layers panel
            // UI state
            this.fileUrl = null; // file parameter from the address bar, kept for shared links
            this.fileLabel = null; // Display name of the loaded file
            this.initialTurn = null; // turn parameter, applied once the session exists
            this.view = 'map'; // Selected destination tab
            this.annotations = {}; // playerN labels from the address bar
            this.linkWinner = null; // winner parameter, applied once a file is loaded
            this.isLoading = false; // A file is being read or parsed
            this.errorTimeout = null; // Auto-dismiss timer for the error banner
            this.unsubscribeTurnSync = null; // Stops URL syncing
            this.map = new ReplayMap();
            this.controlBar = new ControlBar();
            this.emptyState = document.getElementById('emptyState');
            this.loadingOverlay = document.getElementById('loadingOverlay');
            this.loadingText = document.getElementById('loadingText');
            this.errorBanner = document.getElementById('errorBanner');
            this.errorText = document.getElementById('errorText');
            this.gameSummary = document.getElementById('gameSummary');
            this.annotationLine = document.getElementById('annotationLine');
            this.fileInput = document.getElementById('fileInput');
            this.syncUrlState = throttle(() => this.writeUrlState(), urlSyncThrottleMs);
            this.setupOpenControls();
            this.setupDragAndDrop();
            this.setupTabs();
            this.setupMapButtons();
            this.setupErrorBanner();
            this.buildExampleButtons();
            this.handleUrlParameters();
        }
        /**
         * Wire the Open buttons and the hidden file input
         */
        setupOpenControls() {
            const openButtons = [document.getElementById('openButton'), document.getElementById('emptyOpenButton')];
            openButtons.forEach(button => {
                button.addEventListener('click', () => this.fileInput.click());
            });
            this.fileInput.addEventListener('change', () => {
                const file = this.fileInput.files && this.fileInput.files[0];
                if (file) {
                    this.loadFile(file);
                }
                // Let the same file be picked again later
                this.fileInput.value = '';
            });
        }
        /**
         * Wire drag and drop on the whole page
         */
        setupDragAndDrop() {
            const dropZone = document.body;
            // Prevent the browser from navigating away for any drag
            const preventDefaults = (e) => {
                e.preventDefault();
                e.stopPropagation();
            };
            // Visual feedback for drag operations
            const highlight = () => dropZone.classList.add('drag-over');
            const unhighlight = () => dropZone.classList.remove('drag-over');
            // Handle dropped files
            const handleDrop = (e) => {
                var _a;
                unhighlight();
                const files = (_a = e.dataTransfer) === null || _a === void 0 ? void 0 : _a.files;
                if (files && files.length > 0) {
                    this.loadFile(files[0]);
                }
            };
            ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
                dropZone.addEventListener(eventName, preventDefaults, false);
            });
            ['dragenter', 'dragover'].forEach(eventName => {
                dropZone.addEventListener(eventName, highlight, false);
            });
            ['dragleave', 'drop'].forEach(eventName => {
                dropZone.addEventListener(eventName, unhighlight, false);
            });
            dropZone.addEventListener('drop', handleDrop, false);
        }
        /**
         * Wire the destination tabs shown on narrow screens
         */
        setupTabs() {
            const tabs = document.querySelectorAll('.view-tab');
            tabs.forEach(tab => {
                tab.addEventListener('click', () => {
                    this.setView(tab.dataset.view);
                });
            });
        }
        /**
         * Wire the zoom and fit buttons that sit on the map
         */
        setupMapButtons() {
            document.getElementById('zoomInButton').addEventListener('click', () => this.map.map.zoomIn());
            document.getElementById('zoomOutButton').addEventListener('click', () => this.map.map.zoomOut());
            document.getElementById('fitButton').addEventListener('click', () => this.map.fitMap());
        }
        /**
         * Wire the error banner's dismiss button and its auto-hide timer
         */
        setupErrorBanner() {
            document.getElementById('errorDismiss').addEventListener('click', () => this.hideError());
        }
        /**
         * Build one button per bundled example game into the empty state
         */
        buildExampleButtons() {
            const container = document.getElementById('exampleButtons');
            exampleGames.forEach(example => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'action-button example-button';
                const icon = document.createElement('i');
                icon.className = example.kind === 'save' ? 'fa-solid fa-floppy-disk' : 'fa-solid fa-file-lines';
                icon.setAttribute('aria-hidden', 'true');
                const label = document.createElement('span');
                label.textContent = example.label;
                const kind = document.createElement('span');
                kind.className = 'example-kind';
                kind.textContent = example.kind;
                button.appendChild(icon);
                button.appendChild(label);
                button.appendChild(kind);
                button.addEventListener('click', () => this.loadFromUrl(example.file, example.label));
                container.appendChild(button);
            });
        }
        /**
         * Read the address bar: file, turn, view, playerN annotations, and winner
         */
        handleUrlParameters() {
            const urlParams = new URLSearchParams(window.location.search);
            this.fileUrl = urlParams.get('file');
            this.annotations = parseCivAnnotations(urlParams);
            this.linkWinner = urlParams.get('winner');
            const turnParam = urlParams.get('turn');
            this.initialTurn = turnParam !== null ? parseInt(turnParam, 10) : null;
            const viewParam = urlParams.get('view');
            this.setView(viewParam === 'events' ? 'events' : 'map');
            if (this.fileUrl) {
                this.loadFromUrl(this.fileUrl, this.labelFromFileReference(this.fileUrl));
            }
        }
        /**
         * Derive a display label from a file name or URL, e.g. "4.Civ5Save"
         * becomes "Game 4" and "my-game.Civ5Replay" becomes "my-game"
         */
        labelFromFileReference(reference) {
            // Keep only the part after the last slash
            const fileName = reference.split('/').pop() || reference;
            // Drop the file extension
            const base = fileName.replace(/\.(Civ5Replay|Civ5Save)$/i, '');
            // Plain numbers are the bundled example games
            if (/^\d+$/.test(base)) {
                return `Game ${base}`;
            }
            return base || fileName;
        }
        /**
         * Switch the destination tab and let the address bar know
         */
        setView(view) {
            this.view = view;
            document.body.dataset.view = view;
            // Mark the matching tab active
            document.querySelectorAll('.view-tab').forEach(tab => {
                tab.classList.toggle('active', tab.dataset.view === view);
            });
            // The map needs a size refresh when it becomes visible again
            if (view === 'map' && this.hasReplay()) {
                requestAnimationFrame(() => this.map.invalidateSize());
            }
            this.syncUrlState();
        }
        /**
         * Write the current turn, destination, and file into the address bar so a
         * copied link lands where the user is looking. The playerN and winner
         * parameters are kept exactly as the sharer wrote them.
         */
        writeUrlState() {
            const params = new URLSearchParams(window.location.search);
            // A locally opened file cannot be shared, so the stale parameter goes
            if (this.fileUrl) {
                params.set('file', this.fileUrl);
            }
            else {
                params.delete('file');
            }
            if (this.session) {
                params.set('turn', String(this.session.currentTurn));
            }
            else if (this.initialTurn !== null && !Number.isNaN(this.initialTurn)) {
                params.set('turn', String(this.initialTurn));
            }
            else {
                params.delete('turn');
            }
            params.set('view', this.view);
            const query = params.toString();
            const url = query ? `${window.location.pathname}?${query}` : window.location.pathname;
            window.history.replaceState(null, '', url);
        }
        /**
         * Load a replay file from the user's disk
         */
        loadFile(file) {
            if (this.isLoading)
                return;
            this.isLoading = true;
            this.fileUrl = null; // A local file has no shareable URL
            this.fileLabel = this.labelFromFileReference(file.name);
            this.showLoading(this.fileLabel);
            const reader = new FileReader();
            reader.onloadend = (e) => {
                var _a;
                const result = (_a = e.target) === null || _a === void 0 ? void 0 : _a.result;
                if (result) {
                    void this.processReplayData(result, result.byteLength);
                }
                else {
                    this.isLoading = false;
                    this.hideLoading();
                    this.showError('Failed to read the file.');
                }
            };
            reader.onerror = (e) => {
                var _a;
                console.error('Error reading file:', e);
                this.isLoading = false;
                this.hideLoading();
                this.showError('Failed to read file: ' + ((_a = e.target) === null || _a === void 0 ? void 0 : _a.error));
            };
            reader.readAsArrayBuffer(file);
        }
        /**
         * Load a replay file from a URL
         */
        loadFromUrl(fileUrl, label) {
            if (this.isLoading)
                return;
            this.isLoading = true;
            this.fileUrl = fileUrl;
            this.fileLabel = label || this.labelFromFileReference(fileUrl);
            this.showLoading(this.fileLabel);
            const xhr = new XMLHttpRequest();
            xhr.open('GET', fileUrl, true);
            xhr.responseType = 'arraybuffer';
            xhr.onload = (e) => {
                const target = e.target;
                if (target.status === 200) {
                    void this.processReplayData(target.response, target.response.byteLength);
                }
                else {
                    this.isLoading = false;
                    this.hideLoading();
                    this.showError(`Failed to load file: HTTP ${target.status}`);
                }
            };
            xhr.onerror = () => {
                this.isLoading = false;
                this.hideLoading();
                this.showError('Failed to load file from URL');
            };
            xhr.send();
        }
        /**
         * Parse the loaded data and build the session around it
         * Save files parse asynchronously because the compressed body has to be
         * inflated first, so the loading paths fire and forget this method and
         * rely on its own error handling
         * @param data The raw file contents
         * @param size The size of the file data within the buffer
         */
        async processReplayData(data, size) {
            try {
                // Clean up the previous session
                this.cleanup();
                // Parse the file and build the session that owns it
                const replay = new Replay();
                await replay.loadFromFile(data, size);
                // Apply a winner the link asserts, for files that cannot prove
                // their own result, such as a save taken one turn before the
                // game was won
                const winnerCivId = resolveWinnerCivId(this.linkWinner, this.annotations, replay.civs.length);
                if (this.linkWinner !== null && winnerCivId < 0) {
                    console.warn(`The winner parameter "${this.linkWinner}" names no civilization of the loaded file`);
                }
                if (winnerCivId >= 0) {
                    replay.applyLinkVictory(winnerCivId);
                }
                this.session = new GameSession(replay);
                // Initialize the UI components around the session
                this.initializeUIComponents();
                // Apply the turn the link asked for, or the replay's first turn
                const initialTurn = this.initialTurn !== null && !Number.isNaN(this.initialTurn)
                    ? this.initialTurn
                    : replay.startTurn;
                this.session.setTurn(initialTurn);
                // Show the loaded game and hide the empty state
                this.updateHeader();
                this.updateEmptyState();
                // Fit the map once everything has settled in the DOM
                setTimeout(() => {
                    this.map.fitMap();
                }, 100);
            }
            catch (error) {
                console.error('Error processing replay:', error);
                this.showError('Failed to process replay file: ' + error.message);
                this.updateEmptyState();
            }
            finally {
                this.isLoading = false;
                this.hideLoading();
            }
        }
        /**
         * Initialize the UI components with the game session
         */
        initializeUIComponents() {
            if (!this.session)
                return;
            // The event log, with the address bar annotations
            this.eventLog = new EventLog(this.session, this.annotations);
            // Map layers and the layers panel that toggles them
            this.map.initLayers(this.session);
            this.layersControl = new LayersControl(this.map.map, Object.entries(this.map.getToggleableLayers())
                .map(([label, layer]) => ({ label, layer })));
            // Reinitialize the control bar with the new session (reuses the instance)
            this.controlBar.initialize({
                start: this.session.startTurn,
                end: this.session.endTurn,
                session: this.session
            });
            // Keep the address bar's turn in sync while exploring
            this.unsubscribeTurnSync = this.session.subscribe(() => this.syncUrlState());
        }
        /**
         * Fill the header with the loaded game's summary and annotation line.
         * The summary shows the file name, then the game speed and map size as
         * icon and value pairs.
         */
        updateHeader() {
            if (!this.session) {
                this.gameSummary.hidden = true;
                this.annotationLine.hidden = true;
                return;
            }
            const replay = this.session.replay;
            // Rebuild the summary from scratch, since it mixes text and icons
            this.gameSummary.textContent = '';
            this.gameSummary.appendChild(document.createTextNode(this.fileLabel || 'Loaded game'));
            if (replay.gameSpeed) {
                this.gameSummary.appendChild(document.createTextNode(' · '));
                this.gameSummary.appendChild(this.createSummaryItem('fa-gauge-high', prettifyEnumValue(replay.gameSpeed) + ' Speed'));
            }
            if (replay.worldSize) {
                this.gameSummary.appendChild(document.createTextNode(' · '));
                this.gameSummary.appendChild(this.createSummaryItem('fa-map', prettifyEnumValue(replay.worldSize) + ' Map'));
            }
            this.gameSummary.hidden = false;
            // The annotations, and the winner when the file or the link
            // established one: a file result is stated as fact, a link result is
            // attributed to the link
            const civNames = replay.civs.map(civ => civ.name);
            let lineText = formatAnnotationLine(civNames, this.annotations);
            const victory = replay.victory;
            if (victory && victory.reliable && victory.winnerCivId >= 0) {
                const winnerName = annotationFor(this.annotations, victory.winnerCivId) || replay.getCivName(victory.winnerCivId);
                if (winnerName) {
                    const winnerText = `Winner: ${winnerName}`;
                    lineText = lineText ? `${lineText} · ${winnerText}` : winnerText;
                }
            }
            this.annotationLine.textContent = lineText;
            this.annotationLine.hidden = !lineText;
        }
        /**
         * Create one icon and value pair for the header summary
         */
        createSummaryItem(icon, value) {
            const item = document.createElement('span');
            item.className = 'summary-item';
            const iconEl = document.createElement('i');
            iconEl.className = `fa-solid ${icon}`;
            iconEl.setAttribute('aria-hidden', 'true');
            const text = document.createElement('span');
            text.textContent = value;
            item.appendChild(iconEl);
            item.appendChild(text);
            return item;
        }
        /**
         * Show the empty state only while no game is loaded
         */
        updateEmptyState() {
            this.emptyState.hidden = this.session !== null;
        }
        /**
         * Clean up the previous session and its UI components
         */
        cleanup() {
            // Stop following the old session's turns
            if (this.unsubscribeTurnSync) {
                this.unsubscribeTurnSync();
                this.unsubscribeTurnSync = null;
            }
            // Clean up the event log
            if (this.eventLog) {
                this.eventLog.destroy();
                this.eventLog = null;
            }
            // Clean up the layers panel
            if (this.layersControl) {
                this.layersControl.destroy();
                this.layersControl = null;
            }
            // Clean up the one-canvas map renderer before the next session creates it
            if (this.map && this.map.map) {
                this.map.resetTurnState();
                this.map.removeRenderer();
            }
            // Detach the control bar from the session
            this.controlBar.clear();
            // Discard the session
            this.session = null;
        }
        /**
         * Show the loading overlay with a label for what is loading
         */
        showLoading(label) {
            this.loadingText.textContent = `Loading ${label}…`;
            this.loadingOverlay.hidden = false;
        }
        /**
         * Hide the loading overlay
         */
        hideLoading() {
            this.loadingOverlay.hidden = true;
        }
        /**
         * Show an error message in the banner, replacing the old alert dialogs
         */
        showError(message) {
            this.errorText.textContent = message;
            this.errorBanner.hidden = false;
            // Auto-hide after a while so the banner never lingers unnoticed
            if (this.errorTimeout) {
                clearTimeout(this.errorTimeout);
            }
            this.errorTimeout = window.setTimeout(() => this.hideError(), errorBannerTimeoutMs);
        }
        /**
         * Hide the error banner
         */
        hideError() {
            this.errorBanner.hidden = true;
            if (this.errorTimeout) {
                clearTimeout(this.errorTimeout);
                this.errorTimeout = null;
            }
        }
        /**
         * Get the current replay data
         */
        getReplay() {
            return this.session ? this.session.replay : null;
        }
        /**
         * Check whether a game is loaded
         */
        hasReplay() {
            return this.session !== null;
        }
        /**
         * Get the loading state
         */
        isLoadingFile() {
            return this.isLoading;
        }
    }

    /**
     * hex-layer.ts
     * Custom Leaflet layer for rendering hexagonal tile maps
     * Extends Leaflet's GridLayer to draw hexagonal grids for Civilization V maps
     * Migrated from L.TileLayer.Canvas (Leaflet 0.7.x) to L.GridLayer (Leaflet 1.x+)
     */
    /**
     * HexLayer - Custom layer for rendering hexagonal tiles
     * @extends L.GridLayer
     */
    const HexLayer = L.GridLayer.extend({
        /**
         * Initialize the hex layer with configuration
         * @param {Object} config - Configuration object containing hexes, dimensions, and drawing options
         */
        initialize: function (config) {
            // Call parent constructor with options
            _.extend({}, config);
            // Extract non-standard options into config
            this.config = {
                hexes: config.hexes,
                height: config.height,
                width: config.width,
                drawHex: config.drawHex,
                drawHexEdges: config.drawHexEdges,
                overdraw: config.overdraw,
                clipHexes: config.clipHexes !== false // Default to true for backward compatibility
            };
            // Keep standard Leaflet options
            const leafletOptions = {};
            if (config.opacity !== undefined)
                leafletOptions.opacity = config.opacity;
            if (config.zIndex !== undefined)
                leafletOptions.zIndex = config.zIndex;
            if (config.minZoom !== undefined)
                leafletOptions.minZoom = config.minZoom;
            if (config.maxZoom !== undefined)
                leafletOptions.maxZoom = config.maxZoom;
            // Call parent initialize
            L.GridLayer.prototype.initialize.call(this, leafletOptions);
            this.hexes = this.config.hexes;
            if (this.config.hexes) {
                this.hexes = this.config.hexes;
            }
            else if (this.config.height && this.config.width) {
                this.hexes = [];
                for (var i = 0; i < this.config.height; i++) {
                    var row = [];
                    for (var j = 0; j < this.config.width; j++) {
                        row.push({ x: j, y: i });
                    }
                    this.hexes.push(row);
                }
            }
            this.baseHexHeight = 2;
            this.baseHexWidth = Math.sqrt(3) / 2 * this.baseHexHeight; // ~13.856406464
            if (this.config.drawHex) {
                this.config.drawHex = this.config.drawHex.bind(this);
            }
            // Store turnState reference for dynamic layers
            this.turnState = null;
        },
        /**
         * Create a tile element (required by L.GridLayer)
         * @param {Object} coords - Tile coordinates with x, y, z properties
         * @returns {HTMLCanvasElement} The canvas element for this tile
         */
        createTile: function (coords) {
            // Create canvas element
            const tile = document.createElement('canvas');
            const size = this.getTileSize();
            tile.width = size.x;
            tile.height = size.y;
            // Draw the tile content
            this._drawTile(tile, coords);
            return tile;
        },
        /**
         * Internal method to draw tile content (migrated from drawTile)
         * @param {HTMLCanvasElement} tileCanvas - The canvas element to draw on
         * @param {Object} coords - Tile coordinates with x, y, z properties
         */
        _drawTile: function (tileCanvas, coords) {
            if (!this.config.drawHex) {
                return;
            }
            // Get canvas context for drawing
            var ctx = tileCanvas.getContext('2d');
            if (!ctx)
                return;
            // Convert GridLayer coords to old TileLayer.Canvas format
            var zoom = coords.z;
            var tilePoint = { x: coords.x, y: coords.y };
            // Calculate scaling factor
            var scalingFactor = Math.pow(2, zoom);
            if (tilePoint.x < 0 || tilePoint.y < 0) {
                return;
            }
            if (tilePoint.x >= scalingFactor || tilePoint.y >= scalingFactor) {
                return;
            }
            // Normalize tile x/y coordinates
            var tileX = tilePoint.x % scalingFactor;
            var tileY = tilePoint.y % scalingFactor;
            // Calculate cell dimensions and distance
            var hexWidth = this.baseHexWidth * scalingFactor;
            var hexHeight = this.baseHexHeight * scalingFactor;
            var hexDistX = hexWidth;
            var hexDistY = hexHeight * 3 / 4;
            // Calculate how many tile cells fit on this canvas
            var gridCellsX = tileCanvas.width / hexDistX;
            var gridCellsY = tileCanvas.height / hexDistY;
            // Calculate our starting tiles
            var startHexX = tileX * gridCellsX;
            var startHexY = tileY * gridCellsY;
            // Calculate offsets
            var offsetX = (Math.floor(startHexX) - startHexX) * hexDistX;
            var offsetY = (Math.floor(startHexY) - startHexY) * hexDistY;
            // Add global offset so the origin point isn't cut off
            offsetY += hexHeight / 2;
            // Floor startHexX and startHexY
            startHexX = Math.floor(startHexX);
            startHexY = Math.floor(startHexY);
            // Shift back one hex for some overlap
            startHexX -= 1;
            startHexY -= 1;
            offsetX -= hexDistX;
            offsetY -= hexDistY;
            gridCellsX += 1;
            gridCellsY += 1;
            // Loop through the grid cells we want to render
            for (var gridX = startHexX; gridX < startHexX + gridCellsX + 1; gridX++) {
                for (var gridY = startHexY; gridY < startHexY + gridCellsY + 1; gridY++) {
                    var x = ((gridX - startHexX) * hexDistX) + offsetX;
                    var y = ((gridY - startHexY) * hexDistY) + offsetY;
                    var flippedGridY = this.hexes.length - 1 - gridY;
                    if (flippedGridY % 2) {
                        x += hexWidth / 2;
                    }
                    // Skip if out of bounds
                    if (!this.hexes[flippedGridY] || !this.hexes[flippedGridY][gridX]) {
                        continue;
                    }
                    // Our own drawing function sets up the ctx with a hex polygon
                    const hex = this.hexes[flippedGridY][gridX];
                    const edgesToDraw = this.config.drawHexEdges ?
                        this.config.drawHexEdges(ctx, hex, x, y) : null;
                    const clipping = this.preDrawHex(ctx, x, y, hexWidth, hexHeight + (this.config.overdraw || 0), edgesToDraw);
                    // Custom drawing function does something with it
                    ctx.save();
                    if (this.config.clipHexes)
                        ctx.clip(clipping);
                    this.config.drawHex(ctx, hex, x, y, x - hexWidth / 2, y - hexHeight / 2, x + hexWidth / 2, y + hexHeight / 2);
                    ctx.restore();
                }
            }
        },
        preDrawHex: function (ctx, x, y, width, height, edgesToDraw) {
            var angle = 2 * Math.PI / 6 * (0 + 0.5);
            var startX = x + (height * 0.5) * Math.cos(angle);
            var startY = y + (height * 0.5) * Math.sin(angle);
            var clipping = new Path2D();
            ctx.beginPath();
            ctx.moveTo(startX, startY);
            clipping.moveTo(startX, startY);
            if (edgesToDraw) {
                ctx.lineCap = "square";
            }
            for (var i = 1; i <= 6; i++) {
                angle = 2 * Math.PI / 6 * (i + 0.5);
                var endX = x + (height * 0.5) * Math.cos(angle);
                var endY = y + (height * 0.5) * Math.sin(angle);
                // Determine if we should draw this edge
                if (!edgesToDraw || edgesToDraw.has(i)) {
                    // If we should draw this edge, use lineTo to create a continuous path
                    ctx.lineTo(endX, endY);
                }
                else {
                    // If we shouldn't draw this edge, use moveTo to skip drawing
                    ctx.moveTo(endX, endY);
                }
                clipping.lineTo(endX, endY);
            }
            clipping.closePath();
            return clipping;
        },
        drawImage: function (ctx, id, sx, sy, sw, sh) {
            var img = document.getElementById(id);
            ctx.drawImage(img, 0, 0, img.width, img.height, sx, sy, sw, sh);
        },
        /**
         * Selectively redraw only specific hexes that have changed
         * @param {string[]} changedHexKeys - Array of hex keys in format "x,y"
         */
        redrawHexes: function (changedHexKeys) {
            if (!this._map || changedHexKeys.length === 0)
                return;
            // Get current zoom level
            const zoom = this._map.getZoom();
            const scalingFactor = Math.pow(2, zoom);
            // Calculate tile size
            const tileSize = this.getTileSize();
            // Calculate hex dimensions
            const hexWidth = this.baseHexWidth * scalingFactor;
            const hexHeight = this.baseHexHeight * scalingFactor;
            const hexDistX = hexWidth;
            const hexDistY = hexHeight * 3 / 4;
            // Determine which tiles need to be redrawn
            const tilesToRedraw = new Set();
            for (const hexKey of changedHexKeys) {
                const [hexX, hexY] = hexKey.split(',').map(Number);
                // Calculate which tile(s) this hex appears in
                const flippedY = this.hexes.length - 1 - hexY;
                // Account for staggered hex layout
                const offsetX = (flippedY % 2) ? hexWidth / 2 : 0;
                // Calculate hex center position
                const hexCenterX = (hexX * hexDistX) + offsetX + hexWidth / 2;
                const hexCenterY = (flippedY * hexDistY) + hexHeight;
                // Calculate which tile(s) contain this hex
                // A hex might overlap multiple tiles
                const minTileX = Math.floor((hexCenterX - hexWidth) / tileSize.x);
                const maxTileX = Math.floor((hexCenterX + hexWidth) / tileSize.x);
                const minTileY = Math.floor((hexCenterY - hexHeight) / tileSize.y);
                const maxTileY = Math.floor((hexCenterY + hexHeight) / tileSize.y);
                // Add all affected tiles to redraw set
                const roundedZoom = Math.round(zoom * 10000) / 10000;
                for (let tx = minTileX; tx <= maxTileX; tx++) {
                    for (let ty = minTileY; ty <= maxTileY; ty++) {
                        if (tx >= 0 && ty >= 0 && tx < scalingFactor && ty < scalingFactor) {
                            tilesToRedraw.add(`${tx},${ty},${roundedZoom}`);
                        }
                    }
                }
            }
            // Trigger redraw for affected tiles
            for (const tileKey of tilesToRedraw) {
                const [x, y, z] = tileKey.split(',').map(Number);
                const coords = { x, y, z };
                // Find and redraw the tile
                const key = this._tileCoordsToKey(coords);
                const tile = this._tiles[key];
                if (tile && tile.el) {
                    // Clear the canvas before redrawing to avoid glitches
                    const ctx = tile.el.getContext('2d');
                    if (ctx) {
                        ctx.clearRect(0, 0, tile.el.width, tile.el.height);
                    }
                    // Redraw the specific tile
                    this._drawTile(tile.el, coords);
                }
            }
        }
    });

    /**
     * main.ts
     * Entry point for the Civilization V replay viewer application
     * Creates the replay viewer and exposes the app classes on window for
     * console debugging
     */
    // External libraries (Lodash, Leaflet) are loaded as script tags by index.html
    // and typed in globals.d.ts
    // Create the replay viewer instance
    window.replayViewer = new ReplayViewer();
    // Export classes to window for backward compatibility
    window.ReplayViewer = ReplayViewer;
    window.ReplayMap = ReplayMap;
    window.HexLayer = HexLayer;
    window.ControlBar = ControlBar;
    window.EventLog = EventLog;

})();
//# sourceMappingURL=bundle.js.map
