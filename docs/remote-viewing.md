# Remote viewing (self-hosted Opus)

This guide covers how **viewers** (and admins) reach Opus **from outside the local network**: TLS, DNS, tunnels/VPN, and mobile-related hints. The web UI and API are designed for **one HTTPS origin** (nginx serves the SPA, `/api`, and `/go2rtc/` together).

## Goals

1. Users open **one URL** (for example `https://nvr.home.example`) in a browser or in a **WebView app** (see [mobile/README](../mobile/README.md)).
2. Traffic is **encrypted** end-to-end to your edge.
3. Prefer **no** raw exposure of SSH, Flask, or go2rtc ports to the open internet.

## TLS (HTTPS)

- Terminate TLS at **nginx**, a **reverse proxy on a VPS**, or a **tunnel** provider that offers HTTPS (see below).
- Use **real certificates**: [Let’s Encrypt](https://letsencrypt.org/) (e.g. [Certbot](https://certbot.eff.org/)), or certificates from your hosting/tunnel vendor.
- **Self-signed** certs work for lab-only use; browsers and the iOS App Store review flow will warn or block unless you install a custom CA (usually not viable for customers).

## DNS and dynamic IP (DDNS)

If the site has a **residential or dynamic** public IP:

- Use a **dynamic DNS** hostname (many routers or a small agent update `A`/`AAAA` records when the IP changes).
- Point that hostname at your **reverse proxy** or tunnel endpoint—not necessarily directly at the Opus host if you use a tunnel.

Document the **canonical viewer URL** for each deployment (for example `https://nvr.customer.example`) so bookmarks, PWAs, and the mobile shell can use a stable name.

## Patterns that work well

### 1. Mesh / overlay VPN (often the simplest for “family/small business”)

Examples: **Tailscale**, **ZeroTier**, **Netbird**.

- Users install the VPN client; Opus stays on a **private** IP or MagicDNS name.
- No port forwarding; policy and ACLs live in the mesh product.
- Aligns with [hosted-ops-outline.md](hosted-ops-outline.md) (prefer VPN or zero-trust over exposing admin ports).

### 2. Inbound tunnel with HTTPS (no open inbound ports on site)

Examples: **Cloudflare Tunnel** (`cloudflared`), **ngrok**, similar products.

- A small agent on the Opus LAN connects **outbound** to the vendor; viewers hit a public hostname the vendor maps to your tunnel.
- Configure the public hostname to forward to your **local nginx** (or whatever serves Opus on port 80/443).
- Review vendor **terms**, **bandwidth limits**, and **logging** if you use this for video-heavy viewing.

### 3. Traditional reverse proxy + port forward

- A **VPS** or cloud VM runs nginx/Caddy with TLS and proxies to the customer’s Opus (via another VPN link, WireGuard, or a static tunnel).
- Or the customer’s router **forwards 443** to an internal nginx that serves Opus.

Use ** strong authentication** (`SECRET_KEY`, strong user passwords) and keep the host patched when it is internet-facing.

## nginx and WebSockets

Live streaming uses **go2rtc** proxied under `/go2rtc/` with **WebSocket upgrades** (see [nginx.conf](../nginx/nginx.conf)). Any **external** reverse proxy must:

- Forward `Upgrade` and `Connection` headers for WebSocket paths.
- Support **long timeouts** for streaming (the bundled config uses multi-minute read/send timeouts on `/go2rtc/`).

## CORS and API tokens (advanced)

The default install uses **cookie sessions** on the **same origin** as the UI—no CORS configuration needed.

If you split the UI and API across different origins, or use automation/clients that cannot use cookies, set **`CORS_ORIGINS`** in the environment (comma-separated list) and use **Bearer tokens** (see `POST /api/auth/token` in the API). Details: [docs/streaming-playback.md](streaming-playback.md) (HLS for mobile) and backend auth code.

## Checklist before asking users to view remotely

- [ ] HTTPS works on the viewer URL without certificate errors.
- [ ] Login works; session persists (same-site cookies—avoid serving the UI under many unrelated hostnames).
- [ ] **Live** view works on a **phone** (if not, try **HLS**—the UI prefers HLS on coarse-pointer/touch-first devices; see streaming doc).
- [ ] **Recorded** playback works (MP4 paths go through `/api/`—same TLS and cookies).
- [ ] **go2rtc** health: open `/go2rtc/` only through nginx, not by exposing port 1984 publicly unless you intend to.

## Related documentation

| Doc | Topic |
|-----|--------|
| [streaming-playback.md](streaming-playback.md) | MSE, WebRTC, HLS, Safari/mobile notes |
| [hosted-ops-outline.md](hosted-ops-outline.md) | Security posture for appliances |
| [mobile/README](../mobile/README.md) | Optional Capacitor shell (store-ready path) |
