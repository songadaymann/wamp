import { AUTH_STATE_CHANGED_EVENT, getAuthDebugState } from '../../auth/client';
import { GUEST_BUILDER_CLAIM_REQUEST_EVENT, type GuestBuilderClaimRequestDetail } from '../../progression/guestBuilderClaimEvents';
import { APP_MODE_CHANGED_EVENT } from '../appMode';
import type { ChatModerationModalController } from './chatModerationModal';
import type { GuestBuilderClaimModalController } from './guestBuilderClaimModal';
import type { RoomRushModalController } from './roomRushModal';
import type { RoomRushResultModalController } from './roomRushResultModal';
import { ROOM_RUSH_RESULT_REQUEST_EVENT, type RoomRushResultRequestDetail } from './roomRushResultEvents';
import type { LazyModal } from './lazyModal';

type Controllers = {
  chatModerationModal: Pick<LazyModal<ChatModerationModalController>, 'loaded' | 'open' | 'close'>;
  guestBuilderClaimModal: Pick<LazyModal<GuestBuilderClaimModalController>, 'loaded' | 'open' | 'close'>;
  roomRushModal: Pick<LazyModal<RoomRushModalController>, 'loaded' | 'open' | 'close'>;
  roomRushResultModal: Pick<LazyModal<RoomRushResultModalController>, 'loaded' | 'open' | 'close'>;
};
export function setupRemainingModalTriggers(controllers: Controllers, doc: Document = document, win: Window = window): () => void {
  const removers: Array<() => void> = [];
  const listen = (target: EventTarget, type: string, handler: EventListener) => {
    target.addEventListener(type, handler); removers.push(() => target.removeEventListener(type, handler));
  };
  // Permission-driven menu visibility must not download the moderation dialog.
  const renderModerationButton = () => {
    if (controllers.chatModerationModal.loaded) return;
    controllers.chatModerationModal.close();
    const auth = getAuthDebugState(), button = doc.getElementById('btn-chat-moderation-open') as HTMLButtonElement | null;
    button?.classList.toggle('hidden', auth.chatModeration.role === 'none');
    if (button) button.disabled = auth.loading;
  };
  listen(win, AUTH_STATE_CHANGED_EVENT, renderModerationButton); renderModerationButton();
  const rushButton = doc.getElementById('btn-menu-room-rush');
  if (rushButton) listen(rushButton, 'click', () => {
    if (!controllers.roomRushModal.loaded && doc.body.dataset.appMode === 'world') {
      doc.getElementById('auth-panel')?.classList.remove('menu-open');
      void controllers.roomRushModal.open();
    }
  });
  listen(win, GUEST_BUILDER_CLAIM_REQUEST_EVENT, event => {
    const detail = (event as CustomEvent<GuestBuilderClaimRequestDetail>).detail;
    if (!controllers.guestBuilderClaimModal.loaded && detail && !getAuthDebugState().authenticated
      && (detail.source === 'manual-save' || detail.source === 'publish-attempt')) void controllers.guestBuilderClaimModal.open(detail);
  });
  listen(win, ROOM_RUSH_RESULT_REQUEST_EVENT, event => {
    const detail = (event as CustomEvent<RoomRushResultRequestDetail>).detail;
    if (!controllers.roomRushResultModal.loaded && detail?.run) void controllers.roomRushResultModal.open(detail.run);
  });
  let mode = doc.body.dataset.appMode;
  listen(win, APP_MODE_CHANGED_EVENT, () => {
    const nextMode = doc.body.dataset.appMode;
    if (nextMode === mode) return;
    mode = nextMode;
    for (const modal of [controllers.roomRushModal, controllers.guestBuilderClaimModal, controllers.roomRushResultModal, controllers.chatModerationModal]) {
      if (!modal.loaded) modal.close();
    }
  });
  return () => removers.forEach(remove => remove());
}
