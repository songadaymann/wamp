import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { editorState, type PlacedObject } from '../../config';
import { EditorObjectMoveController } from './objectMoveController';
import { buildMovedObjectDocument } from './objectMovement';

function harness() {
  const origin = { x: 640, y: 352 };
  let objects: PlacedObject[] = [{ id: 'floor_trigger', instanceId: 'plate', x: 56, y: 304, triggerTargetInstanceId: 'door', coopPlate: true }];
  let enabled = true, editable = true;
  const sprite = { active: true, x: origin.x + 56, y: origin.y + 304, setPosition: vi.fn((x: number, y: number) => { sprite.x = x; sprite.y = y; }) };
  const graphics = { clear: vi.fn(() => graphics), lineStyle: vi.fn(() => graphics), strokeRect: vi.fn(() => graphics), fillStyle: vi.fn(() => graphics), fillRect: vi.fn(() => graphics), setDepth: vi.fn(() => graphics), destroy: vi.fn() };
  const runtime = {
    getRoomOrigin: () => origin,
    getPlacedObjectSprite: () => sprite,
    getPlacedObjectBounds: () => ({ x: origin.x + 48, y: origin.y + 296, width: 16, height: 16 }),
    findPlacedObjectAt: (x: number, y: number) => Math.hypot(x - origin.x - objects[0].x, y - origin.y - objects[0].y) < 20 ? objects[0] : null,
    documentRevision: 1,
    moveArea: vi.fn(() => { runtime.documentRevision += 1; return true; }),
    movePlacedObject: vi.fn((id: string, point: { x: number; y: number }, start: { x: number; y: number }) => {
      if (!editable) return false;
      const move = buildMovedObjectDocument(objects, id, point, start);
      if (!move.objects) return false;
      objects = move.objects; sprite.setPosition(origin.x + objects[0].x, origin.y + objects[0].y); return true;
    }),
  };
  const events = new EventEmitter(), gameEvents = new EventEmitter(), scale = new EventEmitter(), documentEvents = new EventEmitter(), windowEvents = new EventEmitter();
  let hidden = false;
  const ownerDocument = { get hidden() { return hidden; }, addEventListener: documentEvents.on.bind(documentEvents), removeEventListener: documentEvents.off.bind(documentEvents), defaultView: { addEventListener: windowEvents.on.bind(windowEvents), removeEventListener: windowEvents.off.bind(windowEvents) } };
  const scene = { events, scale, game: { events: gameEvents, canvas: { ownerDocument, getBoundingClientRect: () => ({ width: 1000, height: 800 }) } }, cameras: { main: { zoom: 1, getWorldPoint: (x: number, y: number) => ({ x: x + origin.x, y: y + origin.y }) } }, add: { graphics: () => graphics } };
  const host = { isEnabled: () => enabled, getRuntimeAt: (x: number, y: number) => editable && x >= origin.x && x < origin.x + 640 && y >= origin.y && y < origin.y + 352 ? runtime : null, prepare: vi.fn(), showStatus: vi.fn(), onChanged: vi.fn() };
  const controller = new EditorObjectMoveController(scene as never, host as never);
  controller.activate();
  return { controller, runtime, sprite, graphics, events, gameEvents, scale, host, documentEvents, windowEvents, hideDocument: () => { hidden = true; documentEvents.emit('visibilitychange'); }, objects: () => objects, setEnabled: (value: boolean) => { enabled = value; }, setEditable: (value: boolean) => { editable = value; } };
}

function pointer(x = 56, y = 304, options: { id?: number; touch?: boolean; event?: string; right?: boolean } = {}) {
  return { id: options.id ?? 1, x, y, wasTouch: options.touch ?? false, event: { type: options.event ?? 'pointerup' }, leftButtonDown: () => !options.right, rightButtonDown: () => Boolean(options.right) } as never;
}

describe('shared editor object move gesture', () => {
  beforeEach(() => { editorState.activeTool = 'move'; });

  it('previews the sprite with an Expanded origin, leaves the draft unchanged until release, and commits once', () => {
    const h = harness();
    expect(h.controller.down(pointer())).toBe(true); h.controller.move(pointer(87, 287));
    expect(h.sprite.x).toBe(728); expect(h.sprite.y).toBe(640);
    expect(h.objects()[0].x).toBe(56); expect(h.runtime.movePlacedObject).not.toHaveBeenCalled();
    h.controller.up(pointer(87, 287)); h.controller.up(pointer(87, 287));
    expect(h.objects()[0]).toMatchObject({ x: 88, y: 288, instanceId: 'plate', triggerTargetInstanceId: 'door', coopPlate: true });
    expect(h.runtime.movePlacedObject).toHaveBeenCalledOnce(); expect(h.host.onChanged).toHaveBeenCalledOnce();
  });

  it.each(['cancel', 'outside', 'touchcancel', 'second-touch', 'tool-change', 'disabled', 'permission'])('cancels %s without a committed document change', kind => {
    const h = harness(); h.controller.down(pointer(56, 304, { touch: true })); h.controller.move(pointer(88, 272, { touch: true }));
    if (kind === 'cancel') h.controller.cancel();
    if (kind === 'outside') h.controller.up(pointer(88, 272), true);
    if (kind === 'touchcancel') h.controller.up(pointer(88, 272, { touch: true, event: 'touchcancel' }));
    if (kind === 'second-touch') h.controller.down(pointer(100, 200, { id: 2, touch: true }));
    if (kind === 'tool-change') { editorState.activeTool = 'pencil'; h.controller.validate(); }
    if (kind === 'disabled') { h.setEnabled(false); h.controller.validate(); }
    if (kind === 'permission') { h.setEditable(false); h.controller.up(pointer(88, 272)); }
    expect(h.objects()[0].x).toBe(56); expect(h.runtime.movePlacedObject).not.toHaveBeenCalled();
    expect(h.sprite.x).toBe(696); expect(h.sprite.y).toBe(656); expect(h.controller.isDragging).toBe(false);
  });

  it.each(['blur', 'sleep', 'pause', 'resize'])('cancels %s and restores the visible sprite; lifecycle listeners are removed on shutdown', event => {
    const h = harness(); h.controller.down(pointer()); h.controller.move(pointer(88, 272));
    (event === 'blur' ? h.gameEvents : event === 'resize' ? h.scale : h.events).emit(event);
    expect(h.controller.isDragging).toBe(false); expect(h.sprite.x).toBe(696); expect(h.runtime.movePlacedObject).not.toHaveBeenCalled();
    h.events.emit('shutdown'); expect(h.gameEvents.listenerCount('blur')).toBe(0); expect(h.scale.listenerCount('resize')).toBe(0); expect(h.graphics.destroy).toHaveBeenCalledOnce();
  });

  it('consumes empty/read-only Move clicks, rejects a drop in another cell, and right click cancels', () => {
    const h = harness(); expect(h.controller.down(pointer(400, 100))).toBe(true); h.controller.up(pointer(400, 100));
    expect(h.controller.isDragging).toBe(false); expect(h.controller.selectedArea).toBeNull();
    h.setEditable(false); expect(h.controller.down(pointer())).toBe(true); expect(h.controller.isDragging).toBe(false); h.setEditable(true);
    h.controller.down(pointer()); h.controller.up(pointer(700, 304)); expect(h.runtime.movePlacedObject).not.toHaveBeenCalled(); expect(h.sprite.x).toBe(696);
    h.controller.down(pointer()); expect(h.controller.down(pointer(88, 272, { right: true }))).toBe(true); expect(h.controller.isDragging).toBe(false);
  });

  it.each(['hidden-tab', 'window-blur'])('cancels %s independently of Phaser visibility configuration and cleans up DOM listeners', kind => {
    const h = harness(); h.controller.down(pointer()); h.controller.move(pointer(88, 272));
    if (kind === 'hidden-tab') h.hideDocument(); else h.windowEvents.emit('blur');
    expect(h.controller.isDragging).toBe(false); expect(h.sprite.x).toBe(696); expect(h.runtime.movePlacedObject).not.toHaveBeenCalled();
    h.controller.destroy(); expect(h.documentEvents.listenerCount('visibilitychange')).toBe(0); expect(h.windowEvents.listenerCount('blur')).toBe(0);
  });

  it('drags across empty space to select an area, then moves every layer by dragging inside it', () => {
    const h = harness();
    // Pointer coordinates are local to the room cell in this harness: tiles are 16 px.
    h.controller.down(pointer(166, 40)); h.controller.move(pointer(230, 90)); h.controller.up(pointer(230, 90));
    expect(h.controller.selectedArea).toEqual({ minX: 10, minY: 2, maxX: 14, maxY: 5 });
    expect(h.host.showStatus).toHaveBeenLastCalledWith(expect.stringMatching(/^Selected 5×4/));

    h.controller.down(pointer(200, 60)); h.controller.move(pointer(232, 44));
    expect(h.runtime.moveArea).not.toHaveBeenCalled();
    h.controller.up(pointer(232, 44));
    expect(h.runtime.moveArea).toHaveBeenCalledExactlyOnceWith(10, 2, 14, 5, 2, -1);
    expect(h.controller.selectedArea).toEqual({ minX: 12, minY: 1, maxX: 16, maxY: 4 });
    expect(h.host.onChanged).toHaveBeenCalledOnce();
  });

  it('clears the selection on Escape, a tool change, or any other edit to the room', () => {
    const select = (h: ReturnType<typeof harness>) => { h.controller.down(pointer(166, 40)); h.controller.move(pointer(230, 90)); h.controller.up(pointer(230, 90)); };
    const h = harness(); select(h);
    expect(h.controller.cancel()).toBe(true); expect(h.controller.selectedArea).toBeNull(); expect(h.controller.cancel()).toBe(false);
    select(h); editorState.activeTool = 'pencil'; h.controller.validate(); expect(h.controller.selectedArea).toBeNull();
    editorState.activeTool = 'move'; select(h); h.runtime.documentRevision += 1; h.controller.validate(); expect(h.controller.selectedArea).toBeNull();
  });

  it('cancels an area drag without moving anything, and a second touch stops it', () => {
    const h = harness();
    h.controller.down(pointer(166, 40)); h.controller.move(pointer(230, 90)); h.controller.up(pointer(230, 90));
    h.controller.down(pointer(200, 60, { touch: true })); h.controller.move(pointer(250, 60, { touch: true }));
    expect(h.controller.cancel()).toBe(true); expect(h.controller.selectedArea).not.toBeNull();
    h.controller.down(pointer(200, 60, { touch: true })); h.controller.down(pointer(10, 10, { id: 2, touch: true }));
    expect(h.controller.isDragging).toBe(false);
    h.controller.down(pointer(200, 60)); h.controller.up(pointer(250, 60), true);
    expect(h.runtime.moveArea).not.toHaveBeenCalled();
  });

  it('keeps the selection through blur and resize, and survives a room switch when the drag starts (Expanded editor)', () => {
    const h = harness();
    // Expanded editor: prepare selects the room under the pointer, which resets the controller.
    h.host.prepare.mockImplementation(() => h.controller.reset());
    h.controller.down(pointer(166, 40)); h.controller.move(pointer(230, 90)); h.controller.up(pointer(230, 90));
    h.gameEvents.emit('blur'); h.scale.emit('resize'); h.hideDocument();
    expect(h.controller.selectedArea).toEqual({ minX: 10, minY: 2, maxX: 14, maxY: 5 });
    h.controller.down(pointer(200, 60)); h.controller.move(pointer(216, 60)); h.controller.up(pointer(216, 60));
    expect(h.runtime.moveArea).toHaveBeenCalledExactlyOnceWith(10, 2, 14, 5, 1, 0);
    expect(h.controller.selectedArea).toEqual({ minX: 11, minY: 2, maxX: 15, maxY: 5 });
  });

  it('a middle-button pan stops a marquee without consuming the click or dropping the selection', () => {
    const h = harness();
    h.controller.down(pointer(166, 40)); h.controller.move(pointer(230, 90)); h.controller.up(pointer(230, 90));
    const middle = { ...(pointer(300, 300) as object), leftButtonDown: () => false, rightButtonDown: () => false } as never;
    expect(h.controller.down(middle)).toBe(false);
    expect(h.controller.selectedArea).not.toBeNull();
    expect(h.controller.down(pointer(300, 300, { right: true }))).toBe(true);
    expect(h.controller.selectedArea).toBeNull();
  });
});
