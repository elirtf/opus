# Remote Viewing

This page explains how people **open Opus when they are not on the same Wi‑Fi** as the recorder — for example at home, on LTE, or at another office. The same ideas apply whether they use a **phone, tablet, or computer**.

**In one sentence:** give users **one normal web address** (like `https://cameras.yourcompany.com`), served over **HTTPS**, without leaving extra doors open on your network (SSH, raw camera ports, and so on) unless you mean to.

---

## What “good” looks like

1. Everyone bookmarks **one address** and logs in the same way as at the site.
2. The connection is **encrypted** (the padlock in the browser, or HTTPS).
3. You are **not** exposing admin tools or streaming ports to the whole internet by mistake.

The main Opus website, its login, and live video are meant to live on **the same site address** (nginx serves the pages, `/api`, and `/go2rtc/` together).

---

## Step 1: A stable name (DNS)

People need a **hostname** that always points to the right place.

- If your internet address **changes** (common at homes and small shops), use **dynamic DNS** so the name updates when the IP changes.
- Pick **one official URL** for the site and share that with users (bookmarks, home-screen shortcuts, and any app wrapper all use the same name).

---

## Step 2: Lock (HTTPS)

Browsers and app stores expect a **proper HTTPS certificate**, not a self-made one, for anything customers use daily.

- Free, automatic certificates are available from **Let’s Encrypt** (often via **Certbot**) or your hosting provider.
- **Self-signed** certificates are mainly for lab testing; phones will warn or refuse them for real users.

---

## Step 3: Pick how traffic reaches Opus

You only need **one** of these approaches for a given site.

### A — VPN (often easiest for small teams)

Examples: **Tailscale**, **ZeroTier**, **Netbird**.

- People install a small **VPN app** and join your network. Opus can stay on a **private** address; nothing extra must be “opened” on the router for the world to see.
- Good when you already trust a “private network” model and want fewer public entry points.

For operated appliances, this matches the idea of **preferring VPN / zero-trust** over exposing many ports.

### B — Secure tunnel (no inbound holes on the router)

Examples: **Cloudflare Tunnel** (`cloudflared`), **ngrok**, similar services.

- A small program on the Opus LAN connects **out** to the provider. Visitors use a public address the provider gives you; traffic is forwarded to your **local** Opus/nginx.
- Read the provider’s rules on **bandwidth**, **logging**, and **acceptable use** — video uses a lot of data.

### C — Traditional: port forward or cloud reverse proxy

- **Router:** forward **443** (HTTPS) to the machine running nginx for Opus, or
- **VPS:** a small cloud server terminates HTTPS and forwards to your site (sometimes over another VPN like WireGuard).

Use **strong passwords**, keep the server updated, and treat anything **internet-facing** seriously.

---

## Note for whoever configures the proxy (nginx / tunnel target)

Live video uses **WebSockets** through `/go2rtc/`. Any proxy in front of Opus must:

- Pass through **WebSocket** upgrade headers.
- Allow **long-lived** connections (streaming can run for minutes).

The project’s `nginx/nginx.conf` shows how the bundled nginx does this; copy the same idea if you add another layer in front.

---

## Advanced: different domains for UI vs API

The normal install keeps everything on **one address**, so you usually **do not** need this.

If you **split** the site and API across different host names, or use automation that cannot use browser cookies, set **`CORS_ORIGINS`** and use **Bearer tokens** (`POST /api/auth/token`). For how live video behaves on phones (including HLS), see [streaming-playback.md](streaming-playback.md).

---

## Checklist before you tell users “it works remotely”

- [ ] Open the viewer URL with **HTTPS** and no scary certificate warnings.
- [ ] **Log in** once; refresh the page — you should stay logged in (stick to **one** hostname for the site).
- [ ] **Live** video works on a **phone** (if it fails, see [streaming-playback.md](streaming-playback.md) — small screens often use HLS).
- [ ] **Recorded** playback works (same login, same site).
- [ ] Do not publish **go2rtc’s admin port** (1984) to the internet unless you deliberately want that; use nginx on **443** instead.

---

## Related docs

| Doc | Why open it |
|-----|-------------|
| [streaming-playback.md](streaming-playback.md) | How live and recorded video works in the browser (phones included). |
| [hosted-ops-outline.md](hosted-ops-outline.md) | Security and operations for shipped / rented boxes. |
| [mobile/README](../mobile/README.md) | Optional installable app that wraps the same Opus website. |
