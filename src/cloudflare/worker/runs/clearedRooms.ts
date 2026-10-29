import { isClearedRoomId, type ClearedRoomPage } from '../../../progression/clearedRooms';
import { requireAuthenticatedRequestAuth } from '../auth/request';
import { HttpError, jsonResponse } from '../core/http';
import type { Env } from '../core/types';
import { sqlIsVerificationAccepted } from './verificationSql';

export async function loadClearedRoomProgress(env:Env,userId:string,cursor=''):Promise<ClearedRoomPage> {
  const page=await env.DB.prepare(`WITH cleared AS (
    SELECT r.room_id FROM room_runs r
      WHERE r.user_id=? AND r.result='completed' AND r.finished_at IS NOT NULL AND ${sqlIsVerificationAccepted('r')}
    UNION
    SELECT cells.room_id FROM expanded_room_runs r JOIN expanded_room_cells cells
      ON cells.expanded_room_id=r.expanded_room_id AND cells.expanded_room_version=r.expanded_room_version
      WHERE r.user_id=? AND r.result='completed' AND r.finished_at IS NOT NULL AND ${sqlIsVerificationAccepted('r')}
  ) SELECT cleared.room_id FROM cleared JOIN rooms room ON room.id=cleared.room_id
    WHERE cleared.room_id>? AND room.id=printf('%d,%d',room.x,room.y)
      AND NOT EXISTS(SELECT 1 FROM world_room_claims w WHERE w.room_id=room.id AND w.world_id<>'wamp-prime')
    ORDER BY cleared.room_id LIMIT 513`).bind(userId,userId,cursor).all<{room_id:string}>();
  const rows=page.results;
  return {userId,roomIds:rows.slice(0,512).map(row=>row.room_id),nextCursor:rows.length>512?rows[511].room_id:null};
}
export async function handleClearedRoomProgress(request:Request,url:URL,env:Env):Promise<Response> {
  const auth=await requireAuthenticatedRequestAuth(env,request,'read your cleared-room map','rooms:read');
  const cursor=url.searchParams.get('cursor')??'';
  if(cursor&&!isClearedRoomId(cursor))throw new HttpError(400,'Invalid cleared-room progress cursor.');
  return jsonResponse(request,await loadClearedRoomProgress(env,auth.user.id,cursor),{
    headers:{'Cache-Control':'private, no-store',Vary:'Origin, Cookie, Authorization'},
  });
}
