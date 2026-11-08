# F271 — read user profiles with the original lookup

Email, wallet, ID, username and display-name lookups now select the profile fields
in the same query. Magic-link, live-code and personal API-token joins do the same;
loading two live codes no longer adds a user query for each code. Nullable profile
fields and the display-name normalization/conflict rules are preserved.

Removed the fallback loaders for missing username, avatar, bio and selected-avatar
columns, the signup schema probe and legacy insert retry, and the matching chat
mention fallback. Session authentication already requires these migrated columns;
the existing deployment migration gate remains in place. No migration is added.

Profile-only room/stat readers move from auth into `profiles/userStats.ts` without
changing their SQL. The proposed unused `loadAllUserStatsRows` was already absent
on the current main, so there was nothing further to remove there.

Token scope parsing, revocation, school context and token usage writes retain their
existing behavior. This removes the redundant personal-token profile read; it does
not change agent-token dispatch or the semantics of last-used timestamps.

## Verification

- Existing auth/profile/chat tests: 11 files, 91 tests pass.
- New migrated SQLite query-count coverage: 11 tests pass, including all five user
  lookups, nullable fields, parameter binding, signup, two simultaneous live codes,
  magic links, API-token profile/usage/revocation and database error propagation.
- Initial aggregate run passed all 759 files/6,384 tests, then typecheck caught an
  unused session alias introduced during cleanup. Restored the unchanged session
  implementation. Final `npm run check` passes all stages: 759 files, 6,384 passing
  tests, one expected failure and two skips; boot JavaScript is 678.8/680 KB brotli.
- PR #362 holds the isolated change; exact-commit CI is pending.
- No production account, room, email, token or database changes have been made.

F271 remains unticked until delivery. Round 2 remains 102/248.
