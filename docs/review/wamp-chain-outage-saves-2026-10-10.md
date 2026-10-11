# F236 room saves survive a Base RPC outage

Delivered 2026-10-10 in [PR #122](https://github.com/songadaymann/wamp/pull/122), merge `41e455e9`, API Worker `1ef364ee-34e8-4319-b30b-a451b45276e9`.

## Behavior

- **Room writes** (draft saves, publishes, reverts, command saves, construction preview): if reading ownership from Base fails, the write uses the ownership D1 last recorded and logs `Room <id> ownership sync skipped: Base RPC read failed; using stored ownership (…)`.
  - Unminted rooms stay editable by their claimer.
  - Minted rooms stay with the last synced token owner until the next successful read. A token transferred during an outage takes effect when the RPC recovers.
- The tolerant read retries once with a 5 s timeout (viem's default is 3 retries at 10 s), so a hanging RPC no longer stalls a save for ~40 s.
- **Minting** (prepare, confirm, metadata prepare and confirm) and the explicit ownership refresh still fail when the chain can't be read.
- A save whose chain read changes nothing loads the room's full version history once instead of twice. Command saves run one chain read instead of two.
- Client autosave already backs off after failed saves (`cfbcf8d8`).

## Evidence

- `npm run check` on Node 22: 425 files, 3,352 tests.
- `src/cloudflare/worker/rooms/mutationChainSync.test.ts` (fake RPC):
  - an unminted room saves with the RPC returning 429 (2 RPC calls);
  - a minted room keeps its stored owner: the owner can save and others cannot;
  - 'throw' mode still rejects;
  - an unchanged sync loads the history once.
  - Three of the four fail on the previous code.
- Production: deployed and the smoke test passes. No builder saved between the deploy and this record.

## Left

- Skipping the chain read for unminted rooms with no mint prepare in the last 30 minutes.
- A short cache for `ownerOf` on minted rooms.
- Loading only the latest version row for writes.
