import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultCourseSnapshot } from '../../../courses/model';
import type { CourseRunRecord } from '../../../courses/runModel';
import { NOW, fixture, params, run } from '../activity/testDatabase';
import { loadCourseRecord } from '../courses/store';
import { awardRoomCreatorCompletionPoints, awardCourseCreatorCompletionPoints } from '../runs/points';
import { awardRoomRunProgression, awardCourseRunProgression } from './awards';
import { submitRoomRating, submitCourseRating } from './ratings';

type Kind = 'room' | 'course';
const FINISHED = '2026-10-06T12:00:00.000Z';
const votes = { qualityStars: 4, difficultyChoice: 'hard' as const, autoSuggestedDifficulty: 'hard' as const };
async function scenario(kind: Kind, status = 'passed') {
  const f = fixture();
  const courseGoal = { type: 'reach_exit' as const, exit: { roomId: '0,0', x: 700, y: 320 }, timeLimitMs: null };
  const snapshot = { ...createDefaultCourseSnapshot('golden'), title: 'Golden course', status: 'published', publishedAt: NOW,
    roomRefs: [{ roomId: '0,0', coordinates: { x: 0, y: 0 }, roomVersion: 1, roomTitle: 'Lava Gauntlet' }],
    startPoint: { roomId: '0,0', x: 320, y: 256 }, goal: courseGoal };
  const json = JSON.stringify(snapshot);
  f.sqlite.prepare(`INSERT INTO courses(id,owner_user_id,owner_display_name,draft_json,published_json,published_version,created_at,updated_at)
    VALUES('golden','builder','builder',?,?,1,?,?)`).run(json,json,NOW,NOW);
  f.sqlite.prepare(`INSERT INTO course_versions(course_id,version,snapshot_json,created_at,published_by_user_id)
    VALUES('golden',1,?,?,'builder')`).run(json,NOW);
  const record = (await loadCourseRecord(f.env, 'golden', 'p1'))!;
  const value = run(f, `${kind}-attempt`, 'p1', 9000, status);
  const courseRun: CourseRunRecord = { ...value, courseId: 'golden', courseVersion: 1, goalType:'reach_exit', goal: courseGoal };
  f.sqlite.prepare(`INSERT INTO course_runs(attempt_id,course_id,course_version,goal_type,goal_json,user_id,user_display_name,
    started_at,finished_at,result,elapsed_ms,verification_status,score) VALUES(?,'golden',1,'reach_exit',?,'p1','p1',?,?,'completed',9000,?,100)`)
    .run(courseRun.attemptId,JSON.stringify(courseGoal),NOW,FINISHED,status);
  // Only the selected kind exists as a completed run for this player.
  if (kind === 'course') f.sqlite.prepare('DELETE FROM room_runs WHERE attempt_id=?').run(value.attemptId);
  else f.sqlite.prepare('DELETE FROM course_runs WHERE attempt_id=?').run(value.attemptId);
  const award = () => kind === 'room'
    ? awardRoomRunProgression(f.env,{...params(f.record,value),completedAt:FINISHED})
    : awardCourseRunProgression(f.env,{run:courseRun,goal:courseGoal,courseRecord:record,isFirstCompletion:true,isNewPersonalBest:true,creatorUserId:'builder',completedAt:FINISHED});
  const rate = () => kind === 'room'
    ? submitRoomRating(f.env,{roomRecord:f.record,userId:'p1',body:{roomCoordinates:{x:0,y:0},roomVersion:1,...votes},now:FINISHED})
    : submitCourseRating(f.env,{courseRecord:record,userId:'p1',body:{courseVersion:1,...votes},now:FINISHED});
  const creator = () => kind === 'room'
    ? awardRoomCreatorCompletionPoints(f.env,{creatorUserId:'builder',roomId:'0,0',roomVersion:1,finisherUserId:'p1',attemptId:value.attemptId,createdAt:FINISHED})
    : awardCourseCreatorCompletionPoints(f.env,{creatorUserId:'builder',courseId:'golden',courseVersion:1,finisherUserId:'p1',attemptId:value.attemptId,createdAt:FINISHED});
  const events = () => Object.fromEntries(['pxp','bxp','cxp','trust'].map(lane=>[lane,f.sqlite.prepare(`SELECT user_id,event_type,source_type,source_id,dedupe_key,amount FROM ${lane}_events ORDER BY user_id,dedupe_key`).all()]));
  return {...f,award,rate,creator,events};
}
beforeEach(()=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date(FINISHED));});
afterEach(()=>vi.useRealTimers());

describe('persisted room/course reward identities before sharing the core (F273)',()=>{
  it.each(['room','course'] as const)('pins %s reward amounts, event/source/dedupe bytes and replay behavior',async kind=>{
    const f=await scenario(kind);
    try {
      await f.award(); await f.rate(); await f.creator();
      const before=f.events();
      expect(before).toMatchSnapshot();
      const point=f.sqlite.prepare("SELECT user_id,event_type,source_key,points,breakdown_json FROM point_events WHERE event_type LIKE '%creator_completion' ORDER BY event_type").all();
      expect(point).toMatchSnapshot('creator points');
      await f.award();await f.rate();await f.creator();
      expect(f.events()).toEqual(before);
      expect((f.sqlite.prepare("SELECT COUNT(*) AS n FROM point_events WHERE event_type LIKE '%creator_completion'").get() as {n:number}).n).toBe(1);
    } finally {f.sqlite.close();}
  });
  it.each(['room','course'] as const)('gives rejected and timed-out %s clears no progression or rating eligibility',async kind=>{
    for(const status of ['failed','timeout']){
      const f=await scenario(kind,status);
      try {
        expect(await f.award()).toEqual({pxp:0,bxp:0,cxp:0,trust:0});
        expect(Object.values(f.events()).flat()).toHaveLength(0);
        await expect(f.rate()).rejects.toMatchObject({status:409,message:`Complete this ${kind==='room' ? 'room' : 'expanded room'} version window once before rating it.`});
      }finally{f.sqlite.close();}
    }
  });
  it('keeps accepted failed Protect attempts in room rank selection without giving them clear progression',async()=>{
    const f=fixture();
    try {
      const goal={type:'npc_quest' as const,questType:'protect' as const,npcInstanceId:null,durationMs:30000,
        requiredCount:1,destination:null,timeLimitMs:null};
      f.record.published!.goal=goal;
      const failed={...run(f,'legacy-protect','p2',35000,'not_required'),result:'failed' as const,
        goal,goalType:'npc_quest' as const,score:300};
      const completed={...run(f,'new-protect','p1',30000,'passed'),goal,goalType:'npc_quest' as const,score:300};
      for(const value of [failed,completed]) f.sqlite.prepare('UPDATE room_runs SET goal_type=?,goal_json=?,result=?,score=? WHERE attempt_id=?')
        .run(value.goalType,JSON.stringify(goal),value.result,value.score,value.attemptId);
      await awardRoomRunProgression(f.env,{...params(f.record,completed),completedAt:FINISHED});
      expect((f.sqlite.prepare("SELECT COUNT(*) AS n FROM pxp_events WHERE user_id='p1' AND event_type='top1_take'").get() as {n:number}).n).toBe(0);
      expect((f.sqlite.prepare("SELECT COUNT(*) AS n FROM pxp_events WHERE user_id='p1' AND event_type='top10_entry'").get() as {n:number}).n).toBe(1);
      expect(await awardRoomRunProgression(f.env,{...params(f.record,failed),completedAt:FINISHED}))
        .toEqual({pxp:0,bxp:0,cxp:0,trust:0});
      expect((f.sqlite.prepare("SELECT COUNT(*) AS n FROM pxp_events WHERE user_id='p2'").get() as {n:number}).n).toBe(0);
    }finally{f.sqlite.close();}
  });

});
