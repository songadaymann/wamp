import {describe,it,expect,vi} from 'vitest';
vi.mock('../../auth/client',()=>({getAuthDebugState:()=>({authenticated:false,source:null,user:null})}));
vi.mock('../../persistence/roomRepository',()=>({createRoomRepository:()=>({})}));
vi.mock('../../progression/postRunRatingEvents',()=>({requestPostRunGuestClaim:vi.fn(),requestPostRunRating:vi.fn()}));
vi.mock('../../progression/rewardStings',async importOriginal=>({...await importOriginal<typeof import('../../progression/rewardStings')>(),notifyRewardStings:vi.fn()}));
import {createDefaultRoomSnapshot} from '../../persistence/roomModel';
import {createDefaultRoomGoal,type RoomGoal} from '../../goals/roomGoals';
import type {RunRepository} from '../../runs/runRepository';
import {OverworldGoalRunController} from './goalRuns';
const baseRoom=createDefaultRoomSnapshot();
function start(goal:RoomGoal,entry:'spawn'|'transition'='spawn'){
 const repository={startRun:vi.fn(),finishRun:vi.fn(),loadRoomLeaderboard:vi.fn().mockResolvedValue(null),loadGlobalLeaderboard:vi.fn().mockResolvedValue(null)};
 const controller=new OverworldGoalRunController({playerHeight:14,runRepository:repository as unknown as RunRepository,getScore:()=>0,getAuthenticated:()=>false,getAuthSource:()=>'session',getAuthDisplayName:()=>null,countRoomObjectsByCategory:()=>10,getNowIso:()=>'2026-10-15T00:00:00.000Z'});
 controller.syncRunForRoom({...baseRoom,status:'published',spawnPoint:{x:64,y:256},goal},entry);
 return {controller,repository,run:()=>controller.getCurrentRun()!};
}
describe('room tick compatibility and priority',()=>{
 for(const type of ['reach_exit','collect_target','defeat_all','checkpoint_sprint'] as const)it(type+' fails exactly at its authored deadline',()=>{
  const goal=createDefaultRoomGoal(type);if(goal.type==='survival'||goal.type==='npc_quest')throw Error('Wrong goal');
  const {controller,run,repository}=start({...goal,timeLimitMs:1000});
  expect(controller.tick(999).changed).toBe(false);expect(run().result).toBe('active');
  expect(controller.tick(1)).toMatchObject({event:'fail',transientStatus:'Time up.'});expect(run()).toMatchObject({elapsedMs:1000,result:'failed',pendingResult:'failed'});
  expect(controller.tick(100).changed).toBe(false);expect(run().elapsedMs).toBe(1000);expect(repository.startRun).not.toHaveBeenCalled();expect(repository.finishRun).not.toHaveBeenCalled();
 });
 for(const [player,hunter,message,result] of [[2,1,'Collect race won 2-1.','completed'],[1,1,'Collect race tied 1-1.','failed'],[1,2,'Sword Hunter won 2-1.','failed']] as const)it(message+' resolves the race before generic timeout',()=>{
  const {controller,run}=start({type:'collect_race',timeLimitMs:1000});run().collectiblesCollected=player;run().enemyCollectiblesCollected=hunter;
  expect(controller.tick(1000).transientStatus).toBe(message);expect(run().result).toBe(result);
 });
 it('completes Survival and Protect at duration, leaving Escort/Give untimed',()=>{
  const survival=start({type:'survival',durationMs:1000});expect(survival.controller.tick(999).changed).toBe(false);expect(survival.controller.tick(1)).toMatchObject({event:'complete',transientStatus:'Survival clear.'});
  const goal=createDefaultRoomGoal('npc_quest');if(goal.type!=='npc_quest')throw Error('Wrong goal');
  const protect=start({...goal,durationMs:1000});expect(protect.controller.tick(999).changed).toBe(false);expect(protect.controller.tick(1)).toMatchObject({event:'complete',transientStatus:'NPC protected.'});
  for(const questType of ['escort','give'] as const){const other=start({...goal,questType,durationMs:1000});expect(other.controller.tick(5000).changed).toBe(false);expect(other.run()).toMatchObject({elapsedMs:5000,result:'active'});}
 });
 it('counts suspended milliseconds while deferring resolution, and practice does not advance',()=>{
  for(const goal of [{type:'reach_exit',exit:null,timeLimitMs:1000},{type:'collect_race',timeLimitMs:1000},{type:'survival',durationMs:1000}] as RoomGoal[]){
   const {controller,run}=start(goal);const noOp=controller.tick(2000,{suspendGoalResolution:true});expect(noOp.changed).toBe(false);expect(run()).toMatchObject({elapsedMs:2000,result:'active'});expect(controller.tick(0,{suspendGoalResolution:true})).toBe(noOp);expect(controller.tick(0).changed).toBe(true);
   const practice=start(goal,'transition');expect(practice.controller.tick(5000).changed).toBe(false);expect(practice.run()).toMatchObject({elapsedMs:0,result:'active',qualificationState:'practice'});
  }
 });
 it('preserves raw negative/fractional/non-finite delta handling',()=>{
  const {controller,run}=start({type:'survival',durationMs:1000});controller.tick(-10.5);expect(run().elapsedMs).toBe(-10.5);controller.tick(11);expect(run().elapsedMs).toBe(0.5);controller.tick(NaN);expect(run().elapsedMs).toBeNaN();expect(run().result).toBe('active');
  const infinite=start({type:'survival',durationMs:1000});expect(infinite.controller.tick(Infinity).event).toBe('complete');
 });
});
