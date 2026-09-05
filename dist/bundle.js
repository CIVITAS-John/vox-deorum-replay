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
            // Saves without usable map dimensions can carry an empty hex grid, so
            // guard the bounds math against missing rows
            var south = north - ((tiles.length ? tiles.length : 1) * 0.3888888889);
            var east = west + ((tiles.length && tiles[0].length ? tiles[0].length : 1) * 2.4285714286);
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
    /** Offset of the plot type byte behind the river id list */
    const PLOT_PLOT_TYPE_OFFSET = 8;
    /** Offset of the terrain type byte behind the river id list */
    const PLOT_TERRAIN_OFFSET = 9;
    /** Offset of the feature word behind the river id list, stored as a full enum */
    const PLOT_FEATURE_OFFSET = 10;
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
        const plotType = view.getInt8(base + PLOT_PLOT_TYPE_OFFSET);
        const terrain = view.getInt8(base + PLOT_TERRAIN_OFFSET);
        const feature = view.getInt32(base + PLOT_FEATURE_OFFSET, true);
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
        return { end: p, plotType, terrain, feature, rivers };
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
                    rivers: record.rivers
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
            // Stage 7: replay data clusters, one per player slot in slot order
            const clusters = this.scanClusters(state, eventList.endPos, endTurn);
            const citySeries = this.predictCityCounts(eventList.messages, civSlots, endTurn);
            const deaths = this.analyzeDeaths(eventList.messages, civSlots);
            const clusterBySlot = this.assignClusters(clusters, civSlots, citySeries, deaths, endTurn);
            // Stage 8: map dimensions and terrain, then assemble the output shape
            const mapDims = this.readMapDimensions(state, eventList.messages);
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
            return this.assembleRawData(header, prelude, civs, civSlots, slotToIndex, eventList.messages, clusters, clusterBySlot, mapDims, terrain);
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
         * version string, then the first game fields including the turn counters
         * and the start year
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
            state.getInt32(); // Winning turn
            const startYear = state.getInt32();
            const endTurn = elapsedGameTurns;
            if (endTurn !== headerTurn) {
                console.warn(`Save turn mismatch: header says ${headerTurn}, game section says ${endTurn}`);
            }
            return { startTurn, endTurn, startYear };
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
         * Read the map dimensions
         * The map section follows the embedded savegame database directly, but its
         * fields can carry corrupted high bytes, so both dimensions are masked to
         * their low sixteen bits. When the landmark does not validate, the event
         * coordinates provide a fallback estimate. The section position is returned
         * alongside the dimensions so the terrain walker can start from there
         * @param state Reader over the decompressed game state
         * @param messages The parsed event log
         */
        readMapDimensions(state, messages) {
            const body = this.decompressed;
            const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
            // First choice: the grid header right after the savegame database
            const dbPos = findBytes(body, stringToBytes(SQLITE_MAGIC), 0);
            if (dbPos > 4) {
                const dbSize = view.getInt32(dbPos - 4, true);
                const mapPos = dbPos + dbSize;
                if (dbSize > 0 && mapPos + 8 <= body.byteLength) {
                    state.seek(mapPos);
                    const width = state.getInt32() & 0xffff;
                    const height = state.getInt32() & 0xffff;
                    if (this.validateMapDims(width, height, messages)) {
                        this.diagnostics.mapDimsSource = 'map-section';
                        return { width, height, mapPos };
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
                return { width: maxX + 1, height: maxY + 1, mapPos: -1 };
            }
            this.diagnostics.mapDimsSource = 'none';
            return { width: 0, height: 0, mapPos: -1 };
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
         * Assemble the output in the same shape the replay parser produces
         */
        assembleRawData(header, prelude, civs, civSlots, slotToIndex, messages, clusters, clusterBySlot, mapDims, terrain) {
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
                        tiles.push({ elevation: t.elevation, type: t.type, feature: t.feature, rivers: t.rivers });
                    }
                    else {
                        tiles.push({ elevation: -1, type: -1, feature: -1, rivers: [] });
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
                datasets,
                datasetValues,
                events,
                mapWidth: mapDims.width,
                mapHeight: mapDims.height,
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
         * Replay files parse synchronously, save files are routed through the
         * save parser which inflates the compressed game state first
         * @param file The raw file contents
         * @param size The size of the file data within the buffer
         */
        async loadFromFile(file, size) {
            const rawData = isSaveFile(file)
                ? await new SaveParser(file, size).parseReplay()
                : new ReplayParser(file, size).parse(false);
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
            input.accept = '.Civ5Replay,.Civ5Save';
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
                    void this.processReplayData(result, file.size);
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
                    void this.processReplayData(target.response, target.response.byteLength);
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
         * Save files parse asynchronously because the compressed body has to be
         * inflated first, so the loading paths fire and forget this method and
         * rely on its own error handling
         * @param data The raw file contents
         * @param size The size of the file data within the buffer
         */
        async processReplayData(data, size) {
            try {
                // Clean up previous replay
                this.cleanup();
                // Create new replay instance and load data
                this.replay = new Replay();
                await this.replay.loadFromFile(data, size);
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
