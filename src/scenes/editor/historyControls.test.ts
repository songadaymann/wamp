import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorHistoryControls } from './historyControls';

class Button {
  disabled = true;
  private listeners = new Set<EventListener>();
  constructor(readonly dataset: { editorHistory: string; editorMusicHistory?: string }) {}
  addEventListener(_type: string, callback: EventListener): void { this.listeners.add(callback); }
  removeEventListener(_type: string, callback: EventListener): void { this.listeners.delete(callback); }
  click(): void {
    for (const callback of this.listeners) callback({ currentTarget: this } as unknown as Event);
  }
}
let observers: Array<() => void>;
beforeEach(() => {
  observers = [];
  vi.stubGlobal('MutationObserver', class {
    constructor(callback: () => void) { observers.push(callback); }
    observe(): void {}
    disconnect(): void {}
  });
});
afterEach(() => vi.unstubAllGlobals());
function fixture() {
  const undo = new Button({ editorHistory: 'undo' });
  const redo = new Button({ editorHistory: 'redo' });
  const doc = { body: { dataset: { appMode: 'editor' } as Record<string, string> }, querySelectorAll: () => [undo, redo] };
  const actions = { undo: vi.fn(), redo: vi.fn() };
  const activity = { active: true };
  const controls = new EditorHistoryControls(doc as unknown as Document, actions.undo, actions.redo, () => activity.active);
  return { doc, undo, redo, actions, controls, activity };
}

describe('history control ownership', () => {
  it('allows dedicated music Undo/Redo while terrain history and sprite editing stay locked', () => {
    const f = fixture();
    f.undo.dataset.editorMusicHistory = '';
    f.controls.render(true, true);
    f.doc.body.dataset.editorMusicMode = 'true';
    f.doc.body.dataset.editorMusicUiLocked = 'true';
    observers.forEach(callback => callback());
    expect(f.undo.disabled).toBe(false);
    expect(f.redo.disabled).toBe(true);
    f.undo.click();
    expect(f.actions.undo).toHaveBeenCalledOnce();
    f.doc.body.dataset.editorSpriteUiLocked = 'true';
    f.undo.click();
    expect(f.actions.undo).toHaveBeenCalledOnce();
    f.controls.destroy();
  });
  it('prevents a sleeping editor from changing or receiving the active editor history', () => {
    const f = fixture();
    f.controls.render(true, false);
    const expandedUndo = vi.fn();
    const expanded = new EditorHistoryControls(f.doc as unknown as Document, expandedUndo, vi.fn());
    expanded.render(false, true);
    f.activity.active = false;
    f.controls.render(true, false);
    observers.forEach(callback => callback());
    expect(f.undo.disabled).toBe(true);
    expect(f.redo.disabled).toBe(false);
    f.undo.click();
    expect(f.actions.undo).not.toHaveBeenCalled();
    expanded.render(true, false);
    f.undo.click();
    expect(expandedUndo).toHaveBeenCalledOnce();
    expect(f.actions.undo).not.toHaveBeenCalled();
    f.controls.destroy();
    expect(f.undo.disabled).toBe(false);
    expanded.destroy();
    expect(f.undo.disabled).toBe(true);
    expect(f.redo.disabled).toBe(true);
  });

  it('restores the prior scene as owner when it wakes and renders again', () => {
    const f = fixture();
    f.controls.render(true, false);
    const expandedUndo = vi.fn();
    const expanded = new EditorHistoryControls(f.doc as unknown as Document, expandedUndo, vi.fn());
    expanded.render(true, false);
    f.controls.render(false, true);
    f.redo.click();
    expect(f.actions.redo).toHaveBeenCalledOnce();
    f.undo.click();
    expect(expandedUndo).not.toHaveBeenCalled();
    expanded.destroy();
    expect(f.redo.disabled).toBe(false);
    f.controls.destroy();
  });

  it('rejects history commands immediately when music, sprite or play takes ownership', () => {
    const f = fixture();
    f.controls.render(true, true);
    for (const key of ['editorMusicMode', 'editorMusicUiLocked', 'editorSpriteUiLocked', 'appMode']) {
      f.doc.body.dataset[key] = key === 'appMode' ? 'play-world' : 'true';
      // Lock the click path before the asynchronous DOM observer can run.
      f.undo.click();
      f.redo.click();
      observers.forEach(callback => callback());
      expect(f.undo.disabled).toBe(true);
      expect(f.redo.disabled).toBe(true);
      f.doc.body.dataset[key] = key === 'appMode' ? 'editor' : 'false';
      observers.forEach(callback => callback());
      expect(f.undo.disabled).toBe(false);
      expect(f.redo.disabled).toBe(false);
    }
    expect(f.actions.undo).not.toHaveBeenCalled();
    expect(f.actions.redo).not.toHaveBeenCalled();
    f.controls.destroy();
    f.undo.click();
    expect(f.actions.undo).not.toHaveBeenCalled();
  });
});
