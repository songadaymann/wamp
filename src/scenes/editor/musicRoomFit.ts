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
}

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
    && workbench.right < input.gameWidth * 0.6
  ) {
    left = Math.max(left, workbench.right);
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
}): RoomCameraFitPlan {
  const zoom = Math.max(
    MIN_ZOOM,
    Math.min(MAX_ZOOM, input.viewport.width / input.roomWidth, input.viewport.height / input.roomHeight),
  );
  const roomScreenWidth = input.roomWidth * zoom;
  const roomScreenHeight = input.roomHeight * zoom;
  const screenX = input.viewport.x + (input.viewport.width - roomScreenWidth) * 0.5;
  const screenY = input.viewport.y + (input.viewport.height - roomScreenHeight) * 0.5;
  const displayWidth = input.cameraWidth / zoom;
  const displayHeight = input.cameraHeight / zoom;

  return {
    zoom,
    scrollX: Math.round(
      input.roomX - input.cameraWidth * input.originX + displayWidth * 0.5 - screenX / zoom,
    ),
    scrollY: Math.round(
      input.roomY - input.cameraHeight * input.originY + displayHeight * 0.5 - screenY / zoom,
    ),
  };
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
    shell: visibleAxisBox(doc.getElementById('editor-music-shell')),
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
    for (const id of ['editor-music-shell', 'editor-music-workbench', 'game-container']) {
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
