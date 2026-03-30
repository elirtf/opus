# Opus Viewer (Capacitor shell)

Minimal **store-oriented** wrapper: users enter their **HTTPS Opus URL** once (saved in WebView storage on the bootstrap origin), then the app navigates to the real Opus site. The full React UI, cookies, PWA behavior, HLS, and `/go2rtc/` paths are identical to the desktop browser — same-origin to your recorder.

For many deployments, **Add to Home Screen** from the Opus web UI (see `frontend/public/manifest.webmanifest`) is enough; use this project when you need an App Store / Play listing.

## Prerequisites

- Node.js 20+ (for `npm` / `npx`)
- Xcode (iOS) and/or Android Studio (Android)

## One-time setup

```bash
cd mobile
npm install
npx cap add ios
npx cap add android
npx cap sync
```

## Open native projects

```bash
npm run open:ios
npm run open:android
```

## ATS, cleartext, and release

- **iOS:** Use **HTTPS** for Opus (required for typical App Store configs). For lab-only HTTP, edit the iOS target’s **App Transport Security** exceptions (not recommended for production).
- **Android:** `capacitor.config.json` sets `cleartext: false`. For HTTP lab devices, you must relax network security in the Android project (see Android docs).
- **Signing, icons, privacy strings:** Configure in Xcode / Android Studio before store submission.

## QA

Use the same checks as [docs/remote-viewing.md](../docs/remote-viewing.md): login, live tiles, single-camera view, and recordings playback against your HTTPS origin.

## Changing servers

On the bootstrap screen, use **Clear saved URL**. If the WebView opens Opus directly (restored session), clear app data or reinstall to return to the connector screen.
