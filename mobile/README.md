# Opus on the app stores (optional “wrapper” app)

This folder builds a **thin mobile app** that loads your real Opus website inside a full-screen browser view. **It does not replace the website** — it is the same login, same live view, and same recordings you get in Chrome or Safari.

---

## When you need it vs when you don’t

| Situation | What to use |
|-----------|-------------|
| You want a shortcut on the home screen | Often enough to use the **normal website** and tap **Add to Home Screen** (the web app manifest is in `frontend/public/manifest.webmanifest`). |
| You want **Google Play** / **Apple App Store** listings | Use this **Capacitor** project so the store sees a real native app that opens your HTTPS Opus URL. |

---

## What the user does

1. Open the app once.
2. Enter the **Opus address** your team gave them (must be **`https://…`** for typical store builds).
3. The app remembers that address and opens Opus like a normal browser tab, but full screen.

To **point the app at a different server**, use **Clear saved URL** on the first screen. If the app skipped that screen because it remembered a session, clear the app’s **data** in phone settings or reinstall.

---

## Developer setup

**Requirements**

- Node.js 20+
- **Xcode** (iOS) and/or **Android Studio** (Android)

**One-time install**

```bash
cd mobile
npm install
npx cap add ios
npx cap add android
npx cap sync
```

**Open the native projects**

```bash
npm run open:ios
npm run open:android
```

**Before submitting to stores:** set up **signing**, **icons**, and **privacy text** in Xcode / Android Studio. **iOS** expects HTTPS for production; **Android** is set to disallow plain HTTP by default (`cleartext: false` in `capacitor.config.json`). Relaxing that is only for lab use.

---

## Testing

Use the same checks as [docs/remote-viewing.md](../docs/remote-viewing.md): log in, open live tiles, open a single camera, and play a recording — all against the **real** HTTPS URL you will give customers.
