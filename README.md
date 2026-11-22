# Blockfire

A fast, blocky shooter you play in your browser: slide, strafe, bunny-hop and wall-jump through short matches, earn coins, and collect rare weapon skins.

**Status: Phase 2 — Free For All vs bots.** Play Free For All on Neon Yard against 7 bots (Easy, Normal, Hard or Insane), race the Training Grounds parkour course, and browse all 34 weapons in the holographic Armory. Online multiplayer arrives in Phase 3.

## Play it on your computer

You need [Node.js](https://nodejs.org) 20 or newer.

```bash
npm install
npm run dev
```

Then open the address it prints (usually http://localhost:5173) and click **Play**.

## Controls

| Key | Action |
| --- | --- |
| W A S D | Move |
| Space | Jump. Hold it to bunny-hop |
| C | Crouch. Press while running to slide |
| Left Shift | Walk silently |
| Left click | Shoot / swing |
| Right click | Aim down sights (scope on snipers) |
| R | Reload (in parkour: back to checkpoint) |
| Tab | Scoreboard |
| 1 / 2 / 3 | Primary / secondary / melee weapon (each sets your move speed) |
| R | Back to the last checkpoint |
| Esc | Pause |

Every key can be changed in **Settings**, along with graphics quality (Low, Medium, High, Ultra).

Wall-jumps work while a Snake weapon is in your hand: the default loadout's secondary (key 2) is the Snake Pistol.

## Graphics

Blocky shapes with realistic lighting: physically based materials (metal reflects, neon glows), sky reflections, bloom, soft shadows, ACES tone mapping and a ring of voxel mountains. Quality presets keep it smooth on older laptops.

## Project layout

```
shared/   Code used by both the game and the server: movement physics, combat rules, the match
          simulation, bots, weapons + rarities, map format, maps
client/   The game you play in the browser (Three.js + Vite)
server/   The online game server and API (Phase 3 and 4)
```

The movement physics live in `shared/src/movement.ts`, and every tuning number is in `shared/src/movement-config.ts`. The server will run the exact same code to check every move, which is the main protection against cheating.

## Checks

```bash
npm run check   # typecheck + tests + production build
```

The match simulation (`shared/src/match.ts`) has no graphics in it: the browser runs it today for you-vs-bots, and the Phase 3 server will run the same file for online matches.

The tests check combat (sniper one-shots, kill times, spawn protection, reloads, rocket-jumps, knife backstabs), run whole bot-vs-bot matches, and check the movement numbers from the design doc (6 m/s run, 1.2 m jump, 1.5x slide, 14 m/s cap, 3 wall-jumps…) and run a scripted player through the whole parkour course, so a map change can't make it impossible.

## Free hosting (Cloudflare Pages)

1. Sign in at [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** → **Create** → **Pages** → **Connect to Git** and pick this repository.
2. Build settings:
   - Build command: `npm run build`
   - Build output directory: `client/dist`
   - Environment variable: `NODE_VERSION` = `22`
3. Save. Every push to `main` now publishes the game at `https://<project-name>.pages.dev`, free.

## Design documents

- Game Design Document (modes, maps, economy, servers, roadmap)
- Weapons Design (all weapons, rarities, skin catalog)
