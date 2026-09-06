/**
 * session.test.ts
 * Checks the per-turn ownership derived by the game session against the
 * example replays. Every hard-coded value below is ground truth from the
 * actual bytes of examples/4.Civ5Replay, cross-checked against the previous
 * renderer-side algorithm that the session model replaces.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Replay } from '../../src/core/replay';
import { GameSession } from '../../src/core/session';
import { GameEvent, EventType, TurnState } from '../../src/types/replay.types';

/**
 * Load an example file from the examples directory as a standalone ArrayBuffer
 */
function loadExample(name: string): ArrayBuffer {
  const raw = readFileSync(fileURLToPath(new URL(`../../examples/${name}`, import.meta.url)));
  return raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
}

/**
 * The turn-state folding the map renderer used to perform: one full copy of
 * the tile state per turn, rebuilt from the events. Kept here as the
 * reference the compact session model has to match.
 */
function legacyTurnStates(events: GameEvent[], getCivName: (civId?: number) => string | null): TurnState[] {
  const states: TurnState[] = [];
  const byTurn = new Map<number, GameEvent[]>();
  for (const event of events) {
    if (!byTurn.has(event.turn)) byTurn.set(event.turn, []);
    byTurn.get(event.turn)!.push(event);
  }

  let last: TurnState = {};
  const lastTurn = events[events.length - 1].turn;
  for (let t = 0; t <= lastTurn; t++) {
    const state: TurnState = JSON.parse(JSON.stringify(last));
    for (const event of byTurn.get(t) || []) {
      switch (event.type) {
        case EventType.CityFounded: {
          const key = [event.x, event.y].join(',');
          state[key] = { owner: getCivName(event.civId) || undefined, city: (event.city as any).name };
          break;
        }
        case EventType.TilesClaimed:
          for (const tile of event.tiles!) {
            const key = [tile.x, tile.y].join(',');
            state[key] = state[key] || {};
            const civName = getCivName(event.civId);
            if (civName) { state[key].owner = civName; } else { delete state[key]; }
          }
          break;
        case EventType.CitiesTransferred:
          for (const tile of event.tiles!) {
            const key = [tile.x, tile.y].join(',');
            state[key] = state[key] || {};
            const civName = getCivName(event.civId);
            if (civName) { state[key].owner = civName; }
          }
          break;
        case EventType.CityRazed: {
          const key = [event.x, event.y].join(',');
          if (state[key]) { delete state[key].city; }
          break;
        }
      }
    }
    states.push(state);
    last = state;
  }
  return states;
}

describe('GameSession ownership on examples/4.Civ5Replay', () => {
  let session: GameSession;

  beforeAll(async () => {
    const buffer = loadExample('4.Civ5Replay');
    const replay = new Replay();
    await replay.loadFromFile(buffer, buffer.byteLength);
    session = new GameSession(replay);
  });

  it('starts on the first turn of the replay', () => {
    expect(session.currentTurn).toBe(0);
    expect(session.startTurn).toBe(0);
    expect(session.endTurn).toBe(484);
    expect(session.selection).toEqual({ kind: 'none' });
  });

  it('tracks a founded city from its founding turn', () => {
    // Arabia founded Mecca on turn 0 at (54,19); the tile was unowned before
    expect(session.stateAt(0)['54,19']).toEqual({ owner: 'Arabia', city: 'Mecca' });
    // Denmark took the city at some point; it is still there at the last turn
    expect(session.stateAt(484)['54,19']).toEqual({ owner: 'Denmark', city: 'Mecca' });
  });

  it('tracks a tile claim', () => {
    // Austria claimed seven tiles around its start on turn 1; (48,44) is one
    // of them and never carries a city
    expect(session.stateAt(0)['48,44']).toBeUndefined();
    expect(session.stateAt(1)['48,44']).toEqual({ owner: 'Austria' });
    expect(session.stateAt(484)['48,44']).toEqual({ owner: 'Austria' });
  });

  it('tracks a city transfer', () => {
    // Jerusalem, founded on turn 0 by its city-state, transferred to Arabia
    // on turn 115; the city stays, only the owner moves
    expect(session.stateAt(114)['34,15']).toEqual({ owner: 'Jerusalem', city: 'Jerusalem' });
    expect(session.stateAt(115)['34,15']).toEqual({ owner: 'Arabia', city: 'Jerusalem' });
  });

  it('tracks a razing', () => {
    // Denmark razed Gondar at (56,29) on turn 284: the city goes, the owner
    // stays, and a new city can be founded on the tile later
    expect(session.stateAt(283)['56,29']).toEqual({ owner: 'Denmark', city: 'Gondar' });
    expect(session.stateAt(284)['56,29']).toEqual({ owner: 'Denmark' });
    expect(session.stateAt(484)['56,29']).toEqual({ owner: 'Denmark', city: 'Helluland' });
  });

  it('matches the previous renderer-side algorithm on sampled turns', () => {
    const legacy = legacyTurnStates(session.replay.events, (id) => session.replay.getCivName(id));
    for (const turn of [0, 1, 60, 114, 115, 240, 283, 284, 400, 484]) {
      expect(session.stateAt(turn)).toEqual(legacy[turn]);
    }
    // The final state covers 2745 tiles on this map
    expect(Object.keys(session.stateAt(484))).toHaveLength(2745);
  });

  it('stores ownership compactly instead of one map copy per turn', () => {
    // The old renderer kept 485 full copies of up to 2745 tile entries each;
    // the timeline keeps one record per actual change
    const records = session.ownershipChangeCount();
    expect(records).toBeGreaterThan(0);
    expect(records).toBeLessThan(485 * 2745 / 50);
  });
});

describe('GameSession ownership on examples/1.Civ5Replay', () => {
  it('matches the previous renderer-side algorithm at every turn', async () => {
    const buffer = loadExample('1.Civ5Replay');
    const replay = new Replay();
    await replay.loadFromFile(buffer, buffer.byteLength);
    const session = new GameSession(replay);

    const legacy = legacyTurnStates(replay.events, (id) => replay.getCivName(id));
    for (let turn = 0; turn <= replay.endTurn; turn++) {
      expect(session.stateAt(turn)).toEqual(legacy[turn]);
    }
  });
});

describe('GameSession turn changes and subscriptions', () => {
  let session: GameSession;

  beforeAll(async () => {
    const buffer = loadExample('4.Civ5Replay');
    const replay = new Replay();
    await replay.loadFromFile(buffer, buffer.byteLength);
    session = new GameSession(replay);
  });

  it('notifies subscribers with the turn and its state', () => {
    const seen: Array<{ turn: number; state: TurnState }> = [];
    const unsubscribe = session.subscribe((turn, state) => seen.push({ turn, state }));

    session.setTurn(120);
    expect(seen).toHaveLength(1);
    expect(seen[0].turn).toBe(120);
    // The state handed to subscribers is the one the session keeps for the turn
    expect(seen[0].state).toBe(session.stateAt(120));
    expect(session.currentTurn).toBe(120);
  });

  it('clamps requested turns to the replay range', () => {
    const seen: number[] = [];
    const unsubscribe = session.subscribe((turn) => seen.push(turn));

    session.setTurn(9999);
    session.setTurn(-5);
    expect(seen).toEqual([484, 0]);
    expect(session.currentTurn).toBe(0);

    unsubscribe();
  });

  it('stops notifying after unsubscribing', () => {
    const seen: number[] = [];
    const unsubscribe = session.subscribe((turn) => seen.push(turn));

    session.setTurn(10);
    unsubscribe();
    session.setTurn(20);

    expect(seen).toEqual([10]);
    expect(session.currentTurn).toBe(20);
  });
});

describe('Replay hub data kinds and datasets', () => {
  it('marks the data areas of a replay file as history', async () => {
    const buffer = loadExample('4.Civ5Replay');
    const replay = new Replay();
    await replay.loadFromFile(buffer, buffer.byteLength);

    expect(replay.source).toBe('replay');
    expect(Object.values(replay.dataKinds)).toContain('history');
    expect(Object.values(replay.dataKinds)).not.toContain('snapshot');
  });

  it('exposes each dataset as one series of turn and value pairs per civilization', async () => {
    const buffer = loadExample('4.Civ5Replay');
    const replay = new Replay();
    await replay.loadFromFile(buffer, buffer.byteLength);

    expect(Object.keys(replay.datasets)).toHaveLength(29);
    // Arabia's score series starts at turn 0 and runs to the last turn
    const score = replay.getDatasetForCiv('REPLAYDATASET_SCORE', 0);
    expect(score[0]).toEqual({ turn: 0, value: 6 });
    expect(score[score.length - 1]).toEqual({ turn: 484, value: 0 });
  });
});
