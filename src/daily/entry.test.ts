import { describe,expect,it } from 'vitest';
import { dailyEntryReady } from './entry';
import type { DailyResponse } from './model';
const response:DailyResponse={date:'2026-10-05',resetsAt:'2026-10-06T00:00:00.000Z',leaderboard:[],rankingMode:'time',recentPicks:[],viewer:null,bonusPxp:5,
  pick:{date:'2026-10-05',contentType:'room',contentId:'-11,-5',targetKey:'room:-11,-5',version:2,roomVersion:2,roomId:'-11,-5',
    coordinates:{x:-11,y:-5},title:'Daily',builderUserId:'b',builderDisplayName:'Builder',cellCount:1,legacyCourseId:null,playPath:'/r/-11/-5?from=share&daily=2026-10-05',available:true}};
describe('daily deep-link autoplay gate',()=>{
  it('requires today’s available level and the actually loaded published room version',async()=>{
    const repo={load:async()=>response};
    expect(await dailyEntryReady(repo,'2026-10-05',{x:-11,y:-5},2)).toBe(true);
    expect(await dailyEntryReady(repo,'2026-10-04',{x:-11,y:-5},2)).toBe(false);
    expect(await dailyEntryReady(repo,'2026-10-05',{x:0,y:0},2)).toBe(false);
    expect(await dailyEntryReady(repo,'2026-10-05',{x:-11,y:-5},3)).toBe(false);
  });
  it('keeps member pins independent of an expanded assembly’s version',async()=>{
    const expanded={...response,pick:{...response.pick!,contentType:'expanded_room' as const,roomVersion:1,version:7}};
    expect(await dailyEntryReady({load:async()=>expanded},'2026-10-05',{x:-11,y:-5},1)).toBe(true);
    expect(await dailyEntryReady({load:async()=>({...expanded,pick:{...expanded.pick,available:false}})},'2026-10-05',{x:-11,y:-5},1)).toBe(false);
  });
});
