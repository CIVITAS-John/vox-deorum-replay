/**
 * types.ts
 * Type definitions for UI components
 */

import { GameSession } from '../replay/session';

// Control bar configuration
export interface ControlBarConfig {
  start: number;                 // First turn of the loaded replay
  end: number;                   // Last turn of the loaded replay
  session: GameSession;          // Session that owns the turn and notifies this bar
}
