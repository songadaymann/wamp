import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ default: { Scene: class {}, Geom: { Rectangle: class {} }, Math: {
  Vector2: class { constructor(public x: number, public y: number) {} },
} } }));
import { canPlacedObjectBeLinkedObjectTarget, editorState, updateEditorState, type PlacedObject } from '../../config';
import { createDefaultCourseSnapshot, type CourseSnapshot } from '../../courses/model';
import { EditorInspectorController } from './inspector';
import { CourseEditorObjectInspectorController } from '../courseEditor/objectInspector';

const saved = { paletteMode: editorState.paletteMode, isPlaying: editorState.isPlaying,
  selectedObjectId: editorState.selectedObjectId };
beforeEach(() => updateEditorState({ paletteMode: 'objects', isPlaying: false, selectedObjectId: null }));
afterEach(() => updateEditorState(saved));

function runtime(objects: PlacedObject[], originX = 0) {
  const get = (id: string | null | undefined) => objects.find(p => p.instanceId === id) ?? null;
  const write = vi.fn((id: string, target: string | null) => {
    const source = get(id); if (!source) return false;
    const changed = (source.triggerTargetInstanceId ?? null) !== target;
    source.triggerTargetInstanceId = target;
    return changed;
  });
  return { getPlacedObjectByInstanceId: get, hasPlacedObjectInstanceId: (id: string) => Boolean(get(id)),
    findPlacedObjectAt: (x: number, y: number, predicate: (p: PlacedObject) => boolean) =>
      objects.find(p => p.x + originX === x && p.y === y && predicate(p)) ?? null,
    getObjectLinkEligibleTargets: (id: string) => objects.filter(p => p.instanceId !== id
      && Boolean(get(id)) && canPlacedObjectBeLinkedObjectTarget(get(id)!, p)),
    getObjectPathTargets: () => [], setObjectLinkTarget: write, setPressurePlateTarget: write,
  };
}

const scene = { cameras: { main: { getWorldPoint: (x: number, y: number) => ({ x, y }) } } };

function expandedFixture() {
  const plate: PlacedObject = { id: 'floor_trigger', instanceId: 'plate', x: 8, y: 16 };
  const door: PlacedObject = { id: 'door_metal', instanceId: 'door', x: 24, y: 16 };
  const aObjects = [plate], bObjects = [door];
  const a = { roomId: 'a', origin: { x: 0, y: 0 }, placedObjects: aObjects, runtime: runtime(aObjects) };
  const b = { roomId: 'b', origin: { x: 640, y: 0 }, placedObjects: bObjects, runtime: runtime(bObjects, 640) };
  let draft = createDefaultCourseSnapshot('fixture');
  const render = vi.fn();
  const controller = new CourseEditorObjectInspectorController(scene as never, {
    getRoomSlices: () => [a, b], getRoomSliceById: (id: string) => id === 'a' ? a : id === 'b' ? b : null,
    getSelectedSlice: () => a, getSliceAtWorldPoint: (x: number) => x < 640 ? a : b,
    getActiveCourseDraft: () => draft, setActiveCourseDraft: (next: CourseSnapshot) => { draft = next; },
    getSliceLabel: (s: { roomId: string }) => s.roomId, renderInspector: render,
  } as never);
  return { controller, a, b, plate, door, draft: () => draft, render };
}

describe('inspector link writes before shared controller extraction (F275)', () => {
  it('writes and clears a single-room local link through the native click route', () => {
    const plate: PlacedObject = { id: 'floor_trigger', instanceId: 'plate', x: 8, y: 16 };
    const door: PlacedObject = { id: 'door_metal', instanceId: 'door', x: 24, y: 16 };
    const edit = runtime([plate, door]), render = vi.fn();
    const controller = new EditorInspectorController(scene as never, edit as never, render);
    controller.handleObjectPlaced(plate);
    expect(controller.isConnectingPressurePlate()).toBe(true);
    expect(controller.handleObjectModePrimaryAction({ x: 24, y: 16 } as never)).toBe(true);
    expect(edit.setObjectLinkTarget).toHaveBeenCalledExactlyOnceWith('plate', 'door');
    expect(controller.isConnectingPressurePlate()).toBe(false);
    expect(render).toHaveBeenLastCalledWith(expect.objectContaining({ pressureStatusText: 'Pressure plate linked to metal door.' }));
    controller.clearFocusedPressurePlateConnection();
    expect(edit.setObjectLinkTarget).toHaveBeenLastCalledWith('plate', null);
    expect(plate.triggerTargetInstanceId).toBeNull();
  });

  it('keeps cross-cell links in the course document while clearing the local mirror', () => {
    const f = expandedFixture();
    f.controller.handleObjectPlaced(f.plate);
    expect(f.controller.handlePressurePlateConnectionClick(f.b as never, 664, 16)).toBe(true);
    expect(f.a.runtime.setPressurePlateTarget).toHaveBeenCalledExactlyOnceWith('plate', null);
    expect(f.plate.triggerTargetInstanceId).toBeNull();
    expect(f.draft().objectLinks).toEqual([{ triggerRoomId: 'a', triggerInstanceId: 'plate',
      targetRoomId: 'b', targetInstanceId: 'door' }]);
    expect(f.draft().pressurePlateLinks).toEqual(f.draft().objectLinks);
    f.controller.clearFocusedPressurePlateConnection();
    expect(f.draft().objectLinks).toEqual([]);
    expect(f.draft().pressurePlateLinks).toEqual([]);
  });

  it('prunes a cross-cell link when its target is removed', () => {
    const f = expandedFixture();
    f.controller.handleObjectPlaced(f.plate);
    f.controller.handlePressurePlateConnectionClick(f.b as never, 664, 16);
    f.b.placedObjects.splice(0);
    f.controller.handleObjectRemoved('b', f.door);
    expect(f.draft().objectLinks).toEqual([]);
    expect(f.draft().pressurePlateLinks).toEqual([]);
  });
});
