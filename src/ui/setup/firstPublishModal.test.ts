import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../auth/client', () => ({ AUTH_STATE_CHANGED_EVENT:'auth', AUTH_SESSION_REFRESHED_EVENT:'session', getAuthDebugState: () => ({}) }));
vi.mock('../../mint/roomMetadataRender', () => ({ renderRoomSnapshotToPngDataUrl: vi.fn() }));
vi.mock('../../persistence/roomRepository', async importOriginal => ({ ...await importOriginal<typeof import('../../persistence/roomRepository')>(), createRoomRepository: () => ({}) }));
import { FirstPublishModalController } from './firstPublishModal';
import { ROOM_FIRST_PUBLISHED_EVENT, ROOM_PUBLISH_NAME_REQUEST_EVENT, type FirstPublishedRoom, type RoomPublishNameRequest } from '../../publishing/events';
import { createDefaultRoomSnapshot } from '../../persistence/roomModel';
import { APP_MODE_CHANGED_EVENT } from '../appMode';

class Element extends EventTarget {
  classes = new Set(['hidden']); classList = { contains:(name:string)=>this.classes.has(name), add:(name:string)=>this.classes.add(name),
    remove:(name:string)=>this.classes.delete(name), toggle:(name:string,force:boolean)=>force?this.classes.add(name):this.classes.delete(name) };
  value=''; textContent=''; style:Record<string,string>={}; children:Element[]=[]; isConnected=true; focus=vi.fn(); select=vi.fn();
  setAttribute=vi.fn(); getClientRects=()=>[{}]; querySelectorAll=()=>[];
  replaceChildren(){this.children=[];} append(element:Element){this.children.push(element);} click(){this.dispatchEvent(new Event('click'));}
}
const controllers:FirstPublishModalController[]=[];
function fixture() {
  const elements=new Map<string,Element>();
  const get=(id:string)=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id)!;};
  const doc=Object.assign(new EventTarget(),{body:{dataset:{appMode:'editor'}},activeElement:new Element(),getElementById:get,createElement:()=>new Element()});
  const navigator={clipboard:{writeText:vi.fn(async()=>{})},share:undefined as undefined|((data:ShareData)=>Promise<void>)};
  const win=Object.assign(new EventTarget(),{location:{origin:'https://wamp.land'},navigator,open:vi.fn()});
  let account:string|null='builder';
  const preview=vi.fn(async()=> 'data:image/png;base64,AA==');
  const controller=new FirstPublishModalController(doc as unknown as Document,win as unknown as Window,{account:()=>account,preview,rooms:{queryRoomSnapshots:vi.fn()}});
  vi.stubGlobal('HTMLElement',Element);controller.init();controllers.push(controller);
  const name=(resolve=vi.fn())=>win.dispatchEvent(new CustomEvent<RoomPublishNameRequest>(ROOM_PUBLISH_NAME_REQUEST_EVENT,{cancelable:true,detail:{userId:'builder',suggestedTitle:'Treasure Hunt',resolve}}));
  const detail:FirstPublishedRoom={userId:'builder',contentType:'room',contentId:'1,2',title:'My Saved Room',coordinates:{x:1,y:2},snapshot:createDefaultRoomSnapshot('1,2',{x:1,y:2}),play:vi.fn()};
  const publish=()=>win.dispatchEvent(new CustomEvent(ROOM_FIRST_PUBLISHED_EVENT,{detail}));
  return {controller,get,doc,win,navigator,preview,name,publish,detail,setAccount:(value:string|null)=>{account=value;win.dispatchEvent(new Event('auth'));}};
}
afterEach(()=>{for(const controller of controllers.splice(0))controller.destroy();vi.unstubAllGlobals();});
const tick=async()=>{await Promise.resolve();await Promise.resolve();};
describe('first-publish modal boundaries',()=>{
  it('accepts only a nonblank title and resolves cancellation exactly once',()=>{
    const f=fixture(),resolve=vi.fn();expect(f.name(resolve)).toBe(false);
    f.get('first-publish-name').value='  ';f.get('first-publish-name-form').dispatchEvent(new Event('submit',{cancelable:true}));
    expect(resolve).not.toHaveBeenCalled();expect(f.get('first-publish-status').textContent).toContain('Add a name');
    f.get('first-publish-name').value='  Treasure Hunt  ';f.get('first-publish-name-form').dispatchEvent(new Event('submit',{cancelable:true}));
    expect(resolve).toHaveBeenCalledExactlyOnceWith('Treasure Hunt');f.controller.close();expect(resolve).toHaveBeenCalledOnce();
  });
  it('closes and cancels a pending publish when the account or scene changes',()=>{
    const f=fixture(),resolve=vi.fn();f.name(resolve);f.setAccount('other');expect(resolve).toHaveBeenCalledExactlyOnceWith(null);
    f.setAccount('builder');const next=vi.fn();f.name(next);f.doc.body.dataset.appMode='world';f.win.dispatchEvent(new Event(APP_MODE_CHANGED_EVENT));
    expect(next).toHaveBeenCalledExactlyOnceWith(null);expect(f.get('first-publish-modal').classList.contains('hidden')).toBe(true);
  });
  it('does not expose a celebration for another account, and ignores late preview results after close',async()=>{
    const f=fixture();f.setAccount('other');f.publish();expect(f.get('first-publish-modal').classList.contains('hidden')).toBe(true);
    f.setAccount('builder');let resolve!:(url:string)=>void;f.preview.mockImplementation(()=>new Promise(done=>{resolve=done;}));
    f.publish();f.controller.close();resolve('data:image/png;base64,AA==');await tick();expect(f.get('first-publish-preview').children).toHaveLength(0);
  });
  it('shares the saved public coordinate link and offers a truthful manual clipboard fallback',async()=>{
    const f=fixture();f.publish();await tick();f.get('btn-first-publish-share').click();await tick();
    expect(f.navigator.clipboard.writeText).toHaveBeenCalledExactlyOnceWith('https://wamp.land/r/1/2');
    f.navigator.clipboard.writeText.mockRejectedValue(new Error('denied'));f.get('btn-first-publish-copy').click();await tick();
    expect(f.get('first-publish-link').select).toHaveBeenCalledOnce();expect(f.get('first-publish-status').textContent).toBe('Copy the selected link.');
  });
  it('keeps native-share cancellation quiet and blocks Play after identity changes',async()=>{
    const f=fixture();f.navigator.share=vi.fn(async()=>{throw Object.assign(new Error('cancelled'),{name:'AbortError'});});f.publish();
    f.get('btn-first-publish-share').click();await tick();expect(f.navigator.clipboard.writeText).not.toHaveBeenCalled();
    f.setAccount(null);f.get('btn-first-publish-play').click();expect(f.detail.play).not.toHaveBeenCalled();
  });
  it('opens Play and Wamp-O-Gram only through explicit actions',()=>{
    const f=fixture();f.publish();expect(f.detail.play).not.toHaveBeenCalled();f.get('btn-first-publish-play').click();expect(f.detail.play).toHaveBeenCalledOnce();
    const opened=vi.fn();f.get('btn-wamp-o-gram').addEventListener('click',opened);f.publish();f.get('btn-first-publish-wampogram').click();expect(opened).toHaveBeenCalledOnce();
  });
});
