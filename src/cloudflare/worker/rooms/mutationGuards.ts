import type { RoomRecord } from '../../../persistence/roomModel';
import type { D1PreparedStatement, Env } from '../core/types';

export function prepareRoomMutationGuards(env: Env, existing: RoomRecord, options: {
  admin: boolean;
  publicClaim: boolean;
  claimUserId: string | null;
  claimLimit: number | null;
  now: string;
  expectedDraftUpdatedAt?: string | null;
}): D1PreparedStatement[] {
  const id = crypto.randomUUID();
  const { x, y } = existing.draft.coordinates;
  const absentExpected = !existing.claimerUserId && !existing.published && existing.mintedTokenId === null;
  const expectedDraftUpdatedAt = existing.claimedAt !== null || existing.published !== null
    ? options.expectedDraftUpdatedAt ?? null : null;
  const dayStart = new Date(options.now); dayStart.setUTCHours(0, 0, 0, 0);
  return [env.DB.prepare(`INSERT INTO room_mutation_checks (id, owner_matches, frontier_matches, quota_available)
    VALUES (?, CASE WHEN ? = 1 OR
      (? = 1 AND NOT EXISTS (SELECT 1 FROM rooms WHERE id = ? OR (x = ? AND y = ?))) OR
      EXISTS (SELECT 1 FROM rooms WHERE id = ? AND x = ? AND y = ?
        AND claimer_user_id IS ? AND claimed_at IS ?
        AND minted_chain_id IS ? AND minted_contract_address IS ? AND minted_token_id IS ? AND minted_owner_wallet_address IS ?
        AND json_extract(published_json, '$.version') IS ? AND json_extract(published_json, '$.updatedAt') IS ?
        AND (? IS NULL OR json_extract(draft_json, '$.updatedAt') = ?))
      THEN 1 ELSE 0 END,
    CASE WHEN ? = 0 OR
      (NOT EXISTS (SELECT 1 FROM rooms WHERE published_json IS NOT NULL) AND ? = 0 AND ? = 0) OR
      EXISTS (SELECT 1 FROM rooms WHERE published_json IS NOT NULL AND abs(x - ?) + abs(y - ?) = 1)
      THEN 1 ELSE 0 END,
    CASE WHEN ? = 0 OR ? IS NULL OR
      (SELECT COUNT(*) FROM rooms WHERE claimer_user_id = ? AND claimed_at >= ? AND
        (published_json IS NULL OR json_extract(published_json, '$.publishedAt') IS NULL
          OR json_extract(published_json, '$.publishedAt') >= claimed_at)) < ?
      THEN 1 ELSE 0 END)`)
    .bind(id, options.admin ? 1 : 0, absentExpected ? 1 : 0, existing.draft.id, x, y, existing.draft.id, x, y,
      existing.claimerUserId, existing.claimedAt, existing.mintedChainId, existing.mintedContractAddress,
      existing.mintedTokenId, existing.mintedOwnerWalletAddress, existing.published?.version ?? null, existing.published?.updatedAt ?? null,
      expectedDraftUpdatedAt, expectedDraftUpdatedAt,
      options.publicClaim ? 1 : 0, x, y, x, y, options.publicClaim ? 1 : 0, options.claimLimit, options.claimUserId, dayStart.toISOString(), options.claimLimit),
    env.DB.prepare('DELETE FROM room_mutation_checks WHERE id = ?').bind(id)];
}
