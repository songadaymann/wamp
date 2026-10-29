import { describe, expect, it, vi } from 'vitest';
import type { GuestRunProgressRecord } from '../progression/guestRunProgress';
import type { RoomDiscoveryEntry } from './model';
import { findKeepPlayingDestination } from './keepPlaying';
const entry=(id:string,extra:Partial<RoomDiscoveryEntry>={})=>({roomId:id,goalType:'reach_exit',...extra} as RoomDiscoveryEntry);
const options=()=>({clear:{contentId:'cleared',roomCoordinates:{x:0,y:0},difficulty:'medium' as const},signedIn:true,
  local:[] as GuestRunProgressRecord[],sessionClears:new Set<string>(),current:()=>true});
describe('next unbeaten destination',()=>{
 it('queries only personal unbeaten rooms and falls back from a labeled difficulty to all labels',async()=>{
   const load=vi.fn().mockResolvedValueOnce({results:[entry('cleared')]}).mockResolvedValueOnce({results:[entry('coop',{cooperative:true}),entry('none',{goalType:null}),entry('next')]});
   expect((await findKeepPlayingDestination({...options(),load}))?.roomId).toBe('next');
   expect(load.mock.calls.map(args=>args.slice(0,2))).toEqual([['medium','unbeaten'],[null,'unbeaten']]);
 });
 it('pages guest Popular results past known room and Expanded Room clears',async()=>{
   const load=vi.fn().mockResolvedValueOnce({results:[entry('done'),entry('member',{expandedRoom:{expandedRoomId:'expanded'} as never})],nextCursor:'next-page'})
     .mockResolvedValueOnce({results:[entry('new-room')]});
   const local=[{contentId:'done'},{contentId:'expanded'}] as GuestRunProgressRecord[];
   expect((await findKeepPlayingDestination({...options(),signedIn:false,local,load}))?.roomId).toBe('new-room');
   expect(load.mock.calls[0][1]).toBe('popular');expect(load.mock.calls[1][4]).toBe('next-page');
 });
 it('never navigates or starts another request after the originating clear/account changes',async()=>{
   let current=true;const load=vi.fn(async()=>{current=false;return {results:[entry('late')],nextCursor:'more',difficultyFilter:null,sort:'popular' as const};});
   expect(await findKeepPlayingDestination({...options(),load,current:()=>current})).toBeNull();expect(load).toHaveBeenCalledOnce();
 });
 it('excludes a just-completed unsaved run in the current session and reports an exhausted catalog honestly',async()=>{
   const load=vi.fn(async()=>({results:[entry('cleared'),entry('session')],difficultyFilter:null,sort:'unbeaten' as const}));
   expect(await findKeepPlayingDestination({...options(),clear:{...options().clear,difficulty:null},sessionClears:new Set(['session']),load})).toBeNull();
   expect(load).toHaveBeenCalledOnce();
 });
});
