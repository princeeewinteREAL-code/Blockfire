# Deploying Blockfire (free)

Blockfire has two parts:

| Part | What it is | Where it runs (free) |
|---|---|---|
| **Client** | The game page you open in a browser (`client/dist`) | Cloudflare Workers static assets (already set up via `wrangler.jsonc`) |
| **Server** | The online-multiplayer server (`server/`, WebSocket on port 8787) | Oracle Cloud *Always Free* Arm VM, behind Caddy for HTTPS |

Offline modes (Free For All vs bots, Parkour) only need the client. **Play Online** also needs the server.

---

## 1. Game server on Oracle Cloud Always Free

### 1a. Create the VM (one time, about 15 minutes)
1. Sign up at <https://www.oracle.com/cloud/free/>. Pick **Singapore** (`ap-singapore-1`) as the home region. It's closest to Malaysia, so ping is lowest. Oracle asks for a card to verify you; Always Free resources are never charged.
2. **Compute → Instances → Create instance**
   - Image: **Canonical Ubuntu 24.04**
   - Shape: **Ampere → VM.Standard.A1.Flex**, 1 OCPU, 6 GB RAM. That's plenty, and well inside the free 4 OCPU / 24 GB.
   - Networking: keep "Assign a public IPv4 address" on.
   - SSH keys: download the private key Oracle generates, or paste your own public key.
3. Note the instance's **public IP**.
4. Open ports 80 and 443. Go to **Networking → Virtual cloud networks → (your VCN) → Security Lists → Default** and **Add Ingress Rules**:
   - Source `0.0.0.0/0`, TCP, destination port `80`
   - Source `0.0.0.0/0`, TCP, destination port `443`

> If creation says *"Out of capacity for shape VM.Standard.A1.Flex"*, retry later or pick a different Availability Domain. This is common and goes away.

### 1b. Free domain name (DuckDNS)
1. Go to <https://www.duckdns.org>, sign in, and create a subdomain, e.g. `blockfire-parth`.
2. Set its IP to the VM's public IP and click **update ip**.
   You now have `blockfire-parth.duckdns.org`.

### 1c. Install and start the server
SSH in (`ssh -i your-key ubuntu@<public-ip>`), then:

```bash
# Ubuntu images on Oracle block web ports in iptables too — open them:
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo apt-get update && sudo apt-get install -y iptables-persistent git
sudo netfilter-persistent save

# Docker
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu && newgrp docker

# Blockfire
git clone https://github.com/princeeewinteREAL-code/Blockfire.git
cd Blockfire/deploy
DOMAIN=blockfire-parth.duckdns.org docker compose up -d --build
```

Check it: open `https://blockfire-parth.duckdns.org/health` in a browser. You should see
`{"ok":true,"rooms":0,"players":0,"protocol":1}`. Caddy gets the HTTPS certificate on its own, which takes about 30 seconds the first time.

To update the server after new code is merged:
```bash
cd ~/Blockfire && git pull && cd deploy && DOMAIN=blockfire-parth.duckdns.org docker compose up -d --build
```
Logs: `docker compose logs -f game`

---

## 2. Point the client at the server (Cloudflare)

In the Cloudflare dashboard → **Workers & Pages → blockfire → Settings → Build → Variables and secrets** (build variables), add:

| Name | Value |
|---|---|
| `VITE_SERVER_URL` | `wss://blockfire-parth.duckdns.org` |

Then **Deployments → Retry/redeploy** so the page is rebuilt with that address baked in.

Build settings stay as they are: build command `npm run build`, deploy command `npx wrangler deploy`.

---

## Testing without deploying

- Run everything locally: `npm run server` in one terminal, `npm run dev` in another, and open the page on `localhost`. It connects to `ws://localhost:8787` automatically.
- Point any copy of the page at a server with a query string: `...?server=wss://blockfire-parth.duckdns.org`.

## Free fallback with no card: host from your own PC
If you can't use Oracle, run `npm run server` on a PC, then `cloudflared tunnel --url http://localhost:8787` ([cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)). It prints an `https://…trycloudflare.com` address. Open the game with `?server=wss://<that-address>`. The address changes every time, and the server is only up while the PC is on, so this is for playing with friends, not for a permanent server.
