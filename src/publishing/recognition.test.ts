import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '../api/request';
import { requestBusyConfirmation } from '../ui/appFeedback';
import { confirmPublishRecognition } from './recognition';
const world=vi.hoisted(()=>({id:null as string|null}));
vi.mock('../worlds/clientContext',()=>({getActiveWorldId:()=>world.id,WORLD_CONTEXT_CHANGED_EVENT:'world-changed'}));
vi.mock('../api/request',()=>({apiRequest:vi.fn()}));
vi.mock('../auth/client',()=>({AUTH_STATE_CHANGED_EVENT:'auth-changed'}));
vi.mock('../ui/appFeedback',()=>({requestBusyConfirmation:vi.fn(async()=>true)}));
const state={targetKey:'room:0,0',version:3,featured:true,roomOfTheDay:false};
const options=()=>({targetKey:state.targetKey,version:3,userId:'builder',signal:new AbortController().signal,current:()=>true,events:new EventTarget()});
beforeEach(()=>{world.id=null;vi.clearAllMocks();vi.mocked(apiRequest).mockResolvedValue(state);vi.mocked(requestBusyConfirmation).mockResolvedValue(true);});
describe('publish recognition consent',()=>{
 it('skips first publication and guest saves; ordinary unrecognized republishes need no dialog',async()=>{
   expect(await confirmPublishRecognition({...options(),version:0})).toBe(true);
   expect(await confirmPublishRecognition({...options(),userId:null})).toBe(true);expect(apiRequest).not.toHaveBeenCalled();
   vi.mocked(apiRequest).mockResolvedValue({...state,featured:false});expect(await confirmPublishRecognition(options())).toBe(true);
   expect(requestBusyConfirmation).not.toHaveBeenCalled();
 });
 it('leaves private World/classroom and seed publication flows outside public recognition',async()=>{
   world.id='classroom';expect(await confirmPublishRecognition(options())).toBe(true);world.id=null;
   expect(await confirmPublishRecognition({...options(),targetKey:'room:world-seed:fixture'})).toBe(true);
   expect(apiRequest).not.toHaveBeenCalled();expect(requestBusyConfirmation).not.toHaveBeenCalled();
 });
 it('warns that title/music edits lose the reviewed Featured version, and honors Cancel',async()=>{
   vi.mocked(requestBusyConfirmation).mockResolvedValue(false);expect(await confirmPublishRecognition(options())).toBe(false);
   expect(requestBusyConfirmation).toHaveBeenCalledWith('Publish a new version?',expect.stringMatching(/exact version.*title or music/),expect.objectContaining({confirmLabel:'Publish new version'}));
 });
 it('covers Room of the Day on an Expanded target and confirms the exact target/version',async()=>{
   const targetKey='expanded_room:native';vi.mocked(apiRequest).mockResolvedValue({...state,targetKey,featured:false,roomOfTheDay:true});
   expect(await confirmPublishRecognition({...options(),targetKey})).toBe(true);
   expect(apiRequest).toHaveBeenCalledWith(expect.stringContaining('expanded_room%3Anative'),expect.objectContaining({cache:'no-store'}));
   expect(requestBusyConfirmation).toHaveBeenCalledWith(expect.any(String),expect.stringContaining('Room of the Day unavailable'),expect.anything());
 });
 it('uses a truthful fallback on read failure or an unexpected version instead of silently dropping the warning',async()=>{
   vi.mocked(apiRequest).mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce({...state,version:4});
   expect(await confirmPublishRecognition(options())).toBe(true);expect(await confirmPublishRecognition(options())).toBe(true);
   expect(requestBusyConfirmation).toHaveBeenCalledTimes(2);expect(requestBusyConfirmation).toHaveBeenLastCalledWith(expect.any(String),expect.stringContaining('Could not check'),expect.anything());
 });
 it('cancels stale account/mode requests and aborts an open confirmation on editor shutdown',async()=>{
   let resolve!:(value:unknown)=>void;vi.mocked(apiRequest).mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));
   const first=options(),pending=confirmPublishRecognition(first);first.events.dispatchEvent(new Event('auth-changed'));resolve(state);
   expect(await pending).toBe(false);expect(requestBusyConfirmation).not.toHaveBeenCalled();
   const abort=new AbortController();let ready!:()=>void;const arrived=new Promise<void>(done=>{ready=done;});
   vi.mocked(requestBusyConfirmation).mockImplementationOnce(async(_title,_text,{signal})=>{ready();await new Promise<void>(done=>signal.addEventListener('abort',()=>done(),{once:true}));return true;});
   const dialog=confirmPublishRecognition({...options(),signal:abort.signal});await arrived;abort.abort();expect(await dialog).toBe(false);
 });
});
