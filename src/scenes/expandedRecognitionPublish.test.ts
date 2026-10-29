import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('phaser',()=>({default:{Scene:class{},Math:{Clamp:(v:number,min:number,max:number)=>Math.max(min,Math.min(max,v)),Vector2:class{constructor(public x:number,public y:number){}}}}}));
vi.mock('../publishing/recognition',()=>({confirmPublishRecognition:vi.fn(async()=>false)}));
vi.mock('../auth/client',async original=>({...await original<typeof import('../auth/client')>(),getAuthDebugState:()=>({authenticated:true,user:{id:'builder'}}),refreshAuthSession:vi.fn(async()=>{})}));
vi.mock('../ui/appFeedback',()=>({showBusyOverlay:vi.fn(),hideBusyOverlay:vi.fn(),getAppFeedbackDebugState:()=>({})}));
import { confirmPublishRecognition } from '../publishing/recognition';
import { CourseComposerScene } from './CourseComposerScene';
import { CourseEditorScene } from './CourseEditorScene';
beforeEach(()=>vi.clearAllMocks());
const record=()=>({draft:{id:'legacy'},published:{version:3},versions:[{}]});
describe('Expanded publication recognition boundaries',()=>{
 it.each(['composer','workspace'] as const)('cancels %s before saving or publishing the reviewed Expanded version',async mode=>{
   const course=record(),saveDraft=vi.fn(),publishExpandedRoom=vi.fn();
   const host={record:course,courseRecord:course,loading:false,coursePublishing:false,
     uiState:{canPublishCourse:true},scene:{isActive:()=>true},renderUi:vi.fn(),getCoursePublishDisabledReason:()=>null,
     syncCourseRecordFromSession:()=>course,expandedRoomEditorRepository:{saveDraft,publishExpandedRoom}};
   const method=mode==='composer'?CourseComposerScene.prototype.publishCourseDraft:CourseEditorScene.prototype.publishCourseDraft;
   await method.call(host as never);
   expect(confirmPublishRecognition).toHaveBeenCalledWith(expect.objectContaining({targetKey:'expanded_room:course:legacy',version:3,userId:'builder'}));
   expect(saveDraft).not.toHaveBeenCalled();expect(publishExpandedRoom).not.toHaveBeenCalled();
   expect(host.loading).toBe(false);expect(host.coursePublishing).toBe(false);
 });
 it('cancels a recognized standalone cell in the multi-room workspace before writing any changed cell',async()=>{
   const slice={roomId:'1,0',coordinates:{x:1,y:0},roomTitle:'First room',publishedVersion:4};
   const writeSlices=vi.fn(),host={getChangedSlicesForPublish:()=>[slice],roomSlices:new Map([['1,0',slice]]),scene:{isActive:()=>true},writeSlices,renderUi:vi.fn()};
   const prototype=CourseEditorScene.prototype as unknown as {publishChangedSlices:()=>Promise<unknown>};
   expect(await prototype.publishChangedSlices.call(host)).toBeNull();expect(writeSlices).not.toHaveBeenCalled();
   expect(confirmPublishRecognition).toHaveBeenCalledWith(expect.objectContaining({targetKey:'room:1,0',version:4,label:'First room'}));
 });
});

it('starts setup on first return from a directly opened Expanded cell editor',async()=>{
  const stop=vi.fn(),run=vi.fn(),wake=vi.fn(),host={handleTouchBlur:vi.fn(),musicWorkflow:{setMusicModeActive:vi.fn()},
    backupDebouncer:{flush:vi.fn()},persistSessionOverridesForPlayableSlices:vi.fn(),getSelectedSlice:()=>({coordinates:{x:1,y:0}}),
    courseRecord:{draft:{id:'legacy'}},scene:{stop,run,wake}};
  await CourseEditorScene.prototype.returnToCourseBuilder.call(host as never);
  expect(stop).toHaveBeenCalledOnce();expect(wake).not.toHaveBeenCalled();
  expect(run).toHaveBeenCalledWith('CourseComposerScene',expect.objectContaining({courseId:'legacy',selectedCoordinates:{x:1,y:0}}));
  expect(stop.mock.invocationCallOrder[0]).toBeLessThan(run.mock.invocationCallOrder[0]);
});
