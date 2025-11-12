/**
 * ui.types.ts
 * Type definitions for UI components
 */

import { GameEvent } from './replay.types';

// Control bar configuration
export interface ControlBarConfig {
  onChange: (turn: number) => void;
  onPlay?: () => void;
  onPause?: () => void;
}

// Event log filter types
export type EventFilter = 'all' | 'city' | 'war' | 'diplomacy' | 'tech' | 'policy' | 'wonder' | string;

// Event log configuration
export interface EventLogConfig {
  container?: HTMLElement;
  filters?: EventFilter[];
  onEventClick?: (event: GameEvent) => void;
}

// Slider configuration
export interface SliderConfig {
  min: number;
  max: number;
  value: number;
  step?: number;
  onChange?: (value: number) => void;
  onSlide?: (value: number) => void;
}

// UI State
export interface UIState {
  isPlaying: boolean;
  currentTurn: number;
  playbackSpeed: number;
  selectedEventType: EventFilter;
}

// Message element with event data
export interface MessageElement extends HTMLElement {
  _eventData?: GameEvent;
}