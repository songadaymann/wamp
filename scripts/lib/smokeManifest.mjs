// Every browser smoke and probe script under scripts/: what it covers and where it runs (F480).
// scripts/smoke_manifest.test.ts fails when a smoke or probe is missing from this list, so a new
// script gets a home here the day it lands, and the nightly workflow keeps it from going stale.
//
//   ci       .github/workflows/quality.yml runs it on every pull request (directly or through
//            scripts/mobile_smoke_ci.mjs).
//   nightly  .github/workflows/nightly-smokes.yml runs it through scripts/smoke_nightly.mjs, in
//            `group`, against a fresh local stack. Not a required PR check.
//   deploy   a deploy script runs it against the live site.
//   manual   a pass/fail check that needs something CI doesn't have; `why` says what.
//   devtool  a measuring or debugging tool, not a pass/fail check. Never scheduled.
//
// Nightly entries: `args` and `env` values may use {stack} (the local Worker serving the test-hook
// build and the API, http://127.0.0.1:8788), {viteDev} (a Vite dev server whose API is {stack}),
// {adminKey} (the stack's throwaway ADMIN_API_KEY) and {persistTo} (the stack's D1 directory).
// `server: 'vite-dev'` also starts the Vite dev server. `knownIssue.match` is text from a known
// product bug's failure: such a failure is reported but doesn't fail the night, and a pass is
// flagged so the note can be removed.

/** @type {readonly string[]} */
export const NIGHTLY_GROUPS = ['editor', 'editor-phone', 'editor-dock', 'editor-touch', 'play', 'play-panels', 'stack'];

const ci = (file, covers) => ({ file, covers, runs: 'ci' });
const devtool = (file, covers) => ({ file, covers, runs: 'devtool' });
const manual = (file, covers, why) => ({ file, covers, runs: 'manual', why });

/**
 * `name` tells apart two nightly runs of one file with different settings.
 * @typedef {{ file: string, name?: string, covers: string, runs: 'ci' | 'nightly' | 'deploy' | 'manual' | 'devtool',
 *   group?: string, args?: string[], env?: Record<string, string>, server?: 'stack' | 'vite-dev',
 *   timeoutMinutes?: number, knownIssue?: { match: string, note: string }, why?: string }} SmokeEntry
 */

/** @type {readonly SmokeEntry[]} */
export const SMOKES = [
  // Pull-request checks (quality.yml).
  ci('mobile_smoke.mjs', 'Phone and tablet layouts, touch controls and menus on Chromium and WebKit, against recorded API responses'),
  ci('smoke_assist.mjs', 'Assist mode speed and safe respawn in rooms and Expanded Rooms'),
  ci('smoke_auth_state.mjs', 'Sign-in and sign-out UI and the auth client event contract'),
  ci('smoke_chat_identity.mjs', 'Chat names and identity for guests and signed-in players'),
  ci('smoke_room_emotes.mjs', 'Native classroom/public emote isolation, moderation and keyboard/touch bubbles'),
  ci('smoke_collections.mjs', 'Collection pages, wallet gate loss and returning selections'),
  ci('smoke_collections_service.mjs', 'Builds the API Worker and records the collection data smoke_collections replays'),
  ci('smoke_dom_contract.mjs', 'Every DOM ID the client code and the smokes use exists in a page or is created by code'),
  ci('smoke_expanded_leaderboards.mjs', 'Expanded Room leaderboards and warps'),
  ci('smoke_gameplay_pause.mjs', 'Pausing Play from the menu, restart and resume'),
  ci('smoke_keyboard_bindings.mjs', 'Rebinding keyboard controls and replaying rooms with them'),
  ci('smoke_map_capture.mjs', 'Public map capture page and the capture ZIP'),
  ci('smoke_map_capture_service.mjs', 'Map screenshot Worker routes and admin-key checks'),
  ci('smoke_mint_network.mjs', 'Minted room page on each chain profile'),
  ci('smoke_mint_network_service.mjs', 'Mint prepare routes per chain and the disabled profile'),
  ci('smoke_room_artwork.mjs', 'Room artwork minting, wallet cost display and interrupted-approval recovery'),
  ci('smoke_room_ownership.mjs', 'Room ownership display and controls'),
  ci('smoke_room_protection.mjs', 'Protected rooms and their discovery listings'),
  ci('smoke_room_protection_service.mjs', 'Builds the API Worker and records room protection metadata'),
  ci('smoke_wallet_auth.mjs', 'Wallet sign-in against the real API Worker bundle'),
  ci('smoke_wallet_auth_service.mjs', 'Wallet challenge and verify routes, origin checks'),
  ci('worker_safety_probes.ts', 'API Worker CORS, auth and write-safety rules'),

  // Nightly: editor (desktop editor flows on the synthetic preview-smoke rooms).
  { file: 'smoke_police_enemies.mjs', covers: 'Police palette, inspector, hunter and patrol behaviour in Play', runs: 'nightly', group: 'editor', args: ['{stack}/'] },
  { file: 'smoke_boygame_tileset.mjs', covers: 'Boygame tileset and objects, dark-room lights, animations, heart pickup', runs: 'nightly', group: 'editor', args: ['{stack}/'] },
  { file: 'smoke_jungle_vines.mjs', covers: 'Jungle tileset and background, decoration groups, climbing vines', runs: 'nightly', group: 'editor', args: ['{stack}/'] },
  { file: 'smoke_community_sprites.mjs', covers: 'Community sprite catalog: lazy load, credit, search, Remix, Use, admin lock', runs: 'nightly', group: 'editor', env: { COMMUNITY_SPRITE_SMOKE_URL: '{stack}/?renderer=canvas' } },
  { file: 'smoke_wampos_window.mjs', covers: 'WampOS 95 window and Start Bar brushes: drags, undo/redo, copy/paste, reload', runs: 'nightly', group: 'editor', args: ['{stack}/'],
    knownIssue: { match: 'Picking a single-shape brush must select its only tool', note: 'Choosing WampOS 95 leaves no drawing tool selected (regressed in 39d0e071, PR #28)' } },
  { file: 'smoke_object_drag_fill.mjs', covers: 'Dragging and filling collectibles and decorations', runs: 'nightly', group: 'editor', args: ['{stack}/'] },
  { file: 'smoke_room_camera.mjs', covers: 'Whole-room camera setting, framing across rooms and respawn (desktop)', runs: 'nightly', group: 'editor', args: ['{stack}'] },
  { file: 'smoke_room_camera.mjs', name: 'smoke_room_camera.mjs (touch)', covers: 'The same camera checks with the phone Room Setup controls', runs: 'nightly', group: 'editor', args: ['{stack}'], env: { ROOM_CAMERA_SMOKE_TOUCH: '1' } },
  { file: 'smoke_editor_history.mjs', covers: 'Undo and Redo buttons, locks and per-cell history on four devices', runs: 'nightly', group: 'editor', args: ['{stack}'],
    knownIssue: { match: 'Undo and Redo must not be covered by other editor controls', note: 'At 1024x768 Back to World covers Undo and Redo' } },
  { file: 'smoke_draft_recovery.mjs', covers: 'Local draft recovery for rooms and Expanded Rooms on desktop and phone', runs: 'nightly', group: 'editor', server: 'vite-dev', env: { DRAFT_RECOVERY_SMOKE_URL: '{viteDev}' } },

  // Nightly: editor-phone (long phone editor and physics runs).
  { file: 'smoke_editor_phone_dock.mjs', covers: 'Phone editor dock: libraries, pickers, More menu, swipe and tap selection', runs: 'nightly', group: 'editor-phone', args: ['{stack}'], timeoutMinutes: 15 },
  { file: 'smoke_editor_phone_inspector.mjs', covers: 'Phone inspector for plates, chests, enemies and NPCs, and Undo across cells', runs: 'nightly', group: 'editor-phone', args: ['{stack}'], timeoutMinutes: 15 },
  { file: 'smoke_physics_cadence.mjs', covers: 'Physics gives the same result at 30 to 240 Hz for nine movement fixtures', runs: 'nightly', group: 'editor-phone', args: ['{stack}'], timeoutMinutes: 15 },

  // Nightly: editor-dock (the desktop editor suites; the dock smoke alone takes about 10 minutes).
  { file: 'smoke_editor_dock.mjs', covers: 'Desktop and tablet dock shell, drawers, markers, goals, room settings and layers; Expanded Room editor', runs: 'nightly', group: 'editor-dock', args: ['{stack}/'], timeoutMinutes: 25 },
  { file: 'smoke_smart_autotiling.mjs', covers: 'Auto-Tile and Cyber brushes: paint, persistence, undo, copy/paste, layers, edge cases, Expanded Rooms', runs: 'nightly', group: 'editor-dock', args: ['{stack}/'], timeoutMinutes: 15 },

  // Nightly: editor-touch. The touch smoke sets editor state through source modules, so it runs on Vite dev.
  { file: 'smoke_editor_touch.mjs', covers: 'Touch gesture ownership in both editors on tablet, phone and phone landscape', runs: 'nightly', group: 'editor-touch', server: 'vite-dev', args: ['{viteDev}'], timeoutMinutes: 30 },
  { file: 'smoke_custom_backgrounds.mjs', covers: 'Animated photo backgrounds: pick, fit, upload, reload and play on Chromium and WebKit', runs: 'nightly', group: 'editor-touch', env: { BASE: '{stack}' }, timeoutMinutes: 15 },

  // Nightly: play (first visit, Play and guest flows, with recorded rooms standing in for the world).
  // The recorded API responses (scripts/lib/smokeApiReplay.mjs) stand in for the live world.
  { file: 'smoke_first_visit.mjs', covers: 'First visit: a delayed boot shows only the goal intro, Welcome waits, dismissal survives reload', runs: 'nightly', group: 'play', args: ['{stack}'] },
  { file: 'smoke_first_play_controls.mjs', covers: 'Controls guide before first Play on six devices: shared, home, goal-less and Expanded Room', runs: 'nightly', group: 'play', args: ['{stack}'], env: { F104_RENDERER: 'canvas' }, timeoutMinutes: 20 },
  { file: 'smoke_welcome_destinations.mjs', covers: 'Welcome Explore, Play (First Steps) and Build on five devices', runs: 'nightly', group: 'play', args: ['{stack}'], timeoutMinutes: 15 },
  { file: 'smoke_discovery.mjs', covers: 'Explore sorts, filters and the Play All queue on five devices', runs: 'nightly', group: 'play', args: ['{stack}'], timeoutMinutes: 15 },
  { file: 'smoke_room_clear_feedback.mjs', covers: 'Clear sting, results modal, guest claim copy, and a replay celebrates once', runs: 'nightly', group: 'play', args: ['{stack}'] },
  { file: 'smoke_room_entry_keyboard.mjs', covers: 'Movement and jump after a mouse or Enter start; Restart versus Space focus', runs: 'nightly', group: 'play', args: ['{stack}'] },
  { file: 'smoke_room_entry_keyboard.mjs', name: 'smoke_room_entry_keyboard.mjs (webkit)', covers: 'The same keyboard checks in WebKit', runs: 'nightly', group: 'play', args: ['{stack}'], env: { ROOM_ENTRY_BROWSER: 'webkit' } },
  // Nightly: play-panels (returning guests, text/presentation and post-run panels).
  { file: 'smoke_returning_guest_panel.mjs', covers: 'A returning guest never gets the menu or focus stolen; save-clear reminder', runs: 'nightly', group: 'play-panels', args: ['{stack}'] },
  { file: 'smoke_readable_text.mjs', covers: 'Readable text and text size settings across seven profiles, editors and the eraser picker', runs: 'nightly', group: 'play-panels', args: ['{stack}'] },
  { file: 'smoke_guest_claim_modal.mjs', covers: 'Guest claim prompt waits out Play, then shows the run time; Save opens sign-in', runs: 'nightly', group: 'play-panels', args: ['{stack}/?previewSmoke=1'] },
  { file: 'smoke_progression_rating_modal.mjs', covers: 'Rating prompts wait out Play; a two-room batch and a single prompt', runs: 'nightly', group: 'play-panels', args: ['{stack}/?previewSmoke=1'],
    knownIssue: { match: 'Unexpected saved batch state', note: 'After Submit the batch never marks the room Rated (same on main); product bug or fixture gap not yet settled' } },
  { file: 'preview_smoke_readonly.mjs', covers: 'Read-only preview walk: boot, select a room, Play, Edit', runs: 'nightly', group: 'play-panels', args: ['--url', '{stack}'] },
  { file: 'smoke_wallet_email_link_modal.mjs', covers: 'A wallet-only account adds an email with the inline code panel', runs: 'nightly', group: 'play-panels', env: { WAMP_SMOKE_URL: '{stack}' } },
  { file: 'smoke_launch_admin_game_jams.mjs', covers: 'Launch admin Game Jams panel, Activity placement and contact details, no phone overflow', runs: 'nightly', group: 'play-panels', env: { WAMP_SMOKE_URL: '{stack}' } },

  // Nightly: stack (API flows against the real local Worker and D1).
  { file: 'smoke_worlds_pilot.ts', covers: 'Worlds: invites, membership, publication approval and freeze', runs: 'nightly', group: 'stack', args: ['{stack}'], env: { WORLDS_SMOKE_ADMIN_KEY: '{adminKey}' } },
  { file: 'smoke_activity_tabs.ts', covers: 'Activity page tabs with an isolated activity fixture', runs: 'nightly', group: 'stack', args: ['{stack}'] },
  { file: 'live_construction_play_smoke.ts', covers: 'Overworld preview streaming picks the live construction room', runs: 'nightly', group: 'stack' },
  { file: 'partykit_identity_token_probe.ts', covers: 'Presence identity and construction-preview tokens: signing, tampering, routes', runs: 'nightly', group: 'stack' },

  // Deploy.
  { file: 'smoke_prod.mjs', covers: 'Live site and API health after a deploy (read-only)', runs: 'deploy' },

  // Manual checks.
  manual('smoke_progression_api_flow.mjs', 'Course run, rating and XP through the API', 'Needs a published Expanded Room with id 5d16d080-7f72-43f8-99e2-d4e71f1b62d0 in the target database'),
  manual('smoke_builder_activity.mjs', 'Builder activity panel for a signed-in builder', 'Needs output/web-game/builder-activity/local-api-fixtures.json and local-auth.json from a hand-seeded local API'),
  manual('smoke_first_publish.mjs', 'First publish flow for new builders, including a failed publish', 'Needs output/web-game/first-publish/local-auth.json accounts from a hand-seeded local API'),
  manual('smoke_room_insights.mjs', 'Room insights and death maps for rooms and Expanded Rooms', 'Needs output/web-game/room-insights/local-auth.json and the F124 rooms from a hand-seeded local API'),
  manual('smoke_clear_sharing.mjs', 'Sharing a clear from the result modal and the world HUD', 'Needs room -11,-6 ("de ja vu") and Expanded Room f131-sharing-near in the local API on port 8788'),
  manual('smoke_post_run_reminders.mjs', 'Reminders after a run for guests and signed-in players', 'Needs room -11,-6 with a goal, and for the signed case an AUTH_FIXTURE account, in the local API on port 8788'),
  manual('smoke_guest_builder_claim_modal.mjs', 'Guest builder claim prompt while editing', 'Needs published rooms near the guest build site in the local API on port 8788'),
  manual('smoke_guest_draft_reminders.mjs', 'Guest draft reminders and recovery', 'Needs room -11,-6 with a goal in the local API on port 8788'),
  manual('remote_rollout_check.mjs', 'Wallet sign-in, claim, publish, runs, leaderboards and presence on a safety or local Worker',
    'A rollout tool for safety backends. On a fresh local stack (ROLL_OUT_ALLOW_MUTATIONS=1, ROLL_OUT_BASE_URL, ROLL_OUT_PERSIST_TO) sign-in, claim and publish pass, but its presence socket check times out, run finish returns 400 and cleanup trips the world-room provenance trigger'),
  manual('webgl_recovery_probe.mjs', 'The world-tile map comes back after the WebGL context is lost and restored',
    'Needs a frontend whose API serves an active world-tile map (production or safety data); an empty local stack has none'),
  manual('safety_ranked_run_spoof_probe.js', 'Ranked-run verifier rejects spoofed runs', 'Pasted into DevTools while signed in on a safety preview'),

  // Developer tools.
  devtool('api_performance_probe.mjs', 'Times API endpoints (production by default)'),
  devtool('overworld_tile_pyramid_probe.mjs', 'Measures world tile pyramid loading, caching and frame time'),
  devtool('overworld_zoom_perf_probe.mjs', 'Measures frame time while zooming the overworld'),
  devtool('world_tile_parity_probe.mjs', 'Compares rendered world tiles with the live map pixel by pixel'),
  devtool('runtime_performance_trace.mjs', 'Records phone runtime performance traces'),
  devtool('presence_load_test.mjs', 'Load-tests presence with many simulated players'),
];
