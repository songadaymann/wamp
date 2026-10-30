import { HttpError, jsonResponse, parseOptionalPositiveIntegerQueryParam } from '../core/http';
import type { Env } from '../core/types';
import {
  loadExpandedRoomTarget,
  resolveExpandedRoomAtCoordinates,
} from './store';

export async function handleExpandedRoomGet(
  request: Request,
  env: Env,
  expandedRoomId: string
): Promise<Response> {
  const target = await loadExpandedRoomTarget(env, expandedRoomId);
  if (!target) {
    throw new HttpError(404, 'Expanded room not found.');
  }

  return jsonResponse(request, target);
}

export async function handleExpandedRoomByCoordinateGet(
  request: Request,
  env: Env,
  xRaw: string,
  yRaw: string
): Promise<Response> {
  const coordinates = {
    x: parseIntegerPathSegment(xRaw, 'x'),
    y: parseIntegerPathSegment(yRaw, 'y'),
  };
  const target = await resolveExpandedRoomAtCoordinates(env, coordinates);
  if (!target) {
    throw new HttpError(404, 'Expanded room not found.');
  }

  return jsonResponse(request, target);
}

function parseIntegerPathSegment(value: string, label: string): number {
  if (!/^-?\d+$/.test(value)) {
    throw new HttpError(400, `${label} must be an integer.`);
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new HttpError(400, `${label} must be a safe integer.`);
  }

  return parsed;
}

/** Published geometry only, never a claim that the caller completed this content. */
export async function handleExpandedRoomFootprint(request:Request,url:URL,env:Env,id:string):Promise<Response> {
  const version=parseOptionalPositiveIntegerQueryParam(url.searchParams,'version');
  if(version===null)throw new HttpError(400,'A published footprint version is required.');
  const target=await loadExpandedRoomTarget(env,id);
  if(!target)throw new HttpError(404,'Expanded room not found.');
  let roomIds:string[]=[];
  if(target.source==='standalone_room') {
    const published=await env.DB.prepare(`SELECT 1 FROM room_versions version JOIN rooms room ON room.id=version.room_id
      WHERE version.room_id=? AND version.version=? AND room.id=printf('%d,%d',room.x,room.y)
        AND NOT EXISTS(SELECT 1 FROM world_room_claims w WHERE w.room_id=room.id AND w.world_id<>'wamp-prime')`)
      .bind(target.anchorRoomId,version).first();
    if(published)roomIds=[target.anchorRoomId];
  } else {
    const visible=`JOIN rooms room ON room.id=cell.room_id
      WHERE room.id=printf('%d,%d',room.x,room.y)
        AND NOT EXISTS(SELECT 1 FROM world_room_claims w WHERE w.room_id=room.id AND w.world_id<>'wamp-prime')`;
    const native=await env.DB.prepare(`SELECT cell.room_id FROM expanded_room_cells cell ${visible}
      AND cell.expanded_room_id=? AND cell.expanded_room_version=? ORDER BY cell.cell_order LIMIT 17`)
      .bind(target.expandedRoomId,version).all<{room_id:string}>();
    roomIds=native.results.map(row=>row.room_id);
    if(!roomIds.length&&target.legacyCourseId){
      const legacy=await env.DB.prepare(`SELECT cell.room_id FROM course_room_refs cell ${visible}
        AND cell.course_id=? AND cell.course_version=? ORDER BY cell.room_order LIMIT 17`)
        .bind(target.legacyCourseId,version).all<{room_id:string}>();
      roomIds=legacy.results.map(row=>row.room_id);
    }
  }
  if(!roomIds.length)throw new HttpError(404,'Published footprint not found.');
  if(roomIds.length>16)throw new HttpError(409,'Published footprint is invalid.');
  return jsonResponse(request,{expandedRoomId:id,version,roomIds},{headers:{'Cache-Control':'no-store'}});
}
