import type { CollectedRoom, CollectionAttribution, CollectionShelfResponse, RoomCollector } from '../../../collections/model';
import { buildRoomTokenViewerUrl } from '../../../mint/roomTokenLinks';
import { findUserById } from '../auth/store';
import { HttpError } from '../core/http';
import type { Env } from '../core/types';
import { loadExpandedRoomTarget, loadPublishedExpandedRoomMembershipsForRoomIds } from '../expandedRooms/store';
import { storedRoomProtectionSql } from '../rooms/protection';

interface CollectionRow {
  published_version: number;
  id: string; x: number; y: number; published_title: string | null;
  claimer_user_id: string | null; builder_name: string | null;
  minted_chain_id: number | null; minted_contract_address: string | null; minted_token_id: string | null;
  minted_owner_wallet_address: string | null; minted_owner_synced_at: string | null;
  collector_id: string | null; collector_name: string | null;
}
const columns = `json_extract(rooms.published_json, '$.version') AS published_version, rooms.id, rooms.x, rooms.y, rooms.published_title, rooms.claimer_user_id,
  COALESCE(builder.display_name, rooms.claimer_display_name) AS builder_name,
  rooms.minted_chain_id, rooms.minted_contract_address, rooms.minted_token_id,
  rooms.minted_owner_wallet_address, rooms.minted_owner_synced_at,
  collector.id AS collector_id, collector.display_name AS collector_name`;
const joins = `LEFT JOIN users builder ON builder.id = rooms.claimer_user_id
  LEFT JOIN users collector ON collector.wallet_address = rooms.minted_owner_wallet_address`;

export async function loadCollectionAttribution(env: Env, targetId: string): Promise<CollectionAttribution> {
  const target = await loadExpandedRoomTarget(env, targetId);
  if (!target) throw new HttpError(404, 'Room not found.');
  const ids = target.cells.map(cell => cell.roomId);
  const rows: CollectionRow[] = [];
  for (let offset = 0; offset < ids.length; offset += 80) {
    const batch = ids.slice(offset, offset + 80);
    const result = await env.DB.prepare(`SELECT ${columns} FROM rooms ${joins}
      WHERE rooms.id IN (${batch.map(() => '?').join(',')}) AND rooms.published_json IS NOT NULL
      AND ${storedRoomProtectionSql()}`).bind(...batch).all<CollectionRow>();
    rows.push(...result.results);
  }
  const collectors = new Map<string, RoomCollector>();
  for (const row of rows) {
    const wallet = row.minted_owner_wallet_address;
    if (!wallet || !/^0x[0-9a-f]{40}$/i.test(wallet) || /^0x0{40}$/i.test(wallet)) continue;
    const key = wallet.toLowerCase(), existing = collectors.get(key);
    if (existing) { existing.cellCount++; continue; }
    collectors.set(key, { userId: row.collector_id, displayName: row.collector_name || `${wallet.slice(0, 6)}…${wallet.slice(-4)}`,
      walletAddress: wallet, cellCount: 1 });
  }
  // Oldest snapshot is the honest freshness bound for a multi-cell target.
  const stamps = rows.map(row => row.minted_owner_synced_at);
  const ownerSyncedAt = stamps.length && stamps.every((stamp): stamp is string => Boolean(stamp)) ? stamps.sort()[0] : null;
  return { targetId, cellCount: target.cells.length, ownerSyncedAt,
    collectors: [...collectors.values()].sort((a, b) => b.cellCount - a.cellCount || a.walletAddress.localeCompare(b.walletAddress)) };
}

export async function loadCollectionShelf(env: Env, userId: string, limit: number, cursor: string | null): Promise<CollectionShelfResponse> {
  const user = await findUserById(env, userId);
  if (!user) throw new HttpError(404, 'Profile not found.');
  let offset = 0;
  if (cursor) {
    try {
      const parsed = JSON.parse(atob(cursor)) as { collectionUser?: string; offset?: number };
      if (parsed.collectionUser !== userId || !Number.isSafeInteger(parsed.offset) || parsed.offset! < 0 || parsed.offset! > 100000) throw new Error();
      offset = parsed.offset!;
    } catch { throw new HttpError(400, 'Invalid collection cursor.'); }
  }
  if (!user.walletAddress) return { results: [] };
  const rows = await env.DB.prepare(`SELECT ${columns} FROM rooms ${joins}
    WHERE rooms.minted_owner_wallet_address = ? AND rooms.published_json IS NOT NULL AND ${storedRoomProtectionSql()}
    ORDER BY rooms.minted_owner_synced_at DESC, rooms.id ASC LIMIT ? OFFSET ?`)
    .bind(user.walletAddress, limit + 1, offset).all<CollectionRow>();
  const page = rows.results.slice(0, limit);
  const memberships = await loadPublishedExpandedRoomMembershipsForRoomIds(env, page.map(row => row.id));
  const membershipById = new Map(memberships.map(m => [m.roomId, m]));
  const results: CollectedRoom[] = page.map(row => ({
    roomId: row.id, roomVersion: Number(row.published_version), roomCoordinates: { x: row.x, y: row.y }, roomTitle: row.published_title,
    builder: { userId: row.claimer_user_id, displayName: row.builder_name || 'Unknown builder' },
    expandedRoomTitle: membershipById.has(row.id) ? membershipById.get(row.id)?.title || 'Expanded Room' : null,
    ownerSyncedAt: row.minted_owner_synced_at,
    viewerUrl: buildRoomTokenViewerUrl({ mintedChainId: row.minted_chain_id,
      mintedContractAddress: row.minted_contract_address, mintedTokenId: row.minted_token_id }),
  }));
  return { results, ...(rows.results.length > limit ? { nextCursor: btoa(JSON.stringify({ collectionUser: userId, offset: offset + limit })) } : {}) };
}
