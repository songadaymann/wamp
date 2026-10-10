# F162 move tools, cross-room clipboard and stamps

Delivered 2026-10-09 in [PR #107](https://github.com/songadaymann/wamp/pull/107) (merge `856606ef`) and [PR #108](https://github.com/songadaymann/wamp/pull/108) (merge `30432e60`). Both are live on https://wamp.land through the Pages auto-build; strings from both are in the served chunks. Together with the single-object Move from [PR #101](https://github.com/songadaymann/wamp/pull/101), this completes F162. Frontend only.

## Behavior

- **Copy carries objects.**
  - Objects anchored in the copied area come along with their settings and custom sprite art. So do the custom room tiles that the copied tiles use.
  - Paste gives objects fresh instance IDs. Links between copied objects follow the copies; links to anything outside are dropped, with a status note.
  - Paste skips spots that are taken or outside the room. Custom tiles are reused when the target room has a match, otherwise added under the 128-tile limit.
  - A paste with objects or custom tiles is one Undo step.
- **Clipboard across rooms.**
  - The clipboard is saved in this browser (size-capped) and loaded when a room opens.
  - Copy in one room and paste in another, including between the room editor and the Expanded editor.
- **My Stamps.**
  - With Copy active, a panel (sidebar, top dock, shell and phone dock) offers Paste and Save stamp.
  - Up to 24 stamps, each named by its contents (for example "7×4 terrain · 5 tiles · 2 objects"), with delete. Choosing a stamp starts a paste.
- **Area move.**
  - With Move, drag across empty space to select an area. Drag inside the selection to move all three tile layers and the objects anchored there by whole tiles, with links kept, as one Undo step. Dragging an object still moves just that object.
  - Smart terrain is erased and recreated so neighbours re-solve.
  - The move is refused, with a reason in the status line, if the selection cuts a Smart structure (for example a WampOS Start Bar), if the destination is off the room, or if it lands on another object.
  - The preview is outline-only, and nothing changes until release.
  - Blur, resize and pans keep the selection. Escape or right click clears it, and so do Undo, a tool change or any other edit.
  - In the Expanded editor, selecting an area selects its room.

## Differences from the original plan

- Selection lives in the Move tool rather than a separate Select tool.
- Copy stays one layer plus objects; area move covers all layers.
- Stamps sit in the Copy panel rather than the Stuff/Deco panels. They live in this browser only and are not synced to the account.
- Spawn and goal markers do not move with an area.

## Evidence

- `npm run check` on Node 22:
  - PR #107: 414 files, 3,288 tests.
  - PR #108: 415 files, 3,301 tests, with lint, types and build.
- Unit tests cover:
  - Clipboard: object collection and re-linking, dropped links, skipped spots, custom-tile reuse, append and limit, clipboard and stamp storage limits and corrupt data.
  - Runtime area moves: all layers plus linked objects with undo/redo; forest smart ground; Start Bar split refusal and whole move; cyber concrete; out-of-room, conflict, no-op.
  - Gestures: marquee, move offset, clearing rules, blur/resize/hide keeping the selection, the Expanded room-switch race, and a middle-button pan.
- Headless Chromium on the local dev server (safety API, writes blocked, zero page errors):
  - **Clipboard (#107):** a copied plate-and-door stamp pastes wired, and one Undo restores. The clipboard reaches the Expanded editor. Phone panel buttons are 44 px.
  - **Desktop area move (#108), real mouse drags:**
    - A 7×5 selection moved +6/−5 carries terrain, background, foreground and both linked objects, with the link intact; a distant coin is untouched.
    - Nothing changes during the drag. One Undo restores everything, and Redo reapplies.
  - **Expanded editor:** a selection made in a room that wasn't selected selects that room and moves its tiles.
  - **Phone (390×844, CDP touch events):** select and drag up 6 moves the tiles and objects.

## Not covered

Physical phones and tablets were not used.
