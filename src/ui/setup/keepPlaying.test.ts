import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({load:vi.fn(),user:null as string|null}));
vi.mock('../../auth/client',()=>({AUTH_STATE_CHANGED_EVENT:'auth',getAuthDebugState:()=>({authenticated:Boolean(mocks.user),user:mocks.user?{id:mocks.user}:null})}));
vi.mock('../../runs/runRepository',()=>({createRunRepository:()=>({loadRoomDiscovery:mocks.load})}));
vi.mock('../../progression/guestRunProgress',()=>({loadGuestRunProgress:()=>({records:[]})}));
vi.mock('../../worlds/clientContext',()=>({getActiveWorldId:()=>null,WORLD_CONTEXT_CHANGED_EVENT:'world'}));
import { KeepPlayingController } from './keepPlaying';
import { KEEP_PLAYING_CLEAR_EVENT, KEEP_PLAYING_REQUEST_EVENT, KEEP_PLAYING_RESET_EVENT } from '../../progression/keepPlayingEvents';
import { ROOM_SEQUENCE_START_EVENT } from './roomSequenceEvents';
import { APP_MODE_CHANGED_EVENT } from '../appMode';
class Element extends EventTarget {
 classes=new Set(['hidden']);classList={contains:(s:string)=>this.classes.has(s),toggle:(s:string,value:boolean)=>value?this.classes.add(s):this.classes.delete(s)};
 textContent='';disabled=false;blur=vi.fn();getAttribute(){return null;}click(){this.dispatchEvent(new Event('click'));}
}
const controllers:KeepPlayingController[]=[];
function fixture(){
 const nodes=new Map(['keep-playing','btn-keep-playing','btn-keep-playing-dismiss','keep-playing-status'].map(id=>[id,new Element()]));
 const win=new EventTarget(),doc={body:{dataset:{appMode:'play-world',roomSequenceActive:'false'}},getElementById:(id:string)=>nodes.get(id)??null,querySelectorAll:()=>[]};
 vi.stubGlobal('window',win);mocks.user=null;mocks.load.mockReset();
 const before=vi.fn(),controller=new KeepPlayingController(before,doc as never,win as never);controllers.push(controller);controller.init();
 const sequence=vi.fn();win.addEventListener(ROOM_SEQUENCE_START_EVENT,e=>sequence((e as CustomEvent).detail));
 return {controller,win,doc,nodes,before,sequence,clear:()=>win.dispatchEvent(new CustomEvent(KEEP_PLAYING_CLEAR_EVENT,{detail:{contentId:'0,0',roomCoordinates:{x:0,y:0},difficulty:null}}))};
}
const result={results:[{roomId:'1,0',roomCoordinates:{x:1,y:0},roomVersion:2,goalType:'reach_exit'}]};
afterEach(()=>{controllers.splice(0).forEach(c=>c.destroy());vi.unstubAllGlobals();});
describe('persistent Keep playing action',()=>{
 it('fetches nothing at clear, then starts the selected goal through the real sequence event on tap',async()=>{
   const f=fixture();mocks.load.mockResolvedValue(result);f.clear();expect(mocks.load).not.toHaveBeenCalled();
   expect(f.nodes.get('keep-playing')!.classes.has('hidden')).toBe(false);f.nodes.get('btn-keep-playing')!.click();
   await vi.waitFor(()=>expect(f.sequence).toHaveBeenCalledOnce());
   expect(f.sequence.mock.calls[0][0]).toMatchObject({sourceLabel:'Keep playing',kickerLabel:'Keep playing',entries:[{roomId:'1,0',roomVersion:2}]});
   expect(f.before).toHaveBeenCalledOnce();
 });
 it('leaves active sequences in charge and also accepts the guest modal action after a clear',async()=>{
   const f=fixture();mocks.load.mockResolvedValue(result);f.clear();f.doc.body.dataset.roomSequenceActive='true';
   f.win.dispatchEvent(new Event(KEEP_PLAYING_REQUEST_EVENT));expect(mocks.load).not.toHaveBeenCalled();
   f.doc.body.dataset.roomSequenceActive='false';f.win.dispatchEvent(new Event(KEEP_PLAYING_REQUEST_EVENT));
   await vi.waitFor(()=>expect(f.sequence).toHaveBeenCalledOnce());
 });
 it('discards a late result after entering the editor and allows a fresh click when returning',async()=>{
   const f=fixture();let finish!:(value:typeof result)=>void;mocks.load.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));f.clear();
   f.nodes.get('btn-keep-playing')!.click();await vi.waitFor(()=>expect(mocks.load).toHaveBeenCalledOnce());
   f.doc.body.dataset.appMode='editor';f.win.dispatchEvent(new Event(APP_MODE_CHANGED_EVENT));finish(result);
   await Promise.resolve();expect(f.sequence).not.toHaveBeenCalled();
   f.doc.body.dataset.appMode='play-world';f.win.dispatchEvent(new Event(APP_MODE_CHANGED_EVENT));mocks.load.mockResolvedValue(result);
   f.nodes.get('btn-keep-playing')!.click();await vi.waitFor(()=>expect(f.sequence).toHaveBeenCalledOnce());
 });
 it('clears the old suggestion when another run starts, including Rush, assisted and co-op starts',()=>{
   const f=fixture();f.clear();f.win.dispatchEvent(new Event(KEEP_PLAYING_RESET_EVENT));
   expect(f.nodes.get('keep-playing')!.classes.has('hidden')).toBe(true);
   f.win.dispatchEvent(new Event(KEEP_PLAYING_REQUEST_EVENT));expect(mocks.load).not.toHaveBeenCalled();
 });
 it('shows a retryable error and never invents a destination on failure',async()=>{
   const f=fixture();mocks.load.mockRejectedValueOnce(new Error('Offline'));f.clear();f.nodes.get('btn-keep-playing')!.click();
   await vi.waitFor(()=>expect(f.nodes.get('keep-playing-status')!.textContent).toContain('retry'));
   expect(f.sequence).not.toHaveBeenCalled();expect(f.nodes.get('btn-keep-playing')!.disabled).toBe(false);
 });
});
