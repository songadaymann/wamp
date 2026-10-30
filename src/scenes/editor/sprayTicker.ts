import { clampSprayBrushSize, getSprayTilesPerSecond, listCircleBrushOffsets } from './sprayTiles';

/** A held brush emits by elapsed time, never by the browser's pointer-event rate. */
export class EditorSprayTicker {
  private remainder = 0;

  reset(): void { this.remainder = 0; }

  tick(deltaMs: number, active: boolean, size: number, rate: number, emit: () => void): void {
    if (!active) { this.reset(); return; }
    const brushSize = clampSprayBrushSize(size);
    this.remainder += getSprayTilesPerSecond(brushSize, rate) * Math.max(0, deltaMs) / 1000;
    const burst = Math.min(listCircleBrushOffsets(brushSize).length, Math.floor(this.remainder));
    this.remainder -= burst;
    for (let i = 0; i < burst; i += 1) emit();
  }
}
