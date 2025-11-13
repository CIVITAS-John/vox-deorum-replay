/**
 * hex-layer.ts
 * Custom Leaflet layer for rendering hexagonal tile maps
 * Extends Leaflet's GridLayer to draw hexagonal grids for Civilization V maps
 * Migrated from L.TileLayer.Canvas (Leaflet 0.7.x) to L.GridLayer (Leaflet 1.x+)
 */


declare const L: any;
declare const _: any;

/**
 * Configuration interface for HexLayer initialization
 */
interface HexLayerInitConfig {
	hexes?: any[][];  // Array of hex data rows
	height?: number;  // Grid height (number of rows)
	width?: number;   // Grid width (number of columns)
	drawHex?: (ctx: CanvasRenderingContext2D, hex: any, cx: number, cy: number, x1: number, y1: number, x2: number, y2: number) => void;  // Custom drawing function
	drawHexEdges?: (ctx: CanvasRenderingContext2D, hex: any, cx: number, cy: number) => Set<number> | null;  // Custom function to determine which edges to draw
	overdraw?: number;  // Extra height for hex drawing
	clipHexes?: boolean;  // Whether to clip hex drawing (default: true)
	// Standard Leaflet GridLayer options
	opacity?: number;
	zIndex?: number;
	minZoom?: number;
	maxZoom?: number;
}

/**
 * HexLayer - Custom layer for rendering hexagonal tiles
 * @extends L.GridLayer
 */
export const HexLayer = L.GridLayer.extend({
	/**
	 * Initialize the hex layer with configuration
	 * @param {Object} config - Configuration object containing hexes, dimensions, and drawing options
	 */
	initialize: function (config: HexLayerInitConfig) {
		// Call parent constructor with options
		const options = _.extend({}, config);

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
		const leafletOptions: any = {};
		if (config.opacity !== undefined) leafletOptions.opacity = config.opacity;
		if (config.zIndex !== undefined) leafletOptions.zIndex = config.zIndex;
		if (config.minZoom !== undefined) leafletOptions.minZoom = config.minZoom;
		if (config.maxZoom !== undefined) leafletOptions.maxZoom = config.maxZoom;

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
	createTile: function (coords: any) {
		// Create canvas element
		const tile = document.createElement('canvas') as HTMLCanvasElement;
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
	_drawTile: function (tileCanvas: HTMLCanvasElement, coords: any) {
		if (!this.config.drawHex) { return; }

		// Get canvas context for drawing
		var ctx = tileCanvas.getContext('2d');
		if (!ctx) return;

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
				if (!this.hexes[flippedGridY] || !this.hexes[flippedGridY][gridX]) { continue; }

				// Our own drawing function sets up the ctx with a hex polygon
				const hex = this.hexes[flippedGridY][gridX];
				const edgesToDraw = this.config.drawHexEdges ?
					this.config.drawHexEdges(ctx, hex, x, y) : null;

				const clipping = this.preDrawHex(ctx, x, y, hexWidth, hexHeight + (this.config.overdraw || 0), edgesToDraw);

				// Custom drawing function does something with it
				ctx.save();
				if (this.config.clipHexes) ctx.clip(clipping);

				this.config.drawHex(
					ctx,
					hex,
					x, y,
					x - hexWidth / 2, y - hexHeight / 2,
					x + hexWidth / 2, y + hexHeight / 2
				);

				ctx.restore();
			}
		}
	},

	preDrawHex: function (ctx: any, x: number, y: number, width: number, height: number, edgesToDraw?: Set<number> | null) {
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
			} else {
				// If we shouldn't draw this edge, use moveTo to skip drawing
				ctx.moveTo(endX, endY);
			}
			clipping.lineTo(endX, endY);
		}

		clipping.closePath();
		return clipping;
	},


	drawImage: function (ctx: any, id: string, sx: number, sy: number, sw: number, sh: number) {
		var img = document.getElementById(id) as HTMLImageElement;
		ctx.drawImage(img, 0, 0, img.width, img.height, sx, sy, sw, sh);
	},

	/**
	 * Selectively redraw only specific hexes that have changed
	 * @param {string[]} changedHexKeys - Array of hex keys in format "x,y"
	 */
	redrawHexes: function (changedHexKeys: string[]) {
		if (!this._map || changedHexKeys.length === 0) return;

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
		const tilesToRedraw = new Set<string>();

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