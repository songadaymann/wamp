# F267 — shared paper dialog defaults

The shared dialog base still used the retired dark appearance, requiring individual dialogs to repeat the cream skin. The paper panel, field aliases, title/kicker/meta/error typography and header action now have shared defaults. Dialog widths, scrolling, responsive structure and intentional visual variants stay with their owners.

Repeated exact action bodies are grouped in one sheet while preserving selector specificity. Room Insights and Room Templates lose their dark overrides; template cards use paper/ink tokens. Publish-checklist near-miss colors and the lazy bug reporter use the shared palette. All dialog buttons share disabled colors, with selected-choice inset frames preserved. Five history/Rush buttons use existing action variants instead of four color `!important` declarations; the cascade ceiling is reduced from six to two for that sheet.

The shared-style check rejects copied default skin declarations under dialog IDs, including the lazy reporter. A negative CLI probe confirms rejection; local layout and distinct visual overrides remain valid. Style ownership is documented.

## Verification

- Captured before/after computed styles for 37 dialog shells at desktop and phone sizes (74 cases), including materialized deferred dialogs, with screenshots of the 35 shared panels. Baseline: `c8724388`. All 35 shared panels resolve to cream. Reviewed screenshot galleries for all shared panels. This is isolated real markup/CSS, not production account data.
- Computed disabled-state checks cover 172 dialog buttons: common colors, no raised shadow on ordinary disabled controls, selected inset frames retained.
- Initial full check: all tests except one old source-file-location assertion passed. The assertion now checks the shared action sheet and its load order; all six selected/focus-state tests pass.
- Initial real-app Explore smoke passed the five layout scenarios but failed its final console check on blocked Vite HMR sockets. Repeat on the production build is pending; no assertion was weakened.
- Final `npm run check` passes: 749 files, 6,300 passing tests, one expected failure and two skips; all stages pass. Boot is 662.7 KB brotli across 16 files (670 KB budget).
- Production-build Explore smoke passes desktop, phone, tablet, landscape and narrow phone (five scenarios, zero errors).
- Native desktop/phone synthetic editors show populated template cards, Escape dismissal, Insights focus and keyboard Close with zero page errors. These use an isolated local test-enabled Vite configuration with HMR off. The first attempt against the production build could not access intentionally disabled test helpers; it is not counted as a passing native editor test.
- [PR #359](https://github.com/songadaymann/wamp/pull/359), exact head `16a3ac0a6b89ed58849439b9275193851180a325`, passes all 20 checks (Quality 41224938606), merged as `2c1c36cb`.
- Guarded Pages-only rollout passes production smoke and map compatibility. Initial manual Pages `b837fcf7` was superseded by the completed same-source automatic build `dece8f82`; republishing the verified dist selected `ce87000c`. Live entry `main-QShJoWuG.js`, main/editor chunks and CSS match release bytes exactly; standalone production smoke passes.
- Live desktop/phone checks open and close Explore, Leaderboard, Settings, Controls, About and the lazy bug reporter (12 dialog cases), verifying cream panels and ink titles with zero page errors. API replay and blocked writes isolate the test; no production player/room/email/wallet transaction is created.
- No API Worker, renderer or schema deployment; production remains on 0079. F267 is delivered; Round 2 is 102/248.
