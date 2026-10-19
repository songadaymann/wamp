# UI style ownership

Both `main.css` and the lazy `editor-bundle.css` declare the same cascade order:

1. `base`: tokens, fonts, resets and page defaults.
2. `components`: shell, world/dialog styles, shared size defaults and the editor's structural controls. A component's own responsive rules and shared dialog defaults stay here so its specific layout invariants retain precedence.
3. `editor-skin`: the retro appearance and dock shell; the dock owns its modern structure while legacy layout selectors stay scoped to legacy chrome.
4. `responsive`: editor skin adaptations and cross-surface device, orientation and touch policies that must outrank the skin.
5. `overrides`: shared action roles, explicit editor button/visibility-glyph typography and the player's text preferences.

Put new declarations with the surface that owns them, inside its named `@layer` block. Imports stay unqualified so each rule can keep its actual owner. A media query or device selector does not automatically belong in a later layer: generic phone dialog defaults must not override a dialog's more specific size or header layout. Put those adaptations with their component. Editor adaptations that must override the retro skin belong in `responsive`. Entry points declare the order before importing either kind of rule. Do not add an unlayered stylesheet to win a specificity conflict. Action colors are final policies; a shared minimum button size remains a component default so a specific larger action can retain its height. Important declarations reverse layer priority; they are exceptions, not a way to change a control's normal state.

Use stacking roles from `tokens.css`. The world/HUD, drawer, modal, toast and critical bands preserve the existing order. Local roles belong to their owner's stacking context; named phone/editor roles preserve the established arrangement of toolbar, inspector, music, chat and popovers. A higher number inside a child stacking context cannot escape its parent.

`npm run styles:check` enforces the shared palette/fonts, named stacking roles and reviewed per-file important ceilings. `npm run styles:lint` prints the individual Stylelint warnings. When removing an important declaration, lower its ceiling in `scripts/style-cascade-budget.json`. Do not raise a ceiling to make a new override pass without first resolving and reviewing its cascade owner.

Compare default, active, disabled, hover and focus states on desktop and touch layouts when changing ownership. The lazy editor sheet must still work when inserted before the shared stylesheet, and readable/large text must retain precedence.
