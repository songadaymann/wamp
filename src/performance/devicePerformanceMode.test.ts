import { describe, expect, it, vi } from 'vitest';
import {
  DEVICE_PERFORMANCE_MODE_STORAGE_KEY,
  DEVICE_PERFORMANCE_MODE_STORAGE_VERSION,
  DevicePerformanceModeStore,
  normalizeDevicePerformanceMode,
  parseStoredDevicePerformanceMode,
} from './devicePerformanceMode';

describe('DevicePerformanceModeStore', () => {
  it('normalizes invalid values and malformed or obsolete storage to auto', () => {
    expect(normalizeDevicePerformanceMode('unexpected')).toBe('auto');
    expect(parseStoredDevicePerformanceMode('not json')).toBe('auto');
    expect(parseStoredDevicePerformanceMode(JSON.stringify({ version: 0, mode: 'battery-saver' })))
      .toBe('auto');
    expect(parseStoredDevicePerformanceMode(JSON.stringify({
      version: DEVICE_PERFORMANCE_MODE_STORAGE_VERSION,
      mode: 'invalid',
    }))).toBe('auto');
  });

  it('loads a versioned device-local choice', () => {
    const storage = {
      getItem: vi.fn(() => JSON.stringify({
        version: DEVICE_PERFORMANCE_MODE_STORAGE_VERSION,
        mode: 'full-quality',
      })),
      setItem: vi.fn(),
    };
    expect(new DevicePerformanceModeStore({ storage }).get()).toBe('full-quality');
    expect(storage.getItem).toHaveBeenCalledWith(DEVICE_PERFORMANCE_MODE_STORAGE_KEY);
  });

  it('notifies once and writes the versioned value after a real change', () => {
    const storage = { getItem: vi.fn(() => null), setItem: vi.fn() };
    const dispatchChange = vi.fn();
    const listener = vi.fn();
    const store = new DevicePerformanceModeStore({ storage, dispatchChange });
    store.subscribe(listener);

    expect(store.set('battery-saver')).toBe('battery-saver');
    expect(store.set('battery-saver')).toBe('battery-saver');

    expect(listener).toHaveBeenCalledTimes(1);
    expect(dispatchChange).toHaveBeenCalledTimes(1);
    expect(storage.setItem).toHaveBeenCalledTimes(1);
    expect(JSON.parse(storage.setItem.mock.calls[0][1])).toEqual({
      version: DEVICE_PERFORMANCE_MODE_STORAGE_VERSION,
      mode: 'battery-saver',
    });
  });

  it('keeps a session choice when storage access fails', () => {
    const storage = {
      getItem: vi.fn(() => { throw new Error('blocked'); }),
      setItem: vi.fn(() => { throw new Error('full'); }),
    };
    const store = new DevicePerformanceModeStore({ storage });
    expect(store.get()).toBe('auto');
    expect(store.set('full-quality')).toBe('full-quality');
    expect(store.get()).toBe('full-quality');
  });
});
