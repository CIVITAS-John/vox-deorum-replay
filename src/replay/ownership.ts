/**
 * ownership.ts
 * Compact per-turn tile ownership derived from the replay events
 * Instead of a full copy of the tile state for every turn, each tile keeps
 * a short list of changes, and the state at any turn comes from the last
 * change recorded at or before that turn
 */

import { GameEvent, EventType, TurnState, TileStateInfo } from './types';
import { lastAtOrBefore } from '../utils/arrays';

// Resolves a civilization id to its name, as the Replay hub provides it
export type CivNameResolver = (civId?: number) => string | null;

// One recorded change to a tile: the full owner and city situation on that
// tile from the change's turn onward, until the next change. A record with
// neither field marks the tile as unowned and without a city.
interface TileChange {
  turn: number;
  owner?: string;
  city?: string;
}

/**
 * OwnershipTimeline class
 * Answers which civilization owns each tile and which city stands on it at
 * any turn, built once from the event log
 */
export class OwnershipTimeline {
  // Change lists per tile key ("x,y"), each ordered by turn
  private readonly changesByTile = new Map<string, TileChange[]>();

  // The last materialized turn state, so repeated requests for the same turn
  // share one object and identity checks in the map layers keep working
  private cachedTurn: number = -1;
  private cachedState: TurnState = {};

  constructor(events: GameEvent[], getCivName: CivNameResolver) {
    this.build(events, getCivName);
  }

  /**
   * Total number of recorded changes, one per actual ownership or city change
   */
  get changeCount(): number {
    let total = 0;
    for (const changes of this.changesByTile.values()) {
      total += changes.length;
    }
    return total;
  }

  /**
   * Tile state at a turn: every tile whose last change at or before that
   * turn left it owned or carrying a city
   */
  public stateAt(turn: number): TurnState {
    if (turn === this.cachedTurn) {
      return this.cachedState;
    }

    const state: TurnState = {};
    for (const [key, changes] of this.changesByTile) {
      const change = lastAtOrBefore(changes, turn);
      if (change === undefined) {
        continue;
      }
      const info: TileStateInfo = {};
      if (change.owner !== undefined) {
        info.owner = change.owner;
      }
      if (change.city !== undefined) {
        info.city = change.city;
      }
      if (info.owner !== undefined || info.city !== undefined) {
        state[key] = info;
      }
    }

    this.cachedTurn = turn;
    this.cachedState = state;
    return state;
  }

  /**
   * Walk the events in order and record each tile's visible state whenever
   * it changes, mirroring how the renderer used to fold events into per-turn
   * copies of the map
   */
  private build(events: GameEvent[], getCivName: CivNameResolver): void {
    // The tile states as of the event currently being processed
    const current = new Map<string, TileStateInfo>();

    // Records the tile's current state as the situation from this turn on,
    // skipping tiles whose visible state did not actually change
    const record = (key: string, turn: number): void => {
      const entry = current.get(key);
      const owner = entry && entry.owner;
      const city = entry && entry.city;

      const changes = this.changesByTile.get(key);
      if (changes) {
        const last = changes[changes.length - 1];
        if (last.owner === owner && last.city === city) {
          return;
        }
      }

      const change: TileChange = { turn };
      if (owner !== undefined) {
        change.owner = owner;
      }
      if (city !== undefined) {
        change.city = city;
      }

      if (changes) {
        changes.push(change);
      } else {
        this.changesByTile.set(key, [change]);
      }
    };

    for (const event of events) {
      switch (event.type) {
        case EventType.CityFounded: {
          if (event.x === undefined || event.y === undefined || !event.city) {
            break;
          }
          // A founding resets the tile: the new city stands on it and the
          // founder becomes its owner
          const key = `${event.x},${event.y}`;
          const civName = getCivName(event.civId);
          const entry: TileStateInfo = { city: event.city.name };
          if (civName) {
            entry.owner = civName;
          }
          current.set(key, entry);
          record(key, event.turn);
          break;
        }

        case EventType.TilesClaimed: {
          if (!event.tiles) {
            break;
          }
          const civName = getCivName(event.civId);
          for (const tile of event.tiles) {
            const key = `${tile.x},${tile.y}`;
            if (civName) {
              const entry = current.get(key) || {};
              entry.owner = civName;
              current.set(key, entry);
              record(key, event.turn);
            } else if (current.has(key)) {
              // A claim by an unknown civilization releases the tile
              current.delete(key);
              record(key, event.turn);
            }
          }
          break;
        }

        case EventType.CitiesTransferred: {
          if (!event.tiles) {
            break;
          }
          const civName = getCivName(event.civId);
          if (!civName) {
            break;
          }
          for (const tile of event.tiles) {
            // A transfer moves ownership and leaves any city in place
            const key = `${tile.x},${tile.y}`;
            const entry = current.get(key) || {};
            entry.owner = civName;
            current.set(key, entry);
            record(key, event.turn);
          }
          break;
        }

        case EventType.CityRazed: {
          if (event.x === undefined || event.y === undefined) {
            break;
          }
          // A razing removes the city and keeps the owner
          const key = `${event.x},${event.y}`;
          const entry = current.get(key);
          if (entry && entry.city !== undefined) {
            delete entry.city;
            record(key, event.turn);
          }
          break;
        }

        default:
          break;
      }
    }
  }
}
