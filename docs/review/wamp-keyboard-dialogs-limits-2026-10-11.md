# F180, F115, F175, F051, F193, F204, and parts of F119, F064

| Item | PR | Merge | Delivery |
|---|---|---|---|
| F119 (part) developer and mouse-only wording | [#147](https://github.com/songadaymann/wamp/pull/147) | `be16bc94` | Pages |
| F180 names for fields and buttons; keyboard palette | [#146](https://github.com/songadaymann/wamp/pull/146) | `b983a6ba` | Pages |
| F115 paper skin for the last four dark dialogs | [#148](https://github.com/songadaymann/wamp/pull/148) | `007f3cf1` | Pages |
| F175 dialogs take, trap and return focus | [#149](https://github.com/songadaymann/wamp/pull/149) | `9b6eef20` | Pages (`main-hotgFUPS.js`) |
| F064 (part) goal, finish and mint tests | [#150](https://github.com/songadaymann/wamp/pull/150) | `53a0f103` | tests only |
| F051 JSON body size caps | [#151](https://github.com/songadaymann/wamp/pull/151) | `ae6444d7` | API Worker `174d2a23` |
| F193 deploy guards and rollback help | [#152](https://github.com/songadaymann/wamp/pull/152) | `06131cbc` | tooling |
| F204 rejected runs out of ratings and builder clears | [#153](https://github.com/songadaymann/wamp/pull/153) | `5bf9fc14` | API Worker `174d2a23` |

## Keyboards and screen readers (F180, F175, F119)
- Every form field and every "+"/"−" button now has a name a screen reader or voice control can use.
- Object palette tiles can be chosen with Tab and Enter or Space.
- Opening a dialog moves focus into it, Tab stays inside, and closing puts focus back where it was. The room goal intro's Start button is focused, so Enter starts.
- Enter on a button you tabbed to now presses it. It used to open chat.
- The Controls window shows touch controls first on phones and has lost a leftover developer note.

## Dialog look (F115)
Sign Text, Choose Avatar, Chat Moderation and the phone Warp sheet were the last dialogs in the old dark style. They now match the cream pixel-paper dialogs.

## Safety and ops (F051, F193, F204)
- Request bodies are size-capped, so a giant payload is refused before the server reads it all.
- `npm run deploy:prod` now:
  - refuses to deploy when a database migration hasn't been applied (`--migrate` applies it);
  - runs the full check first;
  - if something fails after the Worker is live, prints the exact command to roll it back.
- Runs the cheat check rejected no longer let a player rate a room or count toward a builder's clears.

## Evidence
`npm run check` on Node 22 passed for each PR. Tests that fail on the previous code: F204 `rejectedRuns.test.ts`; F051 `http.body.test.ts`. Browser checks:
- F175: before/after keyboard flow;
- F180: tile selection by keyboard;
- F115: screenshots of all four dialogs;
- F119: Controls order on desktop and phone.

Production: F051 413 on a 20 KB guest heartbeat; HTML and CSS markers for F119, F180 and F115; `data-autofocus` in the live bundle (F175).

## Left
- F119: friendly-error helper and empty-state buttons (product choices).
- F064: auth client extraction.
- F115: consolidating the dialog base style.
- F175: `inert`.
