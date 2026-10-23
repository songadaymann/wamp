import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { editorState, updateEditorState, type ToolName } from '../../config';
import { applyEditorToolSelection } from '../../scenes/editor/editorToolSelection';
import { EditorPhoneToolSwitch } from './editorPhoneToolSwitch';

class Text { constructor(public textContent: string, public className = '') {} }
class Button extends EventTarget {
  dataset: Record<string, string> = {};
  disabled = false;
  clicks = 0;
  classes = new Set<string>();
  attributes = new Map<string, string>();
  classList = {
    contains: (name: string) => this.classes.has(name),
    toggle: (name: string, on: boolean) => { if (on) this.classes.add(name); else this.classes.delete(name); },
  };
  constructor(public children: Text[]) { super(); }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  querySelector(selector: string) { return this.children.find(child => selector === `.${child.className}`) ?? null; }
  click() { if (!this.disabled) { this.clicks++; this.dispatchEvent(new Event('click')); } }
}

let observers: Array<() => void>;
let tools: Map<ToolName, Button>;
let halves: Button[];
let active: boolean;
let covered: boolean;
let container: { hidden: boolean };
const original = { tool: editorState.activeTool, mode: editorState.paletteMode, selection: editorState.selection, gid: editorState.selectedTileGid };
const selection = { tilesetKey: 'wampos95', startCol: 3, startRow: 21, width: 2, height: 1, occupiedMask: [[true, true]], patternOrder: [] };

/** What the editor does for a real tool button: select the tool, then redraw the tool row. */
function syncToolRow() {
  for (const [tool, button] of tools) button.classList.toggle('active', editorState.activeTool === tool);
  tools.get('pencil')!.children[1].textContent = editorState.pencilSprayMode ? 'Spray' : 'Draw';
  for (const flush of observers) flush();
}
function realTool(tool: ToolName, label: string) {
  const button = new Button([new Text('?', 'tool-icon'), new Text(label, 'tool-label')]);
  button.addEventListener('click', () => { applyEditorToolSelection(tool); syncToolRow(); });
  return button;
}
const pressed = () => halves.map(half => half.getAttribute('aria-pressed'));
const tap = (tool: string) => halves.find(half => half.dataset.editorPhoneTool === tool)!.click();

beforeEach(() => {
  observers = [];
  active = true;
  covered = false;
  container = { hidden: false };
  tools = new Map([['pencil', realTool('pencil', 'Draw')], ['eraser', realTool('eraser', 'Erase')], ['fill', realTool('fill', 'Fill')]]);
  halves = ['pencil', 'eraser'].map(tool => Object.assign(new Button([new Text(''), new Text('')]), { dataset: { editorPhoneTool: tool } }));
  updateEditorState({ paletteMode: 'tiles', activeTool: 'pencil', pencilSprayMode: false, selection, selectedTileGid: 742 });
  syncToolRow();
  const doc = {
    defaultView: { MutationObserver: class { constructor(flush: () => void) { observers.push(flush); } observe() {} } },
    getElementById: (id: string) => (id === 'editor-phone-draw-switch' ? container : null),
    querySelectorAll: () => halves,
    querySelector: (selector: string) => tools.get(/data-tool="(\w+)"/.exec(selector)![1] as ToolName) ?? null,
  };
  new EditorPhoneToolSwitch(doc as unknown as Document, () => active, () => covered);
});
afterEach(() => {
  updateEditorState({ activeTool: original.tool, paletteMode: original.mode, pencilSprayMode: false, selection: original.selection, selectedTileGid: original.gid });
});

describe('phone Draw/Erase switch (F369)', () => {
  it('switches between Draw and Erase in one tap each and keeps the selected tiles', () => {
    expect(pressed()).toEqual(['true', 'false']);
    expect(halves[0].classes.has('active')).toBe(true);
    tap('eraser');
    expect(editorState.activeTool).toBe('eraser');
    expect(pressed()).toEqual(['false', 'true']);
    expect(halves[1].classes.has('active')).toBe(true);
    tap('pencil');
    expect(editorState.activeTool).toBe('pencil');
    expect(pressed()).toEqual(['true', 'false']);
    expect(editorState.selection).toEqual(selection);
    expect(editorState.selectedTileGid).toBe(742);
  });

  it('leaves the current tool alone when its half is tapped again, so Draw never turns into Spray', () => {
    tap('pencil');
    expect(tools.get('pencil')!.clicks).toBe(0);
    expect(editorState.pencilSprayMode).toBe(false);
    tap('eraser');
    tap('eraser');
    expect(tools.get('eraser')!.clicks).toBe(1);
    expect(editorState.activeTool).toBe('eraser');
  });

  it('follows tool changes made in the tool row, including Spray', () => {
    tools.get('fill')!.click();
    expect(pressed()).toEqual(['false', 'false']);
    tap('pencil');
    tools.get('pencil')!.click();
    expect(editorState.pencilSprayMode).toBe(true);
    expect(halves[0].children[1].textContent).toBe('Spray');
    expect(pressed()).toEqual(['true', 'false']);
  });

  it('hides under a menu or dialog, and a tap that reaches it then does nothing', () => {
    expect(container.hidden).toBe(false);
    covered = true;
    syncToolRow();
    expect(container.hidden).toBe(true);
    tap('eraser');
    expect(editorState.activeTool).toBe('pencil');
    covered = false;
    syncToolRow();
    expect(container.hidden).toBe(false);
  });

  it('does nothing off the phone dock or when the editor has the tool turned off', () => {
    active = false;
    tap('eraser');
    expect(editorState.activeTool).toBe('pencil');
    active = true;
    tools.get('eraser')!.disabled = true;
    syncToolRow();
    expect(halves[1].disabled).toBe(true);
    tap('eraser');
    expect(editorState.activeTool).toBe('pencil');
  });
});
