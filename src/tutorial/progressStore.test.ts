import { describe, expect, it } from 'vitest';
import { createDefaultRoomSnapshot } from '../persistence/roomModel';
import { TUTORIAL_PROGRESS_STORAGE_KEY } from './model';
import { TutorialProgressStore } from './progressStore';

class MemoryStorage implements Storage {
  private readonly data = new Map<string, string>();
  get length(): number { return this.data.size; }
  clear(): void { this.data.clear(); }
  getItem(key: string): string | null { return this.data.get(key) ?? null; }
  key(index: number): string | null { return [...this.data.keys()][index] ?? null; }
  removeItem(key: string): void { this.data.delete(key); }
  setItem(key: string, value: string): void { this.data.set(key, value); }
}

describe('TutorialProgressStore', () => {
  it('creates, saves, and resumes a versioned private snapshot', () => {
    const storage = new MemoryStorage();
    const store = new TutorialProgressStore({
      storage,
      now: () => new Date('2026-08-14T12:00:00.000Z'),
      createSessionId: () => 'session-1',
    });
    const created = store.create();
    created.stage = 'creative_edit';
    created.workingSnapshot = createDefaultRoomSnapshot('-10,-6', { x: -10, y: -6 });
    created.creativeChecklist.background = 'skipped';
    const saved = store.save(created);
    const resumed = store.load();

    expect(saved.sessionId).toBe('session-1');
    expect(resumed).toEqual(saved);
    expect(resumed?.workingSnapshot).not.toBe(created.workingSnapshot);
    expect(resumed?.creativeChecklist.background).toBe('skipped');
  });

  it('removes corrupt, incompatible, or stale-template storage', () => {
    const storage = new MemoryStorage();
    const store = new TutorialProgressStore({ storage });

    storage.setItem(TUTORIAL_PROGRESS_STORAGE_KEY, '{bad json');
    expect(store.load()).toBeNull();
    expect(storage.getItem(TUTORIAL_PROGRESS_STORAGE_KEY)).toBeNull();

    const progress = store.create();
    storage.setItem(TUTORIAL_PROGRESS_STORAGE_KEY, JSON.stringify({
      ...progress,
      templateVersions: { ...progress.templateVersions, bridgeRoom: 999 },
    }));
    expect(store.load()).toBeNull();
    expect(storage.getItem(TUTORIAL_PROGRESS_STORAGE_KEY)).toBeNull();
  });

  it('derives terminal status from the saved stage', () => {
    const storage = new MemoryStorage();
    const store = new TutorialProgressStore({ storage });
    const progress = store.create();
    progress.stage = 'completed';
    progress.terminalStatus = 'active';
    expect(store.save(progress).terminalStatus).toBe('completed');
  });
});
