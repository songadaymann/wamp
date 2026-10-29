export interface ClearedRoomPage { userId: string; roomIds: string[]; nextCursor: string | null }
export function isClearedRoomId(value: unknown): value is string {
  if(typeof value!=='string'||! /^-?\d{1,6},-?\d{1,6}$/.test(value))return false;
  const [x,y]=value.split(',').map(Number);return value===`${x},${y}`;
}
/** At most the pinned sixteen-cell footprint; an explicit empty list means ineligible. */
export function normalizeClearedRoomIds(value: unknown): string[] | undefined {
  return Array.isArray(value)?[...new Set(value.slice(0,16).filter(isClearedRoomId))]:undefined;
}
let cleared=new Set<string>();
const listeners=new Set<()=>void>();
export function hasClearedRoom(roomId:string):boolean {return cleared.has(roomId);}
export function replaceClearedRooms(ids:Iterable<string>):void {
  const next=new Set(ids);
  if(next.size===cleared.size&&[...next].every(id=>cleared.has(id)))return;
  cleared=next;for(const listener of listeners)listener();
}
export function subscribeClearedRooms(listener:()=>void):()=>void {listeners.add(listener);return ()=>listeners.delete(listener);}
