/**
 * ui.types.ts
 * Type definitions for UI components
 */

import { GameEvent } from './replay.types';

// Control bar configuration
export interface ControlBarConfig {
  onChange: (turn: number) => void;      // Callback when turn changes
  onPlay?: () => void;                   // Callback when play button is clicked
  onPause?: () => void;                  // Callback when pause button is clicked
}

// Event log filter types
export type EventFilter = 'all' | 'city' | 'war' | 'diplomacy' | 'tech' | 'policy' | 'wonder' | string;

// Event log configuration
export interface EventLogConfig {
  container?: HTMLElement;                      // DOM element to render log in
  filters?: EventFilter[];                      // Available filter options
  onEventClick?: (event: GameEvent) => void;    // Callback when event is clicked
}

// Slider configuration
export interface SliderConfig {
  min: number;                                   // Minimum slider value
  max: number;                                   // Maximum slider value
  value: number;                                 // Current slider value
  step?: number;                                 // Step increment (default: 1)
  onChange?: (value: number) => void;           // Callback when value changes (on release)
  onSlide?: (value: number) => void;            // Callback during sliding (continuous)
}

// UI State
export interface UIState {
  isPlaying: boolean;                           // Whether replay is playing
  currentTurn: number;                          // Current turn being displayed
  playbackSpeed: number;                        // Playback speed multiplier
  selectedEventType: EventFilter;               // Currently selected event filter
}

// Message element with event data
export interface MessageElement extends HTMLElement {
  _eventData?: GameEvent;                       // Event data attached to DOM element
}