import { describe, expect, it } from 'vitest';
import { guestDailyProgress } from './guestProgress';
import type { DailyResponse } from './model';
import type { GuestRunProgressRecord } from '../progression/guestRunProgress';
const response:DailyResponse={date:'2026-10-05',resetsAt:'2026-10-06T00:00:00.000Z',pick:null,rankingMode:'time',leaderboard:[],viewer:null,bonusPxp:5,
  recentPicks:[{date:'2026-10-05',contentType:'room',contentId:'0,0',version:2,legacyCourseId:null},
    {date:'2026-10-04',contentType:'expanded_room',contentId:'course:level',version:3,legacyCourseId:'level'}]};
const record=(date='2026-10-05',version=2,status:'saved'|'queued'|'unverified'='saved'):GuestRunProgressRecord=>({id:crypto.randomUUID(),contentType:'room',contentId:'0,0',version,
  completedAt:`${date}T12:00:00.000Z`,contentTitle:'Room',elapsedMs:1000,deaths:0,score:null,potentialPxp:20,
  guestProgress:{status,durable:true,clientRunId:'client',attemptId:'attempt',reason:null}});
describe('gentle daily guest completion count',()=>{
  it('counts verified dates once and requires the exact picked version',()=>{
    expect(guestDailyProgress(response,[record(),record(),record('2026-10-05',1),record('2026-10-04')])).toEqual({completed:true,completedLast7:1});
  });
  it('ignores queued, rejected, legacy unverified and unavailable storage-only clears',()=>{
    expect(guestDailyProgress(response,[record('2026-10-05',2,'queued'),record('2026-10-05',2,'unverified'),{...record(),guestProgress:undefined},
      {...record(),guestProgress:{...record().guestProgress!,durable:false}}])).toEqual({completed:false,completedLast7:0});
  });
  it('recognizes native and legacy expanded identities without counting a member cell or another day',()=>{
    expect(guestDailyProgress(response,[{...record('2026-10-04',3),contentType:'expanded_room',contentId:'course:level'},
      {...record('2026-10-04',3),contentType:'course',contentId:'level'},record('2026-10-03')])).toEqual({completed:false,completedLast7:1});
  });
});
