import {describe,it,expect} from 'vitest';
import {OverworldGoalMarkerController} from './goalMarkers';
import {buildRoomGoalMarkerDescriptors} from '../editor/goalDocument';
import type {GoalRunState} from './goalRuns';
import type {ActiveCourseRunState} from './courseRuns';
function setup(){
 const sprites:{x:number;y:number;texture:string;alpha?:number;animation?:string;destroyed:boolean}[]=[],labels:{x:number;y:number;text:string}[]=[];
 const scene={add:{sprite:(x:number,y:number,texture:string)=>{const value={x,y,texture,destroyed:false} as (typeof sprites)[number];sprites.push(value);return {setOrigin(){return this;},setDepth(){return this;},setAlpha(alpha:number){value.alpha=alpha;return this;},play(animation:string){value.animation=animation;return this;},destroy(){value.destroyed=true;}};},text:(x:number,y:number,text:string)=>{labels.push({x,y,text});return {setOrigin(){return this;},setDepth(){return this;},destroy(){}};}}};
 const controller=new OverworldGoalMarkerController({scene:scene as never,getRoomOrigin:({x,y})=>({x:x*640,y:y*384}),getSelectedCoordinates:()=>({x:-2,y:3}),getActiveCourseSnapshot:()=>({roomRefs:[{roomId:'room',coordinates:{x:4,y:-5}}]} as never)});
 return {controller,sprites,labels};
}
const room={goal:{type:'checkpoint_sprint',checkpoints:[{x:16,y:32},{x:32,y:48}],finish:{x:48,y:64},timeLimitMs:null},roomCoordinates:{x:-1,y:2},rankedStartPoint:{x:12,y:24},qualificationState:'practice',nextCheckpointIndex:1,result:'active'} as unknown as GoalRunState;
describe('goal marker rendering contract',()=>{
 it('retains practice start and world positions with reached opacity and replaces old sprites',()=>{
  const {controller,sprites,labels}=setup();controller.redrawMarkers(room,null);
  expect(sprites).toMatchObject([{x:12,y:24,texture:'spawn_point',alpha:0.94},{x:-624,y:802,texture:'goal-marker-flag-green',alpha:0.55},{x:-608,y:818,texture:'goal-marker-flag-red'},{x:-592,y:834,texture:'goal-marker-flag-checkered'}]);
  expect(labels.map(l=>l.text)).toEqual(['START','1','2']);
  controller.redrawMarkers({...room,result:'completed'},null);expect(sprites.slice(0,4).every(s=>s.destroyed)).toBe(true);expect(sprites.at(-1)?.texture).toBe('goal-marker-flag-checkered-gold');
 });
 it('lets course markers own the redraw and keeps missing-room fallback coordinates',()=>{
  const {controller,sprites,labels}=setup();const course={course:{startPoint:{roomId:'room',x:8,y:16},goal:{type:'reach_exit',exit:{roomId:'missing',x:24,y:32},timeLimitMs:null}},result:'completed',nextCheckpointIndex:0} as unknown as ActiveCourseRunState;
  controller.redrawMarkers(room,course);expect(sprites).toMatchObject([{x:2568,y:-1902,texture:'goal-marker-flag-red'},{x:-1256,y:1186,texture:'goal-marker-flag-checkered-gold'}]);expect(labels.map(l=>l.text)).toEqual(['S']);
 });
 it('shows a non-Escort NPC destination in the editor while Play leaves it hidden',()=>{
  const goal={type:'npc_quest',questType:'protect',npcInstanceId:null,durationMs:1000,requiredCount:3,destination:{x:16,y:32},timeLimitMs:null} as const;
  expect(buildRoomGoalMarkerDescriptors(goal)).toEqual([{point:{x:16,y:32},label:'NPC',variant:'finish-pending',textColor:'#ffefef'}]);
  const {controller,sprites}=setup();controller.redrawMarkers({...room,goal,qualificationState:'qualified'},null);expect(sprites).toEqual([]);
 });
});
