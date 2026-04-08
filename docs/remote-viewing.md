# Remote viewing

**v1.0 default:** tunnel + HTTPS

Everyone uses **one HTTPS URL**. UI, API, and `/go2rtc/` should share that host.

---

## DNS & HTTPS

- Stable hostname (DDNS if your public IP changes, or the name your tunnel gives you).
- Trusted certificate (Let’s Encrypt, provider, or tunnel — not self-signed for phones).

## Tunnel (v1.0)

Agent on the LAN dials **out**; public URL forwards to nginx. Check the provider allows **WebSockets** and long streams for `/go2rtc/`. Video is heavy — read their bandwidth / terms.

## Proxy / nginx

Anything in front of Opus must pass **WebSocket upgrades** and keep connections open. See `nginx/nginx.conf`.

## ICE (live stuck / “ICE failed”)

**Configuration → Settings** → Streaming → one ICE line per row, each `stun:` or `turn:` (go2rtc format). Examples: `stun:stun.l.google.com:19302`, `stun:8555` (LAN), or your **TURN** URL for strict mobile NAT. Restart **go2rtc** after save.

---

## Advanced (post-1.0)

**VPN** (Tailscale, ZeroTier, …): users run a VPN app; Opus stays private. **Port forward / VPS reverse proxy**: expose 443 to nginx. Strong passwords; don’t publish go2rtc **1984** to the world — use nginx.

**UI and API on different hosts:** set `CORS_ORIGINS`, use Bearer tokens (`POST /api/auth/token`). Rare.

---

## Quick checklist

- [ ] HTTPS, login, live, and playback on a **phone**.
- [ ] Prefer binding 1984/8554 to localhost on LAN (`compose.override.yml.example`); tune streaming in Settings, restart go2rtc.

---

**Goal:** One **HTTPS** URL for everyone (phones, tablets, PCs) when off the LAN.

**How:** Run an **outbound tunnel** from the Opus LAN (e.g. [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/) / `cloudflared`) so a provider hostname forwards to your **nginx** — not to go2rtc port 1984 on its own.

---

**Must have**

- Real TLS on the public URL (not self-signed for real users).
- **WebSockets** + long-lived connections work through to `/go2rtc/`.
- Same hostname for UI, `/api`, and `/go2rtc/`.

**Live fails on cellular?** **Configuration → Settings** → Streaming → ICE lines (`stun:` / `turn:`), restart go2rtc. On the camera page try **MSE** or **HLS**.

---

**Before you ship**

- [ ] HTTPS, no cert warnings; login survives refresh (same host).
- [ ] Live + recordings on a **phone** over **cellular**.
- [ ] [MOBILE_QA_v1.md](MOBILE_QA_v1.md) on a real device.
