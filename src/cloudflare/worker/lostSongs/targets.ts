import { LOST_SONG_OBJECT_ID, getLostSongPlacementError, type LostSongTarget } from '../../../lostSongs/model';
import { parseRoomId } from '../../../persistence/roomModel';
import { HttpError } from '../core/http';
import type { Env } from '../core/types';
import { loadExpandedRoomTarget } from '../expandedRooms/store';
import { loadExactRoomVersion, parseStoredSnapshot } from '../rooms/store';

interface CurrentSongRoom { published_json: string | null; claimer_user_id: string | null; minted_owner_wallet_address: string | null }

export async function loadLostSongTarget(env: Env, body: LostSongTarget, viewer: { id: string; walletAddress?: string | null } | null) {
  const coordinates = parseRoomId(body.roomId);
  if (!coordinates) throw new HttpError(400, 'Invalid room coordinates.');
  const current = await env.DB.prepare('SELECT published_json, claimer_user_id, minted_owner_wallet_address FROM rooms WHERE id = ?')
    .bind(body.roomId).first<CurrentSongRoom>();
  if (!current?.published_json) throw new HttpError(404, 'Published room not found.');
  const published = parseStoredSnapshot(current.published_json, body.roomId);
  let ownerUserId = current.claimer_user_id;
  if (body.expandedRoomId) {
    const expanded = await loadExpandedRoomTarget(env, body.expandedRoomId);
    const cell = expanded?.cells.find(cell => cell.roomId === body.roomId);
    if (!expanded || expanded.version !== body.expandedRoomVersion || !cell
      || (cell.roomVersion ?? published.version) !== body.roomVersion) {
      throw new HttpError(409, 'This room version is not in the published Expanded Room.');
    }
    ownerUserId = expanded.ownerUserId ?? ownerUserId;
  } else if (published.version !== body.roomVersion) {
    throw new HttpError(409, 'Start play from the current published room version.');
  }
  if (viewer && (ownerUserId === viewer.id || current.claimer_user_id === viewer.id
    || (viewer.walletAddress && current.minted_owner_wallet_address?.toLowerCase() === viewer.walletAddress.toLowerCase()))) {
    throw new HttpError(409, 'Your own rooms do not count toward Lost Song progress.');
  }
  const snapshot = published.version === body.roomVersion ? published
    : (await loadExactRoomVersion(env, body.roomId, body.roomVersion))?.snapshot;
  if (!snapshot || getLostSongPlacementError(snapshot.placedObjects)) throw new HttpError(409, 'This room has an invalid Lost Song placement.');
  const song = snapshot.placedObjects.find(object => object.id === LOST_SONG_OBJECT_ID && (object.layer ?? 'terrain') === 'terrain');
  if (!song) throw new HttpError(404, 'No Lost Song is published in this room cell.');
  return { song, ownerUserId };
}

export async function userOwnsSongRoom(env: Env, userId: string, roomId: string): Promise<boolean> {
  const own = await env.DB.prepare(`SELECT 1 AS owned FROM rooms r JOIN users u ON u.id = ?
    WHERE r.id = ? AND (r.claimer_user_id = u.id OR (u.wallet_address IS NOT NULL
      AND LOWER(r.minted_owner_wallet_address) = LOWER(u.wallet_address)))`).bind(userId, roomId).first();
  return own !== null;
}
