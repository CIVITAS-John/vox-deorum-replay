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
import { CivAnnotations, parseCivAnnotations, parseModelName, applyModelAnnotations, formatAnnotationLine, annotationFor, resolveWinnerCivId } from './annotations';
import { throttle } from '../utils/throttle';

// One bundled example game: a playthrough by the model it is named after
interface ExampleGame {
	label: string;    // Button label, e.g. "Claude-5-Opus"
	file: string;     // Path relative to the site root
	kind: string;     // "replay" or "save", shown as the button subtitle
	model?: string;   // Model that drove the civilizations with decision-making trails
}

// The example games offered in the empty state, named after their files
const exampleGames: ExampleGame[] = [
	{ label: 'Claude-5-Opus', file: 'examples/Claude-5-Opus.Civ5Save', kind: 'save', model: 'Claude-5-Opus' },
	{ label: 'GLM-5.2', file: 'examples/GLM-5.2.Civ5Save', kind: 'save', model: 'GLM-5.2' },
	{ label: 'GPT-5.6-Sol', file: 'examples/GPT-5.6-Sol.Civ5Save', kind: 'save', model: 'GPT-5.6-Sol' },
	{ label: 'Qwen-3.8-27B', file: 'examples/Qwen-3.8-27B.Civ5Save', kind: 'save', model: 'Qwen-3.8-27B' }
];

// The destinations the tabs can switch between; statistics arrives in Stage 5
type ViewDestination = 'map' | 'events';

// How long an error banner stays on screen before dismissing itself
const errorBannerTimeoutMs = 10000;

// How often the address bar is refreshed while the turn changes
const urlSyncThrottleMs = 400;

/**
 * Turn a raw file enum value into a display name, so "GAMESPEED_STANDARD"
 * reads as "Standard" and "WORLDSIZE_SMALL" as "Small"
 */
function prettifyEnumValue(value: string): string {
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
	private modelName: string | null = null;    // model parameter, marks the civilizations with decision trails
	private linkWinner: string | null = null;   // winner parameter, applied once a file is loaded
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
			button.addEventListener('click', () => this.loadFromUrl(example.file, example.label, example.model ?? null));

			container.appendChild(button);
		});
	}

	/**
	 * Read the address bar: file, turn, view, playerN annotations, the model
	 * name, and the winner
	 */
	private handleUrlParameters(): void {
		const urlParams = new URLSearchParams(window.location.search);
		this.fileUrl = urlParams.get('file');
		this.annotations = parseCivAnnotations(urlParams);
		this.modelName = parseModelName(urlParams);
		this.linkWinner = urlParams.get('winner');

		const turnParam = urlParams.get('turn');
		this.initialTurn = turnParam !== null ? parseInt(turnParam, 10) : null;

		const viewParam = urlParams.get('view');
		this.setView(viewParam === 'events' ? 'events' : 'map');

		if (this.fileUrl) {
			this.loadFromUrl(this.fileUrl, this.labelFromFileReference(this.fileUrl), this.modelName);
		}
	}

	/**
	 * Derive a display label from a file name or URL, e.g.
	 * "Claude-5-Opus.Civ5Save" becomes "Claude-5-Opus"
	 */
	private labelFromFileReference(reference: string): string {
		// Keep only the part after the last slash
		const fileName = reference.split('/').pop() || reference;

		// Drop the file extension
		const base = fileName.replace(/\.(Civ5Replay|Civ5Save)$/i, '');

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
	 * copied link lands where the user is looking. The model parameter travels
	 * with the file, so an opened example shares its marks. The playerN and
	 * winner parameters are kept exactly as the sharer wrote them.
	 */
	private writeUrlState(): void {
		const params = new URLSearchParams(window.location.search);

		// A locally opened file cannot be shared, so the stale parameter goes
		if (this.fileUrl) {
			params.set('file', this.fileUrl);
		} else {
			params.delete('file');
		}

		if (this.modelName) {
			params.set('model', this.modelName);
		} else {
			params.delete('model');
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
	 * @param fileUrl The URL to load from
	 * @param label Display name for the file, derived from the reference when omitted
	 * @param model Model name marking the civilizations with decision trails,
	 * null for none
	 */
	public loadFromUrl(fileUrl: string, label?: string, model: string | null = null): void {
		if (this.isLoading) return;

		this.isLoading = true;
		this.fileUrl = fileUrl;
		this.modelName = model;
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

			// The model parameter marks every civilization with decision-making
			// trails, whatever player number it sits at, so merge those marks
			// with the playerN labels before anything reads the annotations
			const annotations = this.modelName
				? applyModelAnnotations(this.annotations, this.modelName, replay.getCivIdsWithDecisionTrails())
				: this.annotations;

			// Apply a winner the link asserts, for files that cannot prove
			// their own result, such as a save taken one turn before the
			// game was won
			const winnerCivId = resolveWinnerCivId(this.linkWinner, annotations, replay.civs.length);
			if (this.linkWinner !== null && winnerCivId < 0) {
				console.warn(`The winner parameter "${this.linkWinner}" names no civilization of the loaded file`);
			}
			if (winnerCivId >= 0) {
				replay.applyLinkVictory(winnerCivId);
			}

			this.session = new GameSession(replay);

			// Initialize the UI components around the session
			this.initializeUIComponents(annotations);

			// Apply the turn the link asked for, or the replay's first turn
			const initialTurn = this.initialTurn !== null && !Number.isNaN(this.initialTurn)
				? this.initialTurn
				: replay.startTurn;
			this.session.setTurn(initialTurn);

			// Show the loaded game and hide the empty state
			this.updateHeader(annotations);
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
	 * @param annotations The annotations in effect, playerN labels merged with
	 * the model parameter's marks
	 */
	private initializeUIComponents(annotations: CivAnnotations): void {
		if (!this.session) return;

		// The event log, with the address bar annotations
		this.eventLog = new EventLog(this.session, annotations);

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
	 * @param annotations The annotations in effect, playerN labels merged with
	 * the model parameter's marks
	 */
	private updateHeader(annotations: CivAnnotations): void {
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
		let lineText = formatAnnotationLine(civNames, annotations);

		const victory = replay.victory;
		if (victory && victory.reliable && victory.winnerCivId >= 0) {
			const winnerName = annotationFor(annotations, victory.winnerCivId) || replay.getCivName(victory.winnerCivId);
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
	private createSummaryItem(icon: string, value: string): HTMLElement {
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
