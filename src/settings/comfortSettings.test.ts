import { afterEach, expect, it, vi } from 'vitest';
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
it('persists device comfort choices, reloads them and unsubscribes listeners', async () => {
  const storage = new Map<string,string>();
  vi.stubGlobal('window', {localStorage:{getItem:(key:string)=>storage.get(key) ?? null,setItem:(key:string,value:string)=>storage.set(key,value)}});
  let module = await import('./comfortSettings');
  expect(module.getComfortSettings()).toEqual({reduceMotion:'system',cameraStyle:'follow'});
  const listener = vi.fn();
  const unsubscribe = module.subscribeComfortSettings(listener);
  module.updateComfortSettings({reduceMotion:'on',cameraStyle:'room'});
  expect(listener).toHaveBeenCalledOnce();
  module.updateComfortSettings({reduceMotion:'on'});
  expect(listener).toHaveBeenCalledOnce();
  unsubscribe();
  module.updateComfortSettings({reduceMotion:'off'});
  expect(listener).toHaveBeenCalledOnce();
  vi.resetModules(); module = await import('./comfortSettings');
  expect(module.getComfortSettings()).toEqual({reduceMotion:'off',cameraStyle:'room'});
});
it('keeps preferences functional when storage is blocked', async () => {
  vi.stubGlobal('window', {localStorage:{getItem:()=>{throw new Error('blocked');},setItem:()=>{throw new Error('blocked');}}});
  const module = await import('./comfortSettings');
  module.updateComfortSettings({reduceMotion:'on',cameraStyle:'room'});
  expect(module.getReduceMotionMode()).toBe('on');
  expect(module.getPlayCameraStyle()).toBe('room');
});
