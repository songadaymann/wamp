# Takedowns that take content down (F189) and where players come from (F127) — 2026-10-21

Delivers withheld item **F189** and item **F127**. The guest-room part of F189 shipped earlier with F049 (PR #281).

## F189: takedowns

Restoring a vandalized room used to leave the vandal's version in public History and at its own link (cached for a year), and blocking a community sprite only removed it from the picker, because rooms carry their own copy of every sprite they use. [PR 285](https://github.com/songadaymann/wamp/pull/285):

- **Hidden versions.** When Building Controls restores a room, every version that user published over the restore target is hidden; rooms someone else has published over since are left as they are, but that user's versions from the undo window are hidden too. A hidden version keeps its place in History but is shown as an empty room titled "Hidden by moderation" in History, the room record, exact-version links, pinned and shared views, playlists, comments, activity and insights. It cannot be restored, pinned into an Expanded Room, or picked as a later restore target. Building Controls can also hide or show one version by room id and number. The room's current version can't be hidden; restore an earlier one first. Exact-version links are now cached for 5 minutes instead of a year.
- **Blocked sprites.** Blocked sprite ids travel with the world tile config, and the game keeps its own copy current (at boot, every 3 minutes while visible, and when the tab comes back). The game, the map tiles, the share and link-preview images and new token images paint blocked art as a flat grey placeholder. Stored rooms are never changed, so restoring a sprite brings its art back. Blocking or restoring a sprite re-renders the map tiles of every room that embeds it. A creator can't delete a blocked sprite to undo the block. Share images now stay at the edge for an hour instead of a day.
- Hiding and showing versions is recorded in the moderation audit. A leaderboard pinned to a hidden version goes back to its default.

## F127: where players come from

[PR 286](https://github.com/songadaymann/wamp/pull/286) records where each guest visit started: the landing path (never the query string), the referring site's host, and a short source tag (`?from=`, `utm_source`, or `daily` for the daily room link), read from the original navigation because the game rewrites the address as the player moves. Wamp-O-Gram links now carry `from=gram`. Once a guest signs up, the new account remembers which guest it grew out of; the link is retried on later signed-in loads, so sign-ups finished from a magic link in another tab count too.

Launch Admin has a new **Where Players Come From** panel: new guest browsers over 7 or 30 days, followed through playing, building and a verified clear (as a guest), signing up and publishing, split by source, with the share on phones and next-day and within-a-week return rates. A return is a separate visit 12 hours to 2 or 7 days after the first. Crawlers are left out; visits from before this release show as "unknown".

## Release

- Migrations 0072 (`room_versions.redacted_at` and `redacted_title`, a wider `moderation_audit` action list, the sprite re-render trigger) and 0073 (visit landing columns, account sign-up link and its index) applied to production D1 before the Worker.
- API Worker `41a3c0f4` and world tile renderer Worker `3acf9926` deployed from the branch; `/api/health` and `scripts/smoke_prod.mjs` pass.
- `npm run check`: 620 test files, 5,284 tests; boot JavaScript 662.4 KB brotli (budget 670 KB).

## Adversarial review

Two reviews before release, then a follow-up pass on the fixes.

- F189 (8 findings, then 4 in the follow-up, all fixed): the room record still served hidden versions, the site's link-preview image ignored the blocklist, a creator could delete a blocked sprite to unblock it, the hide rule missed earlier and overtaken versions, a restore could target a hidden version, hidden titles still showed in several other places, and the client only got the list through the map tiles. The follow-up found hidden titles on leaderboards and a leaderboard pinned to a hidden version, a fragile batch for overtaken rooms, link previews that showed art when the list failed to load (they now leave community sprites out and cache for a minute), and tile atlases that did not redraw mid-session.
- F127 (9 findings, then 2 in the follow-up, all fixed): a funnel query that scanned the users table once per guest, returns counted when one sitting crossed midnight, clears pruned after 14 days, pre-release visits shown as "direct", steps that mix guest and account activity, sign-ups from another tab never linked, `linked` reported without checking the update, crawlers counted, and `/today` counted as share traffic. The follow-up found guests counted twice when two accounts linked to one browser, and returns in the same tab never counted (a tab idle for 30 minutes now starts a new visit).

## Not done

- Browsers that fetched a version link before this release may keep their copy for up to a year. Old map tile images stay in storage at their own addresses until garbage collection.
- The minted-room page doesn't load the blocklist (wallet code is being worked on elsewhere).
- Blocking works per sprite id: the same pixels uploaded again under a new id are a new sprite.
- Sign-ups finished in a phone mail app's own browser have different storage and stay unlinked.
- A sprite blocked mid-session redraws in place; room textures redraw on next use.
