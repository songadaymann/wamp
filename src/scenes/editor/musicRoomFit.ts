export interface AxisBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface SizeBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RoomCameraFitPlan {
  zoom: number;
  scrollX: number;
  scrollY: number;
  roomScreenX: number;
  roomScreenY: number;
  roomScreenWidth: number;
  roomScreenHeight: number;
}

export interface WorldInset {
  left?: number;
  top?: number;
  right?: number;
  bottom?: number;
}

/** Drum row names are drawn just left of the room grid. */
export const MUSIC_ROOM_LABEL_GUTTER = 72;
/** Keep a strip of each neighboring room in frame. */
export const MUSIC_ROOM_NEIGHBOR_PEEK = 48;
/** Phrase column used to reserve camera space. The panel may draw wider, up to the drum names. */
const MUSIC_WORKBENCH_COLUMN = 260;
/** Widest drum short-label is 32px and ends 8px left of the grid, plus a small gap. */
const MUSIC_LABEL_CLEARANCE = 8 + 32 + 6;

const VIEW_PADDING = 10;
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 8;

function boxHeight(box: AxisBox): number {
  return box.bottom - box.top;
}

function boxWidth(box: AxisBox): number {
  return box.right - box.left;
}

function overlaps(a: AxisBox, b: AxisBox): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function containsBox(outer: AxisBox, inner: AxisBox, slack = 4): boolean {
  return (
    inner.left >= outer.left - slack
    && inner.top >= outer.top - slack
    && inner.right <= outer.right + slack
    && inner.bottom <= outer.bottom + slack
  );
}

function toGameBox(box: AxisBox, canvas: AxisBox, scaleX: number, scaleY: number): AxisBox {
  return {
    left: (box.left - canvas.left) * scaleX,
    top: (box.top - canvas.top) * scaleY,
    right: (box.right - canvas.left) * scaleX,
    bottom: (box.bottom - canvas.top) * scaleY,
  };
}

export function resolveMusicRoomViewport(input: {
  canvas: AxisBox;
  gameWidth: number;
  gameHeight: number;
  shell: AxisBox | null;
  workbench: AxisBox | null;
}): SizeBox {
  const full: SizeBox = {
    x: VIEW_PADDING,
    y: VIEW_PADDING,
    width: Math.max(1, input.gameWidth - VIEW_PADDING * 2),
    height: Math.max(1, input.gameHeight - VIEW_PADDING * 2),
  };
  const canvasWidth = boxWidth(input.canvas);
  const canvasHeight = boxHeight(input.canvas);
  if (canvasWidth < 1 || canvasHeight < 1 || input.gameWidth < 1 || input.gameHeight < 1) {
    return full;
  }

  const scaleX = input.gameWidth / canvasWidth;
  const scaleY = input.gameHeight / canvasHeight;
  const canvasGame: AxisBox = { left: 0, top: 0, right: input.gameWidth, bottom: input.gameHeight };
  let top = 0;
  let left = 0;

  const shell = input.shell && overlaps(input.shell, input.canvas)
    ? toGameBox(input.shell, input.canvas, scaleX, scaleY)
    : null;
  if (shell && overlaps(shell, canvasGame) && shell.top <= top + 8) {
    top = Math.max(top, shell.bottom);
  }

  const workbench = input.workbench
    && overlaps(input.workbench, input.canvas)
    && !(input.shell && containsBox(input.shell, input.workbench))
    ? toGameBox(input.workbench, input.canvas, scaleX, scaleY)
    : null;
  if (
    workbench
    && overlaps(workbench, canvasGame)
    && workbench.left < input.gameWidth * 0.45
    && workbench.right < input.gameWidth * 0.75
  ) {
    const columnRight = workbench.left + MUSIC_WORKBENCH_COLUMN * scaleX;
    left = Math.max(left, Math.min(workbench.right, columnRight));
  }

  const x = left + VIEW_PADDING;
  const y = top + VIEW_PADDING;
  const width = input.gameWidth - VIEW_PADDING - x;
  const height = input.gameHeight - VIEW_PADDING - y;
  if (width < 64 || height < 64) {
    return full;
  }

  return { x, y, width, height };
}

export function planRoomCameraFit(input: {
  cameraWidth: number;
  cameraHeight: number;
  originX: number;
  originY: number;
  roomX: number;
  roomY: number;
  roomWidth: number;
  roomHeight: number;
  viewport: SizeBox;
  worldInset?: WorldInset;
}): RoomCameraFitPlan {
  const insetLeft = input.worldInset?.left ?? 0;
  const insetTop = input.worldInset?.top ?? 0;
  const insetRight = input.worldInset?.right ?? 0;
  const insetBottom = input.worldInset?.bottom ?? 0;
  const frameX = input.roomX - insetLeft;
  const frameY = input.roomY - insetTop;
  const frameWidth = input.roomWidth + insetLeft + insetRight;
  const frameHeight = input.roomHeight + insetTop + insetBottom;
  const zoom = Math.max(
    MIN_ZOOM,
    Math.min(MAX_ZOOM, input.viewport.width / frameWidth, input.viewport.height / frameHeight),
  );
  const frameScreenWidth = frameWidth * zoom;
  const frameScreenHeight = frameHeight * zoom;
  const frameScreenX = input.viewport.x + (input.viewport.width - frameScreenWidth) * 0.5;
  const frameScreenY = input.viewport.y + (input.viewport.height - frameScreenHeight) * 0.5;
  const displayWidth = input.cameraWidth / zoom;
  const displayHeight = input.cameraHeight / zoom;

  return {
    zoom,
    scrollX: Math.round(
      frameX - input.cameraWidth * input.originX + displayWidth * 0.5 - frameScreenX / zoom,
    ),
    scrollY: Math.round(
      frameY - input.cameraHeight * input.originY + displayHeight * 0.5 - frameScreenY / zoom,
    ),
    roomScreenX: frameScreenX + insetLeft * zoom,
    roomScreenY: frameScreenY + insetTop * zoom,
    roomScreenWidth: input.roomWidth * zoom,
    roomScreenHeight: input.roomHeight * zoom,
  };
}

export function resizeScaleToElement(
  scale: { width: number; height: number; resize: (width: number, height: number) => void },
  element: { clientWidth: number; clientHeight: number } | null,
): void {
  if (!element) {
    return;
  }

  const width = Math.round(element.clientWidth);
  const height = Math.round(element.clientHeight);
  if (width <= 0 || height <= 0 || (scale.width === width && scale.height === height)) {
    return;
  }

  scale.resize(width, height);
}

export function syncMusicWorkbenchFrame(
  canvas: HTMLCanvasElement,
  gameWidth: number,
  gameHeight: number,
  plan: RoomCameraFitPlan,
): void {
  const rect = canvas.getBoundingClientRect();
  const scaleX = rect.width / Math.max(1, gameWidth);
  const scaleY = rect.height / Math.max(1, gameHeight);
  const roomTop = rect.top + plan.roomScreenY * scaleY;
  const roomHeight = plan.roomScreenHeight * scaleY;
  const workbench = canvas.ownerDocument.getElementById('editor-music-workbench');
  const panelLeft = workbench?.getBoundingClientRect().left ?? rect.left + 10;
  const gutterLeft = rect.left + (plan.roomScreenX - MUSIC_ROOM_LABEL_GUTTER * plan.zoom) * scaleX;
  const nameLeft = rect.left + (plan.roomScreenX - MUSIC_LABEL_CLEARANCE * plan.zoom) * scaleX;
  const designRight = panelLeft + MUSIC_WORKBENCH_COLUMN;
  const nameLimit = nameLeft - 4;
  let panelRight = designRight;
  if (nameLimit < designRight) {
    panelRight = Math.max(panelLeft + 168, nameLimit);
  } else if (gutterLeft <= designRight + 36) {
    panelRight = Math.min(nameLimit, designRight + 96);
  }
  const panelWidth = panelRight - panelLeft;
  const root = canvas.ownerDocument.body;
  root.style.setProperty('--editor-music-room-top', `${Math.round(roomTop)}px`);
  root.style.setProperty('--editor-music-room-height', `${Math.round(Math.max(1, roomHeight))}px`);
  root.style.setProperty('--editor-music-workbench-width', `${Math.round(panelWidth)}px`);
}

export function clearMusicWorkbenchFrame(doc: Document = document): void {
  doc.body.style.removeProperty('--editor-music-room-top');
  doc.body.style.removeProperty('--editor-music-room-height');
  doc.body.style.removeProperty('--editor-music-workbench-width');
}

function visibleAxisBox(element: HTMLElement | null): AxisBox | null {
  if (!element || element.classList.contains('hidden') || element.closest('.hidden')) {
    return null;
  }

  const rect = element.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) {
    return null;
  }

  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
  };
}

export function readMusicRoomViewport(
  canvas: HTMLCanvasElement,
  doc: Document,
  gameWidth: number,
  gameHeight: number,
): SizeBox {
  const rect = canvas.getBoundingClientRect();
  return resolveMusicRoomViewport({
    canvas: {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
    },
    gameWidth,
    gameHeight,
    shell: visibleAxisBox(doc.querySelector<HTMLElement>('.editor-music-shell')),
    workbench: visibleAxisBox(doc.getElementById('editor-music-workbench')),
  });
}

export class MusicRoomFitController {
  private observer: ResizeObserver | null = null;
  private active = false;
  private generation = 0;

  sync(active: boolean, apply: () => void, onDeactivate: () => void): void {
    this.generation += 1;
    if (!active) {
      if (!this.active) {
        return;
      }

      this.active = false;
      this.stopObserving();
      const generation = this.generation;
      requestAnimationFrame(() => {
        if (this.generation === generation && !this.active) {
          onDeactivate();
        }
      });
      return;
    }

    if (!this.active) {
      this.active = true;
      this.observe(apply);
    }
    apply();
    const generation = this.generation;
    requestAnimationFrame(() => {
      if (this.generation === generation && this.active) {
        apply();
      }
    });
  }

  stop(): void {
    this.generation += 1;
    this.active = false;
    this.stopObserving();
  }

  private observe(apply: () => void): void {
    this.stopObserving();
    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    const doc = document;
    this.observer = new ResizeObserver(() => {
      if (this.active) {
        apply();
      }
    });
    const shell = doc.querySelector<HTMLElement>('.editor-music-shell');
    if (shell) {
      this.observer.observe(shell);
    }
    for (const id of ['editor-music-workbench', 'game-container']) {
      const element = doc.getElementById(id);
      if (element) {
        this.observer.observe(element);
      }
    }
  }

  private stopObserving(): void {
    this.observer?.disconnect();
    this.observer = null;
  }
}
