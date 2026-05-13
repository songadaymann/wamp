import type { PvpInviteOffer, PvpMatchSnapshot } from '../../pvp/model';

let activeInviteModal: HTMLElement | null = null;
let activeResultModal: HTMLElement | null = null;
let activeCountdownOverlay: HTMLElement | null = null;
let countdownFrame: number | null = null;
let countdownTimeout: number | null = null;
let damageFlashOverlay: HTMLElement | null = null;
let damageFlashTimeout: number | null = null;

export function showPvpInvitePrompt(invite: PvpInviteOffer): Promise<'accept' | 'decline'> {
  activeInviteModal?.remove();

  return new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.className = 'pvp-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');

    const panel = document.createElement('div');
    panel.className = 'pvp-modal-panel';

    const title = document.createElement('div');
    title.className = 'pvp-modal-title';
    title.textContent = 'Arena Duel';

    const body = document.createElement('div');
    body.className = 'pvp-modal-body';
    body.textContent = `${invite.inviter.displayName} invited you to Room ${invite.roomId}.`;

    const actions = document.createElement('div');
    actions.className = 'pvp-modal-actions';

    const accept = document.createElement('button');
    accept.type = 'button';
    accept.className = 'bar-btn primary';
    accept.textContent = 'Accept';

    const decline = document.createElement('button');
    decline.type = 'button';
    decline.className = 'bar-btn';
    decline.textContent = 'Decline';

    const close = (result: 'accept' | 'decline') => {
      if (activeInviteModal === modal) {
        activeInviteModal = null;
      }
      modal.remove();
      resolve(result);
    };

    accept.addEventListener('click', () => close('accept'));
    decline.addEventListener('click', () => close('decline'));
    actions.append(accept, decline);
    panel.append(title, body, actions);
    modal.append(panel);
    document.body.append(modal);
    activeInviteModal = modal;
    accept.focus();

    window.setTimeout(() => {
      if (activeInviteModal === modal) {
        close('decline');
      }
    }, Math.max(1_000, invite.expiresAt - Date.now()));
  });
}

export function showPvpResultModal(snapshot: PvpMatchSnapshot, localUserId: string): void {
  activeResultModal?.remove();

  const modal = document.createElement('div');
  modal.className = 'pvp-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');

  const panel = document.createElement('div');
  panel.className = 'pvp-modal-panel';

  const title = document.createElement('div');
  title.className = 'pvp-modal-title';
  title.textContent = snapshot.draw
    ? 'Draw'
    : snapshot.winnerUserId === localUserId
      ? 'You Win'
      : 'You Lose';

  const body = document.createElement('div');
  body.className = 'pvp-modal-body';
  body.textContent = formatPvpResultBody(snapshot);

  const actions = document.createElement('div');
  actions.className = 'pvp-modal-actions';

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'bar-btn primary';
  close.textContent = 'Close';
  close.addEventListener('click', () => {
    if (activeResultModal === modal) {
      activeResultModal = null;
    }
    modal.remove();
  });

  actions.append(close);
  panel.append(title, body, actions);
  modal.append(panel);
  document.body.append(modal);
  activeResultModal = modal;
  close.focus();
}

export function showPvpCountdownOverlay(snapshot: PvpMatchSnapshot): void {
  if (!snapshot.countdownEndsAt) {
    return;
  }

  ensureCountdownOverlay();
  const overlay = activeCountdownOverlay;
  if (!overlay) {
    return;
  }

  overlay.dataset.mode = 'countdown';
  const title = overlay.querySelector<HTMLElement>('.pvp-countdown-title');
  const rule = overlay.querySelector<HTMLElement>('.pvp-countdown-rule');
  const count = overlay.querySelector<HTMLElement>('.pvp-countdown-count');
  if (title) {
    title.textContent = 'Arena Duel';
  }
  if (rule) {
    rule.textContent = 'First to lose all hearts loses!';
  }

  const render = () => {
    if (activeCountdownOverlay !== overlay) {
      return;
    }
    const remainingMs = Math.max(0, snapshot.countdownEndsAt! - Date.now());
    const nextCount =
      remainingMs <= 450
        ? 'GO!'
        : String(Math.max(1, Math.min(3, Math.ceil((remainingMs - 450) / 1000))));
    if (count) {
      count.textContent = nextCount;
    }
    countdownFrame = window.requestAnimationFrame(render);
  };

  if (countdownFrame !== null) {
    window.cancelAnimationFrame(countdownFrame);
  }
  countdownFrame = window.requestAnimationFrame(render);
}

export function showPvpGoOverlay(durationMs = 700): void {
  ensureCountdownOverlay();
  const overlay = activeCountdownOverlay;
  if (!overlay) {
    return;
  }

  overlay.dataset.mode = 'go';
  overlay.querySelector<HTMLElement>('.pvp-countdown-title')!.textContent = 'Arena Duel';
  overlay.querySelector<HTMLElement>('.pvp-countdown-rule')!.textContent = '';
  overlay.querySelector<HTMLElement>('.pvp-countdown-count')!.textContent = 'GO!';
  if (countdownFrame !== null) {
    window.cancelAnimationFrame(countdownFrame);
    countdownFrame = null;
  }
  if (countdownTimeout !== null) {
    window.clearTimeout(countdownTimeout);
  }
  countdownTimeout = window.setTimeout(() => hidePvpCountdownOverlay(), durationMs);
}

export function hidePvpCountdownOverlay(): void {
  if (countdownFrame !== null) {
    window.cancelAnimationFrame(countdownFrame);
    countdownFrame = null;
  }
  if (countdownTimeout !== null) {
    window.clearTimeout(countdownTimeout);
    countdownTimeout = null;
  }
  activeCountdownOverlay?.remove();
  activeCountdownOverlay = null;
}

export function showPvpDamageFlashOverlay(durationMs = 300): void {
  if (!damageFlashOverlay) {
    damageFlashOverlay = document.createElement('div');
    damageFlashOverlay.className = 'pvp-damage-flash';
    damageFlashOverlay.setAttribute('aria-hidden', 'true');
    document.body.append(damageFlashOverlay);
  }

  damageFlashOverlay.classList.remove('active');
  void damageFlashOverlay.offsetWidth;
  damageFlashOverlay.classList.add('active');

  if (damageFlashTimeout !== null) {
    window.clearTimeout(damageFlashTimeout);
  }
  damageFlashTimeout = window.setTimeout(() => {
    damageFlashOverlay?.classList.remove('active');
    damageFlashTimeout = null;
  }, durationMs);
}

function formatPvpResultBody(snapshot: PvpMatchSnapshot): string {
  const parts = snapshot.participants.map((participant) => {
    const lost = Math.max(0, participant.losses);
    return `${participant.displayName}: ${participant.hearts} hearts, ${lost} lost`;
  });
  return parts.join(' · ');
}

function ensureCountdownOverlay(): void {
  if (activeCountdownOverlay) {
    return;
  }

  const overlay = document.createElement('div');
  overlay.className = 'pvp-countdown-overlay';
  overlay.setAttribute('role', 'status');

  const title = document.createElement('div');
  title.className = 'pvp-countdown-title';

  const rule = document.createElement('div');
  rule.className = 'pvp-countdown-rule';

  const count = document.createElement('div');
  count.className = 'pvp-countdown-count';

  overlay.append(title, rule, count);
  document.body.append(overlay);
  activeCountdownOverlay = overlay;
}
