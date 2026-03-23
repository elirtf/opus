# Certified cameras (v1 — minimal list)

Opus v1 targets **direct RTSP** from IP cameras. Commercial “it will work” commitments should reference **only** rows in this table until expanded.

| Vendor / model   | Firmware / notes     | RTSP notes                                      |
| ---------------- | -------------------- | ----------------------------------------------- |
| *(lab generic)*  | Any recent           | Use substream for live + main for record if split URLs |
| *(add next)*     | TBD                  | Document path and auth                          |

## Regression checklist (quick)

Before a release or customer rollout:

1. **Live:** open dashboard tiles for each certified variant; sub/main pairing works.
2. **Record:** enable continuous recording on one main stream; segments appear on disk and in Recordings UI.
3. **Playback:** scrub a segment from the previous day.
4. **Restart:** `docker compose restart` opus + recorder + go2rtc; streams recover without manual DB edits.

Full lab tracks: [nvr-replacement-lab.md](nvr-replacement-lab.md). Product boundaries: [PRODUCT_SCOPE_V1.md](PRODUCT_SCOPE_V1.md).
