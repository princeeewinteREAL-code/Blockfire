// Blockfire server — placeholder until Phase 3 (online multiplayer).
// The server will import the exact same movement code the client uses,
// so it can check every move a player makes.
import { MOVEMENT } from '@blockfire/shared';

export const SERVER_PHASE = 'Phase 3 — not started yet';

export function describeServer(): string {
  return `Blockfire server (${SERVER_PHASE}). Base run speed shared with client: ${MOVEMENT.runSpeed} m/s.`;
}
