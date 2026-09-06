/**
 * session.ts
 * The game session model: one loaded game, the current turn, the selection,
 * and the per-turn state derived from the events
 * The map, the event log, and the timeline subscribe to the session instead
 * of calling each other
 */

import { Replay } from './replay';
import { OwnershipTimeline } from './ownership';
import { TurnState } from './types';

// Notified with the new turn and its materialized tile state on every change
export type SessionListener = (turn: number, state: TurnState) => void;

// What the user is inspecting: a civilization, a tile, or a city
export type Selection =
  | { kind: 'none' }
  | { kind: 'civ'; civId: number }
  | { kind: 'tile'; x: number; y: number }
  | { kind: 'city'; x: number; y: number };

/**
 * GameSession class
 * Owns the loaded game and the current turn, and lets the views follow both
 */
export class GameSession {
  public readonly replay: Replay;
  public currentTurn: number;
  public selection: Selection;

  private readonly ownership: OwnershipTimeline;
  private readonly listeners = new Set<SessionListener>();

  constructor(replay: Replay) {
    this.replay = replay;
    this.currentTurn = replay.startTurn;
    this.selection = { kind: 'none' };
    this.ownership = new OwnershipTimeline(replay.events, (civId) => replay.getCivName(civId));
  }

  /**
   * First turn available on the timeline
   */
  get startTurn(): number {
    return this.replay.startTurn;
  }

  /**
   * Last turn available on the timeline
   */
  get endTurn(): number {
    return this.replay.endTurn;
  }

  /**
   * Tile ownership and cities at a turn, derived from the events up to it
   */
  public stateAt(turn: number): TurnState {
    return this.ownership.stateAt(turn);
  }

  /**
   * Number of ownership changes the timeline stores, a measure of how
   * compactly the per-turn state is kept
   */
  public ownershipChangeCount(): number {
    return this.ownership.changeCount;
  }

  /**
   * Move to a turn, clamped to the replay's range, and notify subscribers
   */
  public setTurn(turn: number): void {
    const clamped = Math.min(Math.max(turn, this.startTurn), this.endTurn);
    this.currentTurn = clamped;

    const state = this.ownership.stateAt(clamped);
    for (const listener of this.listeners) {
      listener(clamped, state);
    }
  }

  /**
   * Change what the user is inspecting; views read this on demand
   */
  public setSelection(selection: Selection): void {
    this.selection = selection;
  }

  /**
   * Subscribe to turn changes
   * @returns A function that unsubscribes the listener again
   */
  public subscribe(listener: SessionListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
