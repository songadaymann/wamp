import { afterEach, expect, it, vi } from 'vitest';
import { setupRemainingModalTriggers } from './remainingModalTriggers';
import { LazyModal } from './lazyModal';
import { APP_MODE_CHANGED_EVENT } from '../appMode';
import { GUEST_BUILDER_CLAIM_REQUEST_EVENT } from '../../progression/guestBuilderClaimEvents';
vi.mock('../../auth/client', () => ({ AUTH_STATE_CHANGED_EVENT: 'auth-state-changed', getAuthDebugState: () => ({ authenticated: false, loading: false, chatModeration: { role: 'none' } }) }));
afterEach(() => vi.clearAllMocks());
const settle = async () => { for (let index = 0; index < 8; index++) await Promise.resolve(); };
it('does not cancel a held guest prompt when readiness repeats the same app mode', async () => {
  const win = new EventTarget(); const doc = { body: { dataset: { appMode: 'world' } }, getElementById: () => null };
  const instance = { init: vi.fn(), close: vi.fn(), open: vi.fn() }; let resolve!: (value: typeof instance) => void;
  const guestBuilderClaimModal = new LazyModal(() => new Promise<typeof instance>(done => { resolve = done; }));
  const blank = () => new LazyModal(async () => instance);
  const cleanup = setupRemainingModalTriggers({ guestBuilderClaimModal, chatModerationModal: blank(), roomRushModal: blank(), roomRushResultModal: blank() }, doc as unknown as Document, win as Window);
  const detail = { source: 'publish-attempt', roomId: '1,0' }; win.dispatchEvent(new CustomEvent(GUEST_BUILDER_CLAIM_REQUEST_EVENT, { detail }));
  win.dispatchEvent(new Event(APP_MODE_CHANGED_EVENT)); resolve(instance); await settle(); expect(instance.open).toHaveBeenCalledExactlyOnceWith(detail); cleanup();
});
it('a real scene transition cancels the pending prompt before its download finishes', async () => {
  const win = new EventTarget(); const doc = { body: { dataset: { appMode: 'editor' } }, getElementById: () => null };
  const instance = { init: vi.fn(), close: vi.fn(), open: vi.fn() }; let resolve!: (value: typeof instance) => void;
  const guestBuilderClaimModal = new LazyModal(() => new Promise<typeof instance>(done => { resolve = done; })); const blank = () => new LazyModal(async () => instance);
  const cleanup = setupRemainingModalTriggers({ guestBuilderClaimModal, chatModerationModal: blank(), roomRushModal: blank(), roomRushResultModal: blank() }, doc as unknown as Document, win as Window);
  win.dispatchEvent(new CustomEvent(GUEST_BUILDER_CLAIM_REQUEST_EVENT, { detail: { source: 'manual-save' } }));
  doc.body.dataset.appMode = 'world'; win.dispatchEvent(new Event(APP_MODE_CHANGED_EVENT)); resolve(instance); await settle(); expect(instance.open).not.toHaveBeenCalled(); cleanup();
});
