# Remote Viewing VPN

**Recommended path:** put Opus on a **private mesh VPN** (e.g. **Tailscale**, **Netbird**, **ZeroTier**). You do **not** open camera ports or Opus to the whole internet. Users install the same VPN app on their phone or laptop, join your network, then open Opus in the browser like they do at home.

---

## Checklist (Using Tailscale)

1. **Install the VPN on the Opus host**.
2. **Install the VPN on every phone, tablet, and PC** that should view cameras remotely.
3. **Join the same network** on each device (same account or same tailnet).
4. In the browser, open Opus using the VPN IP address or MagicDNS name (often `http://100.x.x.x` if nginx is on port 80, or add `:443` / `https://` if you use TLS on the server).
5.. **Test on cellular:** turn off Wi‑Fi on your phone, confirm the VPN connects, then open the same Opus URL.

---

## HTTPS and certificates

- **Inside the VPN**, many teams use **`http://`** to the VPN IP or internal name first. Traffic is already encrypted **between devices** by the VPN tunnel.
- If you want a **browser padlock** anyway, set up **HTTPS on nginx** (e.g. Let’s Encrypt) or use your VPN’s **HTTPS feature** if it offers a certificate for a device name. Avoid **self-signed** certs for casual users; phones nag or block them.

---

## If live view breaks (black screen)

Opus plays back live streams via **MSE** (desktop) and **HLS** (touch). There is no WebRTC / ICE / STUN layer, so remote viewing over a VPN behaves the same as LAN viewing.

If a tile is black:

- **Try the other mode.** On the camera page, switch **Mode** between **MSE** and **HLS**. If MSE fails but HLS works, the most likely cause is browser HEVC support — see [go2rtc/README-HEVC.md](../go2rtc/README-HEVC.md).
- **Check the sub stream.** The dashboard prefers `*-sub` for tiles. If the NVR sub stream is offline, the UI falls back to `*-main`, which may be HEVC.
- **Restart go2rtc** if you recently changed streams or transcoding in the Configuration page — go2rtc reloads `go2rtc.yaml` only at container start.

---

## Without a VPN (optional, later)

If you **don’t** use a VPN, you typically need **one public HTTPS URL** and either an **outbound tunnel** (e.g. Cloudflare Tunnel) or **port forwarding** `443` to nginx. That exposes a public entry point — plan passwords, updates, and firewall carefully. **Do not** publish go2rtc’s admin port **1984** to the internet; use nginx on **443**.

---

## Quick checklist

- [ ] VPN running on Opus host and on the test phone.
- [ ] Same URL works on LAN and on phone **with VPN on** (cellular test).
- [ ] Login, live tiles, one camera, recordings (and events if you use them).
- [ ] Prefer binding go2rtc **1984** / **8554** to localhost on the server where possible; users still use nginx. See `compose.override.yml.example`.
