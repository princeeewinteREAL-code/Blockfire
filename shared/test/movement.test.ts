import { describe, expect, it } from 'vitest';
import {
  MOVEMENT, TEST_MAP, createPlayer, emptyInput, horizontalSpeed, stepPlayer,
  type MapDef, type MoveInput, type PlayerState,
} from '../src/index.js';

const DT = 1 / 60;

/** A flat, empty 200 x 200 floor. */
const FLAT: MapDef = {
  id: 'flat', name: 'Flat', spawn: { pos: [0, 0, 0], yaw: 0 },
  boxes: [{ min: [-100, -1, -100], max: [100, 0, 100], color: '#fff' }],
  ramps: [], zones: [], sky: { top: '#000', bottom: '#000', fog: '#000' },
};

function run(p: PlayerState, input: Partial<MoveInput>, ticks: number, map: MapDef = FLAT) {
  const events: string[] = [];
  for (let i = 0; i < ticks; i++) events.push(...stepPlayer(p, { ...emptyInput(), ...input }, map, DT).events);
  return events;
}

function grounded(map: MapDef = FLAT, x = 0, z = 0): PlayerState {
  const p = createPlayer({ x, y: 0.5, z });
  run(p, {}, 60, map);
  return p;
}

describe('running', () => {
  it('reaches the base run speed of 6 m/s', () => {
    const p = grounded();
    run(p, { forward: 1 }, 120);
    expect(horizontalSpeed(p)).toBeCloseTo(MOVEMENT.runSpeed, 1);
  });

  it('walks at 3 m/s and crouches at 3 m/s', () => {
    const p = grounded();
    run(p, { forward: 1, walk: true }, 120);
    expect(horizontalSpeed(p)).toBeCloseTo(3, 1);
  });

  it('weapon speed multiplier scales run speed (125% Super Pistols)', () => {
    const p = grounded();
    run(p, { forward: 1, speedMul: 1.25 }, 120);
    expect(horizontalSpeed(p)).toBeCloseTo(7.5, 1);
  });

  it('stops quickly when keys are released', () => {
    const p = grounded();
    run(p, { forward: 1 }, 120);
    run(p, {}, 30);
    expect(horizontalSpeed(p)).toBeLessThan(0.05);
  });
});

describe('jumping', () => {
  it('jumps about 1.2 m high', () => {
    const p = grounded();
    let peak = 0;
    stepPlayer(p, { ...emptyInput(), jump: true }, FLAT, DT);
    for (let i = 0; i < 60; i++) {
      stepPlayer(p, emptyInput(), FLAT, DT);
      peak = Math.max(peak, p.pos.y);
    }
    expect(peak).toBeGreaterThan(1.1);
    expect(peak).toBeLessThan(1.3);
    expect(p.onGround).toBe(true);
  });

  it('auto bunny-hops while jump is held, keeping speed', () => {
    const p = grounded();
    run(p, { forward: 1 }, 120);
    const events = run(p, { forward: 1, jump: true }, 180);
    expect(events.filter((e) => e === 'jump').length).toBeGreaterThanOrEqual(4);
    expect(horizontalSpeed(p)).toBeGreaterThanOrEqual(5.9);
  });
});

describe('sliding', () => {
  it('gives a 1.5x speed boost', () => {
    const p = grounded();
    run(p, { forward: 1 }, 120);
    const events = run(p, { forward: 1, crouch: true }, 1);
    expect(events).toContain('slide');
    expect(horizontalSpeed(p)).toBeGreaterThan(MOVEMENT.runSpeed * 1.45);
  });

  it('ends after about 0.8 s and then has a 1 s cooldown', () => {
    const p = grounded();
    run(p, { forward: 1 }, 120);
    run(p, { forward: 1, crouch: true }, 1);
    expect(p.sliding).toBe(true);
    run(p, { forward: 1, crouch: true }, 50);
    expect(p.sliding).toBe(false);
    expect(p.slideCooldown).toBeGreaterThan(0.8);
    // Pressing crouch again during the cooldown doesn't slide.
    const again = run(p, { forward: 1 }, 1).concat(run(p, { forward: 1, crouch: true }, 1));
    expect(again).not.toContain('slide');
  });

  it('slide-hop carries the slide speed into the air', () => {
    const p = grounded();
    run(p, { forward: 1 }, 120);
    run(p, { forward: 1, crouch: true }, 6);
    const events = run(p, { forward: 1, jump: true }, 1);
    expect(events).toContain('slideHop');
    expect(horizontalSpeed(p)).toBeGreaterThan(8);
  });

  it('shrinks the hitbox while sliding', () => {
    const p = grounded();
    run(p, { forward: 1 }, 120);
    run(p, { forward: 1, crouch: true }, 2);
    expect(p.crouched).toBe(true);
  });
});

describe('air strafing', () => {
  it('gains speed by strafing and turning in the air', () => {
    const p = grounded();
    run(p, { forward: 1 }, 120);
    let yaw = 0;
    // Hold jump + D and keep turning right: the classic strafe.
    for (let i = 0; i < 600; i++) {
      yaw -= 0.035;
      stepPlayer(p, { ...emptyInput(), strafe: 1, jump: true, yaw }, FLAT, DT);
    }
    expect(horizontalSpeed(p)).toBeGreaterThan(MOVEMENT.runSpeed + 1);
  });

  it('never exceeds the 14 m/s cap', () => {
    const p = grounded();
    p.vel.x = 40;
    run(p, { jump: true }, 2);
    expect(horizontalSpeed(p)).toBeLessThanOrEqual(MOVEMENT.maxSpeed + 1e-6);
  });
});

describe('walls, steps and ledges', () => {
  const WALLS: MapDef = {
    ...FLAT,
    boxes: [
      ...FLAT.boxes,
      { min: [-1, 0, -12], max: [1, 0.4, -2], color: '#fff' },  // step
      { min: [-10, 0, -20], max: [10, 1.6, -19], color: '#fff' }, // ledge
      { min: [5, 0, -5], max: [6, 10, 5], color: '#fff' },       // tall wall (east)
    ],
  };

  it('walks up a 0.4 m step without jumping', () => {
    const p = grounded(WALLS);
    run(p, { forward: 1 }, 40, WALLS);
    expect(p.pos.y).toBeCloseTo(0.4, 2);
  });

  it('is stopped by walls', () => {
    const p = grounded(WALLS);
    run(p, { strafe: 1 }, 120, WALLS);
    expect(p.pos.x).toBeLessThan(5 - MOVEMENT.radius + 0.01);
  });

  it('climbs a 1.6 m ledge when holding jump + forward', () => {
    const p = grounded(WALLS, 0, -15);
    const events = run(p, { forward: 1, jump: true }, 120, WALLS);
    expect(events).toContain('climb');
    expect(p.pos.y).toBeGreaterThan(1.5);
  });

  it('wall-jumps up to 3 times with a Snake weapon, then not again until landing', () => {
    const p = grounded(WALLS);
    run(p, { strafe: 1 }, 120, WALLS); // touching the east wall
    const events: string[] = [];
    // Jump, then tap jump repeatedly in the air while pushing into the wall.
    for (let i = 0; i < 120; i++) {
      const jump = i % 8 < 1;
      events.push(...stepPlayer(p, { ...emptyInput(), strafe: 1, jump, wallJump: true }, WALLS, DT).events);
      if (p.onGround && i > 10) break;
    }
    const wallJumps = events.filter((e) => e === 'wallJump').length;
    expect(wallJumps).toBeGreaterThanOrEqual(1);
    expect(wallJumps).toBeLessThanOrEqual(3);
  });

  it('does NOT wall-jump without a Snake weapon', () => {
    const p = grounded(WALLS);
    run(p, { strafe: 1 }, 120, WALLS);
    const events: string[] = [];
    for (let i = 0; i < 60; i++) {
      events.push(...stepPlayer(p, { ...emptyInput(), strafe: 1, jump: i % 8 < 1 }, WALLS, DT).events);
    }
    expect(events).not.toContain('wallJump');
  });
});

describe('Training Grounds map', () => {
  it('spawns the player standing on the ground', () => {
    const [x, y, z] = TEST_MAP.spawn.pos;
    const p = createPlayer({ x, y: y + 0.2, z });
    run(p, {}, 30, TEST_MAP);
    expect(p.onGround).toBe(true);
    expect(p.pos.y).toBeCloseTo(0, 2);
  });

  it('lets you walk up the slide-tower ramp', () => {
    const p = createPlayer({ x: 13, y: 0.1, z: -11 });
    run(p, {}, 10, TEST_MAP);
    run(p, { forward: 1 }, 300, TEST_MAP); // yaw 0 = toward -Z = up the ramp
    expect(p.pos.y).toBeGreaterThan(5);
  });

  it('sliding down the ramp is faster than running', () => {
    const p = createPlayer({ x: 13, y: 6.1, z: -36 });
    run(p, {}, 10, TEST_MAP);
    run(p, { forward: -1 }, 30, TEST_MAP);
    run(p, { forward: -1, crouch: true }, 30, TEST_MAP);
    expect(horizontalSpeed(p)).toBeGreaterThan(MOVEMENT.runSpeed * 1.4);
  });
});
