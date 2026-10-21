import type { Env } from '../core/types';

/** Match isRoomMinted's conservative stored-state test without exposing wallet/token details. */
export function storedRoomProtectionSql(alias: 'rooms' | 'protected_room' = 'rooms'): string {
  return `(${alias}.minted_chain_id IS NOT NULL OR ${alias}.minted_contract_address IS NOT NULL OR ${alias}.minted_token_id IS NOT NULL)`;
}

export function indexedRoomProtectionCountSql(alias: 'index_row' | 'playable_content_index'): string {
  return `(SELECT COUNT(DISTINCT protection_member.room_id)
    FROM playable_content_index_members protection_member
    JOIN rooms protected_room ON protected_room.id = protection_member.room_id
    WHERE protection_member.target_key = ${alias}.target_key AND ${storedRoomProtectionSql('protected_room')})`;
}

export function indexedRoomProtectionExistsSql(alias: 'index_row'): string {
  return `EXISTS(SELECT 1 FROM playable_content_index_members protection_member
    JOIN rooms protected_room ON protected_room.id = protection_member.room_id
    WHERE protection_member.target_key = ${alias}.target_key AND ${storedRoomProtectionSql('protected_room')})`;
}

/** Only legacy profile cells not included in the builder's existing rows need this bounded read. */
export async function loadProtectedRoomIds(env: Env, roomIds: string[]): Promise<Set<string>> {
  const ids = [...new Set(roomIds)];
  const protectedIds = new Set<string>();
  for (let offset = 0; offset < ids.length; offset += 80) {
    const batch = ids.slice(offset, offset + 80);
    const rows = await env.DB.prepare(`SELECT id FROM rooms
      WHERE id IN (${batch.map(() => '?').join(',')}) AND ${storedRoomProtectionSql()}`)
      .bind(...batch).all<{ id: string }>();
    for (const row of rows.results) protectedIds.add(row.id);
  }
  return protectedIds;
}
