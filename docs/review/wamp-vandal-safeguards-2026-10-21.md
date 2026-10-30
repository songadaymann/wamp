# Vandal safeguards, reports and abuse limits — 2026-10-21

Delivers six withheld security and safety items from the October 2026 checkup: **F182, F184, F183, F049, F188 and F213**. They were built as one stack, each reviewed adversarially before release, and shipped together.

## What changed

| Item | PR | What players and admins get |
|---|---|---|
| F182 | [#278](https://github.com/songadaymann/wamp/pull/278) | Publishing over rooms claimed by someone else has its own daily allowance, equal to the builder's new-room publish limit (5 at T0 up to 25 at T4); each room counts once per UTC day. The claimer gets a private inbox notice ("published changes to your room", with a pointer to History). `OTHERS_ROOM_EDITS_PAUSED=1` pauses drafts and publishes over other builders' rooms. |
| F184 | [#279](https://github.com/songadaymann/wamp/pull/279) | Admins can suspend an account: it can still play, but every signed-in write is refused and its bot and API tokens are revoked. Building Controls on the suspicious-activity page preview and restore every room a user published over since a chosen time. Cap overrides of 0 now mean none. Suspensions, restores and room clears are audited. |
| F183 | [#280](https://github.com/songadaymann/wamp/pull/280) | A Report dialog from the menu (Report this room), profiles, world chat messages and Explore guest rooms. Reports are private, read and stored by the server, emailed to the admin on the first report per item (20 a day at most), and listed on the suspicious-activity page with Handled and Dismiss. |
| F049 | [#281](https://github.com/songadaymann/wamp/pull/281) | Admins hide or show shared guest rooms from a Guest Rooms list or straight from a report. Sharing is limited to 5 a day per network and 100 a day in all. |
| F188 | [#282](https://github.com/songadaymann/wamp/pull/282) | Wallet approvals are limited to 60 an hour per network, expired ones are pruned hourly, and the hourly job emails the admin above 8 GB of database. (New guest-draft limits shipped earlier in PR #173.) |
| F213 | [#283](https://github.com/songadaymann/wamp/pull/283) | A numbered World's rooms no longer make neighbouring WAMP 0 cells claimable. |

## Release

1. Production D1 migrations 0069 (`builder_activity` rebuild for the `edited` notice), 0070 (`users.suspended_at`, `moderation_audit`) and 0071 (`content_reports`) were applied first. Before/after: 1,646 activity rows kept, max id and sequence both 1,673, 7 triggers and 3 indexes present, no leftover tables. The six recreated triggers were compared with production's own definitions before the rebuild and matched exactly.
2. API Worker deployed from the stack tip: version `bc00ef00`. `/api/health` reports migration 0071 as expected; `scripts/smoke_prod.mjs` passes. Probes: a malformed report is refused (400), the new admin routes refuse requests without the admin key (403), and a cross-site wallet approval request is refused before it can count (403).
3. PRs #278–#283 merged bottom-up (main `ae2003a5`). Pages deployment `bf46dd06` (for `ae2003a`) is live on wamp.land; the intermediate builds were skipped. Live checks: `index.html` has the Report this room menu item, the profile Report button and the report dialog; the lazy `reportDialog-*.js` chunk posts to `/api/reports`; `/suspicious-admin` has Building Controls, Player Reports and Guest Rooms. The deployed Worker tree is identical to main.
4. CI on the stack tip: all suites passed except `collection-costs`, which was still running at merge (wallet collection pricing, unaffected by this change). A local mobile smoke run passed too.

## Verification

- `npm run check` on the stack tip: 616 test files, 5,264 tests; boot JavaScript 660.8 KB brotli (budget 670 KB). The Report dialog and its CSS load on first use.
- New tests cover the allowance (including a burst of parallel publishes and a failed publish releasing its slot), the claimer notice (private, once per editor and day, none for restores, minted or World rooms), the 0069 rebuild keeping the id sequence, suspension across sessions and tokens, the restore planner (own rooms, rooms others repaired, newer drafts, hijacked claims, stale plans), reports (server-read targets, network-counted guests, email cap, signed-in exemption), guest room hiding and re-sharing, the wallet limit and the size alert.
- Migration rehearsal in a local D1 (workerd) before production: existing rows kept, triggers recreated, the new notice fires.

## Adversarial reviews

Three reviews ran against the diffs. They found 6, 9 and 9 issues respectively; all were fixed before release. The most important: a `?worldId=` parameter that let a WAMP 0 room be treated as a World room (bypassing the allowance), a same-room release race, the admin restore panel acting on a user nobody had previewed, vandalised unclaimed rooms being skipped as the vandal's own, a sitewide wallet cap that other websites could exhaust, and rotating guest ids flooding reports and admin email.

## Production data used for the limits

- Edits to other builders' rooms since May: at most 3 distinct rooms per builder per day.
- Shared guest rooms: 6 in all, at most one a day.
- Expired wallet approvals waiting: 199. Database size: 0.47 GB.

## Not done, by choice

- F184: room clear remains a hard delete (now audited); a soft hide would touch every world and index read.
- F183: no automatic hiding after several reports; alerts only.
- F213: the map can still show Build here beside a World's room for non-members (no numbered Worlds exist yet).
- F188: guest drafts are not re-validated beyond their size on save.

## How to use the new tools

- **Raid switch:** `wrangler secret put OTHERS_ROOM_EDITS_PAUSED` with value `1`; remove with `wrangler secret delete OTHERS_ROOM_EDITS_PAUSED`.
- **Suspend or undo a vandal:** suspicious-admin.html → search the player → Building Controls.
- **Reports and guest rooms:** suspicious-admin.html → Player Reports and Guest Rooms panels.
