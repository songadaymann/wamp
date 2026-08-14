import { describe, expect, it, vi } from 'vitest';
import { OverworldQuicksandController } from './quicksandController';

function createHarness(initialTime = 0) {
  let now = initialTime;
  const showTransientStatus = vi.fn();
  const controller = new OverworldQuicksandController({
    getCurrentTime: () => now,
    showTransientStatus,
  });

  return {
    controller,
    showTransientStatus,
    setTime: (nextTime: number) => {
      now = nextTime;
    },
  };
}

describe('overworld quicksand controller', () => {
  it('keeps quicksand active for 90 ms after the most recent contact', () => {
    const { controller, setTime } = createHarness();

    controller.touch();
    setTime(80);
    controller.touch();
    setTime(169);
    expect(controller.isActive()).toBe(true);
    setTime(170);
    expect(controller.isActive()).toBe(false);
  });

  it('rate-limits the quicksand status message for 2.4 seconds', () => {
    const { controller, setTime, showTransientStatus } = createHarness();

    controller.touch();
    setTime(100);
    controller.touch();
    expect(showTransientStatus).toHaveBeenCalledTimes(1);

    setTime(2_400);
    controller.touch();
    expect(showTransientStatus).toHaveBeenCalledTimes(2);
    expect(showTransientStatus).toHaveBeenLastCalledWith('Quicksand drags you down.');
  });

  it('uses the existing enter and leave interpolation rates', () => {
    const { controller, setTime } = createHarness();

    controller.touch();
    controller.updateVisualSink();
    expect(controller.getVisualSink()).toBeCloseTo(1.2);

    controller.updateVisualSink();
    expect(controller.getVisualSink()).toBeCloseTo(2.112);

    setTime(90);
    controller.updateVisualSink();
    expect(controller.getVisualSink()).toBeCloseTo(1.73184);
  });

  it('snaps near the sink targets and resets all runtime state', () => {
    const { controller, setTime, showTransientStatus } = createHarness();

    controller.touch();
    for (let index = 0; index < 40; index += 1) {
      controller.updateVisualSink();
    }
    expect(controller.getVisualSink()).toBe(5);

    controller.reset();
    expect(controller.isActive()).toBe(false);
    expect(controller.getVisualSink()).toBe(0);

    controller.touch();
    expect(showTransientStatus).toHaveBeenCalledTimes(2);
    setTime(90);
    for (let index = 0; index < 40; index += 1) {
      controller.updateVisualSink();
    }
    expect(controller.getVisualSink()).toBe(0);
  });
});
