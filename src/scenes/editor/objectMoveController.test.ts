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
  const graphics = { clear: vi.fn(() => graphics), lineStyle: vi.fn(() => graphics), strokeRect: vi.fn(() => graphics), setDepth: vi.fn(() => graphics), destroy: vi.fn() };
  const runtime = {
    getRoomOrigin: () => origin,
    getPlacedObjectSprite: () => sprite,
    getPlacedObjectBounds: () => ({ x: origin.x + 48, y: origin.y + 296, width: 16, height: 16 }),
    findPlacedObjectAt: (x: number, y: number) => Math.hypot(x - origin.x - objects[0].x, y - origin.y - objects[0].y) < 20 ? objects[0] : null,
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
    const h = harness(); expect(h.controller.down(pointer(400, 100))).toBe(true); expect(h.controller.isDragging).toBe(false);
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
});
