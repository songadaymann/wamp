export interface PollingController {
  sync(enabled: boolean): void;
  stop(): void;
}

export function createPollingController(
  intervalMs: number,
  poll: () => void,
): PollingController {
  let timer: number | null = null;

  const stop = (): void => {
    if (timer === null) return;
    window.clearInterval(timer);
    timer = null;
  };

  return {
    sync(enabled: boolean): void {
      if (!enabled) {
        stop();
        return;
      }
      if (timer === null) timer = window.setInterval(poll, intervalMs);
    },
    stop,
  };
}
