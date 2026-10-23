# Ledger entries

Each file here is one row of [feature-ledger.md](../../feature-ledger.md). Every entry gets its own file, so two branches that each add one never edit the same file.

## Add an entry

1. Create `docs/ledger/<YYYY-MM-DD>-<slug>.md`, for example `2026-10-23-phone-dock.md`. The easiest way is to copy a recent file and change it.
2. Put one table row in it, on one line:

   ```
   | 2026-10-23 | F368, F369, F367 | [#316](https://github.com/songadaymann/wamp/pull/316) | [receipt](docs/review/wamp-round2-phone-building-2026-10-23.md) | Phone dock: touch-scrolling tile picker, a one-tap Draw/Erase switch, and every dock button in reach |
   ```

   - **Date:** the date in the file name.
   - **Items:** F-IDs separated by `, `, or `—` if there are none.
   - **PR:** `[#N](https://github.com/songadaymann/wamp/pull/N)`, several separated by `, `. Write a run of PRs as `[#302](…/pull/302)–[#308](…/pull/308)`. Use `—` for a direct commit.
   - **Receipt:** `[receipt](docs/review/<file>.md)`, with the path from the repo root, or `—`.
   - **Summary:** plain words, at most 120 characters, no `|`.
3. Run `npm run ledger`. It rebuilds feature-ledger.md, newest first, and stops if a file here is malformed.
4. Commit the new file and feature-ledger.md together.

To fix an entry, edit its file and run `npm run ledger` again. `npm test` (scripts/ledger.test.ts) fails if a file here is malformed or names a receipt that doesn't exist, if feature-ledger.md is missing one of the newest entries, or if it has a row with no file here. `npm run ledger -- --check` runs the same check on its own.

feature-ledger.md shows the newest 80 entries. Older ones stay here; `npm run ledger -- --all` prints every entry.

## Conflicts

The files here never conflict. feature-ledger.md is merged with git's union driver (see `.gitattributes`): when two branches each rebuilt it, a merge or rebase keeps both new rows instead of stopping. The rows may land out of order, which the check allows; the next `npm run ledger` sorts them. If a merge still stops on feature-ledger.md (GitHub's web merge may not use the union driver), run `npm run ledger` and commit. The table is rebuilt from the files here, so nothing is lost.
