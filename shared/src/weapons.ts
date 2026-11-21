/**
 * Every weapon in Blockfire, with the starting stats from the Weapons Design doc.
 * Client, server and bots all read this one file, so balance changes are just number edits.
 */

export type Slot = 'primary' | 'secondary' | 'melee';
export type Delivery = 'hitscan' | 'projectile' | 'melee';

export interface WeaponDef {
  id: string;
  name: string;
  slot: Slot;
  role: string;
  delivery: Delivery;
  /** Damage per hit. For pellet weapons, per pellet. For melee, per swing. */
  damage: { body: number; head: number };
  /** Rounds per minute (melee: swings per minute). */
  rpm: number;
  /** Rounds per magazine (0 = melee). */
  mag: number;
  reloadSec: number;
  /** Move-speed multiplier while held (1 = 100%). */
  moveSpeed: number;
  /** Scope zoom, or 0 for none. */
  zoom: number;
  pellets?: number;
  burst?: number;
  splash?: { radius: number; damage: number };
  /** Melee reach in metres. */
  reach?: number;
  /** Lets you wall-jump up to 3 times while held. */
  wallJump?: boolean;
  special: string;
  /** How you get it. */
  unlock: string;
  /** The secondary this primary unlocks at mastery 5. */
  masteryUnlock?: string;
}

const P = (w: WeaponDef): WeaponDef => w;

export const WEAPONS: WeaponDef[] = [
  // ---------------- Primaries ----------------
  P({ id: 'assault_rifle', name: 'Assault Rifle', slot: 'primary', role: 'All-rounder', delivery: 'hitscan',
    damage: { body: 22, head: 33 }, rpm: 600, mag: 30, reloadSec: 2.0, moveSpeed: 0.95, zoom: 1.5,
    special: 'Good at every range, best at none.', unlock: 'Starter', masteryUnlock: 'grapple_pistol' }),
  P({ id: 'smg', name: 'Submachine Gun', slot: 'primary', role: 'Close-range rusher', delivery: 'hitscan',
    damage: { body: 16, head: 22 }, rpm: 900, mag: 32, reloadSec: 1.6, moveSpeed: 1.05, zoom: 1.2,
    special: 'Built for slide-hopping into close fights. Damage drops hard past 15 m.', unlock: 'Starter', masteryUnlock: 'auto_pistol' }),
  P({ id: 'machine_gun', name: 'Machine Gun', slot: 'primary', role: 'Hold an area', delivery: 'hitscan',
    damage: { body: 25, head: 35 }, rpm: 650, mag: 75, reloadSec: 4.5, moveSpeed: 0.82, zoom: 1.4,
    special: '75 rounds to lock down a corridor. The 4.5 s reload punishes missed spray.', unlock: 'Starter', masteryUnlock: 'flare_pistol' }),
  P({ id: 'sniper', name: 'Sniper Rifle', slot: 'primary', role: 'One-shot picks', delivery: 'hitscan',
    damage: { body: 100, head: 150 }, rpm: 50, mag: 3, reloadSec: 1.8, moveSpeed: 0.88, zoom: 4,
    special: 'A body shot kills. Hip-fire is wildly inaccurate, so quick-scoping is a skill.', unlock: 'Starter', masteryUnlock: 'hand_cannon' }),
  P({ id: 'speedy_sniper', name: 'Speedy Sniper', slot: 'primary', role: 'Mobile sniping', delivery: 'hitscan',
    damage: { body: 70, head: 120 }, rpm: 70, mag: 5, reloadSec: 1.5, moveSpeed: 1.02, zoom: 2,
    special: 'Light enough to slide and bunny-hop with. A headshot still kills in one.', unlock: 'Starter', masteryUnlock: 'snake_pistol' }),
  P({ id: 'revolver', name: 'Revolver', slot: 'primary', role: 'Precision', delivery: 'hitscan',
    damage: { body: 45, head: 70 }, rpm: 180, mag: 6, reloadSec: 1.8, moveSpeed: 1.0, zoom: 1.3,
    special: 'Rewards accurate aim. Two headshots kill.', unlock: 'Starter', masteryUnlock: 'auto_revolver' }),
  P({ id: 'bomber', name: 'Bomber', slot: 'primary', role: 'Splash and area denial', delivery: 'projectile',
    damage: { body: 60, head: 60 }, rpm: 75, mag: 4, reloadSec: 2.6, moveSpeed: 0.9, zoom: 0,
    splash: { radius: 3.5, damage: 50 },
    special: 'Explosive shells. Shoot your feet to rocket-jump (15 self-damage).', unlock: 'Starter', masteryUnlock: 'rocketeer' }),
  P({ id: 'k2_bomber', name: 'K2 Super Bomber', slot: 'primary', role: 'One-shot nuke', delivery: 'projectile',
    damage: { body: 150, head: 150 }, rpm: 12, mag: 1, reloadSec: 5.0, moveSpeed: 0.7, zoom: 0,
    splash: { radius: 6, damage: 110 },
    special: 'One huge shell that wipes out anything near it. Then 5 s of being slow and defenceless.', unlock: 'Starter', masteryUnlock: 'sticky_bomb' }),
  P({ id: 'electronic_gun', name: 'Electronic Gun', slot: 'primary', role: 'Burst damage', delivery: 'projectile',
    damage: { body: 30, head: 40 }, rpm: 720, mag: 12, reloadSec: 3.5, moveSpeed: 1.0, zoom: 1.3,
    special: 'Light, fast and hard-hitting glowing bolts, but only 12 of them and a slow reload.', unlock: 'Starter', masteryUnlock: 'firecrackers' }),
  P({ id: 'super_pistols', name: 'Super Pistols', slot: 'primary', role: 'Pure speed', delivery: 'hitscan',
    damage: { body: 8, head: 12 }, rpm: 1000, mag: 40, reloadSec: 1.4, moveSpeed: 1.25, zoom: 0,
    special: 'The fastest primary in the game. Each bullet barely hurts, so keep the stream on target.', unlock: 'Starter', masteryUnlock: 'snake_auto_pistol' }),
  P({ id: 'dual_heavy_mgs', name: 'Dual Heavy MGs', slot: 'primary', role: 'Slow tank', delivery: 'hitscan',
    damage: { body: 35, head: 45 }, rpm: 900, mag: 100, reloadSec: 6.0, moveSpeed: 0.65, zoom: 0,
    special: 'Melts anyone in front of it. 65% speed and a 6 s reload make it easy to flank.', unlock: 'Starter', masteryUnlock: 'sawed_off' }),

  // ---------------- Secondaries ----------------
  P({ id: 'pistol', name: 'Pistol', slot: 'secondary', role: 'Reliable backup', delivery: 'hitscan',
    damage: { body: 25, head: 40 }, rpm: 300, mag: 10, reloadSec: 1.2, moveSpeed: 1.05, zoom: 1.1,
    special: 'Everyone has one.', unlock: 'Everyone starts with it' }),
  P({ id: 'auto_pistol', name: 'Auto-Pistol', slot: 'secondary', role: 'Spray backup', delivery: 'hitscan',
    damage: { body: 14, head: 20 }, rpm: 800, mag: 18, reloadSec: 1.4, moveSpeed: 1.05, zoom: 1.1,
    special: 'Full-auto.', unlock: 'Submachine Gun mastery 5' }),
  P({ id: 'snake_pistol', name: 'Snake Pistol', slot: 'secondary', role: 'Movement', delivery: 'hitscan',
    damage: { body: 25, head: 40 }, rpm: 300, mag: 10, reloadSec: 1.2, moveSpeed: 1.05, zoom: 1.1, wallJump: true,
    special: 'While in your hand: up to 3 wall-jumps before landing.', unlock: 'Speedy Sniper mastery 5' }),
  P({ id: 'snake_auto_pistol', name: 'Snake Auto-Pistol', slot: 'secondary', role: 'Movement + spray', delivery: 'hitscan',
    damage: { body: 12, head: 18 }, rpm: 800, mag: 16, reloadSec: 1.5, moveSpeed: 1.05, zoom: 1.1, wallJump: true,
    special: 'Full-auto, plus 3 wall-jumps while in your hand.', unlock: 'Super Pistols mastery 5' }),
  P({ id: 'firecrackers', name: 'Firecrackers', slot: 'secondary', role: 'Flashy damage', delivery: 'projectile',
    damage: { body: 30, head: 45 }, rpm: 280, mag: 8, reloadSec: 0.9, moveSpeed: 1.05, zoom: 0,
    special: 'Every shot is a random bright colour and pops into sparks.', unlock: 'Electronic Gun mastery 5' }),
  P({ id: 'rocketeer', name: 'Rocketeer Pistols', slot: 'secondary', role: 'Mini rockets', delivery: 'projectile',
    damage: { body: 25, head: 25 }, rpm: 150, mag: 3, reloadSec: 1.1, moveSpeed: 1.05, zoom: 0,
    splash: { radius: 2, damage: 15 },
    special: 'Small rocket-jumps for 5 self-damage.', unlock: 'Bomber mastery 5' }),
  P({ id: 'auto_revolver', name: 'Auto Revolver', slot: 'secondary', role: 'Burst precision', delivery: 'hitscan',
    damage: { body: 30, head: 45 }, rpm: 120, mag: 9, reloadSec: 1.9, moveSpeed: 1.05, zoom: 1.2, burst: 3,
    special: '3-round bursts. A full burst to the head kills.', unlock: 'Revolver mastery 5' }),
  P({ id: 'grapple_pistol', name: 'Grapple Pistol', slot: 'secondary', role: 'Parkour tool', delivery: 'hitscan',
    damage: { body: 20, head: 30 }, rpm: 300, mag: 8, reloadSec: 1.3, moveSpeed: 1.05, zoom: 0,
    special: 'Right-click fires a hook that pulls you to a wall up to 20 m away (4 s cooldown).', unlock: 'Assault Rifle mastery 5' }),
  P({ id: 'hand_cannon', name: 'Hand Cannon', slot: 'secondary', role: 'Heavy pistol', delivery: 'hitscan',
    damage: { body: 60, head: 100 }, rpm: 90, mag: 2, reloadSec: 2.2, moveSpeed: 1.05, zoom: 1.2,
    special: 'A headshot kills. Huge recoil.', unlock: 'Sniper Rifle mastery 5' }),
  P({ id: 'flare_pistol', name: 'Flare Pistol', slot: 'secondary', role: 'Team spotter', delivery: 'projectile',
    damage: { body: 15, head: 15 }, rpm: 40, mag: 1, reloadSec: 1.5, moveSpeed: 1.05, zoom: 0,
    special: 'Burns for 10 more, and the target glows through walls for your team for 4 s.', unlock: 'Machine Gun mastery 5' }),
  P({ id: 'sticky_bomb', name: 'Sticky Bomb Launcher', slot: 'secondary', role: 'Traps', delivery: 'projectile',
    damage: { body: 70, head: 70 }, rpm: 60, mag: 2, reloadSec: 2.5, moveSpeed: 1.05, zoom: 0,
    splash: { radius: 3, damage: 70 },
    special: 'Bombs stick to walls and players. Press fire again to detonate.', unlock: 'K2 Super Bomber mastery 5' }),
  P({ id: 'sawed_off', name: 'Sawed-Off', slot: 'secondary', role: 'Close escape', delivery: 'hitscan',
    damage: { body: 10, head: 15 }, rpm: 120, mag: 2, reloadSec: 2.0, moveSpeed: 1.05, zoom: 0, pellets: 8,
    special: 'The blast knocks you backwards: a quick escape for slow heavy players.', unlock: 'Dual Heavy MGs mastery 5' }),

  // ---------------- Melee ----------------
  ...([
    ['combat_knife', 'Combat Knife', 50, 0.4, 2.0, 1.15, 'Backstab deals 100.', 'Everyone starts with it'],
    ['kitchen_knife', 'Long Kitchen Knife', 55, 0.5, 2.4, 1.12, '+20 damage when you hit mid-slide.', 'Crates'],
    ['katana', 'Katana', 70, 0.7, 2.8, 1.08, 'Dash-slash: a 6 m lunge, 6 s cooldown.', 'Crates (Rare or higher)'],
    ['spear', 'Spear', 60, 0.8, 3.6, 1.05, 'Throw it once per life for 100 damage, then pick it back up.', 'Crates'],
    ['dragon_tooth', 'Dragon Tooth', 45, 0.6, 2.4, 1.08, '+15 burn over 3 s. Swings leave a short fire trail.', 'Crates (Epic or Legendary only)'],
    ['hammer', 'Hammer', 100, 1.2, 2.2, 1.05, 'One-hit kill. Slam the ground to launch yourself.', 'Crates'],
    ['brass_knuckles', 'Brass Knuckles', 35, 0.25, 1.6, 1.18, 'Every 3rd punch knocks the target back.', 'Crates'],
    ['nunchucks', 'Nunchucks', 30, 0.3, 2.2, 1.12, 'Hold to spin and hit everyone around you.', 'Crates'],
    ['daggers', 'Daggers', 40, 0.35, 1.8, 1.16, 'Throw one for 50 damage. It comes back after 8 s.', 'Crates'],
    ['home_key', 'Home Key', 25, 0.3, 1.6, 1.2, 'Opens secret doors. Kills show "You got locked out".', 'Hidden room on a parkour map'],
    ['toothpick', 'Toothpick', 15, 0.15, 1.4, 1.25, 'The fastest weapon in the game. Kills show "Picked clean".', 'Win a match using only melee'],
  ] as const).map(([id, name, dmg, swing, reach, speed, special, unlock]): WeaponDef => ({
    id, name, slot: 'melee', role: 'Melee', delivery: 'melee',
    damage: { body: dmg, head: dmg }, rpm: Math.round(60 / swing), mag: 0, reloadSec: 0,
    moveSpeed: speed, zoom: 0, reach, special, unlock,
  })),
];

export const WEAPON_BY_ID: Record<string, WeaponDef> = Object.fromEntries(WEAPONS.map((w) => [w.id, w]));

export function weaponsInSlot(slot: Slot): WeaponDef[] {
  return WEAPONS.filter((w) => w.slot === slot);
}

/**
 * Fastest time to kill a 100 HP player with body shots that all land, in seconds.
 * Ignores reloads (the magazines are big enough for one kill in every case).
 */
export function bodyTtk(w: WeaponDef, hp = 100): number {
  const perShot = w.damage.body * (w.pellets ?? 1);
  const hits = Math.ceil(hp / perShot);
  if (w.burst) {
    const bursts = Math.ceil(hits / w.burst);
    return (bursts - 1) * (60 / w.rpm);
  }
  return (hits - 1) * (60 / w.rpm);
}

// ---------------- Rarities ----------------

export type RarityId =
  | 'basic' | 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'uncontrollable' | 'hot' | 'lifelong';

export interface RarityDef {
  id: RarityId;
  name: string;
  /** Display colour for UI. */
  color: string;
  odds: string;
  changes: string;
}

export const RARITIES: RarityDef[] = [
  { id: 'basic', name: 'Basic', color: '#e8e8e8', odds: 'Free', changes: 'Plain default skin' },
  { id: 'common', name: 'Common', color: '#9aa0a6', odds: '50%', changes: 'Simple painted skin' },
  { id: 'uncommon', name: 'Uncommon', color: '#3ddc84', odds: '28%', changes: 'Patterned skin' },
  { id: 'rare', name: 'Rare', color: '#3d8bff', odds: '13%', changes: 'Detailed skin + coloured tracers' },
  { id: 'epic', name: 'Epic', color: '#b14dff', odds: '6%', changes: 'Glowing skin + Epic variant mechanic' },
  { id: 'legendary', name: 'Legendary', color: '#ffc531', odds: '2.5%', changes: 'Animated skin + Legendary signature mechanic' },
  { id: 'uncontrollable', name: 'Uncontrollable', color: '#ff4fd8', odds: '0.5%', changes: 'Legendary mechanic + chaotic shifting visuals' },
  { id: 'hot', name: 'HOT', color: '#ff5a1f', odds: 'Seasonal', changes: 'Legendary mechanic + seasonal flame theme' },
  { id: 'lifelong', name: 'Lifelong', color: '#ffffff', odds: '3 ever', changes: 'Legendary mechanic + serial-numbered one-of-a-kind look' },
];

export const RARITY_BY_ID: Record<RarityId, RarityDef> = Object.fromEntries(RARITIES.map((r) => [r.id, r])) as Record<RarityId, RarityDef>;
