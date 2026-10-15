import {describe,it,expect,expectTypeOf,vi} from 'vitest';
vi.mock('../../auth/client',()=>({getAuthDebugState:()=>({authenticated:false})}));
import {OverworldHudStateController} from './hudState';
import {ROOM_GOAL_DEFINITIONS,createDefaultRoomGoal,ROOM_GOAL_TYPES,type CollectTargetGoal} from '../../goals/roomGoals';
import {createDefaultCourseGoal} from '../../courses/model';
import {getExpandedRoomGoalBadgeText,getExpandedRoomGoalProgressText,getExpandedRoomGoalTimerText} from './expandedRoomRuns';
const hud=new OverworldHudStateController({countRoomEnemies:()=>7} as never);
const run=(type:typeof ROOM_GOAL_TYPES[number],changes={})=>({goal:createDefaultRoomGoal(type),qualificationState:'ranked',leaderboardEligible:true,result:'active',elapsedMs:12500,collectiblesCollected:2,enemyCollectiblesCollected:1,enemiesDefeated:3,checkpointsReached:1,enemyTarget:7,checkpointTarget:4,...changes});
describe('goal HUD presentation compatibility',()=>{
 it('pins badges and selected-room text for all seven goals and NPC variants',()=>{
  const badges=ROOM_GOAL_TYPES.map(type=>hud['getGoalBadgeText'](createDefaultRoomGoal(type)));
  expect(badges).toEqual(['Reach exit','Collect 3','Collect race','Defeat all enemies','Reach 0 checkpoints','Survive 30 seconds','Protect NPC 30 seconds']);
  const selected=ROOM_GOAL_TYPES.map(type=>hud['getSelectedRoomGoalText']({goal:createDefaultRoomGoal(type)} as never));
  expect(selected).toEqual(['Reach exit','Collect 3','Collect more than the Sword Hunter','Defeat 7 enemies','Reach 0 checkpoints','Survive 30 seconds','Protect NPC for 30 seconds']);
  const goal=createDefaultRoomGoal('npc_quest');if(goal.type!=='npc_quest')throw Error('wrong goal');
  expect(hud['getGoalBadgeText']({...goal,questType:'escort'})).toBe('Escort NPC');
  expect(hud['getGoalBadgeText']({...goal,questType:'give'})).toBe('Give NPC 3');
  expect(hud['getSelectedRoomGoalText']({goal:{...goal,questType:'give'}} as never)).toBe('Collect 3 and return to NPC');
  expect(hud['getSelectedRoomGoalText']({goal:null} as never)).toBe('');
 });
 it('pins room progress, practice routing and timer cap/countdown behavior',()=>{
  expect(ROOM_GOAL_TYPES.map(type=>hud['getPlayGoalProgressText'](run(type) as never))).toEqual(['Reach the exit','2/3 collected','You 2 · Hunter 1','3/7 defeated','1/4 checkpoints','Stay alive','Keep NPC alive']);
  expect(hud['getPlayGoalProgressText'](run('survival',{result:'completed'}) as never)).toBe('Survived');
  expect(hud['getPlayGoalProgressText'](run('reach_exit',{qualificationState:'practice'}) as never)).toBe('Reach spawn to rank');
  expect(hud['getPlayGoalProgressText'](run('reach_exit',{qualificationState:'practice',leaderboardEligible:false}) as never)).toBe('Reach spawn to start');
  expect(hud['getPlayGoalTimerText'](run('reach_exit') as never)).toBe('0:12.5');
  expect(hud['getPlayGoalTimerText'](run('survival') as never)).toBe('0:17.5 LEFT');
  expect(hud['getPlayGoalTimerText'](run('survival',{elapsedMs:45000}) as never)).toBe('0:00.0 LEFT');
  expect(hud['getPlayGoalTimerText'](run('npc_quest',{elapsedMs:45000}) as never)).toBe('0:30.0 PROTECTED');
  expect(hud['getPlayGoalTimerText'](run('survival',{qualificationState:'practice'}) as never)).toBe('PRACTICE');
 });
 it('pins course fallbacks, progress targets and unchanged timer callback values',()=>{
  const courseRun=(type:Parameters<typeof createDefaultCourseGoal>[0],changes={})=>({course:{goal:createDefaultCourseGoal(type)},result:'active',elapsedMs:12500,collectiblesCollected:2,collectibleTarget:9,enemiesDefeated:3,enemyTarget:7,checkpointsReached:1,checkpointTarget:4,...changes});
  expect(getExpandedRoomGoalBadgeText(null)).toBe('Expanded Room');
  expect(getExpandedRoomGoalBadgeText(createDefaultCourseGoal('collect_target'))).toBe('Collect 5');
  expect(getExpandedRoomGoalProgressText(courseRun('collect_target') as never)).toBe('2/9 collected');
  expect(getExpandedRoomGoalProgressText(courseRun('collect_target',{collectibleTarget:null}) as never)).toBe('2/5 collected');
  expect(getExpandedRoomGoalProgressText(courseRun('checkpoint_sprint',{checkpointTarget:null}) as never)).toBe('1/0 checkpoints');
  expect(getExpandedRoomGoalProgressText(courseRun('survival',{result:'completed'}) as never)).toBe('Survived');
  expect(getExpandedRoomGoalProgressText({...courseRun('survival'),course:{goal:null}} as never)).toBe('');
  expect(getExpandedRoomGoalTimerText(courseRun('survival') as never,ms=>String(ms))).toBe('17500 LEFT');
  expect(getExpandedRoomGoalTimerText({...courseRun('survival'),course:{goal:null}} as never,ms=>String(ms))).toBe('12500');
 });
});

describe('goal presentation boundaries',()=>{
 it('counts room enemies only for a selected Defeat All goal',()=>{
  const countRoomEnemies=vi.fn(()=>7),controller=new OverworldHudStateController({countRoomEnemies} as never);
  controller['getSelectedRoomGoalText']({goal:null} as never);
  for(const type of ROOM_GOAL_TYPES)controller['getSelectedRoomGoalText']({goal:createDefaultRoomGoal(type)} as never);
  expect(countRoomEnemies).toHaveBeenCalledTimes(1);
 });
 it('ties presentation handlers to their goal and explicitly excludes room-only course progress',()=>{
  expectTypeOf(ROOM_GOAL_DEFINITIONS.collect_target.presentation.progress).parameter(0).toEqualTypeOf<CollectTargetGoal>();
  expectTypeOf(ROOM_GOAL_DEFINITIONS.collect_race.courseProgress).toEqualTypeOf<null>();
  expectTypeOf(ROOM_GOAL_DEFINITIONS.npc_quest.courseProgress).toEqualTypeOf<null>();
 });
});
