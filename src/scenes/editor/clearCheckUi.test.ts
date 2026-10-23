import { describe, expect, it, vi } from 'vitest';
import type { ReadyToPublishChecklist } from './clearCheck';
import { renderEditorClearCheck } from './clearCheckUi';

function fakeElement() {
  return { dataset: {} as Record<string, string>, textContent: '', append: vi.fn() };
}

function fakeDocument() {
  const doc = { createElement: vi.fn(() => fakeElement()) };
  const rows = { ownerDocument: doc, replaceChildren: vi.fn() };
  const root = { classList: { toggle: vi.fn() } };
  const heading = { textContent: '' };
  const elements: Record<string, unknown> = {
    'editor-clear-check': root,
    'editor-clear-check-rows': rows,
    'editor-clear-check-title': heading,
  };
  return { doc: { getElementById: (id: string) => elements[id] ?? null } as unknown as Document, rows, root, heading };
}

function checklist(cleared: boolean): ReadyToPublishChecklist {
  return {
    roomId: '6,9',
    rows: [{ id: 'clear', label: 'Clear Check', detail: cleared ? 'Cleared.' : 'Test it.', state: cleared ? 'ready' : 'pending' }],
    cleared,
    ready: cleared,
    publishError: null,
  };
}

describe('editor Clear Check panel', () => {
  it('rebuilds its rows only when it is given a different checklist', () => {
    const { doc, rows, root, heading } = fakeDocument();
    const pending = checklist(false);
    renderEditorClearCheck(doc, pending);
    renderEditorClearCheck(doc, pending);
    renderEditorClearCheck(doc, pending);
    expect(rows.replaceChildren).toHaveBeenCalledOnce();
    expect(root.classList.toggle).toHaveBeenCalledTimes(3);
    expect(heading.textContent).toBe('Ready to Publish');

    renderEditorClearCheck(doc, checklist(true));
    expect(rows.replaceChildren).toHaveBeenCalledTimes(2);
    expect(heading.textContent).toBe('Clear Check ✓');

    renderEditorClearCheck(doc, undefined);
    expect(root.classList.toggle).toHaveBeenLastCalledWith('hidden', true);
    expect(rows.replaceChildren).toHaveBeenCalledTimes(2);
  });
});
