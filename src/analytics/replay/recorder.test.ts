import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const auth = vi.hoisted(() => ({loading:false,authenticated:false}));
vi.mock('../../auth/client', () => ({getAuthDebugState:()=>auth,AUTH_STATE_CHANGED_EVENT:'auth-state-changed'}));
vi.mock('../../api/baseUrl', () => ({getApiBaseUrl:()=>''}));
import { initializeGuestReplay } from './recorder';
let frame: () => void;
let optOut: EventTarget;
let fetchMock: ReturnType<typeof vi.fn>;
let stop: (() => void) | undefined;
let events: EventTarget;
beforeEach(() => {
  vi.useFakeTimers(); auth.loading=false; auth.authenticated=false;
  events = new EventTarget();
  Object.assign(events,{setInterval:globalThis.setInterval});
  vi.stubGlobal('window',events);
  const storage = new Map<string,string>();
  vi.stubGlobal('localStorage',{getItem:(k:string)=>storage.get(k),setItem:(k:string,v:string)=>storage.set(k,v)});
  vi.stubGlobal('navigator',{doNotTrack:'0'});
  vi.stubGlobal('location',{pathname:'/'});
  vi.stubGlobal('innerWidth',1440);vi.stubGlobal('innerHeight',900);
  const doc = new EventTarget();
  Object.assign(doc,{visibilityState:'visible',referrer:'',body:{append:vi.fn()},getElementById:()=>null,
    createElement:(tag:string)=>{
      const el = Object.assign(new EventTarget(),{append:vi.fn(),remove:vi.fn(),setAttribute:vi.fn(),getContext:()=>null});
      if(tag==='button') optOut=el;
      return el;
    }});
  vi.stubGlobal('document',doc);
  fetchMock=vi.fn(async (url:string) => Response.json(url.endsWith('/start') ? {id:'id',token:'token'} : {ok:true}));
  vi.stubGlobal('fetch',fetchMock);
});
afterEach(()=>{stop?.();stop=undefined;vi.useRealTimers();vi.unstubAllGlobals();});
async function boot() {
  stop=initializeGuestReplay({canvas:{} as HTMLCanvasElement,snapshot:()=>({mode:'play',roomCoordinates:{x:1,y:2}}),
    state:()=>({player:{x:3,y:4,email:'secret@example.com'},auth:{token:'secret'}}),onFrame:callback=>{frame=callback;return vi.fn();}});
  await vi.advanceTimersByTimeAsync(0);
}
it('records allowlisted state and flushes a final sign-in event before stopping',async()=>{
  await boot();
  for(let i=0;i<3;i++){await vi.advanceTimersByTimeAsync(1000);frame();await vi.advanceTimersByTimeAsync(0);}
  auth.authenticated=true;events.dispatchEvent(new Event('auth-state-changed'));
  await vi.advanceTimersByTimeAsync(0);
  const uploads=fetchMock.mock.calls.filter(([url])=>String(url).endsWith('/samples'));
  expect(JSON.stringify(uploads)).toContain('signed_in');
  expect(JSON.stringify(uploads)).not.toContain('secret');
  const count=fetchMock.mock.calls.length;
  await vi.advanceTimersByTimeAsync(10000);frame();
  expect(fetchMock).toHaveBeenCalledTimes(count);
});
it('persists opt-out, discards this recording, and stops future samples',async()=>{
  await boot();
  optOut.dispatchEvent(new Event('click'));
  await vi.advanceTimersByTimeAsync(0);
  expect(localStorage.getItem('wamp_replay_opt_out')).toBe('1');
  expect(fetchMock.mock.calls.some(([url])=>String(url).endsWith('/discard'))).toBe(true);
  const count=fetchMock.mock.calls.length;
  await vi.advanceTimersByTimeAsync(5000);frame();
  expect(fetchMock).toHaveBeenCalledTimes(count);
});
it('does not record an already signed-in visitor',async()=>{
  auth.authenticated=true;await boot();await vi.advanceTimersByTimeAsync(3000);
  expect(fetchMock).not.toHaveBeenCalled();
});
