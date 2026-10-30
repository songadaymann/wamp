-- F264: runtime readers/writers were retired in an earlier compatibility release.
-- Current ratings and per-version change data live in room_ratings and
-- room_version_facts. Keep their parent rooms, versions, users and point events.
DROP TABLE IF EXISTS playfun_point_sync;
DROP TABLE IF EXISTS room_difficulty_votes;
DROP TABLE IF EXISTS room_version_attribution;
