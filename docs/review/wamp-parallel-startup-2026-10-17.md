# F015 — Parallel startup downloads

Source base: `f6290dc6fc7712af4121a6ab7853f3c3b95e6f4f` (delivered F090/PR233). Canonical branch: `codex/wamp-parallel-startup-2026-10-17`.

## Result

A small build plugin adds low-priority module-preload links for the actual game runtime and its static imports. The current build emits 12 hints. Vite's existing entry hints retain their normal priority; editor, modal and other dynamic imports stay lazy. Auxiliary HTML pages and development serving do not receive the new game hints. Module names come from the actual output graph, including content hashes and the configured base URL. A missing expected runtime fails the build instead of silently losing the optimization.

The coarse map bootstrap, execution gate, 750ms coarse wait, refinement wait and 1,400ms total ceiling are unchanged. Only downloading/compilation can overlap the map check; hints do not invoke the game early. The flag image preload stays: the original review's fact-check identified it as a boot asset. No redundant preconnect or Cloudflare Early Hints claim is added. Browser preload behavior is documented in [MDN's module-preload reference](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/rel/modulepreload).

## Verification

- Two actual Vite fixture builds verify relative and prefixed base URLs, the complete static graph, priority, reuse, lazy-editor exclusion and auxiliary-page isolation. Eleven existing startup-gate tests remain unchanged and pass.
- Full quality passes: 525 files / 3,848 tests, typecheck, lint, DOM contract, generated bindings, build and asset checks. Startup JavaScript is 638.8KB brotli across 15 files / 670KB budget.
- Fifteen native Chrome desktop/phone and WebKit phone cases pass startup plus actual jump input: normal, delayed, invalid config, stalled config and hints removed. Three additional valid unavailable-config cases pass, with no bootstrap error. All accepted cases have zero application errors or missing fixtures. Six unchanged-baseline cases retain the comparison.
- With the first map-config reply held for 500ms, baseline runtime requests begin at 714–781ms; candidate requests begin at 24–51ms. Runtime setup still follows the config reply and cover gate. Each hinted file is fetched once, then reused by import. A 2,200ms held reply still permits startup through the existing ceiling; removing the hints still permits startup and play. These are controlled observations, not an overall load-time promise.
- The coarse cover paints in the delayed cases and normal desktop/WebKit cases. The recorded initial phone manifest can mismatch the first viewport on both unchanged baseline and candidate; this existing fixture condition is retained, not hidden or treated as a new preload failure. No blanket map-speed claim is made.
- The installed develop-web-game client completes two real movement/jump iterations after the explicit room intro. Screenshots and text are inspected; no error files. The first default-URL capture showed Welcome rather than gameplay, so acceptance uses the explicit fixture room.
- A new delayed-config/request-reuse scenario passes in both mobile engines locally, with zero errors/misses, expanding hosted coverage from 58 to 60 cases. It waits for actual app readiness, rather than the generic smoke's initial 500ms pause.

Initial harness setup used a short keyboard press and a canvas corner covered by the HUD; final desktop checks focus the unobstructed canvas and hold the jump key until the actual upward movement. Synthetic neighbor reads are isolated instead of reaching the live API. An initial unavailable probe omitted required config fields; the valid unavailable follow-up uses the complete recorded config. Build tests resolve the temporary directory's real path so Vite emits document names correctly. These diagnostics remain in ignored `output/f015-2026-10-17/`.

## Delivery boundary

Source acceptance and final local quality are recorded before push. Exact-source and merged-main hosted checks, public-source scan, merge, guarded Pages-only release, live hash comparison and browser acceptance follow. The final PR description and ignored delivery receipt supersede this source-time pending note.

No Worker, D1, PartyKit, renderer, room-data or media changes. Browser API writes are intercepted; no real room publication, sign-in or destructive action is submitted. Preserve primary dirty files, the selected animation, closed overnight goal, paused cutoff heartbeat and all decision-gated work.
