# F112: browse navigation and the account menu

Jonathan asked to continue after delivered F148. Branch `codex/wamp-navigation-2026-10-16` starts at main `6c57a03c`.

## Result

- Room cards keep selected-room Play/Edit/Expand, sharing, comments and the room leaderboard. Explore, Worlds and global Leaderboards move into the browse footer. Both leaderboard destinations retain their own context.
- The phone browse footer uses two short rows with 44px targets, fitting 320px screens without clipping destinations. The Play footer hides global navigation, zoom/Fit and duplicate coordinate/status rows; existing phone Play footer hiding and touch controls stay intact.
- Guests see a sign-in reason and direct email/wallet forms. Signed-in users get Profile and My Rooms first, with email/wallet linking under a native disclosure. Same-account loading/refresh does not collapse a form mid-entry. Existing first-name prompts, managed-account restrictions and conditional guest recovery actions remain. Meaningful account messages reveal linking fields when appropriate; account errors remain visible outside the disclosure. The header stays visible while long menus scroll within the remaining viewport, including 320px editors.
- My Rooms explicitly opens the profile's Levels tab, including first lazy load, cached reopening and profile refresh. Profile keeps the existing personal Progress default. Only a valid current signed-in identity can use either new destination; logout clears routing.
- Settings, Controls, Guestbook, Room Rush and other game actions live in one menu on all devices. Settings/Controls binding belongs to global UI rather than the Overworld HUD, so it also works in the editor. Phone editors retain More → Account & menu. Destinations close the drawer before opening their own surface; account forms remain open while typing.
- About, bug reporting and Discord follow game actions; Admin appears only when an existing privileged/test-build action is visible, and Log out is last. Consolidated duplicate phone/menu and footer system controls, plus the obsolete tiny Play-mode bug-report button override.
- Uses existing square cream/cyan/green/red surfaces and the 8/12/16px menu type scale, without new eyebrow labels, cards or opacity treatments.

## Verification

- Full quality passes:521 files /3,832 tests, including 10 account-menu tests for guest/loading/current identity/logout, tab routing, form retention, managed accounts, sign-in status reveal and listener disposal. Final typecheck, lint, DOM contract and production build pass; screenshots are inspected.
- Six development browser layouts pass (desktop,390px/320px phones, landscape, tablet and desktop WebKit phone), plus guest and first-name-prompt flows. Three final production-build profiles pass discovery destinations, global-vs-room leaderboard context, lazy/cached/refreshed My Rooms, account linking, Guestbook, Settings, Controls, quiet Play and editor menus with zero application errors/fixture misses. Native macOS Chrome is muted; desktop WebKit is not physical iOS.
- Twelve targeted mobile cases pass across Chromium/WebKit: focused-room HUD, email keyboard, both phone orientations' target audits, the new navigation case and existing gamepad/R flows. New navigation coverage is in regular CI, which now runs26 cases per engine /52 total. Synthetic reads complete the profile and empty Guestbook/discovery responses; sockets/writes stay intercepted, and missing reads fail.
- Installed web-game client:two native Chrome movement/jump iterations pass; screenshot/text states inspected and no error files.
- Existing Editor Dock smoke initially stops at its stale eight-tool assertion on both candidate and unchanged main. Also reproduced its stale four-share-icon assertion on unchanged main, which already has two Share actions. Updated semantic tool/Share assertions for those existing controls, and Settings/Guestbook/Controls assertions to use the new editor menu. The complete Editor Dock smoke then passes with zero application/HTTP errors across its desktop, Expanded Room and phone flows, including detailed palette, marker, environment, Share and menu workflows. Synthetic owned-sprite reads stay empty; no production editor data is changed.

No sign-in emails, wallet actions, profile edits or public posts are submitted by the audits. No API Worker, D1, room data, renderer, PartyKit, palette or background changes. The primary dirty checkout, chosen animated asset and decision-gated work are preserved; the overnight goal remains closed.

## Delivery

Final exact-source and merged-main hosted gates, guarded Pages-only deployment, live navigation and actual-domain/immutable asset proof follow. The final pull-request receipt supersedes this source-time delivery note.
