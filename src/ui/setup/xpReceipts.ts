import {
  XP_RECEIPTS_EVENT,
  XP_RECEIPTS_IDLE_EVENT,
  type XpReceipt,
  type XpReceiptsDetail,
} from '../../progression/xpReceipts';

type XpReceiptElements = {
  layer: HTMLElement | null;
  card: HTMLElement | null;
  icon: HTMLImageElement | null;
  amount: HTMLElement | null;
  reason: HTMLElement | null;
  level: HTMLElement | null;
  detail: HTMLElement | null;
  meterFill: HTMLElement | null;
  impact: HTMLElement | null;
};

const ENTER_DURATION_MS = 170;
const HOLD_DURATION_MS = 920;
const FLY_DURATION_MS = 520;
const IMPACT_DURATION_MS = 540;
const RECEIPT_APP_MODE = 'world';

export class XpReceiptController {
  private readonly elements: XpReceiptElements;
  private readonly queue: XpReceipt[] = [];
  private activeReceipt: XpReceipt | null = null;
  private holdTimer: number | null = null;
  private flyTimer: number | null = null;
  private impactTimer: number | null = null;
  private targetPulseTimer: number | null = null;

  private readonly handleReceiptRequest = (event: Event) => {
    const detail =
      event instanceof CustomEvent
        ? (event.detail as XpReceiptsDetail | undefined)
        : undefined;
    if (!detail?.receipts?.length) {
      return;
    }

    if (!this.canPresentReceipts()) {
      this.windowObj.dispatchEvent(new CustomEvent(XP_RECEIPTS_IDLE_EVENT));
      return;
    }

    this.queue.push(...detail.receipts);
    if (!this.activeReceipt) {
      this.showNext();
    }
  };

  constructor(
    private readonly doc: Document = document,
    private readonly windowObj: Window = window,
  ) {
    this.elements = {
      layer: this.doc.getElementById('xp-receipt-layer'),
      card: this.doc.getElementById('xp-receipt-card'),
      icon: this.doc.getElementById('xp-receipt-icon') as HTMLImageElement | null,
      amount: this.doc.getElementById('xp-receipt-amount'),
      reason: this.doc.getElementById('xp-receipt-reason'),
      level: this.doc.getElementById('xp-receipt-level'),
      detail: this.doc.getElementById('xp-receipt-detail'),
      meterFill: this.doc.getElementById('xp-receipt-meter-fill'),
      impact: this.doc.getElementById('xp-receipt-impact'),
    };
  }

  init(): void {
    this.windowObj.addEventListener(XP_RECEIPTS_EVENT, this.handleReceiptRequest as EventListener);
  }

  destroy(): void {
    this.windowObj.removeEventListener(XP_RECEIPTS_EVENT, this.handleReceiptRequest as EventListener);
    this.clearTimers();
    if (this.targetPulseTimer !== null) {
      this.windowObj.clearTimeout(this.targetPulseTimer);
      this.targetPulseTimer = null;
    }
    this.clearTargetPulse();
    this.elements.impact?.classList.remove('xp-receipt-impact--active');
    this.queue.length = 0;
    this.activeReceipt = null;
  }

  private showNext(): void {
    const nextReceipt = this.queue.shift() ?? null;
    if (!nextReceipt || !this.elements.layer || !this.elements.card) {
      this.activeReceipt = null;
      this.hideLayer();
      return;
    }

    if (!this.canPresentReceipts()) {
      this.activeReceipt = null;
      this.hideLayer();
      return;
    }

    this.clearTimers();
    this.activeReceipt = nextReceipt;
    this.render(nextReceipt);
    this.elements.layer.classList.remove('hidden');
    this.elements.layer.setAttribute('aria-hidden', 'false');
    this.elements.card.className = `xp-receipt-card xp-receipt-card--${nextReceipt.lane}`;
    this.elements.card.classList.add('xp-receipt-card--enter');

    this.windowObj.requestAnimationFrame(() => {
      if (!this.activeReceipt || this.activeReceipt !== nextReceipt || !this.elements.card) {
        return;
      }

      this.primeMeter(nextReceipt);
      this.updateFlyTarget(nextReceipt);
      this.holdTimer = this.windowObj.setTimeout(() => {
        this.beginFly(nextReceipt);
      }, HOLD_DURATION_MS + ENTER_DURATION_MS);
    });
  }

  private render(receipt: XpReceipt): void {
    if (this.elements.icon) {
      this.elements.icon.src = receipt.iconSrc;
      this.elements.icon.alt = receipt.iconAlt;
    }
    if (this.elements.amount) {
      this.elements.amount.textContent = receipt.amountText;
    }
    if (this.elements.reason) {
      this.elements.reason.textContent = receipt.reason;
    }
    if (this.elements.level) {
      this.elements.level.textContent = receipt.levelText;
    }
    if (this.elements.detail) {
      this.elements.detail.textContent = receipt.detailText;
    }
  }

  private primeMeter(receipt: XpReceipt): void {
    if (!this.elements.meterFill) {
      return;
    }

    this.elements.meterFill.className = `xp-receipt-meter-fill xp-receipt-meter-fill--${receipt.lane}`;
    this.elements.meterFill.style.transition = 'none';
    this.elements.meterFill.style.width = `${Math.max(0, Math.min(1, receipt.progressFrom)) * 100}%`;

    this.windowObj.requestAnimationFrame(() => {
      if (!this.elements.meterFill || this.activeReceipt !== receipt) {
        return;
      }

      this.elements.meterFill.style.transition = 'width 780ms steps(14, end)';
      this.elements.meterFill.style.width = `${Math.max(0, Math.min(1, receipt.progressTo)) * 100}%`;
    });
  }

  private updateFlyTarget(receipt: XpReceipt): void {
    if (!this.elements.card) {
      return;
    }

    const sourceRect = this.elements.card.getBoundingClientRect();
    const fallbackTargetX = 120;
    const fallbackTargetY = 72;
    const targetElement = this.getReceiptTargetElement();
    const targetRect = targetElement?.getBoundingClientRect() ?? null;
    const targetX = targetRect ? targetRect.left + targetRect.width / 2 : fallbackTargetX;
    const targetY = targetRect ? targetRect.top + Math.min(54, Math.max(42, targetRect.height * 0.18)) : fallbackTargetY;
    const sourceX = sourceRect.left + sourceRect.width / 2;
    const sourceY = sourceRect.top + sourceRect.height / 2;

    this.elements.card.style.setProperty('--xp-receipt-fly-x', `${targetX - sourceX}px`);
    this.elements.card.style.setProperty('--xp-receipt-fly-y', `${targetY - sourceY}px`);
    this.elements.card.style.setProperty('--xp-receipt-target-progress', String(receipt.progressTo));

    if (this.elements.impact) {
      this.elements.impact.style.left = `${targetX}px`;
      this.elements.impact.style.top = `${targetY}px`;
    }
  }

  private beginFly(receipt: XpReceipt): void {
    if (!this.elements.card || this.activeReceipt !== receipt || !this.canPresentReceipts()) {
      this.finishReceipt();
      return;
    }

    this.elements.card.classList.remove('xp-receipt-card--enter');
    this.elements.card.classList.add('xp-receipt-card--fly');
    this.flyTimer = this.windowObj.setTimeout(() => {
      this.playImpact(receipt);
      this.finishReceipt();
    }, FLY_DURATION_MS);
  }

  private playImpact(receipt: XpReceipt): void {
    const targetElement = this.getReceiptTargetElement();
    if (targetElement) {
      targetElement.dataset.xpLane = receipt.lane;
      targetElement.style.setProperty('--xp-target-progress', String(receipt.progressTo));
      targetElement.classList.add('xp-target-pulse');
      if (this.targetPulseTimer !== null) {
        this.windowObj.clearTimeout(this.targetPulseTimer);
      }
      this.targetPulseTimer = this.windowObj.setTimeout(() => {
        this.clearTargetPulse();
      }, IMPACT_DURATION_MS);
    }

    if (!this.elements.impact) {
      return;
    }

    this.elements.impact.className = `xp-receipt-impact xp-receipt-impact--${receipt.lane}`;
    this.elements.impact.classList.add('xp-receipt-impact--active');
    if (this.impactTimer !== null) {
      this.windowObj.clearTimeout(this.impactTimer);
    }
    this.impactTimer = this.windowObj.setTimeout(() => {
      this.elements.impact?.classList.remove('xp-receipt-impact--active');
    }, IMPACT_DURATION_MS);
  }

  private finishReceipt(): void {
    this.clearTimers();
    if (this.elements.card) {
      this.elements.card.className = 'xp-receipt-card';
      this.elements.card.style.removeProperty('--xp-receipt-fly-x');
      this.elements.card.style.removeProperty('--xp-receipt-fly-y');
    }
    this.activeReceipt = null;
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
    this.elements.layer.setAttribute('aria-hidden', 'true');
    this.windowObj.dispatchEvent(new CustomEvent(XP_RECEIPTS_IDLE_EVENT));
  }

  private clearTimers(): void {
    if (this.holdTimer !== null) {
      this.windowObj.clearTimeout(this.holdTimer);
      this.holdTimer = null;
    }
    if (this.flyTimer !== null) {
      this.windowObj.clearTimeout(this.flyTimer);
      this.flyTimer = null;
    }
    if (this.impactTimer !== null) {
      this.windowObj.clearTimeout(this.impactTimer);
      this.impactTimer = null;
    }
  }

  private canPresentReceipts(): boolean {
    return this.getReceiptTargetElement() !== null;
  }

  private getReceiptTargetElement(): HTMLElement | null {
    if (this.doc.body.dataset.appMode !== RECEIPT_APP_MODE) {
      return null;
    }

    const target = this.doc.getElementById('world-hud');
    return target instanceof HTMLElement ? target : null;
  }

  private clearTargetPulse(): void {
    for (const targetId of ['world-hud', 'menu-toggle']) {
      const target = this.doc.getElementById(targetId);
      if (!(target instanceof HTMLElement)) {
        continue;
      }

      target.classList.remove('xp-target-pulse');
      target.removeAttribute('data-xp-lane');
      target.style.removeProperty('--xp-target-progress');
    }
  }
}
