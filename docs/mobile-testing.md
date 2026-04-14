# Mobile Development And Testing

This pass uses a clean main-based branch:

```bash
feature/mobile-pass-2026-04-13
```

## Fast Automated Smoke

Start a frontend that can reach a real API, then run the mobile smoke:

```bash
VITE_ROOM_API_BASE_URL="https://api.wamp.land" \
VITE_PARTYKIT_HOST="everybodys-platformer-presence.songadaymann.partykit.dev" \
npm run dev -- --host 127.0.0.1
```

```bash
MOBILE_SMOKE_URL="http://127.0.0.1:3000" npm run smoke:mobile
```

The smoke writes screenshots and JSON summaries under:

```bash
output/web-game/mobile-smoke/
```

It covers:

- phone portrait browse without the old rotate/install gate
- phone portrait deep-linked room play with touch controls and camera/player placement checks
- phone portrait deep-linked room Stop flow into the compact bottom HUD
- phone landscape browse HUD and shortcuts
- phone landscape first-visit welcome modal
- phone landscape play controls with D-pad and action-button touch state assertions
- phone landscape editor sheets and collapse behavior
- tablet landscape browse layout

## Local Phone On LAN

Use the Mac's Wi-Fi IP for a real phone or tablet on the same network:

```bash
LAN_IP="$(ipconfig getifaddr en0)"
```

For a local Worker-backed run:

```bash
npm run dev:api
npm run dev:presence
```

```bash
VITE_ROOM_API_BASE_URL="" \
VITE_PARTYKIT_HOST="${LAN_IP}:1999" \
npm run dev -- --host 0.0.0.0
```

Open this on the device:

```bash
http://${LAN_IP}:3000
```

For the portrait direct-play prototype, open a room coordinate directly:

```bash
http://${LAN_IP}:3000/?x=0&y=0
```

Use the actual Vite port if the local server is running somewhere else, for example `3232`.

If the phone cannot reach local PartyKit, use the deployed PartyKit host for frontend testing:

```bash
VITE_PARTYKIT_HOST="everybodys-platformer-presence.songadaymann.partykit.dev"
```

For magic-link auth on the phone, make sure the Worker `APP_BASE_URL` points at the phone URL or an HTTPS preview URL. A localhost `APP_BASE_URL` will send the phone back to the Mac-only loopback address.

## Real Device QA

Before merging a mobile UI pass, verify at least:

- iOS Safari in normal browser and home-screen launch
- Android Chrome in normal browser and installed/PWA launch
- portrait browse, landscape browse, play mode, editor sheets, chat, jump sheet, auth menu, leaderboard/explore modal
- keyboard-open behavior for inputs
- safe-area behavior on notched phones
