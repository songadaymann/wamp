import { describe, expect, it, vi } from 'vitest';
import { CourseComposerPanelController } from './courseComposerPanel';
import { sceneCapabilityFixture } from './sceneCapabilityRegistry.testSupport';

vi.mock('phaser', () => ({ default: {} }));

class Control extends EventTarget {
  dataset: Record<string, string> = {};
  textContent = '';
  readonly attributes = new Map<string, string>();
  readonly classList = { toggle: vi.fn() };
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
}

function harness(active: boolean) {
  // As index.html ships it: open, with the handle saying Hide.
  const panel = Object.assign(new Control(), { dataset: { sheet: 'open' } });
  const handle = Object.assign(new Control(), { textContent: 'Hide setup' });
  handle.setAttribute('aria-expanded', 'true');
  const elements = new Map<string, Control>([['course-workbench-panel', panel], ['btn-course-workbench-sheet', handle]]);
  const doc = { getElementById: (id: string) => elements.get(id) ?? null, activeElement: null };
  const seen: string[] = [];
  const scene = sceneCapabilityFixture('CourseComposerScene', {
    getCourseEditorState: () => null,
    keepMapCenterWhile: (change: () => void) => { seen.push(panel.dataset.sheet); change(); seen.push(panel.dataset.sheet); },
  });
  const game = { scene: { getScene: () => scene, isActive: (key: string) => active && key === 'CourseComposerScene' } };
  new CourseComposerPanelController(game as never, doc as never, new EventTarget() as never).init();
  const toggle = () => handle.dispatchEvent(new Event('click'));
  return { panel, handle, seen, toggle };
}

describe('Expanded Room setup sheet on phones (F365)', () => {
  it('folds to the selected cell and opens again, keeping the map centre through each change', () => {
    const h = harness(true);
    h.toggle();
    expect(h.panel.dataset.sheet).toBe('collapsed');
    expect(h.handle.textContent).toBe('Show setup');
    expect(h.handle.getAttribute('aria-expanded')).toBe('false');
    h.toggle();
    expect(h.panel.dataset.sheet).toBe('open');
    expect(h.handle.textContent).toBe('Hide setup');
    expect(h.handle.getAttribute('aria-expanded')).toBe('true');
    // The layout change runs inside the scene's measurement, never before or after it.
    expect(h.seen).toEqual(['open', 'collapsed', 'collapsed', 'open']);
  });

  it('still toggles while the map scene is not running', () => {
    const h = harness(false);
    h.toggle();
    expect(h.panel.dataset.sheet).toBe('collapsed');
    expect(h.seen).toEqual([]);
  });
});
