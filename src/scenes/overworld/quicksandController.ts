interface OverworldQuicksandControllerOptions {
  getCurrentTime: () => number;
  showTransientStatus: (message: string) => void;
}

const ACTIVE_BUFFER_MS = 90;
const STATUS_COOLDOWN_MS = 2_400;
const MAX_VISUAL_SINK = 5;
const ACTIVE_VISUAL_LERP = 0.24;
const INACTIVE_VISUAL_LERP = 0.18;
const VISUAL_SNAP_THRESHOLD = 0.08;

export class OverworldQuicksandController {
  private touchedUntil = 0;
  private visualSink = 0;
  private statusCooldownUntil = 0;

  constructor(private readonly options: OverworldQuicksandControllerOptions) {}

  reset(): void {
    this.touchedUntil = 0;
    this.visualSink = 0;
    this.statusCooldownUntil = 0;
  }

  touch(): void {
    const now = this.options.getCurrentTime();
    this.touchedUntil = Math.max(this.touchedUntil, now + ACTIVE_BUFFER_MS);
    if (now < this.statusCooldownUntil) {
      return;
    }

    this.statusCooldownUntil = now + STATUS_COOLDOWN_MS;
    this.options.showTransientStatus('Quicksand drags you down.');
  }

  isActive(): boolean {
    return this.options.getCurrentTime() < this.touchedUntil;
  }

  updateVisualSink(): void {
    const active = this.isActive();
    const target = active ? MAX_VISUAL_SINK : 0;
    const lerp = active ? ACTIVE_VISUAL_LERP : INACTIVE_VISUAL_LERP;
    this.visualSink += (target - this.visualSink) * lerp;
    if (Math.abs(this.visualSink - target) < VISUAL_SNAP_THRESHOLD) {
      this.visualSink = target;
    }
  }

  getVisualSink(): number {
    return this.visualSink;
  }
}
