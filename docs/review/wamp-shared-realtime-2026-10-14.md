# F095 — shared realtime connections

Authorized next-item work after F035. Preserve guest, moderation and classroom chat permissions, PvP, construction previews, full reconnect baselines and the existing hidden-tab pause. Keep the primary dirty auth checkout untouched.

## Plan

1. Share presence transport with room chat; explicitly negotiate support and use the legacy chat connection only when an older server requires it. Reuse one token provider on the shared path.
2. Route identity/avatar refresh subscriptions through the existing startup gate. Cap realtime at a camera-centered 3×3 chunk window independently of terrain streaming; verify the local playing/editing chunk stays covered.
3. Test shared/legacy transport, room-scoped delivery, guest/moderation/classroom restrictions, rate limits, preview/PvP coexistence, auth refresh during startup, panning, disconnect/reconnect and hidden-tab return. Measure actual connections and token requests in native desktop/phone browsers.
4. Run full quality/mobile/hosted checks, merge and deploy matching PartyKit plus client/API from clean main. Verify actual custom-domain assets and production transport/gameplay before checking F095.

Starting source: main `720a1e4c`, master 141/215. Candidate branch `codex/wamp-shared-realtime-2026-10-14`. Implementation and verification pending.

## Initial evidence and close-handshake correction

The existing focused suites pass (22 tests), and ten new server/client/radius cases pass. Real desktop app startup negotiates nine shared connections with one token request; an auth refresh held behind the browse gate opens zero sockets before readiness. UI chat works in both directions against the real local PartyKit runtime.

The first reconnect audit found nine retired browser sockets stuck in CLOSING alongside the nine replacements. The pinned PartyKit 0.0.115 runtime forwards onClose without replying, and partykit.json uses compatibility date 2026-03-10. [Cloudflare documents that pre-April-7 close handlers must reciprocate Close frames](https://developers.cloudflare.com/workers/runtime-apis/websockets/#prior-behavior). The candidate now replies when readyState is CLOSING, without changing the compatibility date or upgrading the SDK. Native reruns and full gates remain pending.

Probe corrections: wait for game state after navigation; count the actual browser WebSocket states as well as automation events; allow later legitimate window adjustments instead of assuming exactly nine total startup socket-open attempts. Do not claim zero overall startup churn. The token-cache renewal scenario forces its cached deadline past while hidden, then verifies a single fresh request across all reconnecting shards.

## Native app validation

The previous client on clean main `cf78835a` holds 25 presence + 25 chat connections and issues two token requests in the same desktop fixture. It starts connecting before the held browse gate releases. The candidate settles at nine shared connections and one token request (82% fewer steady connections), with zero connections or token requests during the held auth-refresh/startup gate. Desktop Chrome/Metal, phone Chrome and phone WebKit all pass actual UI chat in both directions, camera-window panning without a token request, direct play startup, auth-to-guest refresh with one request and a blocked guest composer, simulated document visibility hidden for 31 seconds with zero fully open sockets, and return to nine connections. The probe forces the token-cache deadline past while hidden and verifies exactly one renewal request for all returning shards.

The native reruns confirm the close-handshake fix: retired sockets reach CLOSED rather than accumulating in CLOSING. Screenshots inspected and zero application errors. A further desktop case jumps 20 px after reconnect with unchanged deaths. Initial socket-open attempts vary with subsequent window adjustments (9–14); this is not a zero-startup-churn or FPS claim. Phone WebKit is not a physical iOS-device backgrounding test. Proofs are ignored `output/f095-shared-realtime-2026-10-14/native-probe.ts` and `/tmp/wamp-f095-2026-10-14/native/`.

Nineteen focused cases pass, including shared/legacy chat, signed permission restrictions, rate/room/play scope, full construction-preview upsert/removal, PvP invites, close handshakes, client-owned transport teardown, hidden subscriptions and startup gating. TypeScript passes. Owned local test servers have stopped; full quality/mobile and release remain pending, master 141/215.

## Full gates and preview setup

Full quality passes: 489 test files / 3,600 tests, lint, TypeScript, DOM/type contracts, build/bundle budgets and PNG/tree/audio checks. Startup is 642.8 KB brotli against the 670 KB cap. Mobile CI's first run, concurrent with the standard software-rendered gameplay probe, failed one initial portrait-camera framing assertion; the other 12 cases passed. Unchanged clean main then passed all 13 cases, and the same candidate build passed all 13 on an isolated rerun, with zero console/page errors and zero fixture misses (425 responses served). No camera behavior or test assertions were changed. Hosted mobile validation must also pass.

The first standard-client preview used a bare local build with a relative API address and no running API; its 500 errors and empty world are a setup failure. Pages dev also does not supply this project's production API address automatically. An isolated preview build now sets VITE_ROOM_API_BASE_URL explicitly to production, without changing source or any local environment file. Standard-client output must be checked after that setup correction.

Realtime is a 3×3 camera-centered neighborhood in browse and a 3×3 neighborhood around the active room in play/edit, independent of the wider terrain cache. Live badges/previews beyond that capped neighborhood are not subscribed; terrain loading is unchanged. A global/lobby relay and far-map realtime coverage remain separate work. No new media, SDK upgrade, compatibility-date or secret changes are included.
