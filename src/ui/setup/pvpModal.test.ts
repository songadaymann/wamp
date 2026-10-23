import type Phaser from 'phaser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PvpInviteOffer, PvpMatchSnapshot } from '../../pvp/model';
import { installDialogKeyboardSync } from '../keyboardFocus';
import { hasBlockingModalOpen, installDialogEscapeGuard, installModalFocusManagement, installModalStackBackdrops } from '../modalState';
import { installFakeDom } from '../testing/fakeDom';
import { showPvpInvitePrompt, showPvpResultModal } from './pvpModal';

vi.mock('phaser', () => ({ default: {} }));
afterEach(() => vi.unstubAllGlobals());

const player = (userId: string, displayName: string) => ({ userId, displayName });
const invite = {
  inviteId: 'invite-1', matchId: 'match-1', mode: 'arena', roomId: 'room-3', roomCoordinates: { x: 0, y: 0 },
  shardId: 'shard', inviterConnectionId: 'connection', inviter: player('them', 'Rival'), target: player('me', 'Me'),
  createdAt: Date.now(), expiresAt: Date.now() + 1_000,
} as unknown as PvpInviteOffer;

function setup() {
  const dom = installFakeDom();
  const doc = dom.doc as unknown as Document;
  const keyboard = { enabled: true, resetKeys: vi.fn() };
  const game = { input: { keyboard: { captures: [27, 32], preventDefault: true } }, scene: { getScenes: () => [{ input: { keyboard } }] } };
  installDialogEscapeGuard(doc);
  installModalStackBackdrops(doc);
  installModalFocusManagement(doc);
  installDialogKeyboardSync(game as unknown as Phaser.Game, doc);
  const launcher = dom.element('button', { type: 'button' });
  dom.doc.body.append(launcher);
  launcher.focus();
  return { dom, doc, keyboard, launcher };
}

describe('PvP pop-ups are shared dialogs (F406)', () => {
  it('declines a challenge on Escape without the key reaching the room, and gives focus and keys back', async () => {
    const f = setup();
    const answer = showPvpInvitePrompt(invite);
    await f.dom.settle();
    const modal = f.dom.doc.querySelector('.pvp-modal-invite')!;
    expect(hasBlockingModalOpen(f.doc)).toBe(true);
    expect(f.keyboard.enabled).toBe(false);
    expect(f.dom.doc.activeElement?.textContent).toBe('Accept');

    expect(f.dom.press('Escape').defaultPrevented).toBe(true);
    await expect(answer).resolves.toBe('decline');
    await f.dom.settle();
    expect(modal.isConnected).toBe(false);
    expect(hasBlockingModalOpen(f.doc)).toBe(false);
    expect(f.keyboard.enabled).toBe(true);
    expect(f.dom.doc.activeElement).toBe(f.launcher);
  });

  it('closes only the result over another dialog, which keeps one backdrop', async () => {
    const f = setup();
    const settings = f.dom.element('div', { class: 'history-modal' }, f.dom.element('div', { role: 'dialog' }));
    settings.zIndex = 40;
    const closeSettings = vi.fn();
    f.dom.doc.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeSettings(); });
    f.dom.doc.body.append(settings);
    showPvpResultModal({
      mode: 'arena', draw: false, winnerUserId: 'me', participants: [{ ...player('me', 'Me'), hearts: 2, losses: 1 }],
    } as unknown as PvpMatchSnapshot, 'me');
    const result = f.dom.doc.querySelector('.pvp-modal-result')!;
    result.zIndex = 1200;
    await f.dom.settle();
    expect(settings.dataset.modalCovered).toBe('true');

    f.dom.press('Escape');
    await f.dom.settle();
    expect(result.isConnected).toBe(false);
    expect(closeSettings).not.toHaveBeenCalled();
    expect(settings.dataset.modalCovered).toBeUndefined();
  });
});
