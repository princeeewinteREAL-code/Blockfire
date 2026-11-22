# Blockfire

A fast, blocky shooter you play in your browser: slide, strafe, bunny-hop and wall-jump through short matches, earn coins, and collect rare weapon skins.

**Status: Phase 3 — online multiplayer.** Play Online with up to 8 players per room (bots fill the empty spots): Quick Play, or create a private room and share its 6-letter code. Offline you can still play Free For All on Blocktown (big, Burg-sized) or Neon Yard (small) against bots (Easy, Normal, Hard or Insane), race the Training Grounds parkour course, and browse all 34 weapons in the holographic Armory.

## Play it on your computer

You need [Node.js](https://nodejs.org) 20 or newer.

```bash
npm install
npm run dev
```

Then open the address it prints (usually http://localhost:5173) and click **Play**.

For online play on your own computer, also run the game server in a second terminal:

```bash
npm run server   # builds and starts it on ws://localhost:8787
```

On `localhost` the game connects to it automatically.

## Controls

| Key | Action |
| --- | --- |
| W A S D | Move |
| Space | Jump. Hold it to bunny-hop (each hop builds a little speed) |
| W + A / W + D | Strafe sprint (faster than W alone) |
| Left Shift | Crouch / slide. Press it just before you land, then jump, to slide-hop (the fast way to move) |
| X | Walk silently |
| Left click | Shoot / swing |
| Right click | Aim down sights (scope on snipers) |
| R | Reload (in parkour: back to checkpoint) |
| Tab | Scoreboard |
| 1 / 2 / 3 | Primary / secondary / melee weapon (each sets your move speed) |
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
server/   The online game server: rooms, bots, 60 Hz authoritative matches (Phase 3)
deploy/   Docker Compose + Caddy files for hosting the server
```

The movement physics live in `shared/src/movement.ts`, and every tuning number is in `shared/src/movement-config.ts`. The server runs the exact same code to check every move, which is the main protection against cheating.

## Checks

```bash
npm run check   # typecheck + tests + production build
```

The match simulation (`shared/src/match.ts`) has no graphics in it: the browser runs it for you-vs-bots, and the server runs the same file for online matches. Online, your own movement is predicted instantly and corrected by the server; other players are shown 0.11 s in the past so they move smoothly.

The tests check combat (sniper one-shots, kill times, spawn protection, reloads, rocket-jumps, knife backstabs), run whole bot-vs-bot matches, and check the movement numbers from the design doc (6 m/s run, 1.2 m jump, 1.5x slide, 14 m/s cap, 3 wall-jumps…) and run a scripted player through the whole parkour course, so a map change can't make it impossible.

## Sounds

Every sound is an MP3 in `client/public/sounds/`, made by `python3 tools/make_sounds.py` (layered crack, body, thump, mechanics and echo). To use a real recording instead, replace the file with one of the same name, for example from the CC0 Free Firearm Sound Library on OpenGameArt.

## Deploying (free)

- **Game page → Cloudflare.** `wrangler.jsonc` points `npx wrangler deploy` at `client/dist`, so the Cloudflare build command is `npm run build` and the deploy command is `npx wrangler deploy`.
- **Game server → Oracle Cloud Always Free** with Docker and Caddy (automatic HTTPS). Then set `VITE_SERVER_URL` in Cloudflare so the page knows where the server is.

Step-by-step: [DEPLOY.md](DEPLOY.md).

## Design documents

- Game Design Document (modes, maps, economy, servers, roadmap)
- Weapons Design (all weapons, rarities, skin catalog)
