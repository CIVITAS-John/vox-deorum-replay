(function () {
    'use strict';

    /**
     * hex-layer.ts
     * Custom Leaflet layer for rendering hexagonal tile maps
     * Extends Leaflet's Canvas TileLayer to draw hexagonal grids for Civilization V maps
     */
    /**
     * HexLayer - Custom layer for rendering hexagonal tiles
     * @extends L.TileLayer.Canvas
     */
    const HexLayer = L.TileLayer.Canvas.extend({
        /**
         * Initialize the hex layer with configuration
         * @param {Object} config - Configuration object containing hexes, dimensions, and drawing options
         */
        initialize: function (config) {
            this.options = _.clone(this.options, true);
            this.config = config;
            this.tileCache = {};
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
            if (this.config.opacity) {
                this.setOpacity(this.config.opacity);
            }
            if (this.config.drawHex) {
                this.config.drawHex = this.config.drawHex.bind(this);
            }
            if (this.config.zIndex) {
                this.setZIndex(this.config.zIndex);
            }
            this.tileCache = {};
        },
        drawTile: function (tileCanvas, tilePoint, zoom) {
            if (!this.config.drawHex) {
                return;
            }
            // Get canvas context for drawing
            var ctx = tileCanvas.getContext('2d');
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
            // Get cache key
            var cacheKey = [tileX, tileY, zoom].join(',');
            if (this.config.cacheKeySuffix) {
                cacheKey += this.config.cacheKeySuffix();
            }
            // Load from cache if we have it
            if (this.tileCache[cacheKey] && !this.config.nocache) {
                ctx.putImageData(this.tileCache[cacheKey], 0, 0);
                return;
            }
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
            // ctx.fillStyle = 'rgba(0, 255, 0, 0.3)'
            // ctx.fillRect(0, 0, tileCanvas.width, tileCanvas.height)
            // ctx.fillStyle = null
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
                    this.preDrawHex(ctx, x, y, hexWidth, hexHeight + (this.config.overdraw || 0), this.config.gridStyle, gridX, flippedGridY);
                    // Custom drawing function does something with it
                    ctx.save();
                    ctx.clip();
                    this.config.drawHex(ctx, this.hexes[flippedGridY][gridX], x, y, x - hexWidth / 2, y - hexHeight / 2, x + hexWidth / 2, y + hexHeight / 2);
                    ctx.restore();
                }
            }
            // Grid
            // ctx.strokeStyle = 'white'
            // ctx.strokeRect(0, 0, tileCanvas.width, tileCanvas.height)
            // Labels to help visualize the way tiles are laid out
            // ctx.font      = '24px serif'
            // ctx.fillStyle = 'white'
            //
            // var textHeight = 25
            // var textIndex  = 0
            // ctx.fillText('zoom: '       + zoom,        20, textHeight * textIndex); textIndex++
            // ctx.fillText('x: '          + tilePoint.x, 20, textHeight * textIndex); textIndex++
            // ctx.fillText('y: '          + tilePoint.y, 20, textHeight * textIndex); textIndex++
            // ctx.fillText('gridCellsX: ' + gridCellsX,  20, textHeight * textIndex); textIndex++
            // ctx.fillText('gridCellsY: ' + gridCellsY,  20, textHeight * textIndex); textIndex++
            // ctx.fillText('startHexX: '  + startHexX,   20, textHeight * textIndex); textIndex++
            // ctx.fillText('startHexY: '  + startHexY,   20, textHeight * textIndex); textIndex++
            // ctx.fillText('offsetX: '    + offsetX,     20, textHeight * textIndex); textIndex++
            // ctx.fillText('offsetY: '    + offsetY,     20, textHeight * textIndex); textIndex++
            this.tileCache[cacheKey] = ctx.getImageData(0, 0, tileCanvas.width, tileCanvas.height);
        },
        preDrawHex: function (ctx, x, y, width, height, gridStyle, gridX, flippedGridY) {
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
                    case 1:
                        otherEdgeName = [gridX, flippedGridY + 1, 4].join(',');
                        break;
                    case 2:
                        otherEdgeName = [gridX - 1, flippedGridY + 1, 5].join(',');
                        break;
                    case 3:
                        otherEdgeName = [gridX - 1, flippedGridY, 6].join(',');
                        break;
                    case 4:
                        otherEdgeName = [gridX, flippedGridY - 1, 1].join(',');
                        break;
                    case 5:
                        otherEdgeName = [gridX + 1, flippedGridY - 1, 2].join(',');
                        break;
                    case 6:
                        otherEdgeName = [gridX + 1, flippedGridY, 3].join(',');
                        break;
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
            function prettyDamnClose(a, b) {
                return Math.abs((a - b) / a) < 0.01;
            }
        },
        drawNonAntiAliasedLine: function (ctx, startX, startY, endX, endY, style) {
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
        drawImage: function (ctx, id, sx, sy, sw, sh) {
            var img = document.getElementById(id);
            ctx.drawImage(img, 0, 0, img.width, img.height, sx, sy, sw, sh);
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
     * map.ts
     * Manages the Leaflet map display for the replay viewer
     * Handles rendering of terrain, cities, territories, and turn-based state changes
     */
    // External libraries accessed as globals - types defined in globals.d.ts
    /**
     * Map class
     * Creates and initializes the Leaflet map instance
     */
    class Map {
        constructor() {
            this.map = L.map(document.querySelector('.map'), {
                attributionControl: false,
                keyboardPanOffset: 0
            }).setView([0, 0], 0);
            this.turn = 0;
        }
        initLayers(tiles, events) {
            var self = this;
            // Track the state of each tile at every turn
            this.turnStates = [];
            var eventsByTurn = _.groupBy(events, 'turn');
            var lastState = {};
            for (var t = events[0].turn; t <= events[events.length - 1].turn; t++) {
                // Start by copying last state
                var state = _.clone(lastState, true);
                var turnEvents = eventsByTurn[t] || [];
                for (var e = 0; e < turnEvents.length; e++) {
                    var event = turnEvents[e];
                    switch (event.type) {
                        case 'CITY_FOUNDED':
                            var index = [event.x, event.y].join(',');
                            state[index] = { owner: event.civ, city: event.city.name };
                            break;
                        case 'TILES_CLAIMED':
                            for (var i = 0; i < event.tiles.length; i++) {
                                var tile = event.tiles[i];
                                var index = [tile.x, tile.y].join(',');
                                state[index] = state[index] || {};
                                if (event.civ) {
                                    state[index].owner = event.civ;
                                }
                                else {
                                    delete state[index];
                                }
                            }
                            break;
                        case 'CITIES_TRANSFERRED':
                            for (var i = 0; i < event.tiles.length; i++) {
                                var tile = event.tiles[i];
                                var index = [tile.x, tile.y].join(',');
                                state[index] = state[index] || {};
                                state[index].owner = event.civ;
                            }
                            break;
                        case 'CITY_RAZED':
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
                        switch (hex.type) {
                            case 'GRASSLAND':
                            case 'PLAINS':
                            case 'DESERT':
                            case 'TUNDRA':
                            case 'SNOW':
                            case 'COAST':
                            case 'OCEAN':
                                this.drawImage(ctx, hex.type, x1, y1, x2 - x1, y2 - y1);
                                break;
                        }
                    }
                }),
                feature: new HexLayer({
                    hexes: tiles,
                    zIndex: 20,
                    drawHex: function (ctx, hex, cx, cy, x1, y1, x2, y2) {
                        switch (hex.feature) {
                            case 'ICE':
                            case 'JUNGLE':
                            // case  'MARSH':
                            // case  'OASIS':
                            // case  'FLOOD_PLAINS':
                            case 'FOREST':
                                this.drawImage(ctx, hex.feature, x1, y1, x2 - x1, y2 - y1);
                                break;
                        }
                    }
                }),
                elevation: new HexLayer({
                    hexes: tiles,
                    zIndex: 20,
                    drawHex: function (ctx, hex, cx, cy, x1, y1, x2, y2) {
                        switch (hex.elevation) {
                            case 'MOUNTAIN':
                            case 'HILLS':
                                this.drawImage(ctx, hex.elevation, x1, y1, x2 - x1, y2 - y1);
                                break;
                        }
                    }
                }),
                territory: new HexLayer({
                    hexes: tiles,
                    zIndex: 30,
                    overdraw: 1,
                    cacheKeySuffix: function () {
                        return '-territory-' + self.turn;
                    },
                    drawHex: function (ctx, hex, cx, cy, x1, y1, x2, y2) {
                        if (!this.turnState) {
                            return;
                        }
                        var state = this.turnState[hex.x + ',' + hex.y];
                        if (!state) {
                            return;
                        }
                        if (state.owner && hex.type !== 'COAST' && hex.type !== 'OCEAN') {
                            var civColors = CivColors[state.owner];
                            var color = civColors ? civColors.territory : [0, 0, 0];
                            ctx.fillStyle = `rgba(${color.join(',')}, 0.85)`;
                            ctx.fill();
                        }
                    }
                }),
                city: new HexLayer({
                    hexes: tiles,
                    zIndex: 40,
                    cacheKeySuffix: function () {
                        return '-city-' + self.turn;
                    },
                    drawHex: function (ctx, hex, cx, cy, x1, y1, x2, y2) {
                        if (!this.turnState) {
                            return;
                        }
                        var state = this.turnState[hex.x + ',' + hex.y];
                        if (!state) {
                            return;
                        }
                        if (state.city) {
                            var civColors = CivColors[state.owner];
                            var color = civColors ? civColors.city : [255, 255, 255];
                            ctx.fillStyle = `rgba(${color.join(',')}, 0.85)`;
                            ctx.fill();
                        }
                    }
                }),
                grid: new HexLayer({
                    zIndex: 50,
                    width: tiles[0].length,
                    height: tiles.length,
                    gridStyle: 'rgba(255, 255, 255, 0.1)',
                    drawHex: function (ctx, hex, cx, cy) { }
                })
            };
            _.each(this.layers, (layer) => layer.addTo(this.map));
            // Add layer switcher
            var overlays = {
                Terrain: this.layers.terrain,
                Elevation: this.layers.elevation,
                Features: this.layers.feature,
                Territory: this.layers.territory,
                Cities: this.layers.city,
                Grid: this.layers.grid
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
            var bounds = [[south, west], [north, east]];
            this.map.fitBounds(bounds);
        }
        renderTurn(turn) {
            this.turn = turn;
            this.turnState = this.turnStates[turn];
            this.layers.city.turnState = this.turnState;
            this.layers.territory.turnState = this.turnState;
            if (this.layers.city._map) {
                this.layers.city.redraw();
            }
            if (this.layers.territory._map) {
                this.layers.territory.redraw();
            }
        }
    }

    /**
     * event-log.ts
     * Manages the event log display for game events
     * Shows filtered messages and events from the replay based on turn and event type
     */
    // External libraries accessed as globals - types defined in globals.d.ts
    /**
     * EventLog class
     * @param {Array} events - Array of game events to display
     */
    class EventLog {
        constructor(events) {
            this.logContainer = document.querySelector('.log-container');
            this.messagesEl = this.logContainer.querySelector('.log-messages');
            this.events = events;
            // Types
            this.types = [];
            const eventSelect = document.getElementById('event-select');
            eventSelect.addEventListener('change', (e) => {
                // Bootstrap selectpicker still needs jQuery, so we'll get value through its API
                this.setTypes($(e.target).val());
            });
            this.setTypes($(eventSelect).selectpicker('val'));
            // Add events and do initial rendering
            this.addAll(events);
            this.renderTurn(events[0].turn);
        }
        add(event) {
            // Occasionally a message is blank? Just don't include it
            if (event.type == 'MESSAGE' && !event.text) {
                return;
            }
            const msg = document.createElement('li');
            msg.className = 'message';
            msg.setAttribute('type', String(event.type));
            msg.setAttribute('civid', String(event.civId || ''));
            msg.setAttribute('turn', String(event.turn));
            msg.textContent = event.text || '';
            // Store event data on element
            msg._eventData = event;
            if (this.types.indexOf(String(event.type)) == -1) {
                msg.classList.add('hidden');
            }
            this.messagesEl.appendChild(msg);
        }
        addAll(events) {
            this.removeAll();
            _.each(this.events, this.add.bind(this));
        }
        remove() {
        }
        removeAll() {
            this.messagesEl.innerHTML = '';
        }
        renderTurn(turn) {
            const messages = this.messagesEl.querySelectorAll('.message');
            messages.forEach((msg) => {
                msg.classList.remove('active');
                if (parseInt(msg.getAttribute('turn')) <= turn) {
                    msg.classList.add('active');
                }
            });
            const activeMessages = this.messagesEl.querySelectorAll('.message.active');
            const lastMessage = activeMessages[activeMessages.length - 1];
            if (lastMessage) {
                const messageOffset = lastMessage.offsetTop;
                const listOffset = this.messagesEl.offsetTop;
                const listScroll = this.messagesEl.scrollTop;
                const listHeight = this.messagesEl.offsetHeight;
                // Simple animation for scrolling
                const targetScroll = turn ? (listScroll + (messageOffset - listOffset) - (listHeight / 2)) : 0;
                this.smoothScroll(this.messagesEl, targetScroll, 200);
            }
        }
        smoothScroll(element, target, duration) {
            const start = element.scrollTop;
            const distance = target - start;
            const startTime = performance.now();
            const animateScroll = (currentTime) => {
                const elapsed = currentTime - startTime;
                const progress = Math.min(elapsed / duration, 1);
                // Easing function (ease-in-out)
                const easeInOut = progress < 0.5
                    ? 2 * progress * progress
                    : 1 - Math.pow(-2 * progress + 2, 2) / 2;
                element.scrollTop = start + (distance * easeInOut);
                if (progress < 1) {
                    requestAnimationFrame(animateScroll);
                }
            };
            requestAnimationFrame(animateScroll);
        }
        setTypes(types) {
            this.types = types;
            const messages = this.messagesEl.querySelectorAll('.message');
            messages.forEach((msg) => msg.classList.add('hidden'));
            types.forEach(type => {
                const typeMessages = this.messagesEl.querySelectorAll(`[type="${type}"]`);
                typeMessages.forEach((msg) => msg.classList.remove('hidden'));
            });
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
            this.config = config;
            this.config.onChange = (this.config.onChange || function () { }).bind(this);
            // Play/pause button
            this.playPauseBtn = document.getElementById('playPause');
            this.playPauseBtn.addEventListener('click', this.togglePlay.bind(this));
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
                value: this.config.start,
                tooltip: 'always',
                tooltip_position: 'bottom'
            });
            this.turnSlider = $(this.turnSliderEl).data().slider;
            $(this.turnSliderEl).on('change', (e) => this.config.onChange(e.value.newValue));
            $(this.turnSliderEl).on('slide', (e) => this.config.onChange(e.value));
            // Listen for spacebar to toggle play/pause
            document.addEventListener('keydown', (e) => {
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
            });
            this.setTurn(this.config.initial);
        }
        getTurn() {
            return this.turnSlider.getValue();
        }
        setTurn(turn) {
            this.turnSlider.setValue(turn, true);
        }
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
        play() {
            if (this.playTimer) {
                return;
            }
            this.playTimer = setInterval(() => {
                this.step();
            }, this.playInterval);
        }
        pause() {
            if (!this.playTimer) {
                return;
            }
            clearInterval(this.playTimer);
            this.playTimer = null;
        }
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
        setSpeed(speed) {
            speed = speed || 0;
            this.playInterval = this.playIntervals[Math.max(0, Math.min(Math.round(speed), this.playIntervals.length - 1))];
            if (this.playTimer) {
                this.pause();
                this.play();
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
     * replay.ts
     * Core replay file parser for Civilization V (Vox Populi) replay files
     * Handles parsing game metadata, player data, map data, and turn events
     */
    // External library accessed as global (lodash) - type defined in globals.d.ts
    class Replay {
        constructor(file, size) {
            this.meta = {};
            this.civs = [];
            this.cities = {};
            this.events = [];
            this.datasets = {};
            this.tiles = [];
            this.parser = new BinaryParser(file, size);
            this.fileConfig = {
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
                        typeId: 'int32',
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
                        elevationId: 'int8',
                        typeId: 'int8',
                        featureId: 'int8',
                        _5: 'int8'
                    }
                }
            };
        }
        process() {
            // Do initial basic parsing
            this.rawData = this.parser.parseItems(this.fileConfig, false);
            // Store everything but civs / tiles / datasets / events in this.meta
            this.meta = _.omit(this.rawData, ['civs', 'datasets', 'datasetValues', 'events', 'tiles']);
            // Civs are fine as is
            this.civs = this.rawData.civs;
            // Organize dataset values by civ id and dataset name
            const datasetNames = _.pluck(this.rawData.datasets, 'key');
            this.datasets = _(this.rawData.datasets).chain().pluck('key').map((key, datasetIndex) => {
                return _.pluck(this.rawData.datasetValues, datasetIndex);
            }).value();
            this.datasets = _.zipObject(datasetNames, this.datasets);
            // Add human-readable stuff to events
            this.cities = {};
            this.events = [];
            _.each(this.rawData.events, (event, i) => {
                // There may be multiple events combined into one to save space
                let eventsToAdd = [event];
                event.index = i;
                event.civ = this.civs[event.civId] ? this.civs[event.civId].name : null;
                // Add type name
                switch (event.typeId) {
                    case 0:
                        event.type = 'MESSAGE';
                        break;
                    case 1:
                        event.type = 'CITY_FOUNDED';
                        break;
                    case 2:
                        event.type = 'TILES_CLAIMED';
                        break;
                    case 3:
                        event.type = 'CITIES_TRANSFERRED';
                        break;
                    case 4:
                        event.type = 'CITY_RAZED';
                        break;
                    case 5:
                        event.type = 'RELIGION_FOUNDED';
                        break;
                    case 6:
                        event.type = 'PANTHEON_SELECTED';
                        break;
                    default:
                        event.type = event.typeId;
                        break;
                }
                // Add x/y reference to keep things easy
                if (event.tiles.length === 1 && event.type !== 'TILES_CLAIMED' && event.type !== 'CITIES_CLAIMED') {
                    event.x = event.tiles[0].x;
                    event.y = event.tiles[0].y;
                }
                if (event.type === 'CITY_FOUNDED') {
                    // Keep track of the city
                    const cityName = event.text.replace(' is founded.', '');
                    event.city = { name: cityName, owner: event.civ };
                    this.cities[event.x + ',' + event.y] = event.city;
                }
                else if (event.type === 'CITY_RAZED') {
                    event.x = event.tiles[0].x;
                    event.y = event.tiles[0].y;
                    event.city = this.cities[event.x + ',' + event.y];
                    event.text = `${event.city.name} has been burned to the ground by ${event.civ}!`;
                    // Mass razings are compounded into one event; we want to separate them
                    _.each(event.tiles.slice(1), (tile) => {
                        const eventCopy = Object.assign({}, event);
                        eventCopy.x = tile.x;
                        eventCopy.y = tile.y;
                        eventCopy.city = this.cities[eventCopy.x + ',' + eventCopy.y];
                        eventCopy.text = `${eventCopy.city.name} has been burned to the ground by ${eventCopy.civ}!`;
                        eventsToAdd.push(eventCopy);
                    });
                }
                else if (event.type === 'CITIES_TRANSFERRED') {
                    const cityNames = _.map(event.tiles, (tile) => {
                        return this.cities[tile.x + ',' + tile.y].name;
                    });
                    if (cityNames.length === 1) {
                        event.text = `${event.civ} now controls the city of ${cityNames[0]}.`;
                    }
                    else {
                        const lastCity = cityNames.pop();
                        const citiesString = cityNames.length === 1 ? cityNames[0] : (cityNames.join(', ') + ',');
                        event.text = `${event.civ} now controls the cities of ${citiesString} and ${lastCity}.`;
                    }
                }
                if (event.type === 'TILES_CLAIMED') {
                    if (event.civ) {
                        event.text = `${event.civ} has claimed ${event.tiles.length} tile${event.tiles.length > 1 ? 's' : ''}.`;
                    }
                    else {
                        event.text = `${event.tiles.length} tile${event.tiles.length > 1 ? 's have' : ' has'} been abandoned!`;
                    }
                }
                this.events = this.events.concat(eventsToAdd);
            });
            // Add human-readable stuff to tiles
            this.tiles = _.each(this.rawData.tiles, (tile, i) => {
                switch (tile.elevationId) {
                    case 0:
                        tile.elevation = 'MOUNTAIN';
                        break;
                    case 1:
                        tile.elevation = 'HILLS';
                        break;
                    case 2:
                        tile.elevation = 'ABOVE_SEA_LEVEL';
                        break;
                    case 3:
                        tile.elevation = 'BELOW_SEA_LEVEL';
                        break;
                    default:
                        tile.elevation = tile.elevationId;
                        break;
                }
                switch (tile.typeId) {
                    case 0:
                        tile.type = 'GRASSLAND';
                        break;
                    case 1:
                        tile.type = 'PLAINS';
                        break;
                    case 2:
                        tile.type = 'DESERT';
                        break;
                    case 3:
                        tile.type = 'TUNDRA';
                        break;
                    case 4:
                        tile.type = 'SNOW';
                        break;
                    case 5:
                        tile.type = 'COAST';
                        break;
                    case 6:
                        tile.type = 'OCEAN';
                        break;
                    default:
                        tile.type = tile.typeId;
                        break;
                }
                switch (tile.featureId) {
                    case -1:
                        tile.feature = 'NO_FEATURE';
                        break;
                    case 0:
                        tile.feature = 'ICE';
                        break;
                    case 1:
                        tile.feature = 'JUNGLE';
                        break;
                    case 2:
                        tile.feature = 'MARSH';
                        break;
                    case 3:
                        tile.feature = 'OASIS';
                        break;
                    case 4:
                        tile.feature = 'FLOOD_PLAINS';
                        break;
                    case 5:
                        tile.feature = 'FOREST';
                        break;
                    case 15:
                        tile.feature = 'CERRO_DE_POTOSI';
                        break;
                    case 17:
                        tile.feature = 'ATOLL';
                        break;
                    case 18:
                        tile.feature = 'SRI_PADA';
                        break;
                    case 19:
                        tile.feature = 'MT_SINAI';
                        break;
                    default:
                        tile.feature = tile.featureId;
                        break;
                    // TODO: enumerate the rest of the natural wonders and feature types
                }
            });
            // Chunk the tiles a 2D array
            this.tiles = _.chunk(this.tiles, this.meta.mapWidth);
            for (let y = 0; y < this.tiles.length; y++) {
                for (let x = 0; x < this.tiles[y].length; x++) {
                    this.tiles[y][x].x = x;
                    this.tiles[y][x].y = y;
                }
            }
        }
    }

    /**
     * replay-viewer.ts
     * Main controller for the replay viewer application
     * Handles file loading, replay processing, and coordinates map visualization and UI controls
     */
    // External libraries accessed as globals - types defined in globals.d.ts
    /**
     * ReplayViewer class
     * Initializes the replay viewer and sets up file handling
     */
    class ReplayViewer {
        constructor() {
            this.init();
        }
        /**
         * Initialize the replay viewer
         * Sets up map, file drag-and-drop support, and URL parameter handling
         */
        init() {
            this.map = new Map();
            // Setup vanilla JavaScript drag-and-drop
            this.setupDragAndDrop();
            this.file = getParameterByName('file');
            this.turn = getParameterByName('turn');
            if (this.file) {
                this.loadFromDropbox(this.file);
            }
            function getParameterByName(name) {
                // Thanks StackOverflow!
                name = name.replace(/[\[]/, '\\[').replace(/[\]]/, '\\]');
                var regex = new RegExp('[\\?&]' + name + '=([^&#]*)');
                var results = regex.exec(location.search);
                return results === null ? '' : decodeURIComponent(results[1].replace(/\+/g, ' '));
            }
        }
        /**
         * Setup drag-and-drop file handling using native HTML5 APIs
         */
        setupDragAndDrop() {
            const dropZone = document.body;
            const self = this;
            // Prevent default drag behaviors
            const preventDefaults = (e) => {
                e.preventDefault();
                e.stopPropagation();
            };
            // Highlight drop zone when item is dragged over it
            const highlight = (e) => {
                dropZone.classList.add('drag-over');
            };
            const unhighlight = (e) => {
                dropZone.classList.remove('drag-over');
            };
            // Handle dropped files
            const handleDrop = (e) => {
                const dt = e.dataTransfer;
                const files = dt.files;
                if (files.length > 0) {
                    self.handleFile(files[0]);
                }
                unhighlight();
            };
            // Setup event listeners
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
            // Also support file input through a click (optional enhancement)
            dropZone.addEventListener('click', (e) => {
                // Only trigger file dialog if clicking on the body background, not on other elements
                if (e.target === dropZone) {
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.accept = '.Civ5Replay';
                    input.onchange = (e) => {
                        const target = e.target;
                        if (target.files && target.files.length > 0) {
                            self.handleFile(target.files[0]);
                        }
                    };
                    input.click();
                }
            });
        }
        /**
         * Handle a dropped or selected file
         * @param {File} file - The file to process
         */
        handleFile(file) {
            const reader = new FileReader();
            const self = this;
            reader.onloadend = function (e) {
                self.process(e.target.result, file.size);
            };
            reader.onerror = function (e) {
                console.error('Error reading file:', e);
                alert('Error reading file: ' + e.target.error);
            };
            // Read as ArrayBuffer to match the original behavior
            reader.readAsArrayBuffer(file);
        }
        loadFromDropbox(file) {
            // e.g. https://dl.dropboxusercontent.com/1/view/hrbho1q4dtro8pa/Ramesses%20II_0267%20AD-1987_42%20(9).Civ5Replay
            // file = 'hrbho1q4dtro8pa/Ramesses%20II_0267%20AD-1987_42%20(9).Civ5Replay'
            var self = this;
            var xhr = new XMLHttpRequest();
            xhr.open('GET', 'https://dl.dropboxusercontent.com/1/view/' + file, true);
            xhr.responseType = 'arraybuffer';
            xhr.onload = function (e) {
                self.process(this.response, e.total);
            };
            xhr.send();
        }
        process(data, length) {
            // Replay
            if (this.replay) {
                delete this.replay;
            }
            this.replay = new Replay(data, length);
            this.replay.process();
            // Event log
            if (this.eventLog) {
                const logMessages = document.querySelector('.log-messages');
                if (logMessages) {
                    logMessages.innerHTML = '';
                }
                this.eventLog = null;
            }
            this.eventLog = new EventLog(this.replay.events);
            // Map
            _.each(this.map.layers, (layer) => {
                this.map.map.removeLayer(layer);
            });
            _.each(this.map.controls, (control) => {
                this.map.map.removeControl(control);
            });
            this.map.initLayers(this.replay.tiles, this.replay.events);
            this.controlBar = new ControlBar({
                start: this.replay.meta.startTurn,
                end: this.replay.meta.endTurn,
                initial: this.turn === '' ? this.replay.meta.startTurn : (parseInt(this.turn) || this.replay.meta.startTurn),
                onChange: (turn) => {
                    this.eventLog.renderTurn(turn);
                    this.map.renderTurn(turn);
                }
            });
            return false;
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
        'MESSAGE',
        'CITY_FOUNDED',
        'CITIES_TRANSFERRED',
        'CITY_RAZED',
        'PANTHEON_SELECTED',
        'RELIGION_FOUNDED'
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
    window.Map = Map;
    window.HexLayer = HexLayer;
    window.ControlBar = ControlBar;
    window.EventLog = EventLog;

})();
//# sourceMappingURL=bundle.js.map
