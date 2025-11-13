/**
 * hex-layer.ts
 * Custom Leaflet layer for rendering hexagonal tile maps
 * Extends Leaflet's GridLayer to draw hexagonal grids for Civilization V maps
 * Migrated from L.TileLayer.Canvas (Leaflet 0.7.x) to L.GridLayer (Leaflet 1.x+)
 */

declare const L: any;
declare const _: any;

/**
 * HexLayer - Custom layer for rendering hexagonal tiles
 * @extends L.GridLayer
 */
export const HexLayer = L.GridLayer.extend({
	/**
	 * Initialize the hex layer with configuration
	 * @param {Object} config - Configuration object containing hexes, dimensions, and drawing options
	 */
	initialize: function (config: any) {
		// Call parent constructor with options
		const options = _.extend({}, config);

		// Extract non-standard options into config
		this.config = {
			hexes: config.hexes,
			height: config.height,
			width: config.width,
			drawHex: config.drawHex,
			overdraw: config.overdraw,
			gridStyle: config.gridStyle
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
				this.preDrawHex(ctx, x, y, hexWidth, hexHeight + (this.config.overdraw || 0), this.config.gridStyle, gridX, flippedGridY);

				// Custom drawing function does something with it
				ctx.save();
				ctx.clip();

				this.config.drawHex(
					ctx,
					this.hexes[flippedGridY][gridX],
					x, y,
					x - hexWidth / 2, y - hexHeight / 2,
					x + hexWidth / 2, y + hexHeight / 2
				);

				ctx.restore();
			}
		}
	},

	preDrawHex: function (ctx: any, x: number, y: number, width: number, height: number, gridStyle: string, gridX: number, flippedGridY: number) {
		var globalCompositeOperation = ctx.globalCompositeOperation;
		ctx.globalCompositeOperation = 'destination-over';

		var angle = 2 * Math.PI / 6 * (0 + 0.5);
		var startX = x + (height * 0.5) * Math.cos(angle);
		var startY = y + (height * 0.5) * Math.sin(angle);

		ctx.beginPath();
		ctx.moveTo(startX, startY);

		var lastX = startX;
		var lastY = startY;

		for (var i = 1; i <= 6; i++) {
			angle = 2 * Math.PI / 6 * (i + 0.5);
			var endX = x + (height * 0.5) * Math.cos(angle);
			var endY = y + (height * 0.5) * Math.sin(angle);

			var selfEdgeName = [gridX, flippedGridY, i].join(',');
			var otherEdgeName;

			switch (i) {
				case 1: otherEdgeName = [gridX, flippedGridY + 1, 4].join(','); break;
				case 2: otherEdgeName = [gridX - 1, flippedGridY + 1, 5].join(','); break;
				case 3: otherEdgeName = [gridX - 1, flippedGridY, 6].join(','); break;
				case 4: otherEdgeName = [gridX, flippedGridY - 1, 1].join(','); break;
				case 5: otherEdgeName = [gridX + 1, flippedGridY - 1, 2].join(','); break;
				case 6: otherEdgeName = [gridX + 1, flippedGridY, 3].join(','); break;
			}

			var edgeName = selfEdgeName < otherEdgeName ? selfEdgeName : otherEdgeName;

			ctx.lineTo(endX, endY);

			ctx.canvas.edges = ctx.canvas.edges || {};

			if (gridStyle) {
				ctx.closePath();

				if (!ctx.canvas.edges[edgeName]) {
					ctx.canvas.edges[edgeName] = true;

					if (prettyDamnClose(endX, lastX) || prettyDamnClose(endY, lastY)) {
						// Canvas is really dumb with straight lines that use transparency - we need
						// to just do it ourselves by setting individual pixels, becauses stroke()
						// will try to do pathetic anti-aliasing that completely changes the color.
						this.drawNonAntiAliasedLine(ctx, lastX, lastY, endX, endY, gridStyle);
					}
					else {
						ctx.lineWidth = 1;
						ctx.strokeStyle = gridStyle;
						ctx.stroke();
					}
				}

				ctx.beginPath();
				ctx.moveTo(endX, endY);
			}

			lastX = endX;
			lastY = endY;
		}

		ctx.globalCompositeOperation = globalCompositeOperation;

		function prettyDamnClose(a: number, b: number) {
			return Math.abs((a - b) / a) < 0.01;
		}
	},

	drawNonAntiAliasedLine: function (ctx: any, startX: number, startY: number, endX: number, endY: number, style: string) {
		// This is NOT a general purpose line drawing function! It's purely for bypassing
		// a bug in canvas that anti-aliases lines even when they're perfectly horizontal
		// or vertical, which distorts the color. Note that this is NOT solvable by using
		// ctx.imageSmoothingEnabled = false.

		ctx.fillStyle = style;

		for (var x = startX; x <= endX; x++) {
			for (var y = startY; y <= endY; y++) {
				ctx.fillRect(x, y, 1, 1);
			}
		}

		// Mark the line as being drawn by this function
		// ctx.fillStyle = 'rgb(255, 0, 0)'
		// ctx.fillRect(startX, startY, 1, 1)
		// ctx.fillRect(endX,   endY,   1, 1)
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
				// Redraw the specific tile
				this._drawTile(tile.el, coords);
			}
		}
	}
});