import { describe, it, expect, vi } from 'vitest';
import { createDefaultEditorState, type EditorState } from './editorState';
import { createEditorStateStore, type EditorStateChange } from './editorStateStore';

const tick = () => new Promise<void>(resolve => queueMicrotask(resolve));
const make = () => createEditorStateStore(createDefaultEditorState());

describe('editor state ownership and change delivery', () => {
  it('keeps reads live and synchronous while batching a whole command into one typed signal', async () => {
    const store = make(), changes: EditorStateChange[] = [], view = store.state;
    store.subscribe(change => changes.push(change));
    store.update({ paletteMode: 'objects', selectedObjectId: 'coin_gold' });
    store.update({ activeTool: 'eraser', paletteMode: 'tiles' });
    expect(view.paletteMode).toBe('tiles');
    expect(view.selectedObjectId).toBe('coin_gold');
    expect(view.activeTool).toBe('eraser');
    expect(changes).toEqual([]);
    await tick();
    expect(changes).toHaveLength(1);
    expect(changes[0]).toEqual({ keys: ['paletteMode', 'selectedObjectId', 'activeTool'], revision: 2, state: view });
    expect(Object.isFrozen(changes[0])).toBe(true);
    expect(Object.isFrozen(changes[0].keys)).toBe(true);
  });

  it('notifies for every setting without depending on a hand-written UI event', async () => {
    const store = make(), changed = new Set<keyof EditorState>();
    store.subscribe(change => change.keys.forEach(key => changed.add(key)));
    const patch: EditorState = { activeTool: 'eraser', rectOutline: true, ellipseOutline: true, lineCurve: true,
      trianglePaintMode: true, triangleStampFill: '#abcdef', triangleStampStroke: '#123456',
      triangleStampFlipX: true, triangleStampFlipY: true,
      randomizeBrushSize: 5, scrambleBrushSize: 5, pencilBrushSize: 3, pencilSprayMode: true,
      pencilSprayBrushSize: 7, pencilSprayRate: 0.7, pencilContinuousStamping: true,
      fillIgnoreTileFlipping: true, shapeFillMode: 'pattern', activeLayer: 'foreground',
      selectedTilesetKey: 'cave', selectedTileGid: 2, eraserBrushSize: 3, tileFlipXMode: 'on', tileFlipYMode: 'rand',
      showLayerGuides: true, layerVisibility: { background: false, terrain: false, foreground: false },
      selection: { ...createDefaultEditorState().selection, width: 2, occupiedMask: [[true, true]] },
      zoom: 3, isPlaying: true, paletteMode: 'tiles', smartTheme: 'cave', smartMaterial: 'cave.ground',
      smartStyle: 'cave', smartDetailsEnabled: false, selectedObjectId: 'coin_gold', objectFacing: 'left',
      selectedBackground: 'stars', selectedSolidBackgroundColor: '#112233', selectedLightingMode: 'playerAuraDark',
      selectedLightingDarkness: 0.9, selectedLightingRadius: 100, selectedWeatherMode: 'rain', selectedWeatherIntensity: 0.8 };
    store.update(patch); await tick();
    expect([...changed].sort()).toEqual(Object.keys(patch).sort());
    expect(store.state).toEqual(patch);
  });

  it('owns nested palette values and rejects all writes through the read view', async () => {
    const initial = { ...createDefaultEditorState(), selection: { ...createDefaultEditorState().selection,
      occupiedMask: [[true]], patternOrder: [{ col: 0, row: 0 }] } };
    const store = createEditorStateStore(initial), onChange = vi.fn();
    store.subscribe(onChange);
    initial.selection.occupiedMask[0][0] = false;
    initial.selection.patternOrder![0].col = 99;
    initial.layerVisibility.terrain = false;
    expect(store.state.selection.occupiedMask).toEqual([[true]]);
    expect(store.state.selection.patternOrder).toEqual([{ col: 0, row: 0 }]);
    expect(store.state.layerVisibility.terrain).toBe(true);
    expect(Reflect.set(store.state, 'zoom', 9)).toBe(false);
    expect(Reflect.set(store.state.selection, 'width', 9)).toBe(false);
    expect(Reflect.set(store.state.selection.occupiedMask[0], '0', false)).toBe(false);
    expect(Reflect.set(store.state.selection.patternOrder![0], 'col', 5)).toBe(false);
    expect(Reflect.set(store.state.layerVisibility, 'terrain', false)).toBe(false);
    await tick(); expect(onChange).not.toHaveBeenCalled();
    if (false) {
      // @ts-expect-error Shared state only permits command writes.
      store.state.zoom = 9;
      // @ts-expect-error Nested selection coordinates are read-only as well.
      store.state.selection.startCol = 9;
      // @ts-expect-error Nested masks cannot bypass the command signal.
      store.state.selection.occupiedMask[0][0] = false;
      // @ts-expect-error Layer toggles also use the command API.
      store.state.layerVisibility.terrain = false;
    }
  });

  it('copies patch values so later caller mutations cannot change the editor silently', async () => {
    const store = make(), selection = { ...createDefaultEditorState().selection, width: 2, occupiedMask: [[true, false]] };
    const visibility = { background: false, terrain: true, foreground: true };
    store.update({ selection, layerVisibility: visibility });
    selection.width = 8; selection.occupiedMask[0][0] = false; visibility.background = true;
    await tick();
    expect(store.state.selection.width).toBe(2);
    expect(store.state.selection.occupiedMask).toEqual([[true, false]]);
    expect(store.state.layerVisibility.background).toBe(false);
  });

  it('does not notify or replace nested identities for repeated normalized values', async () => {
    const store = make(), onChange = vi.fn(), selection = store.state.selection, visibility = store.state.layerVisibility;
    store.subscribe(onChange);
    store.update({ zoom: 2, activeTool: 'pencil', selection: structuredClone(selection), layerVisibility: { ...visibility } });
    await tick();
    expect(onChange).not.toHaveBeenCalled();
    expect(store.state.selection).toBe(selection);
    expect(store.state.layerVisibility).toBe(visibility);
  });

  it('distinguishes ordered masks, absent pattern order and pattern coordinates', async () => {
    const store = make(), change = vi.fn(); store.subscribe(change);
    store.update({ selection: { ...store.state.selection, occupiedMask: [[false]], patternOrder: [] } });
    await tick(); expect(change).toHaveBeenCalledOnce();
    store.update({ selection: { ...store.state.selection, patternOrder: undefined } });
    await tick(); expect(change).toHaveBeenCalledTimes(2);
    store.update({ selection: { ...store.state.selection, patternOrder: [{ col: 1, row: 2 }] } });
    await tick(); expect(change).toHaveBeenCalledTimes(3);
  });

  it('allows unsubscribe before delivery and separate registrations of the same callback', async () => {
    const store = make(), callback = vi.fn(), stop1 = store.subscribe(callback), stop2 = store.subscribe(callback);
    store.update({ zoom: 3 }); stop1(); stop1(); await tick(); expect(callback).toHaveBeenCalledOnce();
    stop2(); store.update({ zoom: 4 }); await tick(); expect(callback).toHaveBeenCalledOnce();
  });

  it('delivers listener-triggered writes in their own next notification', async () => {
    const store = make(), keys: unknown[] = [];
    store.subscribe(change => { keys.push(change.keys); if (change.keys.includes('zoom')) store.update({ activeTool: 'eraser' }); });
    store.update({ zoom: 3 }); await tick(); await tick();
    expect(keys).toEqual([['zoom'], ['activeTool']]);
  });

  it('does not call listeners added during delivery until the next command', async () => {
    const store = make(), late = vi.fn(); let added = false;
    store.subscribe(() => { if (!added) { added = true; store.subscribe(late); } });
    store.update({ zoom: 3 }); await tick(); expect(late).not.toHaveBeenCalled();
    store.update({ zoom: 4 }); await tick(); expect(late).toHaveBeenCalledOnce();
  });

  it('isolates subscriber failures so another UI owner still updates', async () => {
    const store = make(), error = new Error('failed view'), report = vi.spyOn(console, 'error').mockImplementation(() => {}), next = vi.fn();
    try {
      store.subscribe(() => { throw error; }); store.subscribe(next);
      store.update({ zoom: 3 }); await tick();
      expect(report).toHaveBeenCalledWith('Editor state subscriber failed.', error);
      expect(next).toHaveBeenCalledOnce();
    } finally { report.mockRestore(); }
  });

  it('validates unknown keys before mutating and ignores omitted undefined values', async () => {
    const store = make(), notify = vi.fn(); store.subscribe(notify);
    expect(() => store.update({ zoom: 3, nope: true } as Partial<EditorState>)).toThrow('Unknown editor state field');
    expect(store.state.zoom).toBe(2);
    store.update({ zoom: undefined }); await tick(); expect(notify).not.toHaveBeenCalled();
  });
});

it('keeps production callers on the command boundary instead of naked global writes', async () => {
  const fs = await import('node:fs/promises'), ts = await import('typescript');
  const dir = new URL('../', import.meta.url), offenders: string[] = [];
  const sources: URL[] = [];
  const visitDirectory = async (url: URL): Promise<void> => {
    for (const entry of await fs.readdir(url, { withFileTypes: true })) {
      const child = new URL(entry.name + (entry.isDirectory() ? '/' : ''), url);
      if (entry.isDirectory()) { await visitDirectory(child); continue; }
      if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) continue;
      sources.push(child);
    }
  };
  await visitDirectory(dir);
  // Keep the same whole-source AST audit; bounded parallel reads avoid a serial I/O
  // bottleneck when the full suite is running alongside browser verification.
  await Promise.all(Array.from({ length: 16 }, async () => {
    while (sources.length) {
      const child = sources.pop()!;
      const source = await fs.readFile(child, 'utf8');
      // A matching identifier must be literal or contain a Unicode escape. Keep the
      // same whole-source audit without parsing unrelated gameplay/server modules.
      if (!source.includes('editorState') && !source.includes('\\u')) continue;
      const sf = ts.createSourceFile(child.pathname, source, ts.ScriptTarget.Latest, true);
      const rootedInState = (node: import('typescript').Node): boolean => {
        if (ts.isIdentifier(node)) return node.text === 'editorState';
        if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) return rootedInState(node.expression);
        return false;
      };
      const visit = (node: import('typescript').Node): void => {
        if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment
          && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment && rootedInState(node.left)) offenders.push(child.pathname);
        if (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) {
          if ((node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken) && rootedInState(node.operand)) offenders.push(child.pathname);
        }
        if (ts.isCallExpression(node) && ['Object.assign', 'Object.defineProperty', 'Reflect.set'].includes(node.expression.getText(sf))
          && node.arguments[0] && rootedInState(node.arguments[0])) offenders.push(child.pathname);
        ts.forEachChild(node, visit);
      };
      visit(sf);
    }
  }));
  expect(offenders).toEqual([]);
});
