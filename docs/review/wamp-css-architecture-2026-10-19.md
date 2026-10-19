# F074: CSS ownership, stacking and regression guards

Baseline: main `63a7eb20` (trusted comments delivered in PR256). Canonical branch: `codex/wamp-css-cleanup-2026-10-19`.

Jonathan started a new ongoing goal to continue through the master checklist. The earlier stop after F069 is superseded. This goal remains broader than F074: continue through eligible remaining items after each verified delivery, while preserving declined items, private review material, physical-device checks and decisions that require Jonathan's input. Do not mark the broader goal complete when one item ships.

## Current audit

The original review counts are stale. Current `src/styles` contains75 CSS files,190 important declarations (110 in retro-skin,32 in dock-shell), and91 z-index declarations including one `auto`. The editor stylesheet is inserted before the main sheet, so its order must be declared consistently even when loaded lazily. Keep the device/app-mode attribute architecture, public flows, three text tiers, selected animation and existing appearance.

## Required outcome

1. Explicit cascade ownership for base styles, components, editor skin, responsive rules and final overrides. Remove the retro skin's forced-color/999px inset paint-over pattern by resolving its actual competing declarations. Layer order and important priority must be reviewed together; layering alone is not completion.
2. One documented stacking system with semantic world/HUD/drawer/modal/toast/critical roles and explicit local/editor/phone positions. Replace literal CSS z-index declarations, preserve existing computed ordering, and prevent new arbitrary values.
3. Stylelint's declaration-no-important warning plus an enforced ceiling that ratchets downward; no undisclosed allowlist expansion. Keep the existing palette/font guard. Verify that a new important, raw z-index and malformed stylesheet fail appropriately.
4. Verify computed styling/geometry and hit targets against unchanged main on desktop, phone, tablet and WebKit, including ordinary/Expanded editors, active/disabled tools, palettes, popovers, music, dialogs and readable/large text. Exercise genuine editing and movement with the installed web-game client and inspect screenshots. Keep assertions/timeouts intact, and retain existing tablet Back/Undo overlap separately.
5. Full quality and source/main hosted gates; clean-main guarded frontend release; actual custom-domain/immutable assets and live runtime proof. F074 stays unticked until all requirements are met.

## Work sequence

- Audit and preserve a baseline of stylesheet declarations and screenshots.
- Introduce semantic stacking tokens with an exact value-preservation proof, and add the stylelint/ceiling guard.
- Resolve cascade conflicts and remove the retro paint-over rules; compare every affected state and fix regressions before release.
- Run complete checks and deliver. Update the master count only after acceptance; then select the next eligible item from the full list.

Status: implementation in progress. Master remains166/216. No F074 release or visual-parity acceptance is claimed yet.

## Current implementation checkpoint

90 numeric z-index declarations now use named roles, with an exact resolution proof; the one `auto` remains. Stylelint17.16.0 and reviewed per-file ceilings reject new important declarations, disabled-warning bypasses, malformed CSS, unknown/raw/redefined stacking values, unowned entry imports, paint-over shadows and stale ceilings (11 positive/negative probes). Current source has78 CSS files and48 important declarations, down from190; all110 retro and32 dock important flags and25 retro 999px paint-over shadows are gone.

Explicit typography and button-metric owners preserve the former font policy without forcing unrelated spacing. Legacy fixed-stack/beginner/palette sizing rules are scoped away from the modern dock; the dock owns its action wrapper. Mode visibility is moved from page defaults into the world component owner. Earlier desktop comparisons passed16 states, but later global/phone ownership changes require the current full rerun. The initial baseline recording lacked neighbor/music responses; corrected isolated API adapters retain strict zero-error/miss checks. Uncontrolled sticky hover also required a deterministic pointer and an expanded fresh baseline. Failed diagnostics are retained separately and are not accepted verification.

The earlier token-stage installed client passed two movement/jump iterations; its last screenshot was opened. Final cascade runtime, complete style/geometry/paint-pixel matrix, full quality, hosted source/main gates and guarded/live release remain pending. F074 stays open; no source push or deployment has occurred for this item.

## Responsive ownership follow-up

Whole-file ownership changed modal invariants on phones. Each rule now has a root-level named owner; imports are unqualified and both entry points establish the order first. Component-owned dialogs and shell/menu styling (previously mixed into base.css) keep their own device/media defaults in the component layer. The responsive layer holds adaptations that intentionally outrank the editor skin. Generic dialog defaults therefore do not beat a dialog's specific width or header alignment. All78 files preserved their selector/condition/declaration signatures through that conversion and formatting; a subsequent explicit audit identifies only two files with intentional compatibility adjustments: legacy phone tools/palette hiding excludes the modern dock while retaining the three-column layer grid, and Smart theme/brush minimum width uses the existing phone tap token with a zero desktop fallback. These changes retain the computed baseline rather than adding important flags.

Fifteen guard probes pass, including invalid/nested owners, unowned rules, wrong entry order and stale ceilings. Local imports are also constrained to the checked style directory. The installed client passes two final-cascade movement/jump iterations (player x316→298, active and unpaused); the final screenshot was inspected. The first full quality run passes4,684 tests and finds one real integration omission: the new executable was absent from Knip's root inventory. The inventory and its contract now include the cascade checker and Stylelint configuration; the contract is rechecked before the full rerun.

The strict comparison method now explicitly resets the editor scroll position and finishes CSS transitions before reading computed values. Earlier runs captured a two-pixel scroll difference and mid-transition brightness; those diagnostics are retained, not counted as passes. The fresh baseline also records transform, isolation, contain, clip-path, will-change, container-type and content-visibility, alongside geometry, colors, fonts and stacking. Full current candidate acceptance, source/main hosted gates and release remain pending. Master stays166/216 and the broader goal stays active.

## Final source verification in progress

All incremental desktop, narrow-phone, tablet, landscape, WebKit and readable/large-text profiles pass, for ordinary and Expanded editors. The final single146-state run on the consolidated source is running. Real regressions caught and fixed include legacy palette hiding, layer order, Room Setup wrapper layout, music/sprite chrome visibility and phone close targets. Skin/device rules remain with the skin owner; shared responsive rules explicitly skip the overlaid music/sprite modes. Legacy-only phone action markup is scoped away from the modern dock. Phone close and Smart theme/brush metrics use the existing tap token, preserving38px/zero desktop minimums and44px phone minimums. The final static delta against the earlier conversion checkpoint is confined to five reviewed compatibility files;73 files retain exact selector/condition/declaration signatures. Eighty adjacent same-owner blocks were consolidated with exact ordered declaration ancestry preserved.

Full local quality exits0:561 files/4,685 tests, lint/typecheck, DOM contract (1,056 actual/240 required/948 lookups), generated binding checks, production build and asset checks. The fresh build after the final phone changes also passes, with650.8KB startup Brotli /670KB budget. All18 guard probes pass in an isolated source snapshot, including external/missing/qualified imports; testing those mutations does not reload the running browser. The staged public-source scan has0 blockers/0 warnings. The final installed-client run passes two movement/jump iterations (x313→298, jump-fall, unpaused); screenshot inspected and no error artifact or HTTP error logged. Final aggregate comparison, hosted source/main gates and guarded/live release are still pending. F074/master remain open166/216.

## Production-native follow-up

The first production-native run revealed a real regression outside the editor matrix: the browse Play action fell from its required48px row to44px because a generic large-button minimum had been placed in the final override layer. The shared size metric is now component-owned, while action colors remain final policies. All33 Chromium cases from that first build were inspected (one failure); the known-failed run was then safely stopped before wasting the rest of the WebKit pass. Its143 exit, reports and exact owned-process cleanup are retained. No assertion or timeout changed. The rebuilt production suite currently passes all33 Chromium scenarios; WebKit is still running.

After the correction, the complete146-state/1,261,068-comparison run passes again with zero browser errors or fixture misses. A fresh standard production build/size check passes650.6KB Brotli /670KB. The local edit helper that initially tried to move this rule was stopped when its tree traversal revisited the moved node; it wrote no source. The corrected move collects the node before mutating the tree, and the style guard passes. This is a retained local-tool diagnostic, not an accepted check.

F074 covers the shared application styles in src/styles. Independently loaded feature/admin CSS outside that tree retains its standalone treatment; this release does not claim to migrate every CSS file or inline JavaScript style in the repository. Existing visual treatments are preserved for compatibility, including prior radii, disabled opacity and legacy type sizes; no new treatment is introduced. The initial z-index migration is independently reverified against main63a7eb20 per selector and media condition, preserving declaration order within identical selectors. All90 numeric values and1auto match; only three phone chrome roots intentionally exclude their hidden music/sprite modes. Full production-native acceptance, hosted gates and release remain pending; no F074 push or deployment yet.

## Local source acceptance

The final rebuilt production suite exits0 with all66 cases (33 Chromium,33 WebKit), zero console/page errors and zero API fixture misses. The final146-state comparison after the size-metric correction also exits0 with1,261,068 matched property/geometry values and exact controlled paint crops. Fresh final build and size check pass650.6KB/670KB; the full561-file/4,685-test quality run,18 isolated guard probes, installed-client gameplay captures and staged OSS0/0 scan are accepted. Source requirements1–4 are verified. Push/PR, exact-source/main hosted checks, guarded Pages release and actual-domain/immutable/runtime verification are the remaining delivery gate. Master remains166/216; this is not F074 production completion or completion of the broader goal.
