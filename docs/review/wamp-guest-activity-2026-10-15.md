# Clickable guest activity

Guest names in My activity and All activity open that guest's recorded public activity across rooms and builders. The guest view reuses the WAMP activity panel; room links remain available. Back, or Escape from the guest view, restores the previous loaded feed, pagination cursor, scroll position and focused name button.

The public API accepts `GET /api/activity?guest=<public activity reference>&before=<optional cursor>`. It resolves a currently visible guest event and filters by its stored actor identity. Registered-player, unpublished and missing references are rejected; unpublished or archived targets stay hidden. Browser IDs, recovery tokens and notification preferences are excluded from responses. Viewing a guest does not acknowledge private notifications.

Migration `0066_guest_activity_index.sql` adds an index on guest actor and descending activity ID; apply before deploying the new API Worker. No identity or event history is changed. Deploy the API Worker and Pages together.

Validation: 3,741 tests passed; the expanded real-application/SQLite-backed activity harness checks My/All entry points, cross-builder history, older pages, keyboard activation, Escape, and Back restoring rows, cursor, scroll and focus at desktop, phone, narrow-phone and landscape sizes. Full quality, public-source and hosted release checks are required before delivery. Browser reports/screenshots remain in ignored output/web-game/activity-tabs.
