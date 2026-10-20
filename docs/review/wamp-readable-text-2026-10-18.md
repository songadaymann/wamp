# F171 — Readable text

Canonical branch: `codex/wamp-readable-text-2026-10-18`, based on delivered F170/PR245/main `044dedbd`.

## Behavior

Settings → Comfort adds Text style (Retro / Readable) and Text size (Normal / Large). Retro/Normal remains the default. Readable uses the existing local IBM Plex Mono font. Ordinary UI text uses optional 12/16/20px tiers, with a 16px small-text floor in Large. Existing sizes above20px remain unchanged to preserve branding, artwork and established large controls rather than redesigning the entire type scale.

Choices apply immediately and are stored locally for guests. Signed-in players use the existing account settings sync; the same shared normalization preserves them through the API's existing JSON settings storage. A fresh page applies local preferences in the entry module before the main runtime loads. Existing NPC names, frontier Build Here and Warp labels follow the preferences and release their listeners when destroyed; readable NPC labels retain antialiasing.

Phone portrait run controls gain separate goal and Stop/Restart rows. Phone editor actions use two rows when narrow, retain one row on wide landscape phones, and keep scrolling tool/category strips with complete labels. This changes text layout, without zooming the canvas, controls or safe areas. Music/sprite modes retain their dedicated full-screen layouts.

## Implementation

The size migration wraps562 existing declarations across56 CSS files in optional shared variables, retaining every original fallback. Resolving those variables and the two additional legacy font aliases produces byte-for-byte identical default styles. Core font roles remain in tokens.css, including their readable aliases. The shared-style checker ignores alias definitions when looking for literal font stacks; positive/negative probes still reject literal fonts, palette values and local role redefinitions.

The two controls use the existing Settings controller and GameSettings persistence. A small text-preferences collaborator owns DOM attributes, canvas styles and label lifetimes. The large scene is not expanded. There are no new polling intervals or network services.

## Verification

Local acceptance is complete; release is pending. Evidence is ignored under `output/f171-readable-text-2026-10-18/`.

- Full quality passes543 files /3,998 tests, types, generated bindings, DOM contracts, production build and asset checks. Final layout-only follow-ups are rebuilt and checked separately; startup remains642.6KB brotli under the670KB budget. The API Worker dry run also passes.
- Default CSS compatibility passes for all562 migrated declarations. Shared-style guard probes pass. Source scan reports0 blockers/0 warnings.
- Seven layout profiles pass in Chrome/WebKit: desktop,390px phone,320px narrow phone, landscape phone, tablet, Safari phone and Safari landscape. The frozen production build passes all seven, with zero browser errors or missing fixtures. These are browser/emulation checks; physical iOS remains a separate manual check.
- Phone, landscape and Safari-phone editor checks pass for both ordinary and Expanded Room editors, including category clicks, readable-font checks and tool-label fitting. Wide landscape phones retain one action row. Desktop, landscape and Safari-landscape interaction checks additionally verify Advanced/Tiles eraser options through actual size clicks, escape from toolbar clipping, and full action bounds; desktop category labels also fit.
- Signed settings are saved through the real client transport into isolated responses and restored on a fresh page after clearing the local text preferences. Guest preferences survive reload. Switching to Retro/Normal restores the original computed font/size.
- The installed gameplay client completes two movement/jump iterations with Readable/Large enabled, player x371→413, with inspected screenshots and no browser errors.
- The clean expanded66-case mobile regression run passes33 Chromium and33 WebKit cases, with zero console/page errors or missing fixtures. The first run passed WebKit33/33; Chromium had one existing vibration-settings timeout while other jobs competed for resources. An isolated stable-preview vibration check passed. The successful clean full rerun supersedes that attempt; the first run and an invalid recheck affected by preview-server shutdown remain diagnostics, not acceptance.

Initial diagnostics include about:blank storage access in test setup, missing synthetic neighbors/world responses, a development reload during a check, cramped run/editor labels and a mutable-preview rebuild race and requesting a brush-size row that was intentionally hidden for the selected drawing mode. The final browser matrix uses a frozen production build. All API writes and presence are isolated during tests; no public room, score or play-counter data is created.

## Release boundary

This step implements and verifies the next item locally for Jonathan's review. No source from this branch has been pushed, merged or deployed. Delivery will require API Worker plus Pages so account normalization retains the new fields; no database migration or presence/renderer release is required. F170/PR245 is already fully delivered and its earlier pending source notes are superseded.
