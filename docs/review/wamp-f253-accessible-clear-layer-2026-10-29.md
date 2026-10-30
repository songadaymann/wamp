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

Final check, durable suite and release results will be recorded after verification.
