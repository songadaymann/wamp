# F026 ranking from stored version facts

Delivered 2026-10-10 in [PR #115](https://github.com/songadaymann/wamp/pull/115), merge `a8297e66`. Migration `0064_room_version_facts.sql` applied to production (it was the only pending migration), then API Worker `365e0263` deployed with the release check, build and production smoke passing.

## Behavior

- Leaderboard lineage and rating windows use compact per-version facts: gameplay fingerprint hash, goal type, ranking mode, co-op/boss/hearts signatures and the weighted change from the previous version.
- `room_version_facts` stores them, filled lazily the first time a room's ranking data is read and recomputed when `ROOM_VERSION_FACTS_VERSION` changes. No backfill job; the table is safe to drop and rebuild.
- `loadRoomRankingRecord` loads the room row, every version's facts and only the snapshots a request needs. The leaderboard GET, run finish, difficulty vote and rating submit use it. Other `loadRoomRecord` callers are unchanged.

## Evidence

- Equivalence on 13 production rooms (all with manual leaderboard adoptions, including the spawn room's 176 versions), previous code on full records vs new code on facts: 1,569/1,569 checks identical (lineage and families, selection per version, rating window per version, version options, source validation).
- `npm run check` on Node 22: 421 files, 3,339 tests. `rankingRecord.test.ts` covers lazy fill, reuse without re-reading snapshots, recompute on a facts-version change, loading only requested snapshots, and a pinned facts snapshot that fails if the fingerprint changes without a version bump.
- Production, spawn room `GET /api/leaderboards/rooms/0,0`: before, `room_record` 0.16-3.7 s and TTFB 1.9-5 s; after deploy, the first read filled 176 facts (`room_record` 2.2 s), then 429, 127, 48, 24 and 25 ms, with TTFB down to 0.12 s.

## Left

`GET /api/rooms/:id` still returns every version snapshot (11 MB for 0,0), and Expanded Room course records load every version the same way.
