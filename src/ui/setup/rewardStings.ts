import { playSfx } from '../../audio/sfx';
import {
  REWARD_STINGS_EVENT,
  type RewardSting,
  type RewardStingsDetail,
} from '../../progression/rewardStings';

type RewardStingElements = {
  layer: HTMLElement | null;
  card: HTMLElement | null;
  kicker: HTMLElement | null;
  title: HTMLElement | null;
  subtitle: HTMLElement | null;
  detail: HTMLElement | null;
  meter: HTMLElement | null;
  meterFill: HTMLElement | null;
  icon: HTMLImageElement | null;
};

export class RewardStingController {
  private readonly elements: RewardStingElements;
  private readonly queue: RewardSting[] = [];
  private activeReward: RewardSting | null = null;
  private displayTimer: number | null = null;
  private exitTimer: number | null = null;

  private readonly handleRewardRequest = (event: Event) => {
    const detail =
      event instanceof CustomEvent
        ? (event.detail as RewardStingsDetail | undefined)
        : undefined;
    if (!detail?.rewards?.length) {
      return;
    }

    this.queue.push(...detail.rewards);
    if (!this.activeReward) {
      this.showNext();
    }
  };

  constructor(
    private readonly doc: Document = document,
    private readonly windowObj: Window = window,
  ) {
    this.elements = {
      layer: this.doc.getElementById('reward-sting-layer'),
      card: this.doc.getElementById('reward-sting-card'),
      kicker: this.doc.getElementById('reward-sting-kicker'),
      title: this.doc.getElementById('reward-sting-title'),
      subtitle: this.doc.getElementById('reward-sting-subtitle'),
      detail: this.doc.getElementById('reward-sting-detail'),
      meter: this.doc.getElementById('reward-sting-meter'),
      meterFill: this.doc.getElementById('reward-sting-meter-fill'),
      icon: this.doc.getElementById('reward-sting-icon') as HTMLImageElement | null,
    };
  }

  init(): void {
    this.windowObj.addEventListener(REWARD_STINGS_EVENT, this.handleRewardRequest as EventListener);
  }

  destroy(): void {
    this.windowObj.removeEventListener(REWARD_STINGS_EVENT, this.handleRewardRequest as EventListener);
    this.clearTimers();
    this.queue.length = 0;
    this.activeReward = null;
  }

  private showNext(): void {
    if (!this.elements.layer || !this.elements.card) {
      this.queue.length = 0;
      return;
    }

    const nextReward = this.queue.shift() ?? null;
    if (!nextReward) {
      this.hideLayer();
      return;
    }

    this.clearTimers();
    this.activeReward = nextReward;
    this.render(nextReward);

    this.elements.layer.classList.remove('hidden');
    this.elements.layer.setAttribute('aria-hidden', 'false');
    this.elements.layer.classList.toggle('reward-sting-layer--hero', nextReward.emphasis === 'hero');

    this.elements.card.classList.remove('reward-sting-card--enter', 'reward-sting-card--exit');
    void this.elements.card.offsetWidth;
    this.elements.card.classList.add('reward-sting-card--enter');
    if (nextReward.sfxCue) {
      playSfx(nextReward.sfxCue, { ignoreCooldown: true });
    }

    this.displayTimer = this.windowObj.setTimeout(() => {
      this.beginHide();
    }, nextReward.durationMs);
  }

  private beginHide(): void {
    if (!this.elements.card || !this.activeReward) {
      this.finishHide();
      return;
    }

    this.clearTimers();
    this.elements.card.classList.remove('reward-sting-card--enter');
    this.elements.card.classList.add('reward-sting-card--exit');
    this.exitTimer = this.windowObj.setTimeout(() => {
      this.finishHide();
    }, this.activeReward.emphasis === 'hero' ? 320 : 260);
  }

  private finishHide(): void {
    if (this.elements.card) {
      this.elements.card.classList.remove('reward-sting-card--enter', 'reward-sting-card--exit');
    }
    this.activeReward = null;

    if (this.queue.length > 0) {
      this.showNext();
      return;
    }

    this.hideLayer();
  }

  private hideLayer(): void {
    if (!this.elements.layer) {
      return;
    }

    this.elements.layer.classList.add('hidden');
    this.elements.layer.classList.remove('reward-sting-layer--hero');
    this.elements.layer.setAttribute('aria-hidden', 'true');
  }

  private render(reward: RewardSting): void {
    if (!this.elements.card) {
      return;
    }

    this.elements.card.className = `reward-sting-card reward-sting-card--${reward.tone}${
      reward.emphasis === 'hero' ? ' reward-sting-card--hero' : ''
    }`;

    if (this.elements.kicker) {
      this.elements.kicker.textContent = reward.kicker;
    }
    if (this.elements.title) {
      this.elements.title.textContent = reward.title;
    }
    if (this.elements.subtitle) {
      this.elements.subtitle.textContent = reward.subtitle;
    }
    if (this.elements.detail) {
      const detail = reward.detail?.trim() ?? '';
      this.elements.detail.textContent = detail;
      this.elements.detail.classList.toggle('hidden', detail.length === 0);
    }
    if (this.elements.meter && this.elements.meterFill) {
      const hasProgress = typeof reward.progressValue === 'number';
      this.elements.meter.classList.toggle('hidden', !hasProgress);
      this.elements.meterFill.classList.toggle('reward-sting-meter-fill--visible', hasProgress);
      if (hasProgress) {
        const clampedProgress = Math.max(0, Math.min(1, reward.progressValue ?? 0));
        this.elements.meterFill.style.setProperty('--reward-progress-target', String(clampedProgress));
      } else {
        this.elements.meterFill.style.removeProperty('--reward-progress-target');
      }
    }
    if (this.elements.icon) {
      this.elements.icon.src = reward.iconSrc;
      this.elements.icon.alt = reward.iconAlt;
    }
  }

  private clearTimers(): void {
    if (this.displayTimer !== null) {
      this.windowObj.clearTimeout(this.displayTimer);
      this.displayTimer = null;
    }
    if (this.exitTimer !== null) {
      this.windowObj.clearTimeout(this.exitTimer);
      this.exitTimer = null;
    }
  }
}
