/**
 * replay-viewer.ts
 * UI component for the replay viewer application
 * Manages user interactions and file handling, and connects the game session
 * to the map, the event log, and the playback controls
 */

import { ReplayMap } from '../map/replay-map';
import { EventLog } from './event-log';
import { ControlBar } from './control-bar';
import { Replay } from '../replay/replay';
import { GameSession } from '../replay/session';

/**
 * ReplayViewer UI component
 * Handles user interactions and connects the loaded game session to the visualization components
 */
export class ReplayViewer {
  private map: ReplayMap;                    // Map visualization instance
  private session: GameSession | null = null; // Game session for the loaded replay
  private eventLog: EventLog | null = null; // Event log UI component
  private controlBar: ControlBar | null = null; // Playback control UI component

  // UI state
  private fileUrl: string | null = null;
  private initialTurn: string | null = null;
  private isLoading: boolean = false;

  constructor() {
    this.initialize();
    // Create control bar instance once (will be reinitialized with each session)
    this.controlBar = new ControlBar();
  }

  /**
   * Initialize the UI component
   */
  private initialize(): void {
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
  private setupFileHandling(): void {
    const dropZone = document.body;

    // Prevent default drag behaviors
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
    dropZone.addEventListener('click', (e: MouseEvent) => {
      // Only trigger on body background clicks
      if (e.target === dropZone) {
        this.openFileDialog();
      }
    });
  }

  /**
   * Open file selection dialog
   */
  private openFileDialog(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.Civ5Replay,.Civ5Save';
    input.onchange = (e: Event) => {
      const target = e.target as HTMLInputElement;
      if (target.files && target.files.length > 0) {
        this.loadFile(target.files[0]);
      }
    };
    input.click();
  }

  /**
   * Setup window resize handler to refit map
   */
  private setupResizeHandler(): void {
    let resizeTimeout: number;

    window.addEventListener('resize', () => {
      // Debounce resize events
      clearTimeout(resizeTimeout);
      resizeTimeout = window.setTimeout(() => {
        // Only refit if we have a loaded session
        if (this.hasReplay()) {
          this.map.fitMap();
        }
      }, 250);
    });
  }

  /**
   * Handle URL parameters for file loading
   */
  private handleUrlParameters(): void {
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
  public loadFile(file: File): void {
    if (this.isLoading) return;

    this.isLoading = true;
    const reader = new FileReader();

    reader.onloadend = (e: ProgressEvent<FileReader>) => {
      const result = e.target?.result as ArrayBuffer;
      if (result) {
        void this.processReplayData(result, file.size);
      }
      this.isLoading = false;
    };

    reader.onerror = (e: ProgressEvent<FileReader>) => {
      console.error('Error reading file:', e);
      this.showError('Failed to read file: ' + e.target?.error);
      this.isLoading = false;
    };

    reader.readAsArrayBuffer(file);
  }

  /**
   * Load replay from URL
   */
  public loadFromUrl(fileUrl: string): void {
    if (this.isLoading) return;

    this.isLoading = true;
    const xhr = new XMLHttpRequest();

    // Use the URL directly
    const url = fileUrl;

    xhr.open('GET', url, true);
    xhr.responseType = 'arraybuffer';

    xhr.onload = (e: ProgressEvent<XMLHttpRequest>) => {
      const target = e.target as XMLHttpRequest;
      if (target.status === 200) {
        void this.processReplayData(target.response, target.response.byteLength);
      } else {
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
  private async processReplayData(data: ArrayBuffer, size: number): Promise<void> {
    try {
      // Clean up previous session
      this.cleanup();

      // Parse the file and build the session that owns it
      const replay = new Replay();
      await replay.loadFromFile(data, size);
      this.session = new GameSession(replay);

      // Initialize UI components
      this.initializeUIComponents();

      // Set initial turn, which the session passes to every view
      const initialTurn = this.initialTurn
        ? parseInt(this.initialTurn) || replay.startTurn
        : replay.startTurn;
      this.session.setTurn(initialTurn);

      // Fit map to container after everything is loaded
      // Use setTimeout to ensure DOM has updated
      setTimeout(() => {
        this.map.fitMap();
      }, 100);

    } catch (error) {
      console.error('Error processing replay:', error);
      this.showError('Failed to process replay file: ' + error.message);
    }
  }

  /**
   * Initialize UI components with the game session
   */
  private initializeUIComponents(): void {
    if (!this.session) return;

    // Initialize event log
    this.eventLog = new EventLog(this.session);

    // Initialize map layers
    this.map.initLayers(this.session);

    // Fit map immediately after layers are initialized
    this.map.fitMap();

    // Reinitialize control bar with the new session (reuses existing instance)
    this.controlBar.initialize({
      start: this.session.startTurn,
      end: this.session.endTurn,
      session: this.session
    });
  }

  /**
   * Clean up previous session and UI components
   */
  private cleanup(): void {
    // Clean up event log
    if (this.eventLog) {
      this.eventLog.destroy();
      this.eventLog = null;
    }

    // Clean up map layers and controls
    if (this.map && this.map.map) {
      // Detach the map from the session and reset its turn tracking state
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

    // Clean up the session
    this.session = null;
  }

  /**
   * Show error message to user
   */
  private showError(message: string): void {
    // Simple alert for now, could be replaced with better UI
    alert(message);
  }

  /**
   * Get current replay data
   */
  public getReplay(): Replay | null {
    return this.session ? this.session.replay : null;
  }

  /**
   * Check if a replay is loaded
   */
  public hasReplay(): boolean {
    return this.session !== null;
  }

  /**
   * Get loading state
   */
  public isLoadingFile(): boolean {
    return this.isLoading;
  }
}
