# F253 — accessible Clear Layer and retired editor UI

Clear Layer lives in the active Erase options on desktop and phone, alongside the
existing destructive actions. It uses the existing confirmed, undoable command.
The confirmation explicitly names the selected cell in an Expanded Room. Cancel
preserves the layer; clearing preserves other layers and other Expanded cells;
Undo restores the original tiles and smart terrain. Native Enter and Space
activation is isolated from editor play/pan shortcuts, with listeners cleaned up.

The dock remains the active editor layout. Removed 34 obsolete IDs and the old
sidebar tools, top rails, tool popovers, mobile actions and mobile navigation.
Removed their unused controller state, listeners, element lookups and CSS selectors.
Live feature panels, the phone Hide/Show button, collapse state/event, and music
and sprite controls remain. More → Fit room targets the live shared Fit control
after removal of its former mobile proxy target. Phone options scroll within the stage above the
library, keeping the tool row reachable in landscape and short viewports.

DOM smokes now assert the retired navigation is absent and use the live pressed
brush buttons. The dock smoke exercises native Enter to Cancel Clear Layer,
Space to confirm, and Undo. Existing camera and smart-autotiling smokes already
use live dock selectors. CSS warning ceilings decrease from 48 to 46; file-size
pins shrink without raising budgets. This cleanup principally reduces obsolete
markup and maintenance work, rather than claiming a large runtime improvement.

## Verification

Native workerd/D1 and real desktop/phone browsers exercise Cancel, all three tile
layers, clear and Undo in ordinary rooms and selected Expanded cells, preserving
the other cell and reporting zero page errors. Separate native keyboard checks
verify Enter/Space activate the confirmation and remain in the editor.

The first durable smoke fixture omitted local presence/Worlds configuration;
adding the real presence Durable Object and Worlds binding resolved its network
errors without changing product assertions. The phone suite identified the taller
Erase menu overlapping the tool row in landscape; its stage-height scroll bound
addresses that issue. These are local fixtures, with external email/network sends
disabled. No production room/player writes or live emails.

## Final delivery

PR349 tested a1c1a51d passed all20 checks in CI40975688728 and merged as
bbc82248. Exact-head full check passes738files/6238tests, one existing expected
failure/two skips, all remaining stages and668.8KB/670KB boot JavaScript.
Durable dock passes all five viewports with no page, console or HTTP errors,
including native Enter/Space Cancel/clear/Undo. Final portrait, landscape and
narrow phone scenarios pass for ordinary and Expanded editors (six scenarios,
zero page errors), including More Fit and unobstructed drawing options.
Screenshots inspected. All final local processes exited successfully.

Guarded Pages-only deployment from clean mainbbc82248 passes strict map assets,
build and production smoke. Pages8b269a01 serves entrymain-C6zlHlcy.js, and the
live entry, editor chunks, runtime, deferred review status and styles match the
release bytes. No API Worker deployment, schema migration, production room/player
writes or live email tests. Worker89464588 and mainDB0077 remain unchanged.

Evidence: /tmp/wamp-f253-check-release.log,
/tmp/wamp-f253-durable-dock-final.log, /tmp/wamp-f253-durable-phone-final.log,
/tmp/wamp-f253-keyboard-native-3.log, ignored output/f253-native/ and
output/web-game/phone-builder/, /tmp/wamp-f253-release.log,
/tmp/wamp-f253-live-assets.log and /tmp/wamp-f253-live-assets.json.
The subsequent documentation record may change Pages release metadata; final
frontend reconciliation is tracked in the private machine handoff.

