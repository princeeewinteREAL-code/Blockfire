/**
 * Movement tuning values — the single source of truth for how Blockfire feels.
 * Numbers come from the Game Design Document ("Movement mechanics").
 * Client and server both read this file, so changing a value here changes it everywhere.
 */
export const MOVEMENT = {
  /** Gravity in m/s². */
  gravity: 25,
  /** Base run speed in m/s (weapon move speed multiplies this). */
  runSpeed: 6.5,
  /** Holding W+A or W+D ("strafing") is Krunker's sprint: this much faster. */
  diagonalBoost: 1.15,
  /** Walk (silent) speed in m/s. */
  walkSpeed: 3,
  /** Crouch speed in m/s. */
  crouchSpeed: 3,
  /** Jump height in metres. */
  jumpHeight: 1.2,
  /** How quickly you reach full speed on the ground. */
  groundAccel: 12,
  /** Ground friction. */
  friction: 7,
  /** Below this speed, friction acts as if you were moving this fast (stops you crisply). */
  stopSpeed: 1.5,
  /** Air acceleration used for air strafing. */
  airAccel: 70,
  /** Cap on "wish speed" in the air — the classic trick that makes strafing gain speed. */
  airWishCap: 0.8,
  /** Hard cap on horizontal speed in m/s. */
  maxSpeed: 16,
  /** Air control: holding W in the air turns your momentum toward where you look (radians/s). */
  airTurn: 2.6,

  /** Bunny hop: each hop that leaves the ground the instant you land multiplies speed by this… */
  hopGain: 1.045,
  /** …up to this multiple of run speed. */
  hopCap: 1.35,

  /** Slide: speed becomes at least runSpeed × this. */
  slideBoost: 1.45,
  /** Slide-hop chain: landing straight into a slide multiplies your speed by this. */
  slideChainGain: 1.1,
  /** Slide length in seconds. */
  slideDuration: 0.9,
  /** Wait after a slide runs out before a fresh one. Chained slide-hops ignore it. */
  slideCooldown: 0.5,
  /** Friction while sliding (much lower than normal). */
  slideFriction: 0.55,
  /** Slides follow your mouse: how fast the slide turns toward where you look (radians/s). */
  slideTurn: 7,
  /** Pressing crouch this long before landing still counts for a slide-hop (s). */
  crouchBuffer: 0.25,
  /** Minimum speed needed to start a slide, in m/s. */
  slideMinSpeed: 3.5,

  /** Player body. */
  radius: 0.3,
  standHeight: 1.8,
  /** 30% smaller hitbox while crouching. */
  crouchHeight: 1.26,
  /** Camera sits this far below the top of the head. */
  eyeOffset: 0.16,

  /** Highest step you walk up without jumping, in metres. */
  stepHeight: 0.45,
  /** Highest ledge you can pull yourself onto, in metres. */
  ledgeMax: 1.8,

  /** Wall-jumps per airtime (Snake weapons only). */
  wallJumps: 3,
  /** Push away from the wall, in m/s. */
  wallJumpPush: 5,
  /** Fraction of horizontal speed kept on a wall-jump. */
  wallJumpKeep: 0.9,
  /** How close a wall must be to wall-jump, in metres. */
  wallReach: 0.35,

  /** Fall below this height and you respawn. */
  killHeight: -30,
} as const;

export type MovementConfig = typeof MOVEMENT;

/** Upward speed needed to reach a height h under gravity g. */
export function launchSpeed(height: number, gravity: number = MOVEMENT.gravity): number {
  return Math.sqrt(2 * gravity * height);
}
