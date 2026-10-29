import { getApiBaseUrl } from '../api/baseUrl';
import { loadGuestRunProgress } from './guestRunProgress';
import type { PostRunRatingRequestDetail } from './postRunRatingEvents';
import { isClearedRoomId, replaceClearedRooms, type ClearedRoomPage } from './clearedRooms';

export const CLEARED_ROOM_STORAGE_KEY='wamp_cleared_rooms_v1';
const MAX_GUEST_ROOMS=5000,REFRESH_MS=60_000;
type LoadPage=(cursor:string,signal:AbortSignal)=>Promise<ClearedRoomPage>;
type LoadExpanded=(id:string,version:number)=>Promise<string[]>;
async function loadPage(cursor:string,signal:AbortSignal):Promise<ClearedRoomPage> {
  const response=await fetch(`${getApiBaseUrl()}/api/me/cleared-rooms?${new URLSearchParams({cursor})}`,{
    credentials:'include',cache:'no-store',signal,
  });
  if(!response.ok)throw new Error('Map progress unavailable');
  const page=await response.json();
  if(typeof page.userId!=='string'||!Array.isArray(page.roomIds)||page.roomIds.length>512
    ||page.roomIds.some((id:unknown)=>!isClearedRoomId(id))
    ||(page.nextCursor!==null&&!isClearedRoomId(page.nextCursor)))throw new Error('Invalid map progress');
  return page;
}
async function loadExpanded(id:string,version:number):Promise<string[]> {
  const {loadPublishedExpandedFootprint}=await import('../expandedRooms/repository');
  return loadPublishedExpandedFootprint(id,version);
}
export class ClearedRoomService {
  private userId:string|null|undefined;
  private view=new Set<string>();
  private guest=new Set<string>();
  private readonly legacyResolved=new Set<string>();
  private listeners=new Set<()=>void>();
  private operation=0;
  private abort:AbortController|null=null;
  private pending=false;
  private loadedAt=0;
  private legacyRetryAfter=0;
  private status='';
  constructor(private readonly page:LoadPage=loadPage,private readonly storage:Storage|null=safeStorage(),
    private readonly local=()=>loadGuestRunProgress().records,private readonly expanded:LoadExpanded=loadExpanded) {
    this.readGuest();
  }
  snapshot(){return {total:this.view.size,pending:this.pending,status:this.status,guest:this.userId===null};}
  subscribe(listener:()=>void):()=>void {this.listeners.add(listener);return ()=>this.listeners.delete(listener);}
  async setUser(userId:string|null,force=false):Promise<void> {
    if(this.userId!==userId){this.userId=userId;this.operation++;this.abort?.abort();this.pending=false;this.loadedAt=0;this.status='';this.publish(new Set());}
    if(!force&&(this.pending||(userId!==null&&this.loadedAt&&Date.now()-this.loadedAt<REFRESH_MS)))return;
    const operation=++this.operation;this.abort?.abort();const abort=this.abort=new AbortController();
    const current=()=>this.operation===operation;
    this.pending=true;this.status='';this.emit();
    try {
      if(userId===null){await this.loadGuest(current);return;}
      const ids=new Set<string>(),seen=new Set<string>();let cursor='';
      do {
        const page=await this.page(cursor,abort.signal);if(!current())return;
        if(page.userId!==userId)throw new Error('Map progress identity changed');
        for(const id of page.roomIds)if(isClearedRoomId(id))ids.add(id);
        if(page.nextCursor&&seen.has(page.nextCursor))throw new Error('Map progress pagination stalled');
        if(page.nextCursor)seen.add(page.nextCursor);
        cursor=page.nextCursor??'';
      }while(cursor);
      this.loadedAt=Date.now();this.publish(ids);
    }catch {
      if(current())this.status='Map progress could not refresh. Return to retry.';
    }finally {if(current()){this.pending=false;this.emit();}}
  }
  rememberGuest(detail:PostRunRatingRequestDetail):void {
    if(this.userId!==null)return;
    const ids=detail.clearedRoomIds??(detail.contentType==='room'?[detail.contentId]:[]);
    for(const id of ids)if(isClearedRoomId(id))this.guest.add(id);
    this.saveGuest();this.publish(new Set(this.guest));
  }
  private async loadGuest(current:()=>boolean):Promise<void> {
    this.readGuest();const records=this.local();
    for(const record of records){
      const ids=record.clearedRoomIds??(record.contentType==='room'?[record.contentId]:[]);
      for(const id of ids)if(isClearedRoomId(id))this.guest.add(id);
    }
    this.saveGuest();this.publish(new Set(this.guest));
    if(Date.now()<this.legacyRetryAfter){this.status='Some older guest map progress could not load. Return to retry.';return;}
    const legacy=new Map<string,{id:string;version:number}>();
    for(const record of records)if(record.contentType!=='room'&&record.clearedRoomIds===undefined){
      const id=record.expandedRoomId??(record.contentType==='course'?`course:${record.contentId}`:record.contentId);
      const key=`${id}:${record.version}`;if(!this.legacyResolved.has(key))legacy.set(key,{id,version:record.version});
    }
    const entries=[...legacy];let failed=false;
    for(let start=0;start<entries.length;start+=4){
      await Promise.all(entries.slice(start,start+4).map(async([key,record])=>{
        if(!current())return;
        try {const ids=await this.expanded(record.id,record.version);if(!current())return;
          for(const id of ids)if(isClearedRoomId(id))this.guest.add(id);this.legacyResolved.add(key);
        }catch {if(current())failed=true;}
      }));
      if(!current())return;
    }
    if(failed){this.legacyRetryAfter=Date.now()+REFRESH_MS;this.status='Some older guest map progress could not load. Return to retry.';}
    this.saveGuest();this.publish(new Set(this.guest));
  }
  private readGuest():void {
    try {const value:unknown=JSON.parse(this.storage?.getItem(CLEARED_ROOM_STORAGE_KEY)??'[]');
      if(Array.isArray(value))for(const id of value.slice(-MAX_GUEST_ROOMS))if(isClearedRoomId(id))this.guest.add(id);
    }catch { /* Progress remains usable in memory when browser storage is blocked. */ }
  }
  private saveGuest():void {
    while(this.guest.size>MAX_GUEST_ROOMS)this.guest.delete(this.guest.values().next().value!);
    try {this.storage?.setItem(CLEARED_ROOM_STORAGE_KEY,JSON.stringify([...this.guest]));}catch { /* This tab still retains its checks. */ }
  }
  private publish(ids:Set<string>):void {this.view=ids;replaceClearedRooms(ids);this.emit();}
  private emit():void {for(const listener of this.listeners)listener();}
}
function safeStorage():Storage|null {try{return typeof window==='undefined'?null:window.localStorage;}catch{return null;}}
let service:ClearedRoomService|null=null;
export function getClearedRoomService():ClearedRoomService {return service??=new ClearedRoomService();}
