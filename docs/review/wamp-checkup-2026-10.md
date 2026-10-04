# WAMP Checkup (October 2026)

A fact-checked review of the whole game, run on 2026-10-03 against production commit `7371df9a`. Eighteen specialist reviewers proposed 248 suggestions; a separate skeptical reviewer checked each one against the code (three reviewers for high-impact problems). 4 were dropped as wrong and 30 duplicates were merged, leaving **214 items**.

Interactive version (private to Jonathan): https://claude.ai/artifact/NvifrLw4proi3T2ZjFVC6X

**Progress: 30 of 214 done.**

## How to use this file

This is the master checklist. Humans and AI agents can both read and update it.

- Every item has an ID (`F001` to `F248`). The full write-up for each one (what is wrong, the technical detail, file:line evidence, and fact-check corrections) is in [wamp-checkup-2026-10-details.md](wamp-checkup-2026-10-details.md). Search that file for `### F052` and so on.
- The evidence line numbers are from commit `7371df9a`. The code moves fast, so re-read the current code before acting on an item.
- Work one item at a time, and let Jonathan check it before starting the next.
- When an item ships, change `- [ ]` to `- [x]`, append `— **done YYYY-MM-DD** (commit)` plus a one-line note of what was done and anything left open, and update the progress count above.
- If an item turns out to be wrong or not worth doing, leave it unticked and append `— **won't do:** reason`.
- Merged duplicates are listed under the item they were merged into ("also covers").

## Report card

| Area | Grade | Summary |
|---|---|---|
| Performance (runtime) | B- | Strong foundations (renders at screen size rather than retina, device-aware streaming, per-frame work budgets). Held back by no 60fps cap, fog and dark rooms redrawn from scratch every frame, the map tiles being switched off, and the guest recorder stalling phones. |
| Load time | C | All ~480 art files download before anyone can play. Android fetches them 6 at a time, a Google Fonts import blocks the first paint, and the PNGs are about 40% bigger than they need to be. |
| Backend | B- | Read models, edge caching and Server-Timing are excellent. But leaderboards and saves load a room's entire version history (1.2 s on the spawn room, 10 MB on the public room endpoint), and finishing a run makes dozens of database calls one after another. |
| Security | C | Details withheld from this public repo until the open items are fixed. |
| Code health | B | Unusually clean typing, a real CI gate and a test-first refactor program. Weak spots: 6,000-line files, an unchecked scene-to-UI bridge, no in-repo AGENTS.md, and no tests on goal runs, auth or minting. |
| Mobile | C | Portrait phone play is genuinely good. Tablets and sideways phones can't play at all, the phone editor is the old design with a stray tile on every pinch, and phone text is as small as 6–7px. |
| Visual design | B- | A distinctive retro identity, with an XP colour system and button feel to build on. Hurt by no clear main/danger buttons, four leftover dark dialogs, colours hand-typed more than 1,400 times, and blurry in-between pixel-font sizes. |
| Onboarding & retention | C | Guest-first play and shareable deep links are great. Undermining them: a 'Save Progress' that doesn't save, stacked pop-ups on shared links, an empty Featured tab, and builders who never hear about their players. |
| Game feel | B- | Excellent jump forgiveness and gravity zones. Physics changes with refresh rate, pits don't kill, deaths and clears land flat, and the airborne hitbox is half the sprite's height. |
| Level editor | B- | A fast edit-to-test loop and a polished desktop dock. Still missing: Undo/Redo buttons, starter templates, a move tool, and checks that stop unbeatable rooms from being published. The phone editor lags far behind. |
| Accessibility | C- | Dialog markup and text-field focus handling are good. There's no pause, menus can't be used from the keyboard, focus is never moved into pop-ups, red buttons fail contrast, and there's no remapping or readable-text option. |
| Trust & safety/ops | D+ | Details withheld from this public repo until the open items are fixed. |

## Top 10 priorities

1. **Close two dangerous back doors** ✅ (F040, F186). The server treats wamp.pages.dev as part of WAMP, but someone else controls that site, so a signed-in player who visits it could have their account quietly taken over. Separately, a test-only 'erase every user and room' tool is switched on in production, behind one shared password. Both are tiny config changes, and leaving them could be catastrophic.
2. **Stop builders losing work** ✅ (F052, F060, F058, F057). Shipped retry backoff/local backup, cross-room response guards, two-editor conflict choices, and expanded-room cell/setup recovery with lifecycle protection.
3. **Let tablets and sideways phones play** ✅ (F075, F077). Anyone on an iPad, or holding a phone sideways (the natural way to hold it for a platformer), presses Play and can't move. The installed Android app is even locked to that orientation. That shuts out a large share of players.
4. **Make classroom accounts actually safe** ✅ (F208, F190, F209, F211). Students are blocked from World Chat, but they can talk to strangers through in-room speech bubbles. The multiplayer server doesn't check sign-in or bans for those bubbles at all. Other public-posting paths are also open to students, and student passwords can be guessed with no lockout. Fix these before any more school pilots.
5. **Switch the fast world map back on, safely** ✅ (F003, F010). Compatible pre-rendered imagery is active again. Tile work stays within the current viewport and bounded metadata; strict production smoke, direct outage/recovery emails and blocking production release compatibility checks protect the restored map.
6. **Same jump on every screen, and cap phones at 60fps** (F138, F002). On 120/144Hz screens, quick-tap jumps come out lower, ice slides shorter, and jumps in gravity zones are about half as tall. Rooms get easier or harder depending on the device, and leaderboards aren't fair. A careful cap just above 60fps also cuts heat and battery drain on high-refresh phones.
7. **Make building on phones and tablets stop fighting you** ✅ (F079, F157, F161, F158). Pinch cancellation and touch shapes are delivered in both editors (PR #40), along with Undo/Redo (PR #39). The shared phone dock, persistent Test/Publish, scoped libraries and touch Spawn cancellation are delivered (PR #41). Phone object settings, Done and link Cancel are delivered in both editors (PR #42), including expanded character settings.
8. **Fix the first five minutes** (F093, F122, F126, F104). Shared links now show only the room-goal intro, with Welcome deferred until Stop (PR #43). Verified guest clears and drafts now carry into an account after sign-in (PR #44). Remaining: first-play control guidance and clearer Welcome destinations.
9. **Security/safety priority** (F198, F201, F199, F200, F026). Details withheld from this public repo until fixed.
10. **Security/safety priority** (F182, F184, F183). Details withheld from this public repo until fixed.

## Quick wins

- **Let Android download art 32 files at a time** (F014). Phaser's Android default is 6 parallel downloads, compared with 32 on iPhone and desktop. Changing one setting saves several seconds on a first visit.
- **Remove the Google Fonts blocker and shrink the art losslessly** (F120, F017). The Google Fonts import delays the first paint. The title font isn't preloaded, so it pops in late. Re-saving the PNGs with zero visual change makes them about 40% smaller.
- **Stop downloading an 8.3 MB GIF to show one background frame** (F094). Create real small image variants for custom backgrounds. Today the full original downloads for every visitor near that room.
- **Add one database index and one CORS header** (F027, F032). A missing index makes the database scan every room version on each finished run. A missing preflight-cache header adds an extra round trip to many requests. Each is a one-line fix.
- **Retire the session-long 7 MB legacy world feed fallback** (F030). Right now one network blip switches a player to the heavy old feed for the rest of their visit, re-downloading it every 8–15 seconds.
- **Only poll chat when it's open or visible** (F028). Every open tab asks for new chat messages every 3 seconds, even with chat closed. That's the biggest database load in a traffic spike, and it drains phone data and battery.
- **Stop the guest recorder from stalling phones** (F001). During a new player's first minutes, it freezes the game briefly once a second. Make it smaller and asynchronous, or skip it on phones.
- **Draw fog once and batch dark-room lights** (F004, F005). Today fog and dark rooms rebuild hundreds of shapes or make dozens of GPU passes every frame, which makes phones stutter in those rooms.
- **Block publishing unbeatable rooms** (F156). Don't allow publishing a Reach Exit room with no exit, a Checkpoint Sprint with no finish, or Defeat All with zero enemies (which also hands out free XP).
- **Fill the Featured tab today** (F125). Explore opens on an empty Featured tab. Hand-pick 20 great rooms, and work out difficulty from real clear and death rates instead of 1–2 votes.
- **Stop Escape from kicking you out of runs, and stop dropping quick taps** (F168, F085). Pressing Escape to close a menu also ends your run or PvP match. On phones, the double-tap guard swallows rapid taps, such as pressing Undo twice.
- **Let phone builders name their rooms** (F082). The title box is hidden on phones, which is a big reason so many rooms are 'Untitled Level'.
- **Security/safety quick win** (F185, F192). Details withheld from this public repo until fixed.
- **Give Expanded Room links proper previews** (F132). Shared links to the best levels show 'WAMP room -4,12' instead of the level's name and builder. The server already has that data.
- **Add a short AGENTS.md to the repo** (F061). Every AI session would start with the rules: which checks to run, don't use the stale checkout, how safety deploys and production deploys differ, and how scenes talk to the UI. That saves repeated mistakes.

## Big bets

- **First Steps: a curated starter run that teaches and hooks** (F126, F122, F096, F118, F133). Turn Welcome → Play into a 6–8 room journey ('Room 2 of 8 · Next') that runs through the De Ja Vu tutorial and then the best community rooms. Each new room gets a banner crediting its builder, and every clear gets a real in-play celebration. Guest progress carry-over is delivered (PR #44). Add a proud 'Your room is live!' screen, with a name field and share buttons, for a builder's first publish.
- **Tell builders people are playing their stuff** (F123, F124, F130). The best reason to come back and build is knowing someone played your room. Add: - an activity bell on your profile card ('7 players beat Lava Gauntlet, tkinter took your #1'); - per-room plays, clear rate and average deaths, and later a map of where players die; - a weekly digest email. The server already records most of this.
- **Safety big bet** (F128, F129, F135, F151, F216). Details withheld from this public repo until fixed.
- **Safety big bet** (F142, F207). Details withheld from this public repo until fixed.
- **Builder power tools** (F163, F159, F162, F166, F167). Make building easier at every step: - One-tap starter templates that match the neighbours' tileset. - A 'Clear Check' that confirms you beat your own room before publishing. - A Select/Move tool, a clipboard that works across rooms, and saved stamps. - Door arrows showing where the neighbouring rooms connect. - Later, a 'Describe a room → Sketch it' AI helper built on the existing agent API.
- **Deeper platforming vocabulary** (F141, F139, F143, F150, F155, F144). Give builders more to build with: - respawn checkpoints, so long courses aren't punishing; - pits that actually kill; - crumbling blocks, sideways springs and a double-jump feather; - optional hearts per room; - boss mode for the Sword Hunter; - a world-wide 'Lost Song' collectible hunt that sends explorers into every room.
- **Load only what a room needs** (F013, F019, F024). Download art on demand instead of all ~480 files at boot. Lazy-load the editor UI and the roughly 20 pop-up menus. Then lock the gains in with automatic size and load-time limits in CI, so a new art pack can't quietly double startup again.

## Suggested order

Go one item at a time, and check each on the live site and on a real phone before moving on.

1. **One-line fixes.** Remove wamp.pages.dev and localhost from the trusted origins (F040). Turn off the database-wipe endpoint in production (F186). Fix the Android app's orientation lock (F077). Raise Android download concurrency (F014). Add the CORS max-age header and the missing index (F032, F027). Each takes minutes, and each is easy to verify.
2. **Builders' work.** Fix the runaway autosave and add a local backup (F052). Then the cross-room save race (F060), then the two-editor overwrite (F058).
3. **The world map.** Re-render and re-enable the tiles together with the per-frame tile-scan fix (F003 + F010). Then add the careful ~60fps cap (F002) and the refresh-rate physics fix (F138), and test them on a 120Hz phone.
4. **Student safety.** Lock down room chat and school restrictions (F208, F190, F209, F211) before any new classroom pilots.
5. **Mobile building.** Fix the pinch stray-tile bug and add Undo/Redo buttons (F079, F157).
6. **Tablet and landscape controls.** Add these next (F075), since that's the biggest chunk of players who currently can't play.
7. **First visits.** Shared-link modal deferral and guest progress carry-over are delivered (F093, F122). Next: first-play control guidance and clearer Welcome destinations (F104, F126).
8. **Security and safety items.** Details withheld from this public repo until fixed (F182, F183, F185, F198, F201).
9. **Quick wins and big bets.** Mix in quick wins between bigger items whenever a palate cleanser helps. Then pick one big bet at a time, starting with 'First Steps' or the builder-feedback inbox, since those most directly turn visitors into returning builders.

## Checklist by area

### Performance: frame rate and smoothness

How smoothly the game runs once it's loaded, especially on phones. The foundations are good, but a few effects and missing caps waste a lot of phone power.

- [x] **F003** The pre-rendered world-map tile pyramid is switched off in production (asset hash mismatch since ~Sep 3) (also covers F016) · high impact · small effort — **done 2026-10-03** (`57b607c7`). Matching renderer rebuilt and active at 100%; 972 ready generations, pixel/object parity, public desktop/Android coverage, strict availability smoke, direct outage/recovery emails and blocking production compatibility gates.
- [ ] **F002** No 60 fps cap: 120 Hz phones run all game logic and rendering twice per physics step (also covers F081) · high impact · small effort
- [ ] **F001** Guest session recorder stalls the game once a second for new players (also covers F022) · medium impact · small effort
- [ ] **F004** Fog and rain rebuild hundreds of shapes from scratch every frame · medium impact · small effort
- [ ] **F005** Dark rooms redraw the darkness with two GPU passes per light, every frame · medium impact · small effort
- [ ] **F080** Portrait play draws the whole game behind the opaque controller panel, wasting ~35–40% of rendering · medium impact · small effort
- [ ] **F011** 'Battery Saver' and auto-reduced mode don't turn down any visual effects · medium impact · small effort
- [ ] **F008** Physics collision links grow with every room loaded, and are all rebuilt on room loads, bullet despawns and crate breaks · medium impact · medium effort
- [x] **F010** World-map tile code re-scans every tile it has ever seen, every frame, and never forgets any · medium impact · small effort — **done 2026-10-03** (`57b607c7`). Viewport candidates and retries use direct lookups; coverage/identity caching and bounded metadata eliminate history-wide frame scans while preserving timed transitions.
- [ ] **F012** Leftover per-frame garbage in the play loop · low impact · small effort
- [ ] **F006** Every moving body re-scans the tile map and allocates ~100 small objects per frame for special-tile checks · low impact · small effort

### Load time and downloads

How long new players wait before they can play, and how much data that costs. The biggest win is not downloading every art file before the first room.

- [ ] **F013** Startup downloads all 480 art files in the game before anyone can play (also covers F102) · high impact · medium effort
- [x] **F014** Android phones download game art only 6 files at a time · medium impact · small effort — **done 2026-10-03** (8a844ada). Android loader concurrency is 32; desktop/Android production Browse checks and live bundle parity pass.
- [ ] **F094** Custom backgrounds always download the full original file (one is an 8.3 MB animated GIF) · medium impact · small effort
- [ ] **F017** Game art PNGs are about twice as big as they need to be · medium impact · small effort
- [ ] **F018** World data isn't requested until every sprite has finished downloading · medium impact · small effort
- [ ] **F015** Game code doesn't start downloading until a map-preview check returns · medium impact · small effort
- [ ] **F120** A Google Fonts import delays the first paint, and the title font pops in late · medium impact · small effort
- [ ] **F024** Add automatic size and load-time limits so regressions get caught · medium impact · small effort
- [ ] **F021** Updated art can stay stale for returning players for up to a year · medium impact · small effort
- [ ] **F023** Music and sound files: smaller formats and faster loading (also covers F230) · medium impact · small effort
- [ ] **F019** Players download the level-editor UI and about 30 menus before the first frame · medium impact · medium effort
- [ ] **F025** Styles, hidden menus and fonts make the first paint heavier than needed · low impact · medium effort
- [ ] **F020** Use a slimmer Phaser build and turn off Phaser's unused sound system · low impact · small effort

### Backend speed, cost and reliability

The server side is well instrumented, but a few hot paths do far more database work than needed, and saves depend on a blockchain call. These fixes make leaderboards and saves faster and spikes cheaper.

- [ ] **F026** Leaderboards and run submissions load every saved version of a room; the spawn room takes 1.2 s (also covers F195) · high impact · medium effort
- [ ] **F030** A single network error switches a player to the old 7 MB world feed for the rest of the session · high impact · small effort
- [ ] **F029** Finishing a run makes about 30 database round trips in a row before the player sees a result · high impact · medium effort
- [ ] **F236** Every room save depends on a live Base RPC call, and an RPC hiccup blocks saving in every room · medium impact · small effort
- [x] **F027** Missing index on room_versions.published_by_user_id makes 15+ queries scan the whole table · medium impact · small effort — **done 2026-10-03** (8a844ada). Migration 0050 applied to production D1; publisher counts use the covering index.
- [ ] **F028** Global chat polls every 3 seconds in every open tab, even with the chat panel closed · medium impact · small effort
- [ ] **F031** Each signed-in request makes 3 database lookups to identify the player, and the Worker isn't placed near the database · medium impact · small effort
- [ ] **F033** Profiles still use the slow all-in-one endpoint (≈0.5–1.3 s, 80 KB, never cached), including on every signed-in page load · medium impact · small effort
- [ ] **F035** Builders' in-progress room previews are sent in full to every player in the area on every room change · medium impact · medium effort
- [ ] **F037** Everyone arrives in the same map area, which one multiplayer server handles alone, and each player opens two connections per area · medium impact · medium effort
- [ ] **F095** Each idle visitor holds 50 PartyKit websockets (25 presence + 25 chat), even in a background tab · medium impact · medium effort
- [ ] **F036** Signed-in players get no edge caching; every leaderboard, room summary and discovery read goes to the database · low impact · medium effort
- [x] **F032** No CORS preflight caching, so most game requests make an extra round trip · low impact · small effort — **done 2026-10-03** (8a844ada). Live API OPTIONS responses expose Max-Age 7200; credentialed CORS origin policy remains unchanged.
- [ ] **F039** Every non-GET API request also runs a world-tile queue check · low impact · small effort
- [ ] **F038** Guest replay screenshots are stored in the main database, and nothing else is ever cleaned up · low impact · medium effort

### Security

Open items in this area are withheld from this public repo until fixed.

- [x] **F040** API trusts wamp.pages.dev (a domain WAMP does not own), enabling cross-site account takeover · high impact · small effort — **done 2026-10-03** (715e7677). wamp.pages.dev removed from trusted hosts. Still open: localhost origins are trusted in production (kept on purpose for `dev:frontend:remote`).
- [x] **F186** The live production server has a 'delete the whole database' endpoint behind one shared password · medium impact · small effort — **done 2026-10-03** (715e7677). Snapshot reset/import routes now 404 unless ENABLE_SNAPSHOT_ADMIN=1 (safety env only). Still open: separate ADMIN_API_KEY per environment, timing-safe compare.
- [x] **F187** Chat @mentions and sign-in requests can burn the email budget, and then nobody can log in (also covers F043, F047) · medium impact · small effort — **done 2026-10-03** (1c4d942b, 59e096ca). Sign-in emails capped per network (150/h), per address on one network (10/day) and per inbox (20/h, plus-tags and Gmail dots merged); mention emails 1/h per sender-recipient, 10/day per recipient, confirmed addresses only. Still open: separate sending subdomain for notifications, opt-out toggle, room-comment email caps.
- [x] **F042** 6-digit email sign-in code: per-request throttle is global, allowing parallel brute force of a known code window · medium impact · small effort — **done 2026-10-03** (1c4d942b, 59e096ca). Wrong codes capped per network (100/h), per address on one network (10/day) and per address (30/day); atomic slots; newest two codes accepted; success clears the count.
- [x] **F041** Open redirect + OG spoofing on the public room-share page · medium impact · small effort — **done 2026-10-03** (1c4d942b). Share page ?url= honoured only for WAMP hosts; verified live.
- [x] **F034** Typing an email into sign-in creates an account and assigns a permanent WAMP founder number before the email is verified · medium impact · small effort — **done 2026-10-03** (1c4d942b, 59e096ca). Founder numbers assigned at email verification (best-effort, retried on UNIQUE). Still open: dashboard counts still include unverified accounts.
- [ ] **F243** Security, safety or anti-cheat item; details withheld from this public repo until it is fixed (see the private review page, or ask Claude to read it from the review artifact) · medium impact · small effort
- [ ] **F051** Security, safety or anti-cheat item; details withheld from this public repo until it is fixed (see the private review page, or ask Claude to read it from the review artifact) · low impact · small effort
- [ ] **F050** Security, safety or anti-cheat item; details withheld from this public repo until it is fixed (see the private review page, or ask Claude to read it from the review artifact) · low impact · small effort
- [ ] **F045** Security, safety or anti-cheat item; details withheld from this public repo until it is fixed (see the private review page, or ask Claude to read it from the review artifact) · low impact · small effort
- [ ] **F048** Security, safety or anti-cheat item; details withheld from this public repo until it is fixed (see the private review page, or ask Claude to read it from the review artifact) · low impact · small effort

### Bugs: lost work and broken moments

Defects players and builders can hit today, with the ones that lose a builder's work first.

- [x] **F052** A failed autosave retries every frame forever and keeps no local copy · high impact · small effort — **done 2026-10-03** (cfbcf8d8). Backoff 2s to 30s, stop on unfixable 4xx, local backup on failure, 30s save timeout, guarded localStorage.
- [x] **F060** A save that finishes after you switch rooms can point the editor back at the old room · medium impact · small effort — **done 2026-10-03** (64798043). Session generation counter drops results that finish after the editor switched rooms.
- [x] **F058** Two open editors (two tabs, or phone and laptop) silently overwrite each other · medium impact · medium effort — **done 2026-10-03** (0ae59b67). Editor sends ?baseUpdatedAt=; Worker returns 409 on conflict; Load Latest / Keep Mine choice.
- [x] **F057** Expanded-room edits stay in memory until Save, and neither editor warns before closing the tab · medium impact · medium effort — **done 2026-10-03** (8a844ada). Scoped expanded-room cell/setup backups and dirty recovery, conflict choices, lifecycle warnings/flushes, and in-flight save protection shipped; 16 local recovery scenarios and live editor-bundle parity pass.
- [ ] **F056** What leaving the editor does depends on a 600 ms autosave race · medium impact · small effort
- [ ] **F055** Quick restarts can wipe or swap the ranked-run verification trace, so record runs get rejected · medium impact · small effort
- [ ] **F054** Releasing the mouse over a panel or outside the window leaves strokes uncommitted and pans stuck · medium impact · small effort
- [ ] **F059** Holding Space or Alt while switching windows leaves editor and map stuck in pan mode · medium impact · small effort
- [ ] **F168** Pressing Escape to close a menu also throws you out of the room you're playing (and ends PvP matches) · medium impact · small effort
- [ ] **F063** Players see raw `{"error":"…"}` text: apiRequest never unwraps the server's JSON error · medium impact · small effort
- [ ] **F101** Boot breaks if the page starts hidden or zero-sized (embeds, background tabs) · low impact · small effort
- [ ] **F121** Phone 'More +' view: Room Rush and Expand Room labels sit in the top-left corner · low impact · small effort

### Mobile (play and build on phones and tablets)

Portrait phone play is good, but tablets and sideways phones can't play, and building on a phone still fights you. These items bring mobile up to the standing 'works everywhere' rule.

- [x] **F075** Tablets and landscape phones have no way to play: touch controls exist only in phone portrait (also covers F092) · high impact · medium effort — **done 2026-10-03** (a2ae8327, 14c8c5df). Corner overlay controls for landscape phones and tablets; phones held upright keep the console.
- [x] **F079** Phone/tablet editor: starting a pinch-zoom paints a stray tile (or flood-fills); shape tools need a hidden second tap (also covers F053, F160) · medium impact · medium effort — **done 2026-10-04** (`e572e9da`, PR #40): deferred taps, reversible brush/object previews, touch shape/copy/Curve and cross-cell pinch cancellation; 226 native scenarios and live guest draft/history proof pass.
- [x] **F077** Installed Android app is locked to landscape, the one orientation with no controls · medium impact · small effort — **done 2026-10-03** (a2ae8327). app.webmanifest orientation is now "any".
- [x] **F161** Phone editor still has the old layout: Spawn in Objects→Utility, Test/Publish behind "← World" (also covers F110) · high impact · medium effort
- [x] **F158** On phones, pressure plates, chests, Sword Hunters, police and NPCs can't be configured · high impact · medium effort — **done 2026-10-04** (`f877ebfd`). Shared pinned settings sheet, Done and visible link Cancel in both editors; six phone combinations/48 workflows, 152 touch regressions and actual live guest configuration verified.
- [ ] **F140** Touch: holding the stick slightly down in mid-air triggers a butt stomp (breaks drop-through and puzzle crates) (also covers F083) · medium impact · small effort
- [ ] **F109** Phone chrome uses 6–7px text and 20–30px tap targets (also covers F084, F103, F176) · medium impact · small effort
- [ ] **F076** Typing on a phone (chat, Say, sign-in email) zooms the page and flips the layout to 'landscape' · medium impact · small effort
- [ ] **F098** Phone portrait play shrinks rooms that use the 'fixed room camera' to a 17px-tall hero, and the screen shows the neighboring room · medium impact · small effort
- [ ] **F082** Phone builders can't name their room — the title box is hidden on phones · medium impact · small effort
- [ ] **F086** Full-screen phone modals and the menu are sized with 100vh, so iOS Safari's toolbar covers the bottom · medium impact · small effort
- [ ] **F085** Double-tap-zoom blocker swallows any second tap within 320ms (e.g., rapid Undo) · medium impact · small effort
- [ ] **F078** iPhone/iPad: sound-effect volume slider and mixing do nothing (HTMLAudio volume is read-only on iOS) · medium impact · medium effort
- [ ] **F148** No gamepad support and no instant-restart key (also covers F088, F178) · medium impact · small effort
- [ ] **F089** Mobile smoke uses Chrome only, isn't in CI, and enshrines the missing landscape controls · medium impact · medium effort — _Partly done (a2ae8327): landscape/tablet play scenarios now assert the controls work. Still Chrome-only and not in CI._
- [ ] **F090** Haptic feedback on Android for jump, hit, coin and goal · low impact · small effort
- [ ] **F091** mann.cool plays tracking and virtual-controller listener are missing (and the stock snippet wouldn't work with Phaser) · low impact · small effort

### Design and UI

WAMP's retro look is distinctive. These items make the main actions obvious, finish the visual cleanup, and make error messages say what to do next.

- [ ] **F108** Room card: 'Play Room' isn't the main button, and buttons that can't be used crowd it out · medium impact · medium effort
- [ ] **F119** Error and empty messages are dead ends, and a few were written for developers (also covers F107) · low impact · small effort
- [ ] **F115** Four dialogs still use the old dark theme · medium impact · small effort
- [ ] **F116** Stacked popups: one Esc closes everything, and the screen goes nearly black (also covers F073) · low impact · small effort
- [ ] **F118** Show the room name and builder when you run into a new room · medium impact · small effort
- [ ] **F112** Menus are grouped by history, not by what players need next · medium impact · medium effort
- [ ] **F114** No real primary/secondary/danger buttons: red means Build, Publish, Stop and Delete · medium impact · medium effort
- [ ] **F117** Pixel fonts are drawn at in-between sizes, so they look blurry · low impact · small effort
- [ ] **F113** One retro palette, defined five times and hard-coded 1,433 times · low impact · medium effort

### Onboarding, retention and community

What happens in a newcomer's first five minutes, and what brings players and builders back. These are the highest-leverage product moves for growth.

- [x] **F093** Shared room links stack the Welcome modal over the room-goal modal; the run timer ticks under it · high impact · small effort — **done 2026-10-04** (`ce144c6e`). Automatic Welcome waits for readiness and defers synchronously on Play without persisting dismissal. Native desktop/phone shared/home Start/timer/Stop/reload and modal traces pass on actual wamp.land; home onboarding remains intact.
- [x] **F122** Signing up throws away a guest's clears, even though the game says 'Save Progress' · high impact · medium effort — **done 2026-10-04** (`ef5a966b`). Server-verified guest clears carry into an account for 14 days with canonical XP awarded once, durable retries and all common auth refresh paths; legacy browser clears retain truthful Replay. Guest drafts resume across tabs with preserved edits and an explicit new location if their spot is taken. Full API/Pages release, actual tutorial clear → 20 XP and draft save/retry pass on wamp.land.
- [ ] **F126** Welcome 'Play' runs one room, 'Explore' just closes the window, and 'Build' drops you into an empty room (also covers F097) · medium impact · medium effort
- [ ] **F125** Explore's default 'Featured' tab has nothing featured, and 88% of rooms have no rating, so discovery is mostly noise · high impact · small effort
- [ ] **F096** Clearing a room feels flat: no in-play celebration, no 'Next room', and the XP reward only appears after you press Stop · medium impact · small effort
- [ ] **F104** New players never see the controls before the timer starts · medium impact · small effort
- [ ] **F123** Builders never find out that someone played, beat, rated, or took #1 on their room · high impact · medium effort
- [ ] **F124** Builders can't see how many people played their room, how many beat it, or where they died (also covers F164) · high impact · medium effort
- [ ] **F130** After-run rating prompts and sign-up prompts disappear unless the player goes back to the map · medium impact · small effort
- [ ] **F133** Publishing your first room ends with a line of status text: no celebration, no share prompt, no title prompt (also covers F105) · medium impact · small effort
- [ ] **F099** Returning guests get the sign-in panel popped open on every visit (full-screen on phone landscape) · medium impact · small effort
- [ ] **F100** Guest builders are interrupted by a sign-in modal after their first brush stroke · medium impact · small effort
- [ ] **F137** The 'You left a room unfinished' popup can interrupt a shared-link run and returns every visit · low impact · small effort
- [ ] **F131** Guests and Expanded Room players can't share a clear, and the map has no 'Share this room' button · medium impact · small effort
- [ ] **F132** Link previews for the best levels (Expanded Rooms) say 'WAMP room -4,12' with no title or builder · medium impact · small effort
- [ ] **F129** Add a daily 'Room of the Day' challenge that shows off community builders · high impact · medium effort
- [ ] **F128** Bring back jams as a weekly 'Build Prompt': July's jam produced 10x the community rooms of the months around it (also covers F217) · high impact · medium effort
- [ ] **F135** The global leaderboard is all-time only and dominated by staff; add a 'This Week' board · medium impact · small effort

### Gameplay and game feel

The movement has a great base. These items make it fair on every screen, make deaths and hits feel punchy, and give builders new toys.

- [ ] **F138** Jump height, ice and gravity zones change with screen refresh rate (120/144Hz vs 60Hz vs laggy 30fps) · high impact · small effort
  - Production implementation delivered in PR #38; controlled desktop/phone verification passes. Combined F002/F138 physical 120Hz phone acceptance remains open.
- [ ] **F139** Pits never kill: invisible floor under rooms, and falling into the room below abandons your timed run · high impact · medium effort
- [ ] **F141** Add respawn checkpoints: deaths in courses/expanded rooms send you back to the very first screen · high impact · medium effort
- [ ] **F147** Add hitstop, a short death beat, the unused death sound, and hold-to-bounce higher on stomps (also covers F111) · medium impact · small effort
- [ ] **F145** Player sprite is ~38px tall but the airborne hitbox is 14px: head sinks into ceilings, air slash hits at knee height · medium impact · medium effort
- [ ] **F153** Sword only checks hits on the button-press frame; 'damage' values actually control max hits and bullet radius · medium impact · small effort
- [ ] **F149** Retune jump forgiveness: coyote 80→110ms, cap landing buffer, shorter wall-jump lock, add corner correction · medium impact · medium effort
- [ ] **F146** Follow camera bobs with every jump and doesn't look ahead · medium impact · small effort
- [ ] **F154** 'Water Pool'/'Water Ripple' objects kill on touch, and their descriptions wrongly say swimming doesn't exist · low impact · small effort
- [ ] **F142** Idea: Ghost races against the #1 run and your personal best (also covers F136) · medium impact · medium effort
- [ ] **F143** Idea: Traversal object pack: crumbling blocks, sideways springs, double-jump feather · medium impact · medium effort
- [ ] **F150** Idea: Optional player hearts per room (and make the Heart pickup actually heal) · medium impact · medium effort
- [ ] **F155** Idea: Boss mode for the Sword Hunter and police: health bar, multiple hits, phase change · medium impact · medium effort
- [ ] **F144** Idea: World collectathon: one hidden 'Lost Song' per room, tracked across the whole world · medium impact · medium effort
- [ ] **F151** Idea: Weekly seeded Room Rush: everyone starts from the same room for 7 days · medium impact · medium effort
- [ ] **F152** Idea: Co-op pressure plates that count other live players · medium impact · medium effort

### Level editor

The desktop editor is fast and polished. The gaps are safety nets (Undo buttons, publish checks), getting started (templates), and moving things around.

- [x] **F157** No on-screen Undo/Redo in the desktop/tablet editor; iPad builders have no Undo at all · high impact · small effort
  Delivered in PR #39; desktop/tablet controls and pinned phone Undo/Redo pass local native touch checks in both editors and the live guest Build flow. Physical hardware testing is separate from these controlled browser checks.
- [ ] **F156** Rooms that can't be beaten (or are beaten instantly) can be published · medium impact · small effort
- [ ] **F163** Starter room templates (backlog G-001): build them as command scripts (also covers F106) · high impact · medium effort
- [ ] **F159** Add a "Clear Check" plus a Ready-to-Publish checklist (Mario Maker style) · high impact · medium effort
- [ ] **F162** No way to move things: add a Select/Move tool, a clipboard that works across rooms, and saved stamps · high impact · large effort
- [x] **F065** Expanded-room editor cannot configure NPC, police and Sword Hunter settings (duplicated inspector) · medium impact · medium effort — **done 2026-10-04** (`f877ebfd`). Shared actor view model and existing slice runtime setters replace no-op handlers; native field edits, snapshot/reselection, second-cell isolation and Undo/Redo verified. Fact-check excludes goal intro because expanded room goals are intentionally hidden.
- [ ] **F165** Undo history grows without limit and copies the whole terrain twice per stroke · medium impact · small effort
- [ ] **F166** Show neighbor openings at the room edges so the world actually connects · medium impact · small effort
- [ ] **F167** Use the existing agent API for an in-editor "Sketch my room" AI helper · medium impact · large effort

### Room music

The music system has a lovely, builder-friendly design. Playback and the editor need performance and polish fixes, especially on phones, and there are fun ideas for making music part of each room's identity.

- [ ] **F220** Music editor re-renders the whole song on every note edit and keeps every version in memory · high impact · small effort
- [ ] **F224** Room-to-room music transitions: mid-note starts, slow cross-tempo blends, and a 'ghost' room on fast crossings · medium impact · small effort
- [ ] **F221** Most room loops click at the seam, and open hi-hats pile up into hiss · medium impact · small effort
- [ ] **F223** Entering a room builds its music on the main thread, causing a frame hitch at the doorway · medium impact · medium effort
- [ ] **F225** Played room music is never freed; it is always stereo and still rendered when music volume is 0 · medium impact · small effort
- [ ] **F222** Arranged rooms depend on other people's phrases by live ID: deletes and edits break or change them, and loading takes 26-28 API calls · medium impact · medium effort
- [ ] **F229** Three audio engines run at once; music never pauses when the tab is hidden · medium impact · small effort
- [ ] **F226** Sequencer overlay redraws 24 text labels and deep-clones the song every frame · medium impact · small effort
- [ ] **F227** Phone sequencer cells are about 8-13 px, far too small to tap accurately · medium impact · medium effort
- [ ] **F231** No way to audition a library phrase before placing it, and no playhead in Arrange mode · medium impact · small effort
- [ ] **F228** Make neighboring rooms sound like one world: 'Match neighbors' plus muffled music bleed (G-007) · medium impact · medium effort
- [ ] **F232** Keep the four instruments as separate layers at playback: instant mixing and music that reacts to gameplay · medium impact · medium effort
- [ ] **F233** Seed and curate the phrase library with Jonathan's own phrases, plus sorting and filters · low impact · small effort
- [ ] **F234** Room music as identity: 'Now playing' credit, remix button and shareable loop · low impact · small effort
- [ ] **F235** Builders max out the slow end of the tempo range: add 4-bar patterns or a half-time switch · low impact · medium effort

### Room ownership, NFTs and wallets

The contract and server checks are carefully designed. The everyday experience around them has rough edges: buyers locked out, blank NFTs, lost confirmations, and smart wallets that can't sign in.

- [ ] **F241** After a sale or transfer, the new owner cannot reach the editor, and the seller keeps the credit · medium impact · small effort
- [ ] **F237** 4 of the 11 real NFTs have no metadata at all because minting skips the artwork step · medium impact · small effort
- [ ] **F239** A lost mint confirmation (phone backgrounded, tab closed, 3-minute timeout) leaves the room looking unminted, with no automatic recovery · medium impact · small effort
- [ ] **F238** Smart-account wallets (Google/email login in the wallet popup, Coinbase Smart Wallet) cannot sign in or mint · medium impact · small effort
- [ ] **F240** Mint errors are raw developer dumps, and the price is never shown before the wallet opens · medium impact · small effort
- [ ] **F247** Wallet linking has dead ends that can permanently block a builder from minting their own room · medium impact · small effort
- [ ] **F246** Make ownership visible and use one word for it: 'Collect' · medium impact · medium effort
- [ ] **F244** NFT artwork is an 80×44-pixel thumbnail with no link back to play the room · medium impact · small effort
- [ ] **F242** The game's record of NFT metadata disagrees with the chain, so owners are told to pay for artwork that is already on-chain · low impact · small effort
- [ ] **F245** Cheaper or free first mint: put the price in the signed approval · medium impact · large effort
- [ ] **F248** Sepolia defaults in code and stale docs could cause a wrong-network mint setup · low impact · small effort

### Leaderboard, XP and anti-cheat integrity

Open items in this area are withheld from this public repo until fixed.

- [ ] **F198** Security, safety or anti-cheat item; details withheld from this public repo until it is fixed (see the private review page, or ask Claude to read it from the review artifact) · high impact · medium effort
- [ ] **F201** Security, safety or anti-cheat item; details withheld from this public repo until it is fixed (see the private review page, or ask Claude to read it from the review artifact) · high impact · small effort
- [ ] **F199** Security, safety or anti-cheat item; details withheld from this public repo until it is fixed (see the private review page, or ask Claude to read it from the review artifact) · high impact · medium effort
- [ ] **F200** Security, safety or anti-cheat item; details withheld from this public repo until it is fixed (see the private review page, or ask Claude to read it from the review artifact) · medium impact · small effort
- [ ] **F202** Security, safety or anti-cheat item; details withheld from this public repo until it is fixed (see the private review page, or ask Claude to read it from the review artifact) · medium impact · small effort
- [ ] **F203** Security, safety or anti-cheat item; details withheld from this public repo until it is fixed (see the private review page, or ask Claude to read it from the review artifact) · medium impact · small effort
- [ ] **F206** Security, safety or anti-cheat item; details withheld from this public repo until it is fixed (see the private review page, or ask Claude to read it from the review artifact) · medium impact · small effort
- [ ] **F204** Security, safety or anti-cheat item; details withheld from this public repo until it is fixed (see the private review page, or ask Claude to read it from the review artifact) · low impact · small effort
- [ ] **F205** Security, safety or anti-cheat item; details withheld from this public repo until it is fixed (see the private review page, or ask Claude to read it from the review artifact) · low impact · medium effort
- [ ] **F207** Security, safety or anti-cheat item; details withheld from this public repo until it is fixed (see the private review page, or ask Claude to read it from the review artifact) · medium impact · medium effort

### School accounts, Worlds and Jams

Open items in this area are withheld from this public repo until fixed.

- [x] **F208** Students can chat with strangers, including anonymous guests, through in-room speech bubbles · high impact · small effort — **done 2026-10-03** (9ccb7167). Presence token carries a room-chat permission; the PartyKit server drops bubbles from classroom accounts and never delivers bubbles to them; PvP invites to/from classroom accounts are blocked.
- [x] **F209** School restrictions are opt-in per route, so many public-posting paths are still open to students · medium impact · small effort — **done 2026-10-03** (9ccb7167). Classroom accounts blocked from playlists, Wamp-O-Grams, display-name change, agents and API tokens. Still open: a deny-by-default gate for future routes; the community sprite catalog stays open on purpose (auto-sync).
- [x] **F211** Student login can be brute-forced, and accounts that were never logged into can be taken over · medium impact · small effort — **done 2026-10-03** (9ccb7167, 60f321be). Wrong passwords limited per student per network (8), per student (30) and per class network (200) per 15 min; teacher reset or a correct login clears it; dummy hash for unknown usernames; ~13M temporary passwords; common passwords refused; reset ends sessions.
- [x] **F210** Student accounts can link a personal email or crypto wallet and then mint paid NFTs · medium impact · small effort — **done 2026-10-03** (9ccb7167). Classroom accounts cannot add an email, link a wallet or mint; the menu hides both. Still open: audit query for accounts linked before this change.
- [x] **F219** Student logins last 30 days on shared school computers · medium impact · small effort — **done 2026-10-03** (9ccb7167). Student sessions last 10 hours; logout returns to the class login page.
- [ ] **F212** Security, safety or anti-cheat item; details withheld from this public repo until it is fixed (see the private review page, or ask Claude to read it from the review artifact) · high impact · medium effort
- [ ] **F213** Security, safety or anti-cheat item; details withheld from this public repo until it is fixed (see the private review page, or ask Claude to read it from the review artifact) · medium impact · small effort
- [ ] **F214** Security, safety or anti-cheat item; details withheld from this public repo until it is fixed (see the private review page, or ask Claude to read it from the review artifact) · medium impact · medium effort
- [ ] **F215** Security, safety or anti-cheat item; details withheld from this public repo until it is fixed (see the private review page, or ask Claude to read it from the review artifact) · medium impact · medium effort
- [ ] **F218** Security, safety or anti-cheat item; details withheld from this public repo until it is fixed (see the private review page, or ask Claude to read it from the review artifact) · medium impact · medium effort
- [ ] **F216** Security, safety or anti-cheat item; details withheld from this public repo until it is fixed (see the private review page, or ask Claude to read it from the review artifact) · low impact · small effort

### Accessibility

Dialog markup is good. Players who rely on the keyboard, need to pause, read small text, or get motion sick are still left out in basic ways.

- [ ] **F169** Game key capture blocks arrow keys and Space in menus, so volume sliders, radio choices and modal scrolling don't work from the keyboard · medium impact · small effort
- [ ] **F175** Modals never move, trap or restore keyboard focus (including the welcome and goal-intro popups) · medium impact · medium effort
- [ ] **F170** There's no pause: menus opened mid-run leave enemies, hazards and the timer running · medium impact · medium effort
- [ ] **F171** Phone UI text is 6–7px pixel font, and there's no readable-font or larger-text option · medium impact · medium effort
- [ ] **F174** The signature red buttons (Build, Publish, Mint, errors, chat badge) fail text contrast at about 3:1 · medium impact · small effort
- [ ] **F173** Reduced-motion is ignored except for scrolling comments; add a Comfort section (reduce motion and flashes, camera style) · low impact · small effort
- [ ] **F172** Add an Assist mode (slower game speed, safe respawn) that plays as practice so leaderboards stay clean · medium impact · medium effort
- [ ] **F177** Controls are hard-coded: no remapping, WASD breaks on AZERTY keyboards, and there's no Z/X layout · low impact · medium effort
- [ ] **F179** Checkpoint flags change only red to green, which colour-blind players can barely tell apart · low impact · small effort
- [ ] **F180** Unlabeled form fields, '+'/'−' buttons and div-based palette items · low impact · small effort

### Trust and safety, moderation and ops

Open items in this area are withheld from this public repo until fixed.

- [ ] **F182** Security, safety or anti-cheat item; details withheld from this public repo until it is fixed (see the private review page, or ask Claude to read it from the review artifact) · high impact · medium effort
- [ ] **F184** Security, safety or anti-cheat item; details withheld from this public repo until it is fixed (see the private review page, or ask Claude to read it from the review artifact) · high impact · medium effort
- [ ] **F183** Security, safety or anti-cheat item; details withheld from this public repo until it is fixed (see the private review page, or ask Claude to read it from the review artifact) · high impact · medium effort
- [ ] **F185** Security, safety or anti-cheat item; details withheld from this public repo until it is fixed (see the private review page, or ask Claude to read it from the review artifact) (also covers F071) · high impact · small effort
- [x] **F190** In-room chat bubbles skip sign-in and chat bans on the server (also covers F044) · medium impact · small effort — **done 2026-10-03** (9ccb7167). PartyKit refuses bubbles from guests and chat-banned players; guest names must be the generated "Guest abcd" form (verified live). Still open: no word filter on bubble text (see F191); a ban takes effect on the next connection.
- [ ] **F188** Security, safety or anti-cheat item; details withheld from this public repo until it is fixed (see the private review page, or ask Claude to read it from the review artifact) · medium impact · small effort
- [ ] **F191** Security, safety or anti-cheat item; details withheld from this public repo until it is fixed (see the private review page, or ask Claude to read it from the review artifact) · medium impact · small effort
- [ ] **F049** Security, safety or anti-cheat item; details withheld from this public repo until it is fixed (see the private review page, or ask Claude to read it from the review artifact) · medium impact · small effort
- [ ] **F189** Security, safety or anti-cheat item; details withheld from this public repo until it is fixed (see the private review page, or ask Claude to read it from the review artifact) · medium impact · medium effort
- [ ] **F192** Security, safety or anti-cheat item; details withheld from this public repo until it is fixed (see the private review page, or ask Claude to read it from the review artifact) · medium impact · small effort
- [ ] **F194** Security, safety or anti-cheat item; details withheld from this public repo until it is fixed (see the private review page, or ask Claude to read it from the review artifact) · medium impact · small effort
- [ ] **F193** Security, safety or anti-cheat item; details withheld from this public repo until it is fixed (see the private review page, or ask Claude to read it from the review artifact) · medium impact · small effort
- [ ] **F196** Security, safety or anti-cheat item; details withheld from this public repo until it is fixed (see the private review page, or ask Claude to read it from the review artifact) · medium impact · small effort
- [ ] **F134** Security, safety or anti-cheat item; details withheld from this public repo until it is fixed (see the private review page, or ask Claude to read it from the review artifact) · medium impact · small effort
- [ ] **F127** Security, safety or anti-cheat item; details withheld from this public repo until it is fixed (see the private review page, or ask Claude to read it from the review artifact) · medium impact · medium effort
- [ ] **F197** Security, safety or anti-cheat item; details withheld from this public repo until it is fixed (see the private review page, or ask Claude to read it from the review artifact) · low impact · small effort

### Code health (for AI agents)

The codebase is unusually clean for its size. These items make it safer and faster for AI agents to change without silently breaking buttons, goals or rendering.

- [ ] **F061** Add an in-repo AGENTS.md: the agent guide was deleted and the rules are scattered across 78 KB of logs · medium impact · small effort
- [ ] **F064** Core gameplay and money paths have zero unit tests: goal runs, the auth client, and room minting · medium impact · small effort
- [ ] **F062** Scene↔UI bridge is unchecked: 135 optional methods, an unchecked `as T` cast, and scenes never `implements` it · medium impact · medium effort
- [ ] **F068** Backdrop-camera bookkeeping is half migrated: every new sprite still has to be registered by hand (also covers F009) · medium impact · medium effort
- [ ] **F070** Adding a goal type touches ~30 files: make goal types a typed registry like live objects · medium impact · medium effort
- [ ] **F066** OverworldPlayScene's constructor is 1,392 lines of closure wiring, and the RuntimeContext built to fix it is used by no controller · medium impact · large effort
- [ ] **F072** Make the DOM contract automatic: 575 IDs are used from code but only 159 are checked · low impact · small effort
- [ ] **F067** Lint has exactly one rule: turn on the cheap ones that catch agent mistakes and add a file-size ratchet · low impact · small effort
- [ ] **F069** Global editorState and string events: 136 writes from 11 files with no change signal, plus orphaned events · low impact · medium effort
- [ ] **F074** CSS is growing by override: a 995-line skin with 100 !important rules and an unscaled z-index · low impact · medium effort

## Shipped alongside the review (not review items)

- 2026-10-02: Email sign-in code box inline in the sign-in menu (`5a79b35b`).
- 2026-10-03: Upright-phone camera frames the whole room above the console (`58f352f9`).
- 2026-10-03: Chat button moved into the bar below the game on desktop and mobile (`6a35722d`).
