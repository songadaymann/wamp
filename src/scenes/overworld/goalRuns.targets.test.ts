import {describe,it,expect,vi} from 'vitest';
vi.mock('../../auth/client',()=>({getAuthDebugState:()=>({authenticated:false,source:null,user:null})}));
vi.mock('../../persistence/roomRepository',()=>({createRoomRepository:()=>({})}));
vi.mock('../../progression/postRunRatingEvents',()=>({requestPostRunGuestClaim:vi.fn(),requestPostRunRating:vi.fn()}));
vi.mock('../../progression/rewardStings',async importOriginal=>({...await importOriginal<typeof import('../../progression/rewardStings')>(),notifyRewardStings:vi.fn()}));
import {createDefaultRoomSnapshot,type RoomSnapshot} from '../../persistence/roomModel';
import {createDefaultRoomGoal,type RoomGoal} from '../../goals/roomGoals';
import {OverworldGoalRunController} from './goalRuns';
function start(goal:RoomGoal,placedObjects:RoomSnapshot['placedObjects']=[],enemyCount=2){
 const counts=vi.fn((_room:RoomSnapshot,category:string)=>category==='collectible'?7:category==='enemy'?enemyCount:0);
 const controller=new OverworldGoalRunController({playerHeight:14,runRepository:{startRun:vi.fn(),finishRun:vi.fn(),loadRoomLeaderboard:vi.fn().mockResolvedValue(null),loadGlobalLeaderboard:vi.fn().mockResolvedValue(null)} as never,getScore:()=>0,getAuthenticated:()=>false,getAuthSource:()=>'session',getAuthDisplayName:()=>null,countRoomObjectsByCategory:counts,getNowIso:()=>'2026-10-15T00:00:00Z'});
 controller.syncRunForRoom({...createDefaultRoomSnapshot(),status:'published',goal,placedObjects},'spawn');return {counts,run:controller.getCurrentRun()!};
}
describe('goal run initial targets',()=>{
 it('counts only Race collectibles and Defeat enemies, preserving immediate empty-enemy completion',()=>{
  const race=start(createDefaultRoomGoal('collect_race'));expect(race.run.collectibleTarget).toBe(7);expect(race.counts.mock.calls.map(call=>call[1])).toEqual(['collectible']);
  const defeat=start(createDefaultRoomGoal('defeat_all'));expect(defeat.run.enemyTarget).toBe(2);expect(defeat.counts.mock.calls.map(call=>call[1])).toEqual(['enemy']);
  expect(start(createDefaultRoomGoal('defeat_all'),[],0).run).toMatchObject({enemyTarget:0,result:'completed'});
  for(const type of ['reach_exit','collect_target','checkpoint_sprint','survival','npc_quest'] as const)expect(start(createDefaultRoomGoal(type)).counts).not.toHaveBeenCalled();
 });
 it('keeps authored NPC identities and first-NPC fallback, including legacy empty identities',()=>{
  const goal=createDefaultRoomGoal('npc_quest');if(goal.type!=='npc_quest')throw Error('Wrong goal');
  const npcs=[{id:'jimothy',instanceId:'first',x:16,y:16},{id:'jimothy',instanceId:'second',x:32,y:16}];
  expect(start({...goal,questType:'give',requiredCount:4},npcs).run).toMatchObject({npcTargetInstanceId:'first',npcAlive:true,collectibleTarget:4});
  expect(start({...goal,npcInstanceId:'explicit'},npcs).run.npcTargetInstanceId).toBe('explicit');
  expect(start({...goal,npcInstanceId:''},npcs).run.npcTargetInstanceId).toBe('');
  expect(start(goal,[{...npcs[0],instanceId:''},npcs[1]]).run.npcTargetInstanceId).toBe('');
  expect(start(goal,[]).run).toMatchObject({npcTargetInstanceId:null,npcAlive:true,collectibleTarget:null});
 });
});
