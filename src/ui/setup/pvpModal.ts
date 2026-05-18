import {
  getMultiplayerModeDefinition,
  type PvpInviteOffer,
  type PvpMatchSnapshot,
} from '../../pvp/model';

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
    modal.className = 'pvp-modal pvp-modal-invite';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');

    const panel = document.createElement('div');
    panel.className = 'pvp-modal-panel';

    const header = document.createElement('div');
    header.className = 'pvp-modal-header';

    const kicker = document.createElement('div');
    kicker.className = 'pvp-modal-kicker';
    const mode = getMultiplayerModeDefinition(invite.mode);
    kicker.textContent = mode.copy.inviteKicker;

    const title = document.createElement('div');
    title.className = 'pvp-modal-title';
    title.textContent = mode.copy.inviteTitle;
    header.append(kicker, title);

    const body = document.createElement('div');
    body.className = 'pvp-modal-body';

    const challenge = document.createElement('div');
    challenge.className = 'pvp-modal-card pvp-invite-card';

    const challengeCopy = document.createElement('div');
    challengeCopy.className = 'pvp-invite-copy';
    challengeCopy.textContent = mode.copy.inviteBody(invite.inviter.displayName);

    const roomChip = document.createElement('div');
    roomChip.className = 'pvp-room-chip';
    roomChip.textContent = `Room ${invite.roomId}`;

    const rule = document.createElement('div');
    rule.className = 'pvp-modal-rule';
    rule.textContent = `${mode.startingLives} hearts. First to zero loses.`;

    challenge.append(challengeCopy, roomChip, rule);
    body.append(challenge);

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
    panel.append(header, body, actions);
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
  modal.className = 'pvp-modal pvp-modal-result';
  modal.dataset.result = snapshot.draw
    ? 'draw'
    : snapshot.winnerUserId === localUserId
      ? 'win'
      : 'loss';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');

  const panel = document.createElement('div');
  panel.className = 'pvp-modal-panel';

  const header = document.createElement('div');
  header.className = 'pvp-modal-header';
  const mode = getMultiplayerModeDefinition(snapshot.mode);

  const kicker = document.createElement('div');
  kicker.className = 'pvp-modal-kicker';
  kicker.textContent = mode.copy.resultKicker;

  const title = document.createElement('div');
  title.className = 'pvp-modal-title';
  title.textContent = snapshot.draw
    ? 'Draw'
    : snapshot.winnerUserId === localUserId
      ? 'You Win!'
      : 'You Lose';
  header.append(kicker, title);

  const body = document.createElement('div');
  body.className = 'pvp-modal-body';
  body.append(createPvpResultSummary(snapshot, localUserId));

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
  panel.append(header, body, actions);
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
  const mode = getMultiplayerModeDefinition(snapshot.mode);
  const kicker = overlay.querySelector<HTMLElement>('.pvp-countdown-kicker');
  const title = overlay.querySelector<HTMLElement>('.pvp-countdown-title');
  const rule = overlay.querySelector<HTMLElement>('.pvp-countdown-rule');
  const count = overlay.querySelector<HTMLElement>('.pvp-countdown-count');
  if (kicker) {
    kicker.textContent = mode.copy.countdownKicker;
  }
  if (title) {
    title.textContent = mode.copy.countdownTitle;
  }
  if (rule) {
    rule.textContent = mode.copy.countdownRule;
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

export function showPvpGoOverlay(modeId: PvpMatchSnapshot['mode'] = 'arena', durationMs = 700): void {
  ensureCountdownOverlay();
  const overlay = activeCountdownOverlay;
  if (!overlay) {
    return;
  }

  const mode = getMultiplayerModeDefinition(modeId);
  overlay.dataset.mode = 'go';
  overlay.querySelector<HTMLElement>('.pvp-countdown-kicker')!.textContent = mode.copy.countdownKicker;
  overlay.querySelector<HTMLElement>('.pvp-countdown-title')!.textContent = mode.copy.countdownTitle;
  overlay.querySelector<HTMLElement>('.pvp-countdown-rule')!.textContent = '';
  overlay.querySelector<HTMLElement>('.pvp-countdown-count')!.textContent = mode.copy.goEvent;
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

function ensureCountdownOverlay(): void {
  if (activeCountdownOverlay) {
    return;
  }

  const overlay = document.createElement('div');
  overlay.className = 'pvp-countdown-overlay';
  overlay.setAttribute('role', 'status');

  const card = document.createElement('div');
  card.className = 'pvp-countdown-card';

  const kicker = document.createElement('div');
  kicker.className = 'pvp-countdown-kicker';
  kicker.textContent = getMultiplayerModeDefinition('arena').copy.countdownKicker;

  const title = document.createElement('div');
  title.className = 'pvp-countdown-title';

  const rule = document.createElement('div');
  rule.className = 'pvp-countdown-rule';

  const count = document.createElement('div');
  count.className = 'pvp-countdown-count';

  card.append(kicker, title, rule, count);
  overlay.append(card);
  document.body.append(overlay);
  activeCountdownOverlay = overlay;
}

function createPvpResultSummary(snapshot: PvpMatchSnapshot, localUserId: string): HTMLElement {
  const summary = document.createElement('div');
  summary.className = 'pvp-modal-card pvp-result-summary';

  for (const participant of snapshot.participants) {
    const row = document.createElement('div');
    row.className = 'pvp-result-row';
    row.dataset.local = participant.userId === localUserId ? 'true' : 'false';

    const name = document.createElement('div');
    name.className = 'pvp-result-name';
    name.textContent = participant.userId === localUserId
      ? `${participant.displayName} (You)`
      : participant.displayName;

    const stats = document.createElement('div');
    stats.className = 'pvp-result-stats';
    stats.textContent = `${participant.hearts} hearts / ${Math.max(0, participant.losses)} lost`;

    row.append(name, stats);
    summary.append(row);
  }

  return summary;
}
