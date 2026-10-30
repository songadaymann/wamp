import { createHash } from 'node:crypto';
import { getAuthoringCatalog } from '../agentBuilder/authoringCatalog';
import { ROOM_GOAL_DEFINITIONS, type CollectTargetGoal } from './roomGoals';
import { type CourseGoal } from '../courses/model';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { ROOM_GOAL_TYPES, createDefaultRoomGoal, normalizeRoomGoal, cloneRoomGoal } from './roomGoals';
import { COURSE_GOAL_TYPES, createDefaultCourseGoal, normalizeCourseGoal, cloneCourseGoal } from '../courses/model';

describe('goal data compatibility', () => {
  it('preserves public type order and the course subset', () => {
    expect(ROOM_GOAL_TYPES).toEqual(['reach_exit','collect_target','collect_race','defeat_all','checkpoint_sprint','survival','npc_quest']);
    expect(COURSE_GOAL_TYPES).toEqual(['reach_exit','collect_target','defeat_all','checkpoint_sprint','survival']);
  });
  it('keeps distinct authored defaults and normalization fallback counts', () => {
    expect(createDefaultRoomGoal('collect_target')).toEqual({type:'collect_target',requiredCount:3,timeLimitMs:null});
    expect(createDefaultCourseGoal('collect_target')).toEqual({type:'collect_target',requiredCount:5,timeLimitMs:null});
    expect(normalizeRoomGoal({type:'collect_target'})).toEqual({type:'collect_target',requiredCount:1,timeLimitMs:null});
    expect(normalizeCourseGoal({type:'collect_target'})).toEqual({type:'collect_target',requiredCount:1,timeLimitMs:null});
    expect(normalizeRoomGoal({type:'survival',durationMs:Infinity})).toEqual({type:'survival',durationMs:30000});
    expect(normalizeCourseGoal({type:'survival',durationMs:0.4})).toEqual({type:'survival',durationMs:30000});
  });
  it.each([undefined,null,[],{}, {type:'future_goal'}, {type:'toString'}, {type:'__proto__'}, {type:'constructor'}])('rejects unknown goal data: %j', value => {
    expect(normalizeRoomGoal(value)).toBeNull(); expect(normalizeCourseGoal(value)).toBeNull();
  });
  it('does not promote room-only goals into courses', () => {
    expect(normalizeCourseGoal(createDefaultRoomGoal('collect_race'))).toBeNull();
    expect(normalizeCourseGoal(createDefaultRoomGoal('npc_quest'))).toBeNull();
  });
  it('preserves finite coordinates, integer rounding and course marker identity', () => {
    expect(normalizeRoomGoal({type:'checkpoint_sprint',checkpoints:[{x:0,y:-4},{x:Infinity,y:1},{x:'2',y:2}],finish:{x:2,y:NaN},timeLimitMs:0.5})).toEqual({type:'checkpoint_sprint',checkpoints:[{x:0,y:-4}],finish:null,timeLimitMs:1});
    expect(normalizeCourseGoal({type:'checkpoint_sprint',checkpoints:[{roomId:' 0,0 ',x:0,y:-4},{roomId:' ',x:1,y:2},{x:1,y:2}],finish:{roomId:'1,0',x:2,y:3},timeLimitMs:1234.5})).toEqual({type:'checkpoint_sprint',checkpoints:[{roomId:' 0,0 ',x:0,y:-4}],finish:{roomId:'1,0',x:2,y:3},timeLimitMs:1235});
  });
  it('clones marker arrays deeply while dropping unrelated fields', () => {
    const room = {type:'checkpoint_sprint' as const,checkpoints:[{x:1,y:2}],finish:{x:3,y:4},timeLimitMs:null,unrelated:'drop'};
    const course = {type:'checkpoint_sprint' as const,checkpoints:[{roomId:'0,0',x:1,y:2}],finish:{roomId:'1,0',x:3,y:4},timeLimitMs:null,unrelated:'drop'};
    const r=cloneRoomGoal(room),c=cloneCourseGoal(course);
    expect(r).toEqual({type:'checkpoint_sprint',checkpoints:[{x:1,y:2}],finish:{x:3,y:4},timeLimitMs:null});
    expect(c).toEqual({type:'checkpoint_sprint',checkpoints:[{roomId:'0,0',x:1,y:2}],finish:{roomId:'1,0',x:3,y:4},timeLimitMs:null});
    if(r?.type!=='checkpoint_sprint'||c?.type!=='checkpoint_sprint')throw Error('Wrong cloned type');
    r.checkpoints[0].x=90;c.checkpoints[0].x=90;if(r.finish)r.finish.y=90;if(c.finish)c.finish.y=90;
    expect(room.checkpoints[0].x).toBe(1);expect(course.checkpoints[0].x).toBe(1);expect(room.finish.y).toBe(4);expect(course.finish.y).toBe(4);
  });
});

describe('typed goal registry boundaries', () => {
  it('keeps each handler tied to its own goal and excludes unsupported course goals', () => {
    expectTypeOf(ROOM_GOAL_DEFINITIONS.collect_target.clone).parameter(0).toEqualTypeOf<CollectTargetGoal>();
    expectTypeOf<Extract<CourseGoal, {type:'npc_quest' | 'collect_race'}>>().toEqualTypeOf<never>();
  });
  it('creates independent marker lists for each room and course draft', () => {
    const room = createDefaultRoomGoal('checkpoint_sprint');
    const course = createDefaultCourseGoal('checkpoint_sprint');
    if (room.type !== 'checkpoint_sprint' || course.type !== 'checkpoint_sprint') throw Error('Wrong default type');
    room.checkpoints.push({x:1,y:2});course.checkpoints.push({roomId:'0,0',x:1,y:2});
    expect(createDefaultRoomGoal('checkpoint_sprint')).toEqual({type:'checkpoint_sprint',checkpoints:[],finish:null,timeLimitMs:null});
    expect(createDefaultCourseGoal('checkpoint_sprint')).toEqual({type:'checkpoint_sprint',checkpoints:[],finish:null,timeLimitMs:null});
  });
  it('keeps the released authoring goal catalog byte-for-byte compatible', () => {
    // Read-only production baseline captured before the registry refactor.
    expect(createHash('sha256').update(JSON.stringify(getAuthoringCatalog().goals)).digest('hex'))
      .toBe('8b3d9d7719a07e3143def1ea23bbb4fea9145f58b8c9e2508362ac741211cb0e');
  });
});
