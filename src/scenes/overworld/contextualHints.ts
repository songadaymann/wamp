import Phaser from 'phaser';

export type OverworldContextualHintId = 'pull-crate';

export interface OverworldContextualHintRequest {
  id: OverworldContextualHintId;
  anchor: {
    worldX: number;
    worldY: number;
  };
  backDirection?: -1 | 1;
}

export interface OverworldContextualHintsDebugState {
  activeHintId: OverworldContextualHintId | null;
  visible: boolean;
  dismissed: Record<OverworldContextualHintId, boolean>;
  anchor: { screenX: number; screenY: number } | null;
}

const HINT_SHOW_DELAY_MS = 350;
const HINT_STORAGE_KEYS: Record<OverworldContextualHintId, string> = {
  'pull-crate': 'wamp.contextualHint.pullCrate.dismissed.v2',
};
const VIEWPORT_MARGIN_PX = 12;

export class OverworldContextualHintsController {
  private rootEl: HTMLDivElement | null = null;
  private bodyEl: HTMLDivElement | null = null;
  private dismissButtonEl: HTMLButtonElement | null = null;
  private activeHintId: OverworldContextualHintId | null = null;
  private activeSignature = '';
  private pendingHintId: OverworldContextualHintId | null = null;
  private pendingSince = 0;
  private visible = false;
  private lastAnchor: { screenX: number; screenY: number } | null = null;
  private readonly sessionDismissedHintIds = new Set<OverworldContextualHintId>();

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly doc: Document = document,
  ) {}

  update(requests: OverworldContextualHintRequest[]): void {
    const request = requests.find((candidate) => !this.isHintDismissed(candidate.id)) ?? null;
    if (!request) {
      this.clearPendingHint();
      this.hide();
      return;
    }

    const now = this.scene.time.now;
    if (this.pendingHintId !== request.id) {
      this.pendingHintId = request.id;
      this.pendingSince = now;
      this.hide();
      return;
    }

    if (now - this.pendingSince < HINT_SHOW_DELAY_MS) {
      this.hide();
      return;
    }

    this.show(request);
  }

  completeHint(id: OverworldContextualHintId): void {
    this.dismissHint(id);
  }

  resetTransientState(): void {
    this.clearPendingHint();
    this.hide();
  }

  destroy(): void {
    this.dismissButtonEl?.removeEventListener('click', this.handleDismissClick);
    this.rootEl?.remove();
    this.rootEl = null;
    this.bodyEl = null;
    this.dismissButtonEl = null;
    this.activeHintId = null;
    this.visible = false;
    this.lastAnchor = null;
    this.clearPendingHint();
  }

  getDebugState(): OverworldContextualHintsDebugState {
    return {
      activeHintId: this.activeHintId,
      visible: this.visible,
      dismissed: {
        'pull-crate': this.isHintDismissed('pull-crate'),
      },
      anchor: this.lastAnchor ? { ...this.lastAnchor } : null,
    };
  }

  private show(request: OverworldContextualHintRequest): void {
    const rootEl = this.ensureRootElement();
    const signature = this.getRequestSignature(request);
    if (this.activeHintId !== request.id || this.activeSignature !== signature) {
      this.renderHint(request);
      this.activeHintId = request.id;
      this.activeSignature = signature;
    }

    const anchor = this.projectWorldToViewport(request.anchor.worldX, request.anchor.worldY, rootEl);
    this.lastAnchor = anchor;
    rootEl.style.left = `${anchor.screenX}px`;
    rootEl.style.top = `${anchor.screenY}px`;
    rootEl.dataset.visible = 'true';
    this.visible = true;
  }

  private renderHint(request: OverworldContextualHintRequest): void {
    const bodyEl = this.bodyEl;
    if (!bodyEl) {
      return;
    }

    bodyEl.replaceChildren();
    if (request.id === 'pull-crate') {
      this.renderPullCrateHint(bodyEl, request.backDirection ?? -1);
    }
  }

  private renderPullCrateHint(bodyEl: HTMLElement, backDirection: -1 | 1): void {
    const titleEl = this.doc.createElement('div');
    titleEl.className = 'world-contextual-hint-title';
    titleEl.textContent = 'Pull crate';

    const controlRowEl = this.doc.createElement('div');
    controlRowEl.className = 'world-contextual-hint-control-row';
    controlRowEl.append(
      this.createKeycap('↓'),
      this.createPlus(),
      this.createKeycap(backDirection < 0 ? '←' : '→'),
    );

    const descriptionEl = this.doc.createElement('div');
    descriptionEl.className = 'world-contextual-hint-description';
    descriptionEl.textContent = 'Hold down and move back.';

    bodyEl.append(titleEl, controlRowEl, descriptionEl);
  }

  private createKeycap(label: string): HTMLElement {
    const keyEl = this.doc.createElement('span');
    keyEl.className = 'world-contextual-hint-key';
    keyEl.textContent = label;
    return keyEl;
  }

  private createPlus(): HTMLElement {
    const plusEl = this.doc.createElement('span');
    plusEl.className = 'world-contextual-hint-plus';
    plusEl.textContent = '+';
    return plusEl;
  }

  private hide(): void {
    if (this.rootEl) {
      this.rootEl.dataset.visible = 'false';
    }
    this.visible = false;
    this.activeHintId = null;
    this.activeSignature = '';
    this.lastAnchor = null;
  }

  private dismissHint(id: OverworldContextualHintId): void {
    this.sessionDismissedHintIds.add(id);
    this.writeDismissedHint(id);
    if (this.activeHintId === id || this.pendingHintId === id) {
      this.clearPendingHint();
      this.hide();
    }
  }

  private clearPendingHint(): void {
    this.pendingHintId = null;
    this.pendingSince = 0;
  }

  private ensureRootElement(): HTMLDivElement {
    if (this.rootEl && this.bodyEl && this.dismissButtonEl) {
      return this.rootEl;
    }

    const rootEl = this.doc.createElement('div');
    rootEl.className = 'world-contextual-hint';
    rootEl.dataset.visible = 'false';
    rootEl.setAttribute('role', 'status');
    rootEl.setAttribute('aria-live', 'polite');

    const bodyEl = this.doc.createElement('div');
    bodyEl.className = 'world-contextual-hint-body';

    const dismissButtonEl = this.doc.createElement('button');
    dismissButtonEl.className = 'world-contextual-hint-dismiss';
    dismissButtonEl.type = 'button';
    dismissButtonEl.textContent = 'Got it';
    dismissButtonEl.setAttribute('aria-label', 'Dismiss hint');
    dismissButtonEl.addEventListener('click', this.handleDismissClick);

    rootEl.append(bodyEl, dismissButtonEl);
    this.doc.body.append(rootEl);
    this.rootEl = rootEl;
    this.bodyEl = bodyEl;
    this.dismissButtonEl = dismissButtonEl;
    return rootEl;
  }

  private getRequestSignature(request: OverworldContextualHintRequest): string {
    return `${request.id}:${request.backDirection ?? 0}`;
  }

  private projectWorldToViewport(
    worldX: number,
    worldY: number,
    element: HTMLElement,
  ): { screenX: number; screenY: number } {
    const camera = this.scene.cameras.main;
    const canvasRect = this.scene.game.canvas.getBoundingClientRect();
    const canvasWidth = Math.max(1, this.scene.scale.width);
    const canvasHeight = Math.max(1, this.scene.scale.height);
    const canvasScaleX = canvasRect.width / canvasWidth;
    const canvasScaleY = canvasRect.height / canvasHeight;
    const worldView = camera.worldView;
    const viewportX = camera.x + ((worldX - worldView.x) / Math.max(1, worldView.width)) * camera.width;
    const viewportY = camera.y + ((worldY - worldView.y) / Math.max(1, worldView.height)) * camera.height;
    const rawScreenX = canvasRect.left + viewportX * canvasScaleX;
    const rawScreenY = canvasRect.top + viewportY * canvasScaleY;
    const view = this.doc.defaultView;
    const viewportWidth = view?.innerWidth ?? canvasRect.right;
    const viewportHeight = view?.innerHeight ?? canvasRect.bottom;
    const halfWidth = element.offsetWidth * 0.5;
    const topOffset = element.offsetHeight + 20;
    const minX = VIEWPORT_MARGIN_PX + halfWidth;
    const maxX = viewportWidth - VIEWPORT_MARGIN_PX - halfWidth;
    const minY = VIEWPORT_MARGIN_PX + topOffset;
    const maxY = viewportHeight - VIEWPORT_MARGIN_PX;
    const resolvedMinX = minX <= maxX ? minX : viewportWidth * 0.5;
    const resolvedMaxX = minX <= maxX ? maxX : viewportWidth * 0.5;
    const resolvedMinY = minY <= maxY ? minY : viewportHeight * 0.5;
    const resolvedMaxY = minY <= maxY ? maxY : viewportHeight * 0.5;

    return {
      screenX: Math.round(Phaser.Math.Clamp(rawScreenX, resolvedMinX, resolvedMaxX)),
      screenY: Math.round(Phaser.Math.Clamp(rawScreenY, resolvedMinY, resolvedMaxY)),
    };
  }

  private isHintDismissed(id: OverworldContextualHintId): boolean {
    if (this.sessionDismissedHintIds.has(id)) {
      return true;
    }

    const storage = this.getStorage();
    if (!storage) {
      return false;
    }

    try {
      return storage.getItem(HINT_STORAGE_KEYS[id]) === '1';
    } catch {
      return false;
    }
  }

  private writeDismissedHint(id: OverworldContextualHintId): void {
    const storage = this.getStorage();
    if (!storage) {
      return;
    }

    try {
      storage.setItem(HINT_STORAGE_KEYS[id], '1');
    } catch {
      // The session-level dismissal still prevents repeated prompts if storage is unavailable.
    }
  }

  private getStorage(): Storage | null {
    const view = this.doc.defaultView;
    if (!view) {
      return null;
    }

    try {
      return view.localStorage;
    } catch {
      return null;
    }
  }

  private readonly handleDismissClick = (event: MouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    const hintId = this.activeHintId ?? this.pendingHintId;
    if (hintId) {
      this.dismissHint(hintId);
    }
  };
}
