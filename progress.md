Original prompt: Implement the approved WAMP Editor Dock Redesign plan in a clean current-main worktree, verify it in the browser, push the branch, and publish a frontend-only safety Pages preview.

## 2026-09-04 — Editor dock redesign

- Created `codex/editor-dock-redesign-2026-09-04` from verified `origin/main` at `fee5804d818e2d2c23302fb349e0e49ab474bcca` in the planned sibling worktree.
- Confirmed the dirty/stale root checkout remains untouched.
- Architecture decision: add a narrow desktop/tablet editor-shell controller and reuse the existing editor buttons, palette controller, Smart registry, feature panels, resize event, and scene commands.
- Scope guard: the new shell is active only for standard room editing; phone and expanded-room shells remain on their current paths.

### TODO

- Implemented the standard desktop/tablet shell with the full-width stage, seven-tool upper-left cluster, room title and autosave status, five-action upper-right cluster, six-item dock, resizable contextual drawer, and mutually exclusive Markers/Share popovers. The phone and expanded-room activation paths remain unchanged.
- Reused the existing palette, Smart registry, editing commands, feature panels, background cards, environment controls, Music/Sprite workbenches, mint/history/Wamp-O-Gram handlers, autosave, test, and publish paths. No room schema, API, D1, Worker, PartyKit, or saved-level changes were made.
- Added stateful Terrain, Stuff, Characters, Hazards, Deco, Goal, and Room workspaces. Beginner terrain uses renderer-backed visual theme/brush previews; Advanced retains Auto-Tile/Tilesets, manual selection, flips, layers, and every editing tool. Object membership is separated without changing catalog order or search/filter behavior.
- Added one-shot spawn placement with successful-placement and Escape restoration, explicit Escape precedence for goal/shape/clipboard work, the B/E/C/F/R/O/L shortcut map with 1/2/3 and G compatibility, typing guards, focus return, and selected-versus-expanded accessibility state.
- Added focused reducer/category/shortcut tests, expanded the DOM contract, adapted the existing Smart smoke to the new shell, and added `smoke:editor-dock` browser coverage for the agreed 1920×1080, 1440×900, 1024×768, and phone viewports.
- Validation: `npm run check` passed 224 test files / 1,622 tests plus ESLint, TypeScript, generated bindings, and the production build; `npm run smoke:dom-contract` passed 764 IDs / 161 required IDs; the dock browser smoke passed all target viewports with zero console/page errors; the official Canvas client produced a visually inspected healthy Browse frame and coherent game state.
- Baseline note: the legacy Smart smoke reaches its deep Cyber structure checks without application errors, then both this branch and untouched `origin/main` produce the same existing exact-value failure (`1050239 !== 1647`). No solver assertion or terrain logic was weakened for this UI branch.
- Remaining delivery: commit, push, deploy and verify the frontend-only safety Pages preview, then record its URL here and in `feature-ledger.md`.
