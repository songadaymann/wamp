import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../audio/sfx',()=>({playSfx:vi.fn()}));
vi.mock('../../auth/client',()=>({AUTH_STATE_CHANGED_EVENT:'auth',getAuthDebugState:vi.fn(),syncChatModerationState:vi.fn()}));
vi.mock('../appFeedback',()=>({APP_READY_EVENT:'ready',isAppReady:()=>true}));
vi.mock('./client',()=>({fetchChatMessages:vi.fn()}));
import { fetchChatMessages } from './client';
import { ChatPanelController } from './panel';
afterEach(()=>vi.restoreAllMocks());
describe('chat background read lifetime',()=>{
 it.each(['ensureLoaded','pollForNewMessages'] as const)('treats %s cancellation as control flow and still exposes genuine failures',async method=>{
   const controller={isChatModeActive:()=>true,shouldPoll:()=>true,historyLoaded:method==='pollForNewMessages',
     initialLoadInFlight:false,loading:false,render:vi.fn(),setStatus:vi.fn(),canPost:()=>true};
   const methods=ChatPanelController.prototype as unknown as Record<typeof method,(this:unknown)=>Promise<void>>;
   const log=vi.spyOn(console,'error').mockImplementation(()=>{});
   vi.mocked(fetchChatMessages).mockRejectedValueOnce(new DOMException('Page closed','AbortError'));
   await methods[method].call(controller);
   expect(log).not.toHaveBeenCalled();expect(controller.setStatus).not.toHaveBeenCalled();expect(controller.loading).toBe(false);
   vi.mocked(fetchChatMessages).mockRejectedValueOnce(new Error('Offline'));
   await methods[method].call(controller);expect(log).toHaveBeenCalledOnce();expect(controller.loading).toBe(false);
 });
});
