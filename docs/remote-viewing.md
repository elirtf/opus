# Remote Viewing VPN

**Recommended path:** put Opus on a **private mesh VPN** (e.g. **Tailscale**, **Netbird**, **ZeroTier**). You do **not** open camera ports or Opus to the whole internet. Users install the same VPN app on their phone or laptop, join your network, then open Opus in the browser like they do at home.

---

## Checklist

1. **Pick a VPN product** and create an account / tailnet / network.
2. **Install the VPN on the Opus host** (the machine that runs Docker / nginx / Opus).
3. **Install the VPN on every phone, tablet, and PC** that should view cameras remotely.
4. **Join the same network** on each device (same account, same tailnet, or approved peers).
5. **Find how to reach Opus over the VPN:**
   - Use the **VPN IP** of the Opus host (often looks like `100.x.x.x`), **or**
   - Use a **hostname** your VPN gives you (e.g. MagicDNS name).
6. In the browser, open Opus using that address and the **same port you use on the LAN** (often `http://100.x.x.x` if nginx is on port 80, or add `:443` / `https://` if you use TLS on the server).
7. **Test on cellular:** turn off Wi‑Fi on your phone, confirm the VPN connects, then open the same Opus URL.

---

## HTTPS and certificates

- **Inside the VPN**, many teams use **`http://`** to the VPN IP or internal name first. Traffic is already encrypted **between devices** by the VPN tunnel.
- If you want a **browser padlock** anyway, set up **HTTPS on nginx** (e.g. Let’s Encrypt) or use your VPN’s **HTTPS feature** if it offers a certificate for a device name. Avoid **self-signed** certs for casual users; phones nag or block them.

---

## Nginx and live video

Opus expects **one front door** (nginx) for the website, `/api`, and `/go2rtc/`. Keep using that even over VPN.

Live video uses **WebSockets** on `/go2rtc/`. If you ever put another proxy in front, it must allow **WebSocket upgrades** and **long-lived** connections. See `nginx/nginx.conf` in the repo.

---

## If live view breaks (ICE / black screen)

**Configuration → Settings** → Streaming → **WebRTC ICE candidates** (one per line, each starts with `stun:` or `turn:` in go2rtc format).

Examples:

- `stun:stun.l.google.com:19302` — often helps on the public internet; over VPN you may still use it or rely on direct paths.
- `stun:8555` — works when the browser can reach go2rtc’s UDP on the Opus host (common on the same LAN; over VPN it depends on your layout).

After changes, **restart the go2rtc container**. On the camera page, try **MSE** or **HLS** if a mode fails.

---

## Without a VPN (optional, later)

If you **don’t** use a VPN, you typically need **one public HTTPS URL** and either an **outbound tunnel** (e.g. Cloudflare Tunnel) or **port forwarding** `443` to nginx. That exposes a public entry point — plan passwords, updates, and firewall carefully. **Do not** publish go2rtc’s admin port **1984** to the internet; use nginx on **443**.

---

## Quick checklist

- [ ] VPN running on Opus host and on the test phone.
- [ ] Same URL works on LAN and on phone **with VPN on** (cellular test).
- [ ] Login, live tiles, one camera, recordings (and events if you use them).
- [ ] Prefer binding go2rtc **1984** / **8554** to localhost on the server where possible; users still use nginx. See `compose.override.yml.example`.
