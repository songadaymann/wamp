# F076 and F086 iPhone text fields and full-screen panels

Delivered 2026-10-10 in [PR #127](https://github.com/songadaymann/wamp/pull/127), merge `ece9bfe3`, live through the Pages auto-build (loader `main-3dx8K_vq.js`, CSS `main-CxZGqfr2.css`).

## Behavior

- **Text fields:** on touch devices every text field, textarea and select is at least 16px, so iOS Safari no longer zooms the page when one is focused. This covers chat, room chat, world jump, sign-in email and display name, and the room title.
- **Orientation:** follows the layout viewport. With the keyboard open, a portrait phone stays in the portrait layout; before, the play controls hid and the room HUD expanded and stayed open.
- **Full-screen panels:** full-screen phone modals, the phone menu and modal max-heights use the visible screen height (`min(100dvh, app viewport)`) instead of iOS Safari's toolbar-hidden `100vh`. Phone modals centre with `safe` alignment so overflow stays reachable.

## Evidence

- `npm run check` on Node 22: 429 files, 3,362 tests. New `deviceLayout.test.ts` case (portrait phone with half the screen under the keyboard stays portrait) fails on the previous code.
- iPhone 13 emulation (local dev server):
  - the five text fields compute to 16px;
  - layout stays phone/portrait;
  - `--visible-vh` resolves to `min(100dvh, 664px)`;
  - a phone modal panel's max-height is 640px;
  - the chat panel with 16px input text lays out cleanly.
- Live CSS: 28 `--visible-vh` uses and the 16px field rule.

## Left

- Lifting bottom-anchored inputs (world chat, room chat) above the keyboard with a `--keyboard-inset`.
- A real-iPhone check: no zoom on focus, panels clear of the toolbar, layout while typing.
