import { describe, expect, it } from 'vitest';
import { buildVerificationTrigger,createRoomVerificationTrigger,createCourseVerificationTrigger } from './verification';

const roomGoal={type:'reach_exit' as const,exit:{x:600,y:256},timeLimitMs:null};
const courseGoal={...roomGoal,exit:{...roomGoal.exit,roomId:'0,0'}};
const at='2026-10-06T12:00:00.000Z';
const candidate={attemptId:'new',userId:'player',elapsedMs:9000,deaths:0,score:100,finishedAt:at};
const top={attempt_id:'top',user_id:'leader',elapsed_ms:10000,deaths:0,score:100,finished_at:at,overall_rank:'1'};
const viewer={...top,attempt_id:'old',user_id:'player',elapsed_ms:20000,overall_rank:'12'};

describe('shared stored-rank input for verification triggers (F273)',()=>{
  it.each(['room','course'] as const)('keeps %s rank transitions and verification requirements from string D1 ranks',kind=>{
    const input={candidate,currentTopRows:[top,viewer],viewerBestRow:viewer,pointAwardPotential:true};
    const trigger=kind==='room' ? buildVerificationTrigger(createRoomVerificationTrigger,roomGoal,input)
      : buildVerificationTrigger(createCourseVerificationTrigger,courseGoal,input);
    expect(trigger).toMatchObject({required:true,reason:'take_top_1',predictedRank:1,previousRank:12,
      previousBestElapsedMs:10000,pointAwardPotential:true});
  });
  it.each(['room','course'] as const)('keeps %s null viewer ranks and verification for a new leaderboard entry',kind=>{
    const input={candidate:{...candidate,elapsedMs:30000},currentTopRows:[{...top,overall_rank:null}],viewerBestRow:null,pointAwardPotential:true};
    const trigger=kind==='room' ? buildVerificationTrigger(createRoomVerificationTrigger,roomGoal,input)
      : buildVerificationTrigger(createCourseVerificationTrigger,courseGoal,input);
    expect(trigger).toMatchObject({required:true,previousRank:null,pointAwardPotential:true});
    expect(trigger.reason).toBe('enter_top_10');
  });
  it.each(['room','course'] as const)('keeps %s point-gain verification independent of rank gains',kind=>{
    const input={candidate:{...candidate,elapsedMs:30000},currentTopRows:[top,{...viewer,overall_rank:'2'}],
      viewerBestRow:{...viewer,overall_rank:'2'},pointAwardPotential:true};
    const trigger=kind==='room' ? buildVerificationTrigger(createRoomVerificationTrigger,roomGoal,input)
      : buildVerificationTrigger(createCourseVerificationTrigger,courseGoal,input);
    expect(trigger).toMatchObject({required:true,reason:'point_gain',predictedRank:2,previousRank:2,pointAwardPotential:true});
  });

});
