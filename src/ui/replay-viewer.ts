/**
 * replay-viewer.ts
 * Top-level UI component for the replay viewer
 * Owns file opening (dialog, drag and drop, shared links, bundled examples),
 * the loading and error feedback, the header summary, the destination tabs,
 * and the address bar state. Connects the loaded game session to the map,
 * the event log, the layers panel, and the playback bar.
 */

import { ReplayMap } from '../map/replay-map';
import { EventLog } from './event-log';
import { ControlBar } from './control-bar';
import { LayersControl } from './layers-control';
import { Replay } from '../replay/replay';
import { GameSession } from '../replay/session';
import { CivAnnotations, parseCivAnnotations, formatAnnotationLine } from './annotations';
import { throttle } from '../utils/throttle';

// One bundled example game; where a save is bundled the save is preferred
// because it carries everything the replay carries plus the rivers
interface ExampleGame {
	label: string;    // Button label, e.g. "Game 4"
	file: string;     // Path relative to the site root
	kind: string;     // "replay" or "save", shown as the button subtitle
}

// The example games offered in the empty state
const exampleGames: ExampleGame[] = [
	{ label: 'Game 1', file: 'examples/1.Civ5Replay', kind: 'replay' },
	{ label: 'Game 2', file: 'examples/2.Civ5Replay', kind: 'replay' },
	{ label: 'Game 3', file: 'examples/3.Civ5Replay', kind: 'replay' },
	{ label: 'Game 4', file: 'examples/4.Civ5Save', kind: 'save' },
	{ label: 'Game 5', file: 'examples/5.Civ5Save', kind: 'save' }
];

// The destinations the tabs can switch between; statistics arrives in Stage 5
type ViewDestination = 'map' | 'events';

// How long an error banner stays on screen before dismissing itself
const errorBannerTimeoutMs = 10000;

// How often the address bar is refreshed while the turn changes
const urlSyncThrottleMs = 400;

/**
 * ReplayViewer class
 * Handles user interactions and connects the loaded game session to the
 * visualization components
 */
export class ReplayViewer {
	private map: ReplayMap;                     // Map visualization instance
	private session: GameSession | null = null; // Game session for the loaded game
	private eventLog: EventLog | null = null;   // Event log UI component
	private controlBar: ControlBar;             // Playback control UI component
	private layersControl: LayersControl | null = null; // Map layers panel

	// UI elements the viewer drives directly
	private emptyState: HTMLElement;
	private loadingOverlay: HTMLElement;
	private loadingText: HTMLElement;
	private errorBanner: HTMLElement;
	private errorText: HTMLElement;
	private gameSummary: HTMLElement;
	private annotationLine: HTMLElement;
	private fileInput: HTMLInputElement;

	// UI state
	private fileUrl: string | null = null;      // file parameter from the address bar, kept for shared links
	private fileLabel: string | null = null;    // Display name of the loaded file
	private initialTurn: number | null = null;  // turn parameter, applied once the session exists
	private view: ViewDestination = 'map';      // Selected destination tab
	private annotations: CivAnnotations = {};   // playerN labels from the address bar
	private isLoading = false;                  // A file is being read or parsed
	private errorTimeout: number | null = null; // Auto-dismiss timer for the error banner
	private unsubscribeTurnSync: (() => void) | null = null; // Stops URL syncing

	// Address bar updates are throttled so playback does not spam history
	private syncUrlState: () => void;

	constructor() {
		this.map = new ReplayMap();
		this.controlBar = new ControlBar();

		this.emptyState = document.getElementById('emptyState');
		this.loadingOverlay = document.getElementById('loadingOverlay');
		this.loadingText = document.getElementById('loadingText');
		this.errorBanner = document.getElementById('errorBanner');
		this.errorText = document.getElementById('errorText');
		this.gameSummary = document.getElementById('gameSummary');
		this.annotationLine = document.getElementById('annotationLine');
		this.fileInput = document.getElementById('fileInput') as HTMLInputElement;

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
	private setupOpenControls(): void {
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
	private setupDragAndDrop(): void {
		const dropZone = document.body;

		// Prevent the browser from navigating away for any drag
		const preventDefaults = (e: DragEvent) => {
			e.preventDefault();
			e.stopPropagation();
		};

		// Visual feedback for drag operations
		const highlight = () => dropZone.classList.add('drag-over');
		const unhighlight = () => dropZone.classList.remove('drag-over');

		// Handle dropped files
		const handleDrop = (e: DragEvent) => {
			unhighlight();
			const files = e.dataTransfer?.files;
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
	private setupTabs(): void {
		const tabs = document.querySelectorAll<HTMLButtonElement>('.view-tab');

		tabs.forEach(tab => {
			tab.addEventListener('click', () => {
				this.setView(tab.dataset.view as ViewDestination);
			});
		});
	}

	/**
	 * Wire the zoom and fit buttons that sit on the map
	 */
	private setupMapButtons(): void {
		document.getElementById('zoomInButton').addEventListener('click', () => this.map.map.zoomIn());
		document.getElementById('zoomOutButton').addEventListener('click', () => this.map.map.zoomOut());
		document.getElementById('fitButton').addEventListener('click', () => this.map.fitMap());
	}

	/**
	 * Wire the error banner's dismiss button and its auto-hide timer
	 */
	private setupErrorBanner(): void {
		document.getElementById('errorDismiss').addEventListener('click', () => this.hideError());
	}

	/**
	 * Build one button per bundled example game into the empty state
	 */
	private buildExampleButtons(): void {
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
	 * Read the address bar: file, turn, view, and playerN annotations
	 */
	private handleUrlParameters(): void {
		const urlParams = new URLSearchParams(window.location.search);
		this.fileUrl = urlParams.get('file');
		this.annotations = parseCivAnnotations(urlParams);

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
	private labelFromFileReference(reference: string): string {
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
	private setView(view: ViewDestination): void {
		this.view = view;
		document.body.dataset.view = view;

		// Mark the matching tab active
		document.querySelectorAll<HTMLButtonElement>('.view-tab').forEach(tab => {
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
	 * copied link lands where the user is looking. The playerN parameters are
	 * kept exactly as the sharer wrote them.
	 */
	private writeUrlState(): void {
		const params = new URLSearchParams(window.location.search);

		// A locally opened file cannot be shared, so the stale parameter goes
		if (this.fileUrl) {
			params.set('file', this.fileUrl);
		} else {
			params.delete('file');
		}

		if (this.session) {
			params.set('turn', String(this.session.currentTurn));
		} else if (this.initialTurn !== null && !Number.isNaN(this.initialTurn)) {
			params.set('turn', String(this.initialTurn));
		} else {
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
	public loadFile(file: File): void {
		if (this.isLoading) return;

		this.isLoading = true;
		this.fileUrl = null; // A local file has no shareable URL
		this.fileLabel = this.labelFromFileReference(file.name);
		this.showLoading(this.fileLabel);

		const reader = new FileReader();

		reader.onloadend = (e: ProgressEvent<FileReader>) => {
			const result = e.target?.result as ArrayBuffer;
			if (result) {
				void this.processReplayData(result, result.byteLength);
			} else {
				this.isLoading = false;
				this.hideLoading();
				this.showError('Failed to read the file.');
			}
		};

		reader.onerror = (e: ProgressEvent<FileReader>) => {
			console.error('Error reading file:', e);
			this.isLoading = false;
			this.hideLoading();
			this.showError('Failed to read file: ' + e.target?.error);
		};

		reader.readAsArrayBuffer(file);
	}

	/**
	 * Load a replay file from a URL
	 */
	public loadFromUrl(fileUrl: string, label?: string): void {
		if (this.isLoading) return;

		this.isLoading = true;
		this.fileUrl = fileUrl;
		this.fileLabel = label || this.labelFromFileReference(fileUrl);
		this.showLoading(this.fileLabel);

		const xhr = new XMLHttpRequest();
		xhr.open('GET', fileUrl, true);
		xhr.responseType = 'arraybuffer';

		xhr.onload = (e: ProgressEvent<XMLHttpRequest>) => {
			const target = e.target as XMLHttpRequest;
			if (target.status === 200) {
				void this.processReplayData(target.response, target.response.byteLength);
			} else {
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
	private async processReplayData(data: ArrayBuffer, size: number): Promise<void> {
		try {
			// Clean up the previous session
			this.cleanup();

			// Parse the file and build the session that owns it
			const replay = new Replay();
			await replay.loadFromFile(data, size);
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
		} catch (error) {
			console.error('Error processing replay:', error);
			this.showError('Failed to process replay file: ' + error.message);
			this.updateEmptyState();
		} finally {
			this.isLoading = false;
			this.hideLoading();
		}
	}

	/**
	 * Initialize the UI components with the game session
	 */
	private initializeUIComponents(): void {
		if (!this.session) return;

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
	 * Fill the header with the loaded game's summary and annotation line
	 */
	private updateHeader(): void {
		if (!this.session) {
			this.gameSummary.hidden = true;
			this.annotationLine.hidden = true;
			return;
		}

		const replay = this.session.replay;
		const summaryParts = [this.fileLabel || 'Loaded game'];
		if (replay.gameSpeed) {
			summaryParts.push(replay.gameSpeed);
		}
		if (replay.worldSize) {
			summaryParts.push(replay.worldSize);
		}
		this.gameSummary.textContent = summaryParts.join(' · ');
		this.gameSummary.hidden = false;

		const civNames = replay.civs.map(civ => civ.name);
		const annotationText = formatAnnotationLine(civNames, this.annotations);
		this.annotationLine.textContent = annotationText;
		this.annotationLine.hidden = !annotationText;
	}

	/**
	 * Show the empty state only while no game is loaded
	 */
	private updateEmptyState(): void {
		this.emptyState.hidden = this.session !== null;
	}

	/**
	 * Clean up the previous session and its UI components
	 */
	private cleanup(): void {
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

		// Clean up map layers: detach from the session, reset turn tracking,
		// and remove every layer so the next session re-adds them
		if (this.map && this.map.map) {
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
		}

		// Detach the control bar from the session
		this.controlBar.clear();

		// Discard the session
		this.session = null;
	}

	/**
	 * Show the loading overlay with a label for what is loading
	 */
	private showLoading(label: string): void {
		this.loadingText.textContent = `Loading ${label}…`;
		this.loadingOverlay.hidden = false;
	}

	/**
	 * Hide the loading overlay
	 */
	private hideLoading(): void {
		this.loadingOverlay.hidden = true;
	}

	/**
	 * Show an error message in the banner, replacing the old alert dialogs
	 */
	private showError(message: string): void {
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
	private hideError(): void {
		this.errorBanner.hidden = true;
		if (this.errorTimeout) {
			clearTimeout(this.errorTimeout);
			this.errorTimeout = null;
		}
	}

	/**
	 * Get the current replay data
	 */
	public getReplay(): Replay | null {
		return this.session ? this.session.replay : null;
	}

	/**
	 * Check whether a game is loaded
	 */
	public hasReplay(): boolean {
		return this.session !== null;
	}

	/**
	 * Get the loading state
	 */
	public isLoadingFile(): boolean {
		return this.isLoading;
	}
}
