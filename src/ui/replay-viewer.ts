/**
 * replay-viewer.ts
 * UI component for the replay viewer application
 * Manages user interactions, file handling, and coordinates between data and visualization
 */

import { ReplayMap } from '../map/map';
import { EventLog } from './event-log';
import { ControlBar } from './control-bar';
import { Replay } from '../core/replay';
import { MapLayer, MapControl } from '../types/map.types';

/**
 * ReplayViewer UI component
 * Handles user interactions and coordinates between replay data and visualization components
 */
export class ReplayViewer {
  private map: ReplayMap;                    // Map visualization instance
  private replay: Replay | null = null; // Replay data hub instance
  private eventLog: EventLog | null = null; // Event log UI component
  private controlBar: ControlBar | null = null; // Playback control UI component

  // UI state
  private fileUrl: string | null = null;
  private initialTurn: string | null = null;
  private isLoading: boolean = false;

  constructor() {
    this.initialize();
  }

  /**
   * Initialize the UI component
   */
  private initialize(): void {
    // Initialize map visualization
    this.map = new ReplayMap();

    // Setup file handling (drag-and-drop and click-to-open)
    this.setupFileHandling();

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
    input.accept = '.Civ5Replay';
    input.onchange = (e: Event) => {
      const target = e.target as HTMLInputElement;
      if (target.files && target.files.length > 0) {
        this.loadFile(target.files[0]);
      }
    };
    input.click();
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
        this.processReplayData(result, file.size);
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
   * Load replay from URL (e.g., Dropbox)
   */
  public loadFromUrl(fileUrl: string): void {
    if (this.isLoading) return;

    this.isLoading = true;
    const xhr = new XMLHttpRequest();

    // Support Dropbox URLs
    const url = fileUrl.startsWith('http')
      ? fileUrl
      : `https://dl.dropboxusercontent.com/1/view/${fileUrl}`;

    xhr.open('GET', url, true);
    xhr.responseType = 'arraybuffer';

    xhr.onload = (e: ProgressEvent<XMLHttpRequest>) => {
      const target = e.target as XMLHttpRequest;
      if (target.status === 200) {
        this.processReplayData(target.response, e.total);
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
   */
  private processReplayData(data: ArrayBuffer, size: number): void {
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

    } catch (error) {
      console.error('Error processing replay:', error);
      this.showError('Failed to process replay file: ' + error.message);
    }
  }

  /**
   * Initialize UI components with replay data
   */
  private initializeUIComponents(): void {
    if (!this.replay) return;

    // Initialize event log
    this.eventLog = new EventLog(this.replay.events, this.replay);

    // Initialize map layers
    this.map.initLayers(this.replay.tiles, this.replay.events, this.replay);

    // Initialize control bar
    this.controlBar = new ControlBar({
      start: this.replay.startTurn,
      end: this.replay.endTurn,
      initial: this.initialTurn
        ? parseInt(this.initialTurn) || this.replay.startTurn
        : this.replay.startTurn,
      onChange: (turn: number) => this.renderTurn(turn)
    });
  }

  /**
   * Render a specific turn
   */
  private renderTurn(turn: number): void {
    if (!this.replay || !this.eventLog || !this.map) return;

    this.eventLog.renderTurn(turn);
    this.map.renderTurn(turn);
  }

  /**
   * Clean up previous replay data and UI components
   */
  private cleanup(): void {
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
      if (this.map.layers) {
        Object.values(this.map.layers).forEach(layer => {
          this.map.map.removeLayer(layer);
        });
      }
      if (this.map.controls) {
        Object.values(this.map.controls).forEach(control => {
          this.map.map.removeControl(control);
        });
      }
    }

    // Clean up control bar
    this.controlBar = null;

    // Clean up replay data
    this.replay = null;
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
    return this.replay;
  }

  /**
   * Check if a replay is loaded
   */
  public hasReplay(): boolean {
    return this.replay !== null;
  }

  /**
   * Get loading state
   */
  public isLoadingFile(): boolean {
    return this.isLoading;
  }
}