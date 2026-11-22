/**
 * Blockfire movement physics.
 *
 * One pure function, `stepPlayer`, advances a player by one fixed tick (1/60 s).
 * It never touches the screen, keyboard or network, so the browser can use it to move
 * you instantly, and the server can run the exact same code to check every move.
 */
import { MOVEMENT, launchSpeed, type MovementConfig } from './movement-config.js';
import { rampDownhill, rampHeightAt, type Box, type MapDef, type Ramp } from './map.js';

export interface Vec3 { x: number; y: number; z: number }

export interface PlayerState {
  /** Position of the player's FEET (centre of the bottom of the body). */
  pos: Vec3;
  vel: Vec3;
  onGround: boolean;
  crouched: boolean;
  sliding: boolean;
  slideTime: number;
  slideCooldown: number;
  wallJumpsLeft: number;
  climbCooldown: number;
  /** Was jump/crouch held last tick (to detect fresh presses). */
  jumpHeld: boolean;
  crouchHeld: boolean;
  /** Landed on the previous tick (lets you slide straight out of a landing). */
  justLanded: boolean;
  /** Seconds left on a crouch pressed in the air (buffered for a slide-hop). */
  crouchQueue: number;
  /** Consecutive bunny hops (for the HUD and effects). */
  hops: number;
  /** The ramp you're standing on, if any (index into map.ramps). */
  groundRamp: number;
}

export interface MoveInput {
  /** -1 (back) .. 1 (forward). */
  forward: number;
  /** -1 (left) .. 1 (right). */
  strafe: number;
  jump: boolean;
  crouch: boolean;
  walk: boolean;
  /** Camera yaw in radians. 0 looks toward -Z. */
  yaw: number;
  /** True while a Snake weapon is in hand (enables wall-jumps). */
  wallJump: boolean;
  /** Weapon move-speed multiplier (1 = 100%). */
  speedMul: number;
}

export type MoveEvent = 'jump' | 'land' | 'slide' | 'slideChain' | 'slideHop' | 'wallJump' | 'climb' | 'step';

export interface StepResult { events: MoveEvent[] }

export function createPlayer(pos: Vec3, cfg: MovementConfig = MOVEMENT): PlayerState {
  return {
    pos: { ...pos },
    vel: { x: 0, y: 0, z: 0 },
    onGround: false,
    crouched: false,
    sliding: false,
    slideTime: 0,
    slideCooldown: 0,
    wallJumpsLeft: cfg.wallJumps,
    climbCooldown: 0,
    jumpHeld: false,
    crouchHeld: false,
    justLanded: false,
    crouchQueue: 0,
    hops: 0,
    groundRamp: -1,
  };
}

export function emptyInput(): MoveInput {
  return { forward: 0, strafe: 0, jump: false, crouch: false, walk: false, yaw: 0, wallJump: false, speedMul: 1 };
}

export function playerHeight(p: PlayerState, cfg: MovementConfig = MOVEMENT): number {
  return p.crouched || p.sliding ? cfg.crouchHeight : cfg.standHeight;
}

export function eyeHeight(p: PlayerState, cfg: MovementConfig = MOVEMENT): number {
  return playerHeight(p, cfg) - cfg.eyeOffset;
}

export function horizontalSpeed(p: PlayerState): number {
  return Math.hypot(p.vel.x, p.vel.z);
}

const EPS = 1e-4;

/** Does a player body at (x, y, z) with height h overlap box b? */
function overlaps(b: Box, x: number, y: number, z: number, h: number, r: number): boolean {
  return (
    x + r > b.min[0] + EPS && x - r < b.max[0] - EPS &&
    y + h > b.min[1] + EPS && y < b.max[1] - EPS &&
    z + r > b.min[2] + EPS && z - r < b.max[2] - EPS
  );
}

/** Is there room for a body at this spot? */
export function fits(map: MapDef, x: number, y: number, z: number, h: number, r: number = MOVEMENT.radius): boolean {
  for (const b of map.boxes) if (overlaps(b, x, y, z, h, r)) return false;
  return true;
}

/** Quake-style acceleration: only adds speed up to `wishSpeed` along `wishDir`. */
function accelerate(v: Vec3, dirX: number, dirZ: number, wishSpeed: number, accel: number, dt: number): void {
  const current = v.x * dirX + v.z * dirZ;
  const add = wishSpeed - current;
  if (add <= 0) return;
  const amount = Math.min(accel * dt * wishSpeed, add);
  v.x += amount * dirX;
  v.z += amount * dirZ;
}

/** Rotate horizontal velocity toward a direction by at most `maxAngle` radians, keeping its speed. */
function turnToward(v: Vec3, dirX: number, dirZ: number, maxAngle: number): void {
  const speed = Math.hypot(v.x, v.z);
  if (speed < 0.5) return;
  const cur = Math.atan2(v.z, v.x);
  const want = Math.atan2(dirZ, dirX);
  let d = want - cur;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  // Don't flip around when you look backwards.
  if (Math.abs(d) > Math.PI * 0.6) return;
  const a = cur + Math.max(-maxAngle, Math.min(maxAngle, d));
  v.x = Math.cos(a) * speed;
  v.z = Math.sin(a) * speed;
}

function applyFriction(v: Vec3, friction: number, stopSpeed: number, dt: number): void {
  const speed = Math.hypot(v.x, v.z);
  if (speed < EPS) { v.x = 0; v.z = 0; return; }
  const control = Math.max(speed, stopSpeed);
  const next = Math.max(speed - control * friction * dt, 0);
  const k = next / speed;
  v.x *= k;
  v.z *= k;
}

/** Find a wall within reach and return its outward normal (x, z), or null. */
function findWall(map: MapDef, p: PlayerState, h: number, cfg: MovementConfig): { x: number; z: number } | null {
  const reach = cfg.radius + cfg.wallReach;
  let best: { x: number; z: number; d: number } | null = null;
  for (const b of map.boxes) {
    if (p.pos.y + h <= b.min[1] || p.pos.y >= b.max[1]) continue;
    // Clamp feet position to the box footprint to find the nearest point.
    const cx = Math.max(b.min[0], Math.min(p.pos.x, b.max[0]));
    const cz = Math.max(b.min[2], Math.min(p.pos.z, b.max[2]));
    const dx = p.pos.x - cx;
    const dz = p.pos.z - cz;
    const d = Math.hypot(dx, dz);
    if (d > reach || d < EPS) continue;
    if (!best || d < best.d) best = { x: dx / d, z: dz / d, d };
  }
  return best ? { x: best.x, z: best.z } : null;
}

/**
 * Move along one horizontal axis, stopping at walls. Handles walking up small steps
 * and pulling yourself onto ledges.
 */
function moveHorizontal(
  map: MapDef, p: PlayerState, axis: 'x' | 'z', delta: number, h: number,
  input: MoveInput, cfg: MovementConfig, events: MoveEvent[],
): void {
  if (delta === 0) return;
  const r = cfg.radius;
  const startX = p.pos.x;
  const startZ = p.pos.z;
  p.pos[axis] += delta;
  for (const b of map.boxes) {
    if (!overlaps(b, p.pos.x, p.pos.y, p.pos.z, h, r)) continue;
    const top = b.max[1];
    const rise = top - p.pos.y;

    // 1. Small step: walk straight up it.
    if (p.onGround && rise > 0 && rise <= cfg.stepHeight && fits(map, p.pos.x, top, p.pos.z, h, r)) {
      p.pos.y = top;
      events.push('step');
      continue;
    }

    // 2. Blocked: stop at the wall.
    if (axis === 'x') p.pos.x = delta > 0 ? b.min[0] - r - EPS : b.max[0] + r + EPS;
    else p.pos.z = delta > 0 ? b.min[2] - r - EPS : b.max[2] + r + EPS;
    p.vel[axis] = 0;

    // 3. Ledge climb: holding jump + forward against a ledge you can reach.
    if (
      input.jump && input.forward > 0 && p.climbCooldown <= 0 &&
      rise > cfg.stepHeight && rise <= cfg.ledgeMax && p.vel.y < 2 &&
      fits(map, startX, top + 0.01, startZ, h, r)
    ) {
      p.vel.y = launchSpeed(rise + 0.25, cfg.gravity);
      p.onGround = false;
      p.climbCooldown = 0.3;
      events.push('climb');
    }
  }
}

/** Move vertically. Returns true if feet landed on a box. */
function moveVertical(map: MapDef, p: PlayerState, delta: number, h: number, r: number): boolean {
  p.pos.y += delta;
  let landed = false;
  for (const b of map.boxes) {
    if (!overlaps(b, p.pos.x, p.pos.y, p.pos.z, h, r)) continue;
    if (delta < 0) {
      p.pos.y = b.max[1];
      landed = true;
    } else {
      p.pos.y = b.min[1] - h - EPS;
    }
    p.vel.y = 0;
  }
  return landed;
}

/** Snap feet onto a ramp surface if close enough. Returns the ramp index or -1. */
function snapToRamp(map: MapDef, p: PlayerState, wasOnGround: boolean, onBox: boolean): number {
  if (p.vel.y > 0.01) return -1;
  const above = wasOnGround ? 0.35 : 0.02;
  let best = -1;
  let bestH = -Infinity;
  map.ramps.forEach((ramp: Ramp, i: number) => {
    const surface = rampHeightAt(ramp, p.pos.x, p.pos.z);
    if (surface === null) return;
    // Standing on a block: only step UP onto a ramp, never sink into the block.
    if (onBox && surface < p.pos.y - EPS) return;
    if (p.pos.y <= surface + above && p.pos.y >= surface - 0.6 && surface > bestH) {
      best = i;
      bestH = surface;
    }
  });
  if (best >= 0) {
    p.pos.y = bestH;
    p.vel.y = 0;
  }
  return best;
}

/**
 * Advance one player by `dt` seconds (use a fixed 1/60).
 * Mutates `p` and returns the things that happened (for sounds and effects).
 */
export function stepPlayer(
  p: PlayerState, input: MoveInput, map: MapDef, dt: number, cfg: MovementConfig = MOVEMENT,
): StepResult {
  const events: MoveEvent[] = [];
  const jumpPressed = input.jump && !p.jumpHeld;
  const crouchPressed = input.crouch && !p.crouchHeld;
  const wasOnGround = p.onGround;

  p.slideCooldown = Math.max(0, p.slideCooldown - dt);
  p.climbCooldown = Math.max(0, p.climbCooldown - dt);

  // Wish direction from keys + camera yaw. W+A / W+D is faster (Krunker's "strafe sprint").
  const sin = Math.sin(input.yaw);
  const cos = Math.cos(input.yaw);
  let wx = -sin * input.forward + cos * input.strafe;
  let wz = -cos * input.forward - sin * input.strafe;
  const wlen = Math.hypot(wx, wz);
  if (wlen > 1e-6) { wx /= wlen; wz /= wlen; } else { wx = 0; wz = 0; }
  const hasWish = wlen > 1e-6;
  const diag = input.forward !== 0 && input.strafe !== 0 ? cfg.diagonalBoost : 1;
  const faceX = -sin;
  const faceZ = -cos;

  // Crouch pressed in the air is remembered briefly, so you can slide the moment you land.
  if (!p.onGround && crouchPressed) p.crouchQueue = cfg.crouchBuffer;
  p.crouchQueue = Math.max(0, p.crouchQueue - dt);

  // --- Start a slide ---
  const speed = horizontalSpeed(p);
  const landingSlide = p.justLanded && (input.crouch || p.crouchQueue > 0);
  if (
    p.onGround && !p.sliding && speed >= cfg.slideMinSpeed &&
    (landingSlide || (crouchPressed && p.slideCooldown <= 0))
  ) {
    const base = cfg.runSpeed * input.speedMul * cfg.slideBoost;
    // Chaining (landing straight into a slide) builds speed; a fresh slide gives the base boost.
    const target = Math.min(cfg.maxSpeed, landingSlide ? Math.max(speed * cfg.slideChainGain, base) : Math.max(speed, base));
    // Slides go where you're looking (unless you're moving backwards).
    const vx = p.vel.x / speed, vz = p.vel.z / speed;
    const useFace = vx * faceX + vz * faceZ > 0;
    p.vel.x = (useFace ? faceX : vx) * target;
    p.vel.z = (useFace ? faceZ : vz) * target;
    p.sliding = true;
    p.slideTime = cfg.slideDuration;
    p.crouchQueue = 0;
    events.push(landingSlide ? 'slideChain' : 'slide');
  }

  // --- Jumping (hold to bunny-hop) and wall-jumps ---
  if (p.onGround && input.jump) {
    if (p.sliding) {
      // Slide-hop: keep the slide speed (no cooldown, so you can chain them).
      p.sliding = false;
      events.push('slideHop');
    } else {
      if (hasWish) {
        const base = input.walk ? cfg.walkSpeed : cfg.runSpeed;
        accelerate(p.vel, wx, wz, base * input.speedMul * diag, cfg.groundAccel, dt);
      }
      // Bunny hop: jumping the instant you land builds a little speed.
      const hs0 = horizontalSpeed(p);
      const cap = cfg.runSpeed * input.speedMul * cfg.hopCap;
      if (p.justLanded && hs0 > cfg.runSpeed * input.speedMul * 0.8 && hs0 < cap) {
        const k = Math.min(cfg.hopGain, cap / hs0);
        p.vel.x *= k;
        p.vel.z *= k;
        p.hops += 1;
      } else if (!p.justLanded) {
        p.hops = 0;
      }
    }
    p.vel.y = launchSpeed(cfg.jumpHeight, cfg.gravity);
    p.onGround = false;
    p.groundRamp = -1;
    events.push('jump');
  } else if (!p.onGround && jumpPressed && input.wallJump && p.wallJumpsLeft > 0) {
    const wall = findWall(map, p, playerHeight(p, cfg), cfg);
    if (wall) {
      p.vel.x *= cfg.wallJumpKeep;
      p.vel.z *= cfg.wallJumpKeep;
      const into = p.vel.x * wall.x + p.vel.z * wall.z;
      if (into < 0) { p.vel.x -= into * wall.x; p.vel.z -= into * wall.z; }
      p.vel.x += wall.x * cfg.wallJumpPush;
      p.vel.z += wall.z * cfg.wallJumpPush;
      p.vel.y = launchSpeed(cfg.jumpHeight, cfg.gravity);
      p.wallJumpsLeft -= 1;
      events.push('wallJump');
    }
  } else if (p.onGround && !p.justLanded) {
    p.hops = 0;
  }

  // --- Accelerate ---
  if (p.onGround) {
    if (p.sliding) {
      applyFriction(p.vel, cfg.slideFriction, 0, dt);
      if (p.groundRamp >= 0) {
        const down = rampDownhill(map.ramps[p.groundRamp]!);
        p.vel.x += down.x * cfg.gravity * down.sin * dt;
        p.vel.z += down.z * cfg.gravity * down.sin * dt;
      }
      // Steer the slide with the mouse.
      turnToward(p.vel, faceX, faceZ, cfg.slideTurn * dt);
      p.slideTime -= dt;
      if (p.slideTime <= 0 || horizontalSpeed(p) < cfg.crouchSpeed) {
        p.sliding = false;
        p.slideCooldown = cfg.slideCooldown;
      }
    } else {
      applyFriction(p.vel, cfg.friction, cfg.stopSpeed, dt);
      const base = input.crouch ? cfg.crouchSpeed : input.walk ? cfg.walkSpeed : cfg.runSpeed;
      if (hasWish) accelerate(p.vel, wx, wz, base * input.speedMul * diag, cfg.groundAccel, dt);
    }
  } else {
    if (hasWish) {
      const wish = cfg.runSpeed * input.speedMul;
      accelerate(p.vel, wx, wz, Math.min(wish, cfg.airWishCap), cfg.airAccel, dt);
      // Air control: holding forward bends your momentum toward where you look, without losing speed.
      if (input.forward > 0) turnToward(p.vel, wx, wz, cfg.airTurn * dt);
    }
    p.vel.y -= cfg.gravity * dt;
  }

  // Speed cap.
  const hs = horizontalSpeed(p);
  if (hs > cfg.maxSpeed) {
    p.vel.x *= cfg.maxSpeed / hs;
    p.vel.z *= cfg.maxSpeed / hs;
  }

  // --- Crouch height (stand up only if there's headroom) ---
  const wantLow = input.crouch || p.sliding;
  if (wantLow) p.crouched = true;
  else if (p.crouched && fits(map, p.pos.x, p.pos.y, p.pos.z, cfg.standHeight, cfg.radius)) p.crouched = false;
  const h = playerHeight(p, cfg);

  // --- Move and collide ---
  moveHorizontal(map, p, 'x', p.vel.x * dt, h, input, cfg, events);
  moveHorizontal(map, p, 'z', p.vel.z * dt, h, input, cfg, events);

  let grounded = false;
  if (p.onGround) {
    // Probe just below the feet to stay on the ground.
    grounded = moveVertical(map, p, -0.05, h, cfg.radius);
    if (!grounded) p.pos.y += 0.05;
  } else {
    grounded = moveVertical(map, p, p.vel.y * dt, h, cfg.radius);
  }
  const ramp = snapToRamp(map, p, p.onGround, grounded);
  if (ramp >= 0) grounded = true;
  p.groundRamp = ramp;

  if (grounded) {
    p.vel.y = 0;
    if (!wasOnGround) events.push('land');
    p.onGround = true;
    p.wallJumpsLeft = cfg.wallJumps;
  } else {
    if (p.onGround && p.sliding) {
      // Slid off an edge: keep the speed, end the slide.
      p.sliding = false;
      p.slideCooldown = cfg.slideCooldown;
    }
    p.onGround = false;
  }
  p.justLanded = grounded && !wasOnGround;

  p.jumpHeld = input.jump;
  p.crouchHeld = input.crouch;
  return { events };
}
