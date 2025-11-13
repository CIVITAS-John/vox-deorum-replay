(function () {
    'use strict';

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
     * hex-border-utils.ts
     * Utility functions for calculating hex border properties
     */
    /**
     * Calculate the appropriate line width for a hex border based on hex size
     * Uses the hex width to determine a proportional line width that scales properly with zoom
     *
     * @param hexWidth - The width of the hex (typically x2 - x1)
     * @param maxWidth - Maximum line width to use (default: 4)
     * @param scaleFactor - Scale factor for the calculation (default: 0.5)
     * @returns The calculated line width
     */
    function calculateHexBorderWidth(hexWidth, maxWidth = 4, scaleFactor = 0.5) {
        // Calculate proportional width based on hex size
        // Using square root provides better scaling across different zoom levels
        const proportionalWidth = Math.sqrt(hexWidth) * scaleFactor;
        // Cap at maximum width to prevent borders from becoming too thick
        return Math.min(maxWidth, proportionalWidth);
    }
    /**
     * Calculate text outline width for hex labels based on hex size
     * Similar to border width but typically smaller for better readability
     *
     * @param hexWidth - The width of the hex
     * @param maxWidth - Maximum outline width (default: 3)
     * @param scaleFactor - Scale factor for the calculation (default: 0.5)
     * @returns The calculated outline width
     */
    function calculateTextOutlineWidth(hexWidth, maxWidth = 3, scaleFactor = 0.5) {
        return calculateHexBorderWidth(hexWidth, maxWidth, scaleFactor);
    }

    /**
     * city-layer.ts
     * Custom HexLayer for rendering cities on the map
     * Shows city locations with colored circles and name labels
     */
    /**
     * CityLayer - Specialized HexLayer for rendering cities
     * @extends HexLayer
     */
    const CityLayer = HexLayer.extend({
        /**
         * Initialize the city layer
         * @param {Object} config - Configuration object
         */
        initialize: function (config) {
            // Set up city-specific drawing configuration
            const cityConfig = _.extend({}, config, {
                zIndex: 50, // Above territory and above grid
                clipHexes: false, // Don't clip city rendering
                drawHex: this.drawCity.bind(this)
            });
            // Call parent initialize
            HexLayer.prototype.initialize.call(this, cityConfig);
            // Store config for city rendering options
            this.showNames = config.showNames !== false; // Default to true
            this.cityRadius = config.cityRadius || 0.1; // Radius as fraction of hex size
        },
        /**
         * Draw a city on the hex
         * @param {CanvasRenderingContext2D} ctx - Canvas context
         * @param {HexData} hex - Hex data
         * @param {number} cx - Center X coordinate
         * @param {number} cy - Center Y coordinate
         * @param {number} x1 - Left boundary
         * @param {number} y1 - Top boundary
         * @param {number} x2 - Right boundary
         * @param {number} y2 - Bottom boundary
         */
        drawCity: function (ctx, hex, cx, cy, x1, y1, x2, y2) {
            // Check if this hex has a city
            if (!this.turnState)
                return;
            const hexKey = `${hex.x},${hex.y}`;
            const state = this.turnState[hexKey];
            if (!state || !state.city)
                return;
            // Get civilization color
            const civColors = state.owner ? CivColors[state.owner] : null;
            const cityColor = civColors ? civColors.city : [200, 200, 200]; // Default gray if no civ
            // Calculate city circle dimensions
            const hexWidth = x2 - x1;
            const radius = hexWidth * this.cityRadius;
            // Draw city circle with border
            ctx.save();
            // Draw white border/outline
            ctx.beginPath();
            ctx.arc(cx, cy, radius + 1, 0, 2 * Math.PI);
            ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
            ctx.fill();
            // Draw colored city circle
            ctx.beginPath();
            ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
            ctx.fillStyle = `rgb(${cityColor[0]}, ${cityColor[1]}, ${cityColor[2]})`;
            ctx.fill();
            // Draw city name if enabled
            if (this.showNames && state.city && hexWidth >= 16) {
                // Use hex-relative font size to avoid flickering during zoom
                // The font will naturally scale with the tile/hex size
                const fontSize = Math.sqrt(hexWidth) * 2.5; // Font size relative to hex height
                // Set up text style with improved clarity
                ctx.font = `${fontSize}px EB Garamond, serif`;
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                // Enable better text rendering
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
                // Position text to the right of the circle with padding
                const textX = cx + radius + Math.sqrt(hexWidth);
                const textY = cy;
                // Draw stronger black outline for better contrast
                ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
                ctx.lineWidth = calculateTextOutlineWidth(hexWidth) * 1.5;
                ctx.lineJoin = 'round';
                ctx.miterLimit = 2;
                ctx.strokeText(state.city, textX, textY);
                // Draw white text with full opacity for maximum clarity
                ctx.fillStyle = 'rgba(255, 255, 255, 1)';
                ctx.fillText(state.city, textX, textY);
            }
            ctx.restore();
        },
        /**
         * Update turn state and redraw
         * @param {TurnState} turnState - New turn state
         */
        setTurnState: function (turnState) {
            this.turnState = turnState;
            this.redraw();
        }
    });

    /**
     * grid-layer.ts
     * Simple HexLayer for rendering hex grid lines only
     */
    // Grid constants
    const DEFAULT_GRID_COLOR = 'rgba(255, 255, 255, 0.2)';
    const GRID_WIDTH = 2;
    /**
     * GridLayer - Simple layer for rendering hex grid lines
     * @extends HexLayer
     */
    const GridLayer = HexLayer.extend({
        /**
         * Initialize the grid layer
         * @param {Object} config - Configuration object
         */
        initialize: function (config) {
            // Set up grid-specific drawing configuration
            const gridConfig = _.extend({}, config, {
                zIndex: 45, // Above territory but below cities
                drawHex: this.drawGrid.bind(this)
            });
            // Call parent initialize
            HexLayer.prototype.initialize.call(this, gridConfig);
            // Store state
            this.showGrid = config.showGrid;
        },
        /**
         * Draw grid lines for a hex
         * @param {CanvasRenderingContext2D} ctx - Canvas context
         * @param {HexData} hex - Hex data
         * @param {number} cx - Center X coordinate
         * @param {number} cy - Center Y coordinate
         * @param {number} x1 - Left boundary
         * @param {number} y1 - Top boundary
         * @param {number} x2 - Right boundary
         * @param {number} y2 - Bottom boundary
         */
        drawGrid: function (ctx, hex, cx, cy, x1, y1, x2, y2) {
            if (!this.showGrid)
                return;
            // Set grid style
            ctx.strokeStyle = DEFAULT_GRID_COLOR;
            ctx.lineWidth = calculateHexBorderWidth(x2 - x1, GRID_WIDTH, GRID_WIDTH / 4);
            ctx.stroke();
            /*// Draw coordinate label
            const hexSize = x2 - x1;
            const fontSize = Math.max(10, Math.min(16, hexSize / 8));

            ctx.save();
            ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
            ctx.font = `${fontSize}px Arial`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            const coordText = `${hex.x},${hex.y}`;
            ctx.fillText(coordText, cx, cy);
            ctx.restore();*/
            // Note: The actual edge drawing is handled by HexLayer's preDrawHex
        },
        /**
         * Toggle grid visibility
         * @param {boolean} show - Whether to show the grid
         */
        setGridVisible: function (show) {
            if (this.showGrid !== show) {
                this.showGrid = show;
                this.redraw();
            }
        }
    });

    /**
     * boundary-layer.ts
     * Custom HexLayer for rendering civilization boundaries
     * Shows territory borders with civilization colors
     * Supports highlighting specific civilizations with bright yellow
     */
    // Boundary constants
    const BOUNDARY_WIDTH = 12;
    const HIGHLIGHT_COLOR = 'rgba(255, 255, 0, 1)'; // Bright yellow for highlighted civs
    /**
     * BoundaryLayer - Specialized HexLayer for rendering civilization boundaries
     * @extends HexLayer
     */
    const BoundaryLayer = HexLayer.extend({
        /**
         * Initialize the boundary layer
         * @param {Object} config - Configuration object
         */
        initialize: function (config) {
            // Set up boundary-specific drawing configuration
            const boundaryConfig = _.extend({}, config, {
                zIndex: 47, // Above grid layer
                drawHex: this.drawBoundaries.bind(this),
                drawHexEdges: this.getOutwardFacingEdges.bind(this)
            });
            // Call parent initialize
            HexLayer.prototype.initialize.call(this, boundaryConfig);
            // Store state
            this.highlightedCivs = new Set();
        },
        /**
         * Setup boundary drawing style
         * @param {CanvasRenderingContext2D} ctx - Canvas context
         * @param {HexData} hex - Hex data
         * @param {number} cx - Center X coordinate
         * @param {number} cy - Center Y coordinate
         * @param {number} x1 - Left boundary
         * @param {number} y1 - Top boundary
         * @param {number} x2 - Right boundary
         * @param {number} y2 - Bottom boundary
         */
        drawBoundaries: function (ctx, hex, cx, cy, x1, y1, x2, y2) {
            if (!this.turnState)
                return;
            const hexKey = `${hex.x},${hex.y}`;
            const state = this.turnState[hexKey];
            const owner = state === null || state === void 0 ? void 0 : state.owner;
            if (!owner)
                return;
            // Set boundary color and width
            if (this.highlightedCivs.has(owner)) {
                // Use bright yellow for highlighted civilizations
                ctx.strokeStyle = HIGHLIGHT_COLOR;
            }
            else {
                // Use civilization's territory color
                const civColors = CivColors[owner];
                if (civColors) {
                    const color = civColors.territory;
                    ctx.strokeStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]})`;
                }
                else {
                    // Fallback to a default color if civ color not found
                    ctx.strokeStyle = 'rgba(128, 128, 128)';
                }
            }
            ctx.lineWidth = calculateHexBorderWidth(x2 - x1, BOUNDARY_WIDTH, BOUNDARY_WIDTH / 12);
            ctx.stroke();
        },
        /**
         * Determine which edges of a hex should be drawn based on boundary conditions
         * Returns only outward-facing edges at civilization boundaries
         * @param {CanvasRenderingContext2D} ctx - Canvas context
         * @param {HexData} hex - Hex data
         * @param {number} cx - Center X coordinate
         * @param {number} cy - Center Y coordinate
         * @param {number} x1 - Left boundary
         * @param {number} y1 - Top boundary
         * @param {number} x2 - Right boundary
         * @param {number} y2 - Bottom boundary
         * @returns {Set<number> | null} Set of edge indices to draw (1-6), or null for no edges
         */
        getOutwardFacingEdges: function (ctx, hex, cx, cy) {
            if (!this.turnState)
                return new Set();
            const hexKey = `${hex.x},${hex.y}`;
            const state = this.turnState[hexKey];
            const owner = state === null || state === void 0 ? void 0 : state.owner;
            // If no owner, don't draw any edges
            if (!owner) {
                return new Set();
            }
            const isEvenRow = hex.y % 2 === 0;
            const edgesToDraw = new Set();
            // Define neighbor positions by direction
            const neighborsByDirection = isEvenRow ? {
                'NE': [hex.x, hex.y + 1],
                'E': [hex.x + 1, hex.y],
                'SE': [hex.x, hex.y - 1],
                'SW': [hex.x - 1, hex.y - 1],
                'W': [hex.x - 1, hex.y],
                'NW': [hex.x - 1, hex.y + 1]
            } : {
                'NE': [hex.x + 1, hex.y + 1],
                'E': [hex.x + 1, hex.y],
                'SE': [hex.x + 1, hex.y - 1],
                'SW': [hex.x, hex.y - 1],
                'W': [hex.x - 1, hex.y],
                'NW': [hex.x, hex.y + 1]
            };
            // Map directions to edge numbers
            const directionToEdge = {
                'NE': 5,
                'E': 6,
                'SE': 1,
                'SW': 2,
                'W': 3,
                'NW': 4
            };
            // Check each direction: if neighbor is not in same territory, draw the edge
            for (const [direction, [nx, ny]] of Object.entries(neighborsByDirection)) {
                const neighborKey = `${nx},${ny}`;
                const neighborState = this.turnState[neighborKey];
                // Draw edge if neighbor has different owner or no owner
                if (!neighborState || !neighborState.owner || neighborState.owner !== owner) {
                    edgesToDraw.add(directionToEdge[direction]);
                }
            }
            // Set the boundary color for this hex
            if (this.highlightedCivs.has(owner)) {
                this.config.gridStyle = HIGHLIGHT_COLOR;
            }
            else {
                const civColors = CivColors[owner];
                if (civColors) {
                    const color = civColors.territory;
                    this.config.gridStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]})`;
                }
                else {
                    this.config.gridStyle = 'rgba(128, 128, 128, 0.5)';
                }
            }
            return edgesToDraw;
        },
        /**
         * Highlight specific civilizations with bright yellow
         * @param {string[]} civNames - Array of civilization names to highlight
         */
        highlightCivBoundaries: function (civNames) {
            this.highlightedCivs.clear();
            for (const name of civNames) {
                this.highlightedCivs.add(name);
            }
            this.redraw();
        },
        /**
         * Add civilizations to highlight
         * @param {string[]} civNames - Array of civilization names
         */
        addHighlightedCivs: function (civNames) {
            let changed = false;
            for (const name of civNames) {
                if (!this.highlightedCivs.has(name)) {
                    this.highlightedCivs.add(name);
                    changed = true;
                }
            }
            if (changed) {
                this.redraw();
            }
        },
        /**
         * Remove civilizations from highlight
         * @param {string[]} civNames - Array of civilization names
         */
        removeHighlightedCivs: function (civNames) {
            let changed = false;
            for (const name of civNames) {
                if (this.highlightedCivs.delete(name)) {
                    changed = true;
                }
            }
            if (changed) {
                this.redraw();
            }
        },
        /**
         * Clear all civilization highlights
         */
        clearCivHighlights: function () {
            if (this.highlightedCivs.size > 0) {
                this.highlightedCivs.clear();
                this.redraw();
            }
        },
        /**
         * Get the owner of a specific hex
         * @param {string} hexKey - The hex key
         * @returns {string | undefined} The owner or undefined
         */
        getHexOwner: function (hexKey) {
            const state = this.turnState ? this.turnState[hexKey] : null;
            return state === null || state === void 0 ? void 0 : state.owner;
        }
    });

    /**
     * selection-layer.ts
     * Custom HexLayer for rendering selection/hover highlighting on the map
     * Shows a solid yellow border around the selected/hovered hex
     */
    // Selection highlighting constants
    const SELECTION_COLOR = '#FFEB3B'; // Light yellow
    const SELECTION_WIDTH = 4;
    /**
     * SelectionLayer - Specialized HexLayer for rendering hex selection/hover
     * @extends HexLayer
     */
    const SelectionLayer = HexLayer.extend({
        /**
         * Initialize the selection layer
         * @param {Object} config - Configuration object
         */
        initialize: function (config) {
            // Set up selection-specific drawing configuration
            const selectionConfig = _.extend({}, config, {
                zIndex: 65, // Above cities but below events
                drawHex: this.drawSelection.bind(this)
            });
            // Call parent initialize
            HexLayer.prototype.initialize.call(this, selectionConfig);
            // Store selection state
            this.selectedHex = null;
        },
        /**
         * Draw selection highlight on the hex
         * @param {CanvasRenderingContext2D} ctx - Canvas context
         * @param {HexData} hex - Hex data
         * @param {number} cx - Center X coordinate
         * @param {number} cy - Center Y coordinate
         * @param {number} x1 - Left boundary
         * @param {number} y1 - Top boundary
         * @param {number} x2 - Right boundary
         * @param {number} y2 - Bottom boundary
         */
        drawSelection: function (ctx, hex, cx, cy, x1, y1, x2, y2) {
            const hexKey = `${hex.x},${hex.y}`;
            if (this.selectedHex === hexKey) {
                // Draw solid light yellow border for selection
                ctx.strokeStyle = SELECTION_COLOR;
                ctx.lineWidth = calculateHexBorderWidth(x2 - x1, SELECTION_WIDTH);
                ctx.stroke();
            }
        },
        /**
         * Set the selected hex
         * @param {string | null} hexKey - The hex key to select, or null to clear
         */
        setSelectedHex: function (hexKey) {
            if (this.selectedHex !== hexKey) {
                this.selectedHex = hexKey;
                this.redraw();
            }
        },
        /**
         * Get the currently selected hex
         * @returns {string | null} The selected hex key or null
         */
        getSelectedHex: function () {
            return this.selectedHex;
        },
        /**
         * Clear the selection
         */
        clearSelection: function () {
            this.setSelectedHex(null);
        }
    });

    /**
     * events-layer.ts
     * Custom HexLayer for rendering event highlighting on the map
     * Shows dashed yellow borders around hexes where events occurred
     */
    // Event highlighting constants
    const EVENT_COLOR = '#FFEB3B'; // Light yellow
    const EVENT_WIDTH = 4;
    const DASH_PATTERN = [4, 4]; // Dashed line pattern
    /**
     * EventsLayer - Specialized HexLayer for rendering event highlights
     * @extends HexLayer
     */
    const EventsLayer = HexLayer.extend({
        /**
         * Initialize the events layer
         * @param {Object} config - Configuration object
         */
        initialize: function (config) {
            // Set up events-specific drawing configuration
            const eventsConfig = _.extend({}, config, {
                zIndex: 70, // Above selection
                drawHex: this.drawEventHighlight.bind(this)
            });
            // Call parent initialize
            HexLayer.prototype.initialize.call(this, eventsConfig);
            // Store event hexes map (hex key -> event type)
            this.eventHexes = new Map();
        },
        /**
         * Draw event highlight on the hex
         * @param {CanvasRenderingContext2D} ctx - Canvas context
         * @param {HexData} hex - Hex data
         * @param {number} cx - Center X coordinate
         * @param {number} cy - Center Y coordinate
         * @param {number} x1 - Left boundary
         * @param {number} y1 - Top boundary
         * @param {number} x2 - Right boundary
         * @param {number} y2 - Bottom boundary
         */
        drawEventHighlight: function (ctx, hex, cx, cy, x1, y1, x2, y2) {
            const hexKey = `${hex.x},${hex.y}`;
            const eventType = this.eventHexes.get(hexKey);
            if (eventType !== undefined) {
                // Draw dashed light yellow border for event
                ctx.strokeStyle = EVENT_COLOR;
                ctx.lineWidth = calculateHexBorderWidth(x2 - x1, EVENT_WIDTH, EVENT_WIDTH / 4);
                ctx.setLineDash(DASH_PATTERN);
                ctx.stroke();
                ctx.setLineDash([]); // Reset to solid
            }
        },
        /**
         * Highlight hexes where events occurred
         * @param {GameEvent[]} events - Array of game events
         */
        highlightEventHexes: function (events) {
            var _a;
            // Clear previous event hexes
            this.eventHexes.clear();
            // Add new event hexes (only first event per hex)
            for (const event of events) {
                const hexKeys = (_a = event.tiles) === null || _a === void 0 ? void 0 : _a.map(t => `${t.x},${t.y}`);
                if (!hexKeys)
                    continue;
                for (const hexKey of hexKeys) {
                    // Only store if hex doesn't already have an event
                    if (!this.eventHexes.has(hexKey)) {
                        this.eventHexes.set(hexKey, event.type);
                    }
                }
            }
            // Force redraw
            this.redraw();
        },
        /**
         * Clear all event highlights
         */
        clearEventHighlights: function () {
            this.eventHexes.clear();
            this.redraw();
        },
        /**
         * Get the event type for a specific hex
         * @param {string} hexKey - The hex key
         * @returns {EventType | undefined} The event type or undefined
         */
        getEventType: function (hexKey) {
            return this.eventHexes.get(hexKey);
        }
    });

    /**
     * map-highlighting.ts
     * Module for managing map highlighting features
     * Handles selection highlighting and event border highlighting
     */
    /**
     * MapHighlighting class
     * Manages different types of highlighting on the map
     */
    class MapHighlighting {
        constructor(parentMap) {
            this.parentMap = parentMap;
            this.selectedHex = null;
            this.eventHexes = new Map();
            this.selectionLayer = null;
            this.eventsLayer = null;
            this.gridLayer = null;
            // Keep for backward compatibility
            this.highlightedCivs = new Set();
        }
        /**
         * Initialize highlighting layers
         */
        initLayers(map, tiles) {
            this.map = map;
            this.tiles = tiles;
            // Create selection layer for mouse hover
            this.selectionLayer = new SelectionLayer({
                hexes: tiles
            });
            // Create events layer for border highlighting
            this.eventsLayer = new EventsLayer({
                hexes: tiles
            });
            // Add layers to map
            this.selectionLayer.addTo(map);
            this.eventsLayer.addTo(map);
            // Note: Grid layer with boundary functionality is now created and managed by ReplayMap
        }
        /**
         * Set reference to grid layer for boundary highlighting
         */
        setGridLayer(gridLayer) {
            this.gridLayer = gridLayer;
        }
        /**
         * Get layers for layer control
         */
        getLayers() {
            return {
                selection: this.selectionLayer,
                events: this.eventsLayer
                // Note: boundaries are now handled by the grid layer
            };
        }
        /**
         * Clear all highlights
         */
        clearAll() {
            this.selectedHex = null;
            this.eventHexes.clear();
            this.highlightedCivs.clear();
            if (this.selectionLayer) {
                this.selectionLayer.clearSelection();
            }
            if (this.eventsLayer) {
                this.eventsLayer.clearEventHighlights();
            }
            if (this.gridLayer) {
                this.gridLayer.clearCivHighlights();
            }
        }
        /**
         * Update turn state for boundary highlighting in grid layer
         * Note: Grid layer's turnState is set directly by ReplayMap, this just triggers redraw
         */
        updateTurnState(turnState) {
            if (this.gridLayer && this.gridLayer.turnState !== turnState) {
                this.gridLayer.redraw();
            }
        }
        // Selection methods
        /**
         * Set the selected hex (for hover highlight)
         */
        setSelectedHex(hexKey) {
            if (this.selectedHex !== hexKey) {
                this.selectedHex = hexKey;
                if (this.selectionLayer) {
                    this.selectionLayer.setSelectedHex(hexKey);
                }
            }
        }
        /**
         * Get the currently selected hex
         */
        getSelectedHex() {
            return this.selectedHex;
        }
        // Event highlighting methods
        /**
         * Highlight hexes where events occurred with colored borders
         */
        highlightEventHexes(events) {
            var _a;
            // Clear and update internal tracking
            this.eventHexes.clear();
            for (const event of events) {
                const hexKeys = (_a = event.tiles) === null || _a === void 0 ? void 0 : _a.map(t => `${t.x},${t.y}`);
                if (!hexKeys)
                    continue;
                for (const hexKey of hexKeys) {
                    if (!this.eventHexes.has(hexKey)) {
                        this.eventHexes.set(hexKey, event.type);
                    }
                }
            }
            // Delegate to events layer
            if (this.eventsLayer) {
                this.eventsLayer.highlightEventHexes(events);
            }
        }
        /**
         * Clear event highlights
         */
        clearEventHighlights() {
            this.eventHexes.clear();
            if (this.eventsLayer) {
                this.eventsLayer.clearEventHighlights();
            }
        }
        // Backward compatibility methods - delegate to appropriate layer
        highlightHexes(hexKeys) {
            // For backward compatibility - treat as selection
            if (hexKeys.length > 0) {
                this.setSelectedHex(hexKeys[0]);
            }
        }
        addHighlightedHexes(hexKeys) {
            if (hexKeys.length > 0 && !this.selectedHex) {
                this.setSelectedHex(hexKeys[0]);
            }
        }
        removeHighlightedHexes(hexKeys) {
            if (hexKeys.includes(this.selectedHex || '')) {
                this.setSelectedHex(null);
            }
        }
        clearHexHighlights() {
            this.setSelectedHex(null);
        }
        // Civilization boundary methods (delegated to grid layer)
        highlightCivBoundaries(civNames) {
            this.highlightedCivs.clear();
            for (const name of civNames) {
                this.highlightedCivs.add(name);
            }
            if (this.gridLayer) {
                this.gridLayer.highlightCivBoundaries(civNames);
            }
        }
        addHighlightedCivs(civNames) {
            for (const name of civNames) {
                this.highlightedCivs.add(name);
            }
            if (this.gridLayer) {
                this.gridLayer.addHighlightedCivs(civNames);
            }
        }
        removeHighlightedCivs(civNames) {
            for (const name of civNames) {
                this.highlightedCivs.delete(name);
            }
            if (this.gridLayer) {
                this.gridLayer.removeHighlightedCivs(civNames);
            }
        }
        clearCivHighlights() {
            this.highlightedCivs.clear();
            if (this.gridLayer) {
                this.gridLayer.clearCivHighlights();
            }
        }
        setHighlightColors(hexColor, boundaryColor, eventColor) {
            // For backward compatibility - colors are now fixed for consistency
            // Colors are no longer configurable in the individual layer modules
        }
    }

    /**
     * replay.types.ts
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
     * enum-names.ts
     * Utility functions to convert enum values to display names
     * Used primarily for UI rendering and debugging
     */
    /**
     * Convert ElevationType enum to display name
     */
    function getElevationName(elevation) {
        switch (elevation) {
            case ElevationType.Mountain: return 'Mountain';
            case ElevationType.Hills: return 'Hills';
            case ElevationType.AboveSeaLevel: return 'Above Sea Level';
            case ElevationType.BelowSeaLevel: return 'Below Sea Level';
            default: return `Unknown Elevation ${elevation}`;
        }
    }
    /**
     * Convert TileType enum to display name
     */
    function getTileTypeName(type) {
        switch (type) {
            case TileType.Grassland: return 'Grassland';
            case TileType.Plains: return 'Plains';
            case TileType.Desert: return 'Desert';
            case TileType.Tundra: return 'Tundra';
            case TileType.Snow: return 'Snow';
            case TileType.Coast: return 'Coast';
            case TileType.Ocean: return 'Ocean';
            default: return `Unknown Tile ${type}`;
        }
    }
    /**
     * Convert FeatureType enum to display name
     */
    function getFeatureName(feature) {
        switch (feature) {
            case FeatureType.NoFeature: return 'None';
            case FeatureType.Ice: return 'Ice';
            case FeatureType.Jungle: return 'Jungle';
            case FeatureType.Marsh: return 'Marsh';
            case FeatureType.Oasis: return 'Oasis';
            case FeatureType.FloodPlains: return 'Flood Plains';
            case FeatureType.Forest: return 'Forest';
            case FeatureType.CerroDePotosi: return 'Cerro de Potosi';
            case FeatureType.Atoll: return 'Atoll';
            case FeatureType.SriPada: return 'Sri Pada';
            case FeatureType.MtSinai: return 'Mt. Sinai';
            default: return `Unknown Feature ${feature}`;
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
     * replay-map.ts
     * Manages the Leaflet map display for the replay viewer
     * Handles rendering of terrain, cities, territories, and turn-based state changes
     * Includes highlighting features for hexes and civilization boundaries
     */
    // External libraries accessed as globals - types defined in globals.d.ts
    /**
     * ReplayMap class
     * Creates and initializes the Leaflet map instance
     */
    class ReplayMap {
        constructor(replay) {
            this.replay = replay || null;
            this.map = L.map(document.querySelector('.map'), {
                attributionControl: false,
                keyboardPanOffset: 0,
                fadeAnimation: false, // Disable fade animation to prevent transparency transitions during redraw
                zoomSnap: 0.2 // Allow fractional zoom levels with 0.25 increments
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
        initLayers(tiles, events, replay) {
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
            var lastState = {};
            // Always start from turn 0, regardless of when first event occurs
            const lastTurn = events[events.length - 1].turn;
            for (var t = 0; t <= lastTurn; t++) {
                // Start by copying last state
                var state = _.clone(lastState, true);
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
                    }
                }
                this.turnStates.push(state);
                lastState = state;
            }
            this.layers = {
                terrain: new HexLayer({
                    hexes: tiles,
                    zIndex: 10,
                    drawHex: function (ctx, hex, cx, cy, x1, y1, x2, y2) {
                        // Convert enum to texture name for rendering
                        const textureName = getTileTypeName(hex.type).toUpperCase();
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
                        }
                    }
                }),
                feature: new HexLayer({
                    hexes: tiles,
                    zIndex: 20,
                    drawHex: function (ctx, hex, cx, cy, x1, y1, x2, y2) {
                        // Convert enum to texture name for rendering
                        const textureName = getFeatureName(hex.feature).toUpperCase().replace(' ', '_');
                        switch (hex.feature) {
                            case FeatureType.Ice:
                            case FeatureType.Jungle:
                            // case FeatureType.Marsh:
                            // case FeatureType.Oasis:
                            // case FeatureType.FloodPlains:
                            case FeatureType.Forest:
                                this.drawImage(ctx, textureName, x1, y1, x2 - x1, y2 - y1);
                                break;
                        }
                    }
                }),
                elevation: new HexLayer({
                    hexes: tiles,
                    zIndex: 20,
                    drawHex: function (ctx, hex, cx, cy, x1, y1, x2, y2) {
                        // Convert enum to texture name for rendering
                        const textureName = getElevationName(hex.elevation).toUpperCase().replace(' ', '_');
                        switch (hex.elevation) {
                            case ElevationType.Mountain:
                            case ElevationType.Hills:
                                this.drawImage(ctx, textureName, x1, y1, x2 - x1, y2 - y1);
                                break;
                        }
                    }
                }),
                territory: new HexLayer({
                    hexes: tiles,
                    zIndex: 30,
                    overdraw: 1,
                    drawHex: function (ctx, hex, cx, cy, x1, y1, x2, y2) {
                        if (!this.turnState) {
                            return;
                        }
                        var state = this.turnState[hex.x + ',' + hex.y];
                        if (!state) {
                            return;
                        }
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
            _.each(this.layers, (layer) => layer.addTo(this.map));
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
            function onMapClick(e) {
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
        renderTurn(turn) {
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
        highlightHexes(hexKeys) {
            this.highlighting.highlightHexes(hexKeys);
        }
        addHighlightedHexes(hexKeys) {
            this.highlighting.addHighlightedHexes(hexKeys);
        }
        removeHighlightedHexes(hexKeys) {
            this.highlighting.removeHighlightedHexes(hexKeys);
        }
        clearHexHighlights() {
            this.highlighting.clearHexHighlights();
        }
        highlightCivBoundaries(civNames) {
            this.highlighting.highlightCivBoundaries(civNames);
        }
        addHighlightedCivs(civNames) {
            this.highlighting.addHighlightedCivs(civNames);
        }
        removeHighlightedCivs(civNames) {
            this.highlighting.removeHighlightedCivs(civNames);
        }
        clearCivHighlights() {
            this.highlighting.clearCivHighlights();
        }
        setHighlightColors(hexColor, boundaryColor, eventColor) {
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
     * event-log.ts
     * Manages the event log display for game events
     * Shows filtered messages and events from the replay based on turn and event type
     */
    // External libraries accessed as globals - types defined in globals.d.ts
    /**
     * EventLog class
     * Manages and displays game events with filtering and turn-based navigation
     */
    class EventLog {
        constructor(events, replay) {
            this.types = new Set();
            // WeakMap for associating DOM elements with their event data
            this.elementToEvent = new WeakMap();
            this.eventToElement = new Map();
            // Track current turn for scrolling optimization
            this.currentTurn = 0;
            // Track turn separator elements for scrolling
            this.turnSeparators = new Map();
            this.logContainer = document.querySelector('.log-container');
            this.messagesEl = this.logContainer.querySelector('.log-messages');
            this.events = events;
            this.replay = replay;
            this.initializeEventFilter();
            this.renderEvents();
            if (events.length > 0) {
                this.renderTurn(events[0].turn);
            }
        }
        /**
         * Initialize event type filtering
         */
        initializeEventFilter() {
            const eventSelect = document.getElementById('event-select');
            // Bootstrap selectpicker event handling
            $(eventSelect).on('changed.bs.select', (e) => {
                const selectedValues = $(e.target).val() || [];
                console.log('Event filter changed:', selectedValues);
                this.updateTypeFilter(selectedValues);
            });
            // Set initial filter values
            const initialValues = $(eventSelect).selectpicker('val') || [];
            this.updateTypeFilter(initialValues);
        }
        /**
         * Update the type filter with new values
         */
        updateTypeFilter(types) {
            this.types.clear();
            types.forEach(type => this.types.add(Number(type)));
            console.log('Setting types:', Array.from(this.types));
            this.applyTypeFilter();
        }
        /**
         * Apply type filter to all message elements
         */
        applyTypeFilter() {
            const messages = this.messagesEl.querySelectorAll('.message');
            console.log('Total messages:', messages.length);
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
                    // Create civ header
                    const civHeader = document.createElement('div');
                    civHeader.className = 'civ-header';
                    if (civColor) {
                        // Major civ - use colored circle with territory/tile color
                        const circle = document.createElement('span');
                        circle.className = 'civ-circle';
                        circle.style.backgroundColor = `rgb(${civColor.territory[0]}, ${civColor.territory[1]}, ${civColor.territory[2]})`;
                        civHeader.appendChild(circle);
                    }
                    else {
                        // Minor civ - use rectangle with default color
                        const rect = document.createElement('span');
                        rect.className = 'civ-rectangle';
                        civHeader.appendChild(rect);
                    }
                    // Create civ name text
                    const civNameEl = document.createElement('span');
                    civNameEl.className = 'civ-name';
                    civNameEl.textContent = civName;
                    civHeader.appendChild(civNameEl);
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
                    // Check if text contains game markup (icons/colors)
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
            // Store bidirectional association using WeakMap and Map
            this.elementToEvent.set(msg, event);
            this.eventToElement.set(event, msg);
            // Apply initial filter
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
         * Render all events
         */
        renderEvents() {
            this.clear();
            // If no events, return early
            if (this.events.length === 0) {
                return;
            }
            const fragment = document.createDocumentFragment();
            // Find the range of turns
            let minTurn = Infinity;
            let maxTurn = -Infinity;
            this.events.forEach(event => {
                if (event.turn < minTurn)
                    minTurn = event.turn;
                if (event.turn > maxTurn)
                    maxTurn = event.turn;
            });
            // Handle case where all events were empty and got filtered
            if (minTurn === Infinity || maxTurn === -Infinity) {
                return;
            }
            // Group events by turn for easier processing
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
            // Create turn separators for all turns in range
            for (let turn = minTurn; turn <= maxTurn; turn++) {
                // Add turn separator for every turn
                const separator = this.createTurnSeparator(turn);
                this.turnSeparators.set(turn, separator);
                fragment.appendChild(separator);
                // Add events for this turn if they exist
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
            // Clear associations
            this.eventToElement.clear();
            this.turnSeparators.clear();
            // WeakMap will be garbage collected automatically
            this.messagesEl.innerHTML = '';
        }
        /**
         * Update log display to show events up to specified turn
         * and scroll to the turn separator for that turn
         */
        renderTurn(turn) {
            const messages = this.messagesEl.querySelectorAll('.message');
            const separators = this.messagesEl.querySelectorAll('.turn-separator');
            // Update active state for messages
            messages.forEach(msg => {
                const msgTurn = parseInt(msg.dataset.turn || '0');
                if (msgTurn <= turn) {
                    msg.classList.add('active');
                }
                else {
                    msg.classList.remove('active');
                }
            });
            // Update active state for turn separators
            separators.forEach(sep => {
                const sepTurn = parseInt(sep.dataset.turn || '0');
                if (sepTurn <= turn) {
                    sep.classList.add('active');
                }
                else {
                    sep.classList.remove('active');
                }
            });
            // Scroll to the turn separator if it exists
            if (turn === 0) {
                // Scroll to top when at turn 0
                this.messagesEl.scrollTop = 0;
                this.currentTurn = turn;
                return;
            }
            // Try to get the turn separator for this turn
            const turnSeparator = this.turnSeparators.get(turn);
            if (turnSeparator)
                this.scrollToElement(turnSeparator);
            this.currentTurn = turn;
        }
        /**
         * Scroll to a specific element in the messages container
         */
        scrollToElement(element) {
            const containerRect = this.messagesEl.getBoundingClientRect();
            const elementRect = element.getBoundingClientRect();
            // Calculate the scroll position to put the element at the top
            const relativeTop = elementRect.top - containerRect.top;
            const scrollOffset = this.messagesEl.scrollTop + relativeTop;
            // Direct scroll without animation
            this.messagesEl.scrollTop = Math.max(0, scrollOffset);
        }
        /**
         * Set visible event types based on filter selection
         * @deprecated Use updateTypeFilter instead
         */
        setTypes(types) {
            this.updateTypeFilter(types);
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
     * UI control bar for replay playback
     * Manages play/pause, speed control, and turn navigation
     */
    // External libraries accessed as globals - types defined in globals.d.ts
    /**
     * ControlBar class
     * @param {Object} config - Configuration with start/end turns and onChange callback
     */
    class ControlBar {
        constructor(config) {
            this.initialized = false; // Track if the control bar has been initialized
            this.keydownHandler = null; // Store keydown handler for cleanup
            this.playPauseHandler = null; // Store play/pause handler for cleanup
            // Allow constructor to be called without config for initial instance creation
            if (config) {
                this.initialize(config);
            }
        }
        // Initialize or reinitialize the control bar with new config
        initialize(config) {
            this.config = config;
            this.config.onChange = (this.config.onChange || function () { }).bind(this);
            // Stop any existing playback
            this.pause();
            // Only set up event handlers on first initialization
            if (!this.initialized) {
                // Play/pause button
                this.playPauseBtn = document.getElementById('playPause');
                this.playPauseHandler = this.togglePlay.bind(this);
                this.playPauseBtn.addEventListener('click', this.playPauseHandler);
                // Speed slider
                this.playIntervals = [2000, 1000, 600, 400, 0];
                this.playInterval = this.playIntervals[2];
                this.speedSliderEl = document.getElementById('speedSlider');
                // Note: Bootstrap slider still requires jQuery internally, we'll keep using it through its API
                $(this.speedSliderEl).slider({
                    id: 'speedSlider',
                    min: 0,
                    max: 4,
                    value: 2,
                    tooltip: 'hide',
                    ticks: [0, 1, 2, 3, 4],
                    ticks_snap_bounds: 1
                });
                this.speedSlider = $(this.speedSliderEl).data().slider;
                $(this.speedSliderEl).on('change', (e) => this.setSpeed(e.value.newValue));
                // Turn slider
                this.turnSliderEl = document.getElementById('turnSlider');
                $(this.turnSliderEl).slider({
                    id: 'turnSlider',
                    min: this.config.start,
                    max: this.config.end,
                    value: this.config.initial || this.config.start,
                    tooltip: 'always',
                    tooltip_position: 'bottom'
                });
                this.turnSlider = $(this.turnSliderEl).data().slider;
                // Listen for spacebar to toggle play/pause
                this.keydownHandler = (e) => {
                    // Prevent handling if not initialized with a config
                    if (!this.config)
                        return;
                    switch (e.keyCode) {
                        case 32:
                            this.togglePlay();
                            return; // space
                        case 33:
                            this.setTurn(this.config.start);
                            return; // page up
                        case 34:
                            this.setTurn(this.config.end);
                            return; // page down
                        case 35:
                            this.setTurn(this.config.end);
                            return; // end
                        case 36:
                            this.setTurn(this.config.start);
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
                            this.speedSlider.setValue(0, true, true);
                            return; // 1
                        case 50:
                            this.speedSlider.setValue(1, true, true);
                            return; // 2
                        case 51:
                            this.speedSlider.setValue(2, true, true);
                            return; // 3
                        case 52:
                            this.speedSlider.setValue(3, true, true);
                            return; // 4
                        case 53:
                            this.speedSlider.setValue(4, true, true);
                            return; // 5
                        default: return;
                    }
                };
                document.addEventListener('keydown', this.keydownHandler);
                this.initialized = true;
            }
            else {
                // On subsequent initializations, just update the turn slider range
                // Update the slider's min, max, and value without destroying it
                this.turnSlider.setAttribute({
                    min: this.config.start,
                    max: this.config.end
                });
                this.turnSlider.setValue(this.config.initial || this.config.start, true, true);
            }
            // Update turn slider event handlers (remove old ones first)
            $(this.turnSliderEl).off('change').on('change', (e) => {
                this.config.onChange(e.value.newValue);
            });
            // Listen for slide events (fires continuously while dragging)
            $(this.turnSliderEl).off('slide').on('slide', (e) => {
                this.config.onChange(e.value);
            });
            this.setTurn(this.config.initial || this.config.start);
        }
        // Get current turn number from slider
        getTurn() {
            return this.turnSlider.getValue();
        }
        // Set turn number on slider
        setTurn(turn) {
            this.turnSlider.setValue(turn, true, true);
        }
        // Step forward/backward by specified number of turns
        step(step) {
            if (step === undefined) {
                step = 1;
            }
            if (this.getTurn() + step < this.config.start) {
                this.setTurn(this.config.start);
            }
            else if (this.getTurn() + step > this.config.end) {
                this.setTurn(this.config.end);
            }
            else {
                this.setTurn(this.getTurn() + step);
            }
        }
        // Start automatic playback
        play() {
            if (this.playTimer) {
                return;
            }
            this.playTimer = setInterval(() => {
                this.step();
            }, this.playInterval);
        }
        // Pause automatic playback
        pause() {
            if (!this.playTimer) {
                return;
            }
            clearInterval(this.playTimer);
            this.playTimer = null;
        }
        // Toggle between play and pause states
        togglePlay() {
            const icon = this.playPauseBtn.querySelector('i');
            if (this.playTimer) {
                this.pause();
                icon.classList.remove('fa-pause');
                icon.classList.add('fa-play');
            }
            else {
                this.play();
                icon.classList.remove('fa-play');
                icon.classList.add('fa-pause');
            }
        }
        // Set playback speed (0-4 scale)
        setSpeed(speed) {
            speed = speed || 0;
            this.playInterval = this.playIntervals[Math.max(0, Math.min(Math.round(speed), this.playIntervals.length - 1))];
            if (this.playTimer) {
                this.pause();
                this.play();
            }
        }
        // Clear the control bar (cleanup timers)
        clear() {
            var _a;
            // Stop playback timer if running
            if (this.playTimer) {
                clearInterval(this.playTimer);
                this.playTimer = null;
            }
            // Reset play/pause button to play icon
            const icon = (_a = this.playPauseBtn) === null || _a === void 0 ? void 0 : _a.querySelector('i');
            if (icon) {
                icon.classList.remove('fa-pause');
                icon.classList.add('fa-play');
            }
        }
    }

    /**
     * binary-parser.ts
     * Handles parsing of binary replay files for Civilization V
     * Uses jDataView library to read binary data with proper byte order handling
     */
    // External libraries accessed as globals - types defined in globals.d.ts
    class BinaryParser {
        constructor(file, size) {
            this.view = new jDataView(file, 0, size, false); // Initialize view with file buffer, false = little-endian
        }
        // Parse a single data item based on its configuration
        parseItem(itemConfig, includeJunk) {
            if (typeof itemConfig === 'string') {
                itemConfig = { type: itemConfig };
            }
            if (typeof itemConfig === 'function') {
                (itemConfig.bind(this))();
                return;
            }
            const config = itemConfig;
            switch (config.type) {
                case 'byte': return this.getBytes(config.length);
                case 'str': return this.getString(config.length);
                case 'varstr': return this.getVarString();
                case 'int32': return this.getInt32();
                case 'int16': return this.getInt16();
                case 'int8': return this.getInt8();
                case 'until': return this.getUntil(config.value);
                case 'tell': return this.tell();
                case 'array': return this.getArray(config.items, includeJunk);
            }
        }
        // Parse multiple items from a configuration object or array
        parseItems(itemConfigs, includeJunk) {
            if (typeof itemConfigs === 'object' && 'type' in itemConfigs && itemConfigs.type === 'array') {
                return this.parseItem(itemConfigs, includeJunk);
            }
            // Takes dictionary of configs
            const data = {};
            _.each(itemConfigs, (type, key) => {
                const pointer = this.tell();
                try {
                    const value = this.parseItem(type, includeJunk);
                    if (key === "events" && Array.isArray(value))
                        console.log(`Parsed ${value.length} events`);
                    // Bail if we don't want to include junk data
                    if (key.startsWith('_') && includeJunk === false) {
                        return;
                    }
                    data[key] = value;
                }
                catch (e) {
                    // Seek back to the pointer
                    this.view.seek(pointer);
                    console.error(`Error parsing key "${key}" at position ${this.decToHex(pointer)}: ${e}`);
                    // Print the next 200 bytes
                    const bytes = this.getBytes(200);
                    const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
                    console.log(`Next 200 bytes: ${hex.toUpperCase()}`);
                    // Print the current data
                    console.log(data);
                    throw (e);
                }
            });
            return data;
        }
        // Get current position in the buffer
        tell() {
            return this.view.tell();
        }
        // Read specified number of bytes from current position
        getBytes(length) {
            try {
                return this.view.getBytes(length);
            }
            catch (e) {
                throw new Error(`Unable to read ${length} bytes at position ${this.decToHex(this.tell())}`);
            }
        }
        // Read fixed-length string from current position
        getString(length) {
            try {
                return this.view.getString(length);
            }
            catch (e) {
                throw new Error(`Unable to read string of length ${length} at position ${this.decToHex(this.tell())}`);
            }
        }
        // Read 32-bit integer (little-endian)
        getInt32() {
            return this.view.getInt32(this.tell(), true);
        }
        // Read 16-bit integer (little-endian)
        getInt16() {
            return this.view.getInt16(this.tell(), true);
        }
        // Read 8-bit integer
        getInt8() {
            return this.view.getInt8(this.tell());
        }
        // Read bytes until a specific value is encountered
        getUntil(test) {
            const result = [];
            let val = null;
            do {
                val = this.getInt8();
                result.push(val);
            } while (val !== test);
            return result;
        }
        // Read variable-length string (length prefix as 32-bit int)
        getVarString() {
            // Variable-length string - uses first four bytes to specify length
            const length = this.getInt32();
            const value = this.getString(length);
            return value;
        }
        // Read array of items (length prefix as 32-bit int)
        getArray(config, includeJunk) {
            const length = this.getInt32();
            const records = [];
            for (let i = 0; i < length; i++) {
                let record = {};
                if (typeof config === 'function') {
                    record = config(i, includeJunk);
                }
                else if (typeof config === 'object') {
                    record = this.parseItems(config, includeJunk);
                }
                records.push(record);
            }
            return records;
        }
        // Convert decimal number to hexadecimal string (for debugging)
        decToHex(dec) {
            // arbitrary length decimal to hex conversion
            return parseInt(dec.toString()).toString(16).toUpperCase().padStart(2, '0');
        }
    }

    /**
     * replay-parser.ts
     * Handles parsing of Civilization V (Vox Populi) replay files
     * Separates parsing logic from data management
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
            this.view.seek(this.view.tell() - 7);
            console.log(`Found the start year: ${this.decToHex(this.view.tell())}`);
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
     * Responsible for parsing binary replay files
     */
    class ReplayParser {
        constructor(file, size, fileConfig) {
            this.parser = new BinaryParser(file, size);
            this.fileConfig = fileConfig || DEFAULT_FILE_CONFIG;
        }
        /**
         * Parse the replay file and return raw data
         * @param includeJunk Whether to include unknown/debug fields
         */
        parse(includeJunk = false) {
            return this.parser.parseItems(this.fileConfig, includeJunk);
        }
        /**
         * Get the default file configuration
         */
        static getDefaultFileConfig() {
            return DEFAULT_FILE_CONFIG;
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
                    if (this.replay.getCivName(event.civId) === null)
                        return;
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
            event.text = `Claimed ${tileCount} tile${tileCount > 1 ? 's' : ''}.`;
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
        }
        /**
         * Load replay data from a binary file
         */
        loadFromFile(file, size) {
            const parser = new ReplayParser(file, size);
            const rawData = parser.parse(false);
            this.processRawData(rawData);
        }
        /**
         * Process raw parsed data and populate the replay instance
         */
        processRawData(rawData) {
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
            // Process datasets
            this.processDatasets(rawData.datasets, rawData.datasetValues);
            // Process events
            this.processEvents(rawData.events || []);
            // Process tiles
            this.processTiles(rawData.tiles || []);
        }
        /**
         * Process dataset values by civ id and dataset name
         */
        processDatasets(datasets, datasetValues) {
            if (!datasets || !datasetValues)
                return;
            const datasetNames = datasets.map(d => d.key);
            const processedDatasets = datasetNames.map((_key, index) => {
                return datasetValues.map((civData) => civData[index] || []);
            });
            // Create object from key-value pairs (ES5 compatible)
            this.datasets = {};
            datasetNames.forEach((name, i) => {
                this.datasets[name] = processedDatasets[i];
            });
        }
        /**
         * Process game events and add human-readable information
         */
        processEvents(events) {
            const eventParser = new EventParser(this);
            this.events = eventParser.processEvents(events);
            this.cities = eventParser.getCities();
        }
        /**
         * Process tiles and convert IDs to enums
         */
        processTiles(tiles) {
            if (!tiles || tiles.length === 0)
                return;
            // Convert raw tile data to use enums
            const processedTiles = tiles.map((tile) => {
                var _a, _b;
                const processed = {
                    x: 0, // Will be set later
                    y: 0, // Will be set later
                    elevation: ((_a = tile.elevationId) !== null && _a !== void 0 ? _a : ElevationType.AboveSeaLevel),
                    type: tile.type,
                    feature: ((_b = tile.featureId) !== null && _b !== void 0 ? _b : FeatureType.NoFeature)
                };
                // Copy any additional raw properties
                Object.keys(tile).forEach(key => {
                    processed[key] = tile[key];
                });
                return processed;
            });
            // Chunk into 2D array and add coordinates
            this.tiles = this.chunk(processedTiles, this.mapWidth);
            for (let y = 0; y < this.tiles.length; y++) {
                for (let x = 0; x < this.tiles[y].length; x++) {
                    this.tiles[y][x].x = x;
                    this.tiles[y][x].y = y;
                }
            }
        }
        /**
         * Utility function to chunk an array into a 2D array
         */
        chunk(array, size) {
            const result = [];
            for (let i = 0; i < array.length; i += size) {
                result.push(array.slice(i, i + size));
            }
            return result;
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
         * Get civilization color from ID or name
         */
        getCivColor(civIdOrName) {
            let civName = null;
            if (typeof civIdOrName === 'number') {
                civName = this.getCivName(civIdOrName);
            }
            else {
                civName = civIdOrName;
            }
            if (!civName || !CivColors[civName]) {
                return null;
            }
            return CivColors[civName];
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
         * Get dataset values for a specific civilization and dataset
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
     * replay-viewer.ts
     * UI component for the replay viewer application
     * Manages user interactions, file handling, and coordinates between data and visualization
     */
    /**
     * ReplayViewer UI component
     * Handles user interactions and coordinates between replay data and visualization components
     */
    class ReplayViewer {
        constructor() {
            this.replay = null; // Replay data hub instance
            this.eventLog = null; // Event log UI component
            this.controlBar = null; // Playback control UI component
            // UI state
            this.fileUrl = null;
            this.initialTurn = null;
            this.isLoading = false;
            this.initialize();
            // Create control bar instance once (will be reinitialized with each replay)
            this.controlBar = new ControlBar();
        }
        /**
         * Initialize the UI component
         */
        initialize() {
            // Initialize map visualization
            this.map = new ReplayMap();
            // Setup file handling (drag-and-drop and click-to-open)
            this.setupFileHandling();
            // Setup window resize handler
            this.setupResizeHandler();
            // Check for URL parameters
            this.handleUrlParameters();
        }
        /**
         * Setup file handling (drag-and-drop and click-to-open)
         */
        setupFileHandling() {
            const dropZone = document.body;
            // Prevent default drag behaviors
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
            // Register drag-and-drop event listeners
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
            // Setup click-to-open file dialog
            dropZone.addEventListener('click', (e) => {
                // Only trigger on body background clicks
                if (e.target === dropZone) {
                    this.openFileDialog();
                }
            });
        }
        /**
         * Open file selection dialog
         */
        openFileDialog() {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.Civ5Replay';
            input.onchange = (e) => {
                const target = e.target;
                if (target.files && target.files.length > 0) {
                    this.loadFile(target.files[0]);
                }
            };
            input.click();
        }
        /**
         * Setup window resize handler to refit map
         */
        setupResizeHandler() {
            let resizeTimeout;
            window.addEventListener('resize', () => {
                // Debounce resize events
                clearTimeout(resizeTimeout);
                resizeTimeout = window.setTimeout(() => {
                    // Only refit if we have a loaded replay
                    if (this.hasReplay()) {
                        this.map.fitMap();
                    }
                }, 250);
            });
        }
        /**
         * Handle URL parameters for file loading
         */
        handleUrlParameters() {
            const urlParams = new URLSearchParams(window.location.search);
            this.fileUrl = urlParams.get('file');
            this.initialTurn = urlParams.get('turn');
            if (this.fileUrl) {
                this.loadFromUrl(this.fileUrl);
            }
        }
        /**
         * Load a replay file
         */
        loadFile(file) {
            if (this.isLoading)
                return;
            this.isLoading = true;
            const reader = new FileReader();
            reader.onloadend = (e) => {
                var _a;
                const result = (_a = e.target) === null || _a === void 0 ? void 0 : _a.result;
                if (result) {
                    this.processReplayData(result, file.size);
                }
                this.isLoading = false;
            };
            reader.onerror = (e) => {
                var _a;
                console.error('Error reading file:', e);
                this.showError('Failed to read file: ' + ((_a = e.target) === null || _a === void 0 ? void 0 : _a.error));
                this.isLoading = false;
            };
            reader.readAsArrayBuffer(file);
        }
        /**
         * Load replay from URL
         */
        loadFromUrl(fileUrl) {
            if (this.isLoading)
                return;
            this.isLoading = true;
            const xhr = new XMLHttpRequest();
            // Use the URL directly
            const url = fileUrl;
            xhr.open('GET', url, true);
            xhr.responseType = 'arraybuffer';
            xhr.onload = (e) => {
                const target = e.target;
                if (target.status === 200) {
                    this.processReplayData(target.response, target.response.byteLength);
                }
                else {
                    this.showError(`Failed to load file: HTTP ${target.status}`);
                }
                this.isLoading = false;
            };
            xhr.onerror = () => {
                this.showError('Failed to load file from URL');
                this.isLoading = false;
            };
            xhr.send();
        }
        /**
         * Process loaded replay data
         */
        processReplayData(data, size) {
            try {
                // Clean up previous replay
                this.cleanup();
                // Create new replay instance and load data
                this.replay = new Replay();
                this.replay.loadFromFile(data, size);
                // Initialize UI components
                this.initializeUIComponents();
                // Set initial turn
                const initialTurn = this.initialTurn
                    ? parseInt(this.initialTurn) || this.replay.startTurn
                    : this.replay.startTurn;
                // Trigger initial render
                this.renderTurn(initialTurn);
                // Fit map to container after everything is loaded
                // Use setTimeout to ensure DOM has updated
                setTimeout(() => {
                    this.map.fitMap();
                }, 100);
            }
            catch (error) {
                console.error('Error processing replay:', error);
                this.showError('Failed to process replay file: ' + error.message);
            }
        }
        /**
         * Initialize UI components with replay data
         */
        initializeUIComponents() {
            if (!this.replay)
                return;
            // Initialize event log
            this.eventLog = new EventLog(this.replay.events, this.replay);
            // Initialize map layers
            this.map.initLayers(this.replay.tiles, this.replay.events, this.replay);
            // Fit map immediately after layers are initialized
            this.map.fitMap();
            // Reinitialize control bar with new replay data (reuses existing instance)
            this.controlBar.initialize({
                start: this.replay.startTurn,
                end: this.replay.endTurn,
                initial: this.initialTurn
                    ? parseInt(this.initialTurn) || this.replay.startTurn
                    : this.replay.startTurn,
                onChange: (turn) => this.renderTurn(turn)
            });
        }
        /**
         * Render a specific turn
         */
        renderTurn(turn) {
            if (!this.replay || !this.eventLog || !this.map)
                return;
            this.eventLog.renderTurn(turn);
            this.map.renderTurn(turn);
        }
        /**
         * Clean up previous replay data and UI components
         */
        cleanup() {
            // Clean up event log
            if (this.eventLog) {
                const logMessages = document.querySelector('.log-messages');
                if (logMessages) {
                    logMessages.innerHTML = '';
                }
                this.eventLog = null;
            }
            // Clean up map layers and controls
            if (this.map && this.map.map) {
                // Reset the map's turn tracking state
                this.map.resetTurnState();
                if (this.map.layers) {
                    Object.values(this.map.layers).forEach(layer => {
                        // Clear tile cache if the layer has this method
                        if (layer.clearCache) {
                            layer.clearCache();
                        }
                        this.map.map.removeLayer(layer);
                    });
                }
                if (this.map.controls) {
                    Object.values(this.map.controls).forEach(control => {
                        this.map.map.removeControl(control);
                    });
                }
            }
            // Clean up control bar (but don't null it - we'll reuse the instance)
            this.controlBar.clear();
            // Clean up replay data
            this.replay = null;
        }
        /**
         * Show error message to user
         */
        showError(message) {
            // Simple alert for now, could be replaced with better UI
            alert(message);
        }
        /**
         * Get current replay data
         */
        getReplay() {
            return this.replay;
        }
        /**
         * Check if a replay is loaded
         */
        hasReplay() {
            return this.replay !== null;
        }
        /**
         * Get loading state
         */
        isLoadingFile() {
            return this.isLoading;
        }
    }

    /**
     * main.ts
     * Entry point for the Civilization V replay viewer application
     * Initializes UI components and creates the main ReplayViewer instance
     */
    // External libraries accessed as globals - types defined in globals.d.ts
    // Init event selectpicker
    // Note: Bootstrap components require jQuery, so we keep it for vendor libraries only
    $('#event-select').selectpicker({
        width: 275,
        noneSelectedText: 'No event types selected',
        countSelectedText: function (numSelected, numTotal) {
            return (numSelected == 1) ? '{0} item selected' : '{0} event types selected';
        }
    });
    $('#event-select').selectpicker('val', [
        EventType.Message,
        EventType.Strategies,
        EventType.CityFounded,
        EventType.CitiesTransferred,
        EventType.CityRazed,
        EventType.PantheonSelected,
        EventType.ReligionFounded
    ]);
    // Init the sliders to get the styling
    $('#speedSlider').slider({
        id: 'speedSlider',
        min: 0,
        max: 0,
        value: 0,
        tooltip: 'hide'
    });
    $('#turnSlider').slider({
        id: 'turnSlider',
        min: 0,
        max: 0,
        value: 0,
        tooltip: 'hide'
    });
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
