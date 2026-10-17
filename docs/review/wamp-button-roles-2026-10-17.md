# F114: button roles

Jonathan asked to move to the next item after delivered F112. Branch `codex/wamp-button-roles-2026-10-17` starts at current main342df06a, preserving PR228's character-name rendering fix.

## Result

- Shared Play, Build, Curate, Neutral and Danger tokens and explicit button variants on main room actions, editor proxies, legacy editor actions and Expanded Room setup controls. Existing danger-class controls keep their meaning.
- Play, Test, Restart and Publish are green; Build Here, Edit and Expand are yellow; discovery, sharing and Comments are blue. Back is cream. Stop, Log out and Unpublish use danger styling. The established Room Rush orange and content-category/difficulty colors remain separate visual meanings.
- Play/Stop and Test/Back to Editor update the role with the existing HUD state. Handlers, publish validation, room permissions and gameplay routing are unchanged.
- Publish is a 44px primary target, with 16px pixel type where it fits and 8px in compact toolbars. Its desktop column has room for the label. The existing compact desktop arrangement starts before the widest drawer can crowd out actions; the single-row toolbar also reserves the account controls' space. Phone placement stays intact.
- Disabled action states use solid gray, square corners and opaque text. Enabled role colors have at least 4.5:1 text contrast. Removed migrated per-action color overrides; sidebar paint uses shared tokens through its existing rules rather than new important overrides.

## Verification

Full quality passes (522 files / 3,834 tests), including the main branch's two character-label tests; the final production build passes after CSS-only cleanup. Native development and production-build profiles exercise real Browse, Play, Settings/Controls, editor Test and Back, and checks for clipped labels and covered toolbar targets. Actual frontier Build Here and hover states are checked separately. Existing complete Editor Dock smoke includes ordinary and Expanded Room tools. Two installed-client movement/jump iterations pass with screenshots/text states inspected. Nine final production profiles, three frontier Build Here/hover profiles, seven Expanded Room editor/setup profiles and eight targeted Chromium/WebKit cases pass with zero application errors/fixture misses. Final source/main delivery is recorded in the pull-request receipt.

The new action audit is part of the existing 54-case mobile gate, including both narrow and regular navigation cases in both engines. It checks actual rendered action roles, colors, contrast, disabled states, primary target size, label fit and toolbar tap positions. Publish, Unpublish, Log out and destructive actions are not submitted. Synthetic reads/writes stay intercepted, including Test's local autosave path.

## Delivery

Final source/main hosted gates, staged public-source scan, clean-main guarded Pages-only deployment and live/custom-domain/immutable verification follow. The final pull-request receipt supersedes this source-time pending note.

No API Worker, D1, room data, renderer, PartyKit, background asset, financial flow or policy changes. Primary dirty files, chosen animation, closed overnight goal and decision-gated work are preserved. Physical iOS remains a hands-on follow-up.
