import {describe,expect,expectTypeOf,it} from 'vitest';
import {ROOM_GOAL_DEFINITIONS,createDefaultRoomGoal,type RoomGoal,type CollectTargetGoal} from './roomGoals';
import {COURSE_GOAL_DEFINITIONS,createDefaultCourseGoal} from '../courses/model';
import type {RunFinishRequestBody,RoomRunRecord} from '../runs/model';
import {computeRunScore,getLeaderboardRankingMode,compareLeaderboardEntries,sortCompletedRunsForLeaderboard} from '../runs/scoring';
import {computeCourseRunScore,getCourseLeaderboardRankingMode,compareCourseLeaderboardEntries} from '../courses/scoring';
const finish=(changes:Partial<RunFinishRequestBody>={}):RunFinishRequestBody=>({result:'completed' as const,elapsedMs:0,deaths:0,collectiblesCollected:0,enemyCollectiblesCollected:0,enemiesDefeated:0,checkpointsReached:0,...changes});
describe('goal scoring and ranking compatibility',()=>{
 it('preserves the implicit 90-second room bonus and explicit time-limit weights',()=>{
  expect(computeRunScore(createDefaultRoomGoal('reach_exit'),finish())).toBe(460);
  expect(computeRunScore({type:'reach_exit',exit:null,timeLimitMs:10000},finish({elapsedMs:2000,deaths:1}))).toBe(128);
  expect(computeRunScore(createDefaultRoomGoal('collect_target'),finish({collectiblesCollected:2}))).toBe(380);
  expect(computeRunScore(createDefaultRoomGoal('collect_race'),finish({collectiblesCollected:2}))).toBe(350);
  expect(computeRunScore(createDefaultRoomGoal('defeat_all'),finish({enemiesDefeated:2}))).toBe(410);
  expect(computeRunScore(createDefaultRoomGoal('checkpoint_sprint'),finish({checkpointsReached:3,deaths:1}))).toBe(130);
 });
 it('preserves result-dependent bonuses and the existing unconditional room awards',()=>{
  expect(computeRunScore(createDefaultRoomGoal('reach_exit'),finish({result:'failed' as const}))).toBe(460);
  expect(computeRunScore(createDefaultRoomGoal('collect_target'),finish({result:'failed' as const,collectiblesCollected:2}))).toBe(320);
  expect(computeRunScore(createDefaultRoomGoal('collect_race'),finish({result:'failed' as const,collectiblesCollected:2}))).toBe(230);
  expect(computeRunScore(createDefaultRoomGoal('defeat_all'),finish({result:'failed' as const,enemiesDefeated:2}))).toBe(330);
  expect(computeRunScore(createDefaultRoomGoal('checkpoint_sprint'),finish({result:'failed' as const,checkpointsReached:3}))).toBe(150);
 });
 it('keeps room survival flooring, duration cap, pickup awards and clamped zero-death behavior',()=>{
  const goal={type:'survival' as const,durationMs:30000},body=finish({elapsedMs:12900,collectiblesCollected:2,enemiesDefeated:1});
  expect(computeRunScore(goal,{...body,result:'failed' as const})).toBe(180);
  expect(computeRunScore(goal,body)).toBe(330);
  expect(computeRunScore(goal,{...body,elapsedMs:45000})).toBe(510);
  expect(computeRunScore(goal,{...body,elapsedMs:45000,deaths:1})).toBe(440);
  expect(computeRunScore(goal,{...body,elapsedMs:45000,deaths:-1})).toBe(510);
 });
 it('keeps course weights, rounding and its raw zero-death test distinct',()=>{
  expect(computeCourseRunScore(createDefaultCourseGoal('collect_target'),finish())).toBe(350);
  const goal={type:'survival' as const,durationMs:30000},body=finish({elapsedMs:12900});
  expect(computeCourseRunScore(goal,body)).toBe(415);
  expect(computeCourseRunScore(goal,{...body,deaths:-1})).toBe(315);
  expect(computeCourseRunScore(goal,{...body,result:'failed' as const})).toBe(0);
  expect(computeCourseRunScore(goal,{...body,collectiblesCollected:2,enemiesDefeated:1,checkpointsReached:3})).toBe(610);
 });
 const entries=[
  {id:'A',elapsedMs:1000,deaths:1,score:100,finishedAt:'2026-10-15T00:00:03Z'},
  {id:'B',elapsedMs:2000,deaths:0,score:100,finishedAt:'2026-10-15T00:00:04Z'},
  {id:'C',elapsedMs:1000,deaths:0,score:90,finishedAt:'2026-10-15T00:00:02Z'},
  {id:'D',elapsedMs:1000,deaths:0,score:100,finishedAt:'2026-10-15T00:00:01Z'},
  {id:'E',elapsedMs:1000,deaths:0,score:100,finishedAt:'2026-10-15T00:00:00Z'},
 ];
 it('preserves room time, room score, Protect elapsed ranking and every tie-break order',()=>{
  const ranked=(goal:RoomGoal)=>[...entries].sort((a,b)=>compareLeaderboardEntries(a,b,goal)).map(row=>row.id);
  expect(ranked(createDefaultRoomGoal('reach_exit'))).toEqual(['E','D','C','A','B']);
  expect(ranked(createDefaultRoomGoal('survival'))).toEqual(['E','D','B','A','C']);
  expect(ranked(createDefaultRoomGoal('npc_quest'))).toEqual(['B','E','D','C','A']);
 });
 it('preserves course score/time tie order and Reach Exit’s scope-specific mode',()=>{
  const goal=createDefaultCourseGoal('reach_exit');if(goal.type!=='reach_exit')throw Error('Wrong goal');
  expect(getCourseLeaderboardRankingMode(goal)).toBe('score');expect(getLeaderboardRankingMode(createDefaultRoomGoal('reach_exit'))).toBe('time');
  expect([...entries].sort((a,b)=>compareCourseLeaderboardEntries(a,b,goal)).map(row=>row.id)).toEqual(['E','D','A','B','C']);
  goal.timeLimitMs=1000;expect(getCourseLeaderboardRankingMode(goal)).toBe('time');
  expect([...entries].sort((a,b)=>compareCourseLeaderboardEntries(a,b,goal)).map(row=>row.id)).toEqual(['E','D','C','A','B']);
 });
 it('preserves failed Protect eligibility and excludes unfinished/null room records',()=>{
  const fixtures=[{...entries[0],attemptId:'completed',result:'completed' as const},{...entries[1],attemptId:'failed',result:'failed' as const}, {...entries[2],attemptId:'active',result:'active' as const},{...entries[3],attemptId:'no-time',elapsedMs:null,result:'completed' as const},{...entries[4],attemptId:'no-date',finishedAt:null,result:'completed' as const}];
  const rows:RoomRunRecord[]=fixtures.map(row=>({roomId:'0,0',roomCoordinates:{x:0,y:0},roomVersion:1,goalType:'reach_exit',goal:createDefaultRoomGoal('reach_exit'),userId:'player',userDisplayName:'Player',startedAt:'2026-10-15T00:00:00Z',collectiblesCollected:0,enemiesDefeated:0,checkpointsReached:0,...row}));
  expect(sortCompletedRunsForLeaderboard(rows,createDefaultRoomGoal('reach_exit')).map(row=>row.attemptId)).toEqual(['completed']);
  expect(sortCompletedRunsForLeaderboard(rows,createDefaultRoomGoal('npc_quest')).map(row=>row.attemptId)).toEqual(['failed','completed']);
 });
});

describe('goal scoring policy contracts', () => {
 it('preserves Protect elapsed caps and Give/Escort pickup weights', () => {
  const goal=createDefaultRoomGoal('npc_quest');
  if(goal.type!=='npc_quest')throw Error('Wrong default');
  expect(computeRunScore(goal,finish({elapsedMs:12900,result:'failed',deaths:1}))).toBe(100);
  expect(computeRunScore(goal,finish({elapsedMs:45000}))).toBe(300);
  expect(computeRunScore({...goal,questType:'give'},finish({collectiblesCollected:3,deaths:1}))).toBe(110);
  expect(computeRunScore({...goal,questType:'escort'},finish({collectiblesCollected:3,deaths:1}))).toBe(80);
 });
 it('requires typed room policies and explicit supported-course policies', () => {
  expectTypeOf(ROOM_GOAL_DEFINITIONS.collect_target.roomScoring.score).parameter(0).toEqualTypeOf<CollectTargetGoal>();
  expectTypeOf(ROOM_GOAL_DEFINITIONS.collect_race.courseScoring).toEqualTypeOf<null>();
  expectTypeOf(COURSE_GOAL_DEFINITIONS.npc_quest.courseScoring).toEqualTypeOf<null>();
  expectTypeOf(COURSE_GOAL_DEFINITIONS.collect_target.courseScoring.score).parameter(0).toEqualTypeOf<Extract<ReturnType<typeof createDefaultCourseGoal>, {type:'collect_target'}>>();
 });
});
