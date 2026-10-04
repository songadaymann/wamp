import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorPhoneInspector } from './phoneInspector';
import { createEmptyEditorInspectorState } from './inspectorViewModel';
class Node {
  textContent = '';
  scrollTop = 12;
  attributes: Record<string, string> = {};
  private readonly listeners = new Map<string, Set<EventListener>>();
  addEventListener(type: string, listener: EventListener): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)?.add(listener);
  }
  removeEventListener(type: string, listener: EventListener): void { this.listeners.get(type)?.delete(listener); }
  setAttribute(key: string, value: string): void { this.attributes[key] = value; }
  querySelectorAll(): Node[] { return [this]; }
  click(): void { for (const listener of this.listeners.get('click') ?? []) listener({ currentTarget: this } as unknown as Event); }
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
  const nodes = Object.fromEntries(['btn-editor-inspector-done', 'btn-editor-link-cancel', 'editor-inspector', 'editor-phone-link-prompt', 'editor-phone-link-status'].map(id => [id, new Node()]));
  const doc = {
    body: { dataset: { appMode: 'editor', deviceClass: 'phone' } as Record<string, string> },
    getElementById: (id: string) => nodes[id],
    defaultView: { requestAnimationFrame: (callback: () => void) => callback(), dispatchEvent: vi.fn() },
  };
  const clear = vi.fn(); const cancel = vi.fn(); const activity = { active: true };
  const presenter = new EditorPhoneInspector(doc as unknown as Document, () => activity.active, clear, cancel);
  return { nodes, doc, presenter, clear, cancel, activity };
}
const pinned = { ...createEmptyEditorInspectorState(), visible: true, pinned: true, selectionId: 'plate-1' };
describe('phone inspector lifecycle', () => {
  it('shows only a pinned selection and preserves a visible cancel path while linking', () => {
    const f = fixture();
    f.presenter.render({ ...pinned, pinned: false });
    expect(f.doc.body.dataset.editorPhoneInspector).toBe('false');
    f.presenter.render(pinned);
    expect(f.doc.body.dataset.editorPhoneInspector).toBe('true');
    expect(f.nodes['editor-inspector'].attributes['aria-hidden']).toBe('false');
    expect(f.nodes['editor-inspector'].scrollTop).toBe(0);
    f.presenter.render({ ...pinned, connecting: true, pressureStatusText: 'Click a target.' });
    expect(f.doc.body.dataset.editorPhoneInspector).toBe('false');
    expect(f.doc.body.dataset.editorPhoneLinking).toBe('true');
    expect(f.nodes['editor-phone-link-status'].textContent).toBe('Tap a target.');
    f.nodes['btn-editor-link-cancel'].click(); expect(f.cancel).toHaveBeenCalledOnce();
    f.nodes['btn-editor-inspector-done'].click(); expect(f.clear).toHaveBeenCalledOnce();
    f.presenter.destroy();
    expect(f.doc.body.dataset.editorPhoneLinking).toBe('false');
  });
  it('prevents a sleeping or destroyed ordinary editor from taking the expanded inspector', () => {
    const f = fixture(); f.presenter.render(pinned);
    const clearExpanded = vi.fn();
    const expanded = new EditorPhoneInspector(f.doc as unknown as Document, () => true, clearExpanded, vi.fn());
    expanded.render(pinned); f.activity.active = false; f.presenter.render(createEmptyEditorInspectorState());
    f.nodes['btn-editor-inspector-done'].click(); expect(clearExpanded).toHaveBeenCalledOnce(); expect(f.clear).not.toHaveBeenCalled();
    f.presenter.destroy(); expect(f.doc.body.dataset.editorPhoneInspector).toBe('true');
    expanded.destroy(); expect(f.doc.body.dataset.editorPhoneInspector).toBe('false');
  });
  it('locks callbacks immediately during workbenches and deactivates on desktop or play', () => {
    const f = fixture(); f.presenter.render(pinned);
    for (const key of ['editorMusicMode', 'editorMusicUiLocked', 'editorSpriteUiLocked', 'appMode', 'deviceClass']) {
      f.doc.body.dataset[key] = key === 'appMode' ? 'play-world' : key === 'deviceClass' ? 'desktop' : 'true';
      f.nodes['btn-editor-inspector-done'].click(); f.nodes['btn-editor-link-cancel'].click();
      observers.forEach(callback => callback()); expect(f.doc.body.dataset.editorPhoneInspector).toBe('false');
      f.doc.body.dataset[key] = key === 'appMode' ? 'editor' : key === 'deviceClass' ? 'phone' : 'false';
      observers.forEach(callback => callback()); expect(f.doc.body.dataset.editorPhoneInspector).toBe('true');
    }
    expect(f.clear).not.toHaveBeenCalled(); expect(f.cancel).not.toHaveBeenCalled(); f.presenter.destroy();
  });
});
