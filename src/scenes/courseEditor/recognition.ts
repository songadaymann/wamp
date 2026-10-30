import type { CourseRecord } from '../../courses/model';
import { expandedRoomIdFromLegacyCourseId } from '../../expandedRooms/model';
import { confirmPublishRecognition } from '../../publishing/recognition';
import { getAuthDebugState } from '../../auth/client';
interface SceneEvents { once(name:string,listener:()=>void):unknown;off(name:string,listener:()=>void):unknown }
interface Cell {roomId:string;roomTitle:string|null;publishedVersion:number;coordinates:{x:number;y:number}}
async function withLifetime(events:SceneEvents|undefined,work:(signal:AbortSignal)=>Promise<boolean>):Promise<boolean> {
  const abort=new AbortController(),cancel=()=>abort.abort();
  for(const name of ['sleep','shutdown'])events?.once(name,cancel);
  try{return await work(abort.signal);}finally{for(const name of ['sleep','shutdown'])events?.off(name,cancel);}
}
export function confirmExpandedPublishRecognition(course:CourseRecord,userId:string|null,current:()=>boolean,events?:SceneEvents):Promise<boolean> {
  return withLifetime(events,signal=>confirmPublishRecognition({targetKey:`expanded_room:${expandedRoomIdFromLegacyCourseId(course.draft.id)}`,
    version:course.published?.version??0,userId,current,signal}));
}
export function confirmCellPublishRecognition(cells:Cell[],userId:string|null,current:(cell:Cell)=>boolean,events?:SceneEvents):Promise<boolean> {
  return withLifetime(events,async signal=>{
    for(const cell of cells)if(!await confirmPublishRecognition({targetKey:`room:${cell.roomId}`,version:cell.publishedVersion,
      label:cell.roomTitle||`Room ${cell.coordinates.x},${cell.coordinates.y}`,userId,signal,
      current:()=>current(cell)&&getAuthDebugState().user?.id===userId}))return false;
    return true;
  });
}
