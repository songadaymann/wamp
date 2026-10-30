import { requireAuthenticatedRequestAuth } from '../auth/request';
import { HttpError, jsonResponse } from '../core/http';
import type { Env } from '../core/types';

export async function handlePublishRecognition(request:Request,url:URL,env:Env):Promise<Response> {
  await requireAuthenticatedRequestAuth(env,request,'check publication recognition','rooms:read');
  const targetKey=url.searchParams.get('targetKey')??'',raw=url.searchParams.get('version')??'';
  const version=Number(raw);
  if(targetKey.length>256||!/^((room:-?\d+,-?\d+)|(expanded_room:.+))$/.test(targetKey)
    ||!/^\d+$/.test(raw)||!Number.isSafeInteger(version)||version<1)throw new HttpError(400,'A published target and version are required.');
  const row=await env.DB.prepare(`SELECT
    EXISTS(SELECT 1 FROM featured_rooms f JOIN playable_content_index i
      ON i.target_key=COALESCE(f.target_key,'room:'||f.room_id) AND i.version_key=COALESCE(f.target_version,f.room_version)
      WHERE i.target_key=? AND i.version_key=?) AS featured,
    EXISTS(SELECT 1 FROM daily_rooms WHERE date=? AND target_key=? AND version=?) AS daily`)
    .bind(targetKey,version,new Date().toISOString().slice(0,10),targetKey,version)
    .first<{featured:number;daily:number}>();
  return jsonResponse(request,{targetKey,version,featured:row?.featured===1,roomOfTheDay:row?.daily===1},
    {headers:{'Cache-Control':'private, no-store',Vary:'Origin, Cookie, Authorization'}});
}
