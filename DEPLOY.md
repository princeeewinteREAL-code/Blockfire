# Deploying Blockfire (free, no card)

The whole game runs in **one free Cloudflare Worker**:

| Address | What it is |
|---|---|
| `/` | The game page (static files from `client/dist`) |
| `/ws` | The online game server: every room is a Cloudflare **Durable Object** running matches at 60 ticks a second |
| `/health` | `{"ok":true,"rooms":…,"players":…,"protocol":…}` |

Durable Objects are on Cloudflare's free Workers plan, with no card needed. Rooms start in milliseconds (no "waking up" wait) and run on Cloudflare's servers close to the players.

## Set up (one time)

You already connected the GitHub repo to Cloudflare. That's all the setup needed.

1. Merge the pull request. Cloudflare rebuilds automatically, using the same settings as before:
   - Build command: `npm run build`
   - Deploy command: `npx wrangler deploy`
2. The first deploy creates the Durable Objects by itself (that's what `migrations` in `wrangler.jsonc` is for).
3. Open `https://<your-worker>.workers.dev/health`. You should see `{"ok":true,...}`.
4. Open the game, click **Play Online** → **Quick Play**.

If the deploy log complains about the Worker name, change `"name"` in `wrangler.jsonc` to the name shown in the Cloudflare dashboard.

Do **not** set `VITE_SERVER_URL`. The page finds the server on its own address automatically. If you added it earlier, delete it.

## Free-plan limits

- **Requests: 100,000 a day.** Incoming WebSocket messages count 20 to 1. The game sends inputs 30 times a second per player, so this is about **18 player-hours of play per day**, for example 4 friends playing for 4½ hours.
- **Compute: 13,000 GB-s a day.** That's about 29 hours of one room running, which is more than the request limit allows anyway.
- If a limit is used up, joining fails with an error until it resets at 00:00 UTC (08:00 Malaysia time). The free plan never sends a bill.
- Watch usage in the dashboard: Workers & Pages → blockfire → Metrics.

## Run it on your computer

```bash
npm run cf:dev        # builds the game, then runs page + server like Cloudflare does
```
Open http://localhost:8787. For quick work on the page, use `npm run dev` (http://localhost:5173) with `npm run server` in a second terminal.

## Other ways to host the server (optional)

The repo still has a plain Node.js server (`npm run server`), plus a `Dockerfile` and `deploy/` (Docker Compose + Caddy for HTTPS). Use these if the game ever outgrows the free Cloudflare limits and you get a VPS. Point the page at it by setting the Cloudflare build variable `VITE_SERVER_URL=wss://your-server-address`, or open the game with `?server=wss://your-server-address`.
