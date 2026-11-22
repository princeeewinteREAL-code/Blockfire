import { describe, expect, it } from 'vitest';
import { TEST_MAP, createPlayer, emptyInput, pointInZone, stepPlayer } from '../src/index.js';

/**
 * A scripted "speedrunner" runs the Training Grounds parkour course with the real physics,
 * proving the course can be finished. It runs straight north (-Z) along x = -35:
 * holds forward, jumps near each platform edge, and slides on the long checkpoint platform.
 */
describe('Training Grounds parkour course', () => {
  it('can be completed from the start gate to the finish', () => {
    const p = createPlayer({ x: -35, y: 0.1, z: 26 });
    const finish = TEST_MAP.zones.find((z) => z.kind === 'finish')!;
    const edges = [12, 4, -2, -5, -18, -23, -38].map((z) => z); // near edges of each gap (approx.)
    let finished = false;
    let t = 0;
    for (let i = 0; i < 60 * 30 && !finished; i++) {
      const input = { ...emptyInput(), forward: 1 };
      // Jump when within 0.9 m of the far edge of whatever we're running on.
      const nextEdge = [20, 12, 4, -2, -18, -38].find((e) => p.pos.z > e - 0.01 && p.pos.z - e < 0.9);
      // Climb onto a higher platform ahead: [its near edge z, its top height].
      const lowAhead = ([[9, 0.8], [1.5, 1.5], [-5, 3]] as const).find(([e, top]) => p.pos.z > e && p.pos.z - e < 1.6 && p.pos.y < top - 0.2);
      input.jump = nextEdge !== undefined || lowAhead !== undefined;
      // Slide on the long platform to make the 5 m gap.
      input.crouch = p.pos.z < -15.6 && p.pos.z > -16.4;
      stepPlayer(p, input, TEST_MAP, 1 / 60);
      t += 1 / 60;
      if (pointInZone(finish, p.pos.x, p.pos.y + 0.5, p.pos.z)) finished = true;
      if (p.pos.y < -30) break;
    }
    expect(edges.length).toBeGreaterThan(0);
    expect(finished, `ended at z=${p.pos.z.toFixed(2)} y=${p.pos.y.toFixed(2)}`).toBe(true);
    expect(t).toBeLessThan(30);
  });
});
