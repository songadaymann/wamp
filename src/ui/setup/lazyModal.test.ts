import { hasPendingDialog } from '../pendingDialog';
import { expect, it, vi } from 'vitest';
import { LazyModal } from './lazyModal';
function deferred<T>() { let resolve!: (value:T)=>void; const promise=new Promise<T>(done=>{resolve=done;});return {promise,resolve}; }
it('does not download until requested and shares one initialized instance', async () => {
  const instance={init:vi.fn(),open:vi.fn(),close:vi.fn()};const load=vi.fn(async()=>instance);const modal=new LazyModal(load);
  modal.close();expect(load).not.toHaveBeenCalled();
  await modal.open();await modal.open();expect(load).toHaveBeenCalledOnce();expect(instance.init).toHaveBeenCalledOnce();expect(instance.open).toHaveBeenCalledTimes(2);expect(modal.loaded).toBe(true);
});
it('keeps a closed pending menu closed when its download finishes', async () => {
  const instance={init:vi.fn(),open:vi.fn(),close:vi.fn()};const download=deferred<typeof instance>();const modal=new LazyModal(()=>download.promise);
  const pending=modal.open();modal.close();download.resolve(instance);await pending;
  expect(instance.open).not.toHaveBeenCalled();await modal.open();expect(instance.open).toHaveBeenCalledOnce();
});
it('opens only the latest request while loading and keeps its arguments', async () => {
  const instance={init:vi.fn(),open:vi.fn((_value:string)=>undefined),close:vi.fn()};const download=deferred<typeof instance>();const modal=new LazyModal(()=>download.promise);
  const first=modal.open('first');const second=modal.open('second');download.resolve(instance);await Promise.all([first,second]);expect(instance.open).toHaveBeenCalledExactlyOnceWith('second');
});
it('retries a failed download or initialization without caching a rejection', async () => {
  const instance={init:vi.fn().mockImplementationOnce(()=>{throw new Error('init failed');}),open:vi.fn(),close:vi.fn()};
  const load=vi.fn().mockRejectedValueOnce(new Error('network failed')).mockResolvedValue(instance);const modal=new LazyModal(load);
  await expect(modal.open()).rejects.toThrow('network failed');await expect(modal.open()).rejects.toThrow('init failed');await modal.open();expect(load).toHaveBeenCalledTimes(3);expect(instance.open).toHaveBeenCalledOnce();
});
it('does not initialize or reopen a menu destroyed during its download', async () => {
  const instance={init:vi.fn(),open:vi.fn(),close:vi.fn(),destroy:vi.fn()};const download=deferred<typeof instance>();const modal=new LazyModal(()=>download.promise);
  const opening=modal.open();modal.destroy();download.resolve(instance);await opening;expect(instance.init).not.toHaveBeenCalled();expect(instance.open).not.toHaveBeenCalled();
});

it('holds a pause through a deferred open and releases it immediately on cancellation or failure', async () => {
  const download=deferred<{ init:()=>void; open:()=>void; close:()=>void }>();
  const modal=new LazyModal(()=>download.promise);
  const opening=modal.open(); expect(hasPendingDialog()).toBe(true);
  modal.close(); expect(hasPendingDialog()).toBe(false);
  download.resolve({init:vi.fn(),open:vi.fn(),close:vi.fn()}); await opening;
  const failed=new LazyModal<{init():void;open():void;close():void}>(async()=>{throw Error('offline');});
  await expect(failed.open()).rejects.toThrow('offline'); expect(hasPendingDialog()).toBe(false);
});
it('hands pause ownership to the visible dialog before its asynchronous data finishes', async () => {
  const data=deferred<void>(); const instance={init:vi.fn(),open:vi.fn(()=>data.promise),close:vi.fn()};
  const modal=new LazyModal(async()=>instance);const opening=modal.open();
  for(let i=0;i<8;i++)await Promise.resolve();
  expect(instance.open).toHaveBeenCalledOnce(); expect(hasPendingDialog()).toBe(false);
  data.resolve();await opening;
});
