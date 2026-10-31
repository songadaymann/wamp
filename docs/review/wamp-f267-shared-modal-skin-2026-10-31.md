# F267 — shared paper dialog defaults

The shared dialog base still used the retired dark appearance, requiring individual dialogs to repeat the cream skin. The paper panel, field aliases, title/kicker/meta/error typography and header action now have shared defaults. Dialog widths, scrolling, responsive structure and intentional visual variants stay with their owners.

Repeated exact action bodies are grouped in one sheet while preserving selector specificity. Room Insights and Room Templates lose their dark overrides; template cards use paper/ink tokens. Publish-checklist near-miss colors and the lazy bug reporter use the shared palette. All dialog buttons share disabled colors, with selected-choice inset frames preserved. Five history/Rush buttons use existing action variants instead of four color `!important` declarations; the cascade ceiling is reduced from six to two for that sheet.

The shared-style check rejects copied default skin declarations under dialog IDs, including the lazy reporter. A negative CLI probe confirms rejection; local layout and distinct visual overrides remain valid. Style ownership is documented.

## Verification

- Captured before/after computed styles and screenshots for 37 dialog shells at desktop and phone sizes (74 cases), including materialized deferred dialogs. All 35 shared panels resolve to cream. Reviewed screenshot galleries for all shared panels. This is isolated real markup/CSS, not production account data.
- Computed disabled-state checks cover 172 dialog buttons: common colors, no raised shadow on ordinary disabled controls, selected inset frames retained.
- Initial full check: all tests except one old source-file-location assertion passed. The assertion now checks the shared action sheet and its load order; all six selected/focus-state tests pass.
- Initial real-app Explore smoke passed the five layout scenarios but failed its final console check on blocked Vite HMR sockets. Repeat on the production build is pending; no assertion was weakened.
- Final full check, exact-head CI and guarded frontend release remain pending. F267 stays unticked until live verification.
