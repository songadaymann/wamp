import { describe, expect, it, vi } from 'vitest';
import type { RoomCommentRecord } from '../../roomComments/model';
import { RoomCommentsPlayPresentationController } from './roomCommentsPlayPresentationController';

vi.mock('phaser', () => ({
  default: {
    Geom: {
      Rectangle: class Rectangle {},
    },
  },
}));

describe('RoomCommentsPlayPresentationController', () => {
  it('owns pin creation, position, popover interaction, reconciliation, and teardown', () => {
    const scene = createScene();
    const onDisplayObjectsChanged = vi.fn();
    const controller = new RoomCommentsPlayPresentationController({
      scene: scene as never,
      getRoomOrigin: ({ x, y }) => ({ x: x * 640, y: y * 352 }),
      onDisplayObjectsChanged,
    });

    controller.sync([comment('comment-a', 2, 3, 18, 42)]);
    expect(controller.getRenderedCount()).toBe(1);
    expect(onDisplayObjectsChanged).toHaveBeenCalledOnce();
    const container = controller.getIgnoredObjects()[0] as unknown as TestDisplayObject;
    expect(container.position).toEqual({ x: 2 * 640 + 18, y: 3 * 352 + 20 });
    expect(container.depth).toBe(262);
    expect(container.children.slice(1).every((child) => child.visible === false)).toBe(true);

    container.emit('pointerover');
    expect(container.children.slice(1).every((child) => child.visible === true)).toBe(true);
    container.emit('pointerdown');
    container.emit('pointerout');
    expect(container.children.slice(1).every((child) => child.visible === true)).toBe(true);
    container.emit('pointerdown');
    container.emit('pointerout');
    expect(container.children.slice(1).every((child) => child.visible === false)).toBe(true);

    controller.sync([comment('comment-a', 4, 5, 10, 20)]);
    expect(container.position).toEqual({ x: 4 * 640 + 10, y: 5 * 352 - 2 });
    expect(onDisplayObjectsChanged).toHaveBeenCalledOnce();

    controller.sync([]);
    expect(controller.getRenderedCount()).toBe(0);
    expect(container.destroyed).toBe(true);
    expect(onDisplayObjectsChanged).toHaveBeenCalledTimes(2);

    controller.sync([comment('comment-b', 0, 0, 1, 23)]);
    const replacement = controller.getIgnoredObjects()[0] as unknown as TestDisplayObject;
    controller.reset();
    expect(replacement.destroyed).toBe(true);
    expect(controller.getIgnoredObjects()).toEqual([]);
  });
});

function comment(
  id: string,
  roomX: number,
  roomY: number,
  x: number,
  y: number,
): RoomCommentRecord {
  return {
    id,
    roomId: `${roomX},${roomY}`,
    roomVersion: 1,
    roomCoordinates: { x: roomX, y: roomY },
    position: { x, y },
    body: 'A useful comment',
    authorUserId: 'user-a',
    authorDisplayName: 'Player A',
    createdAt: '2026-08-13T12:00:00.000Z',
  };
}

function createScene() {
  return {
    add: {
      image: () => new TestDisplayObject(),
      graphics: () => new TestDisplayObject(),
      text: (_x: number, _y: number, value: string) => {
        const text = new TestDisplayObject();
        text.text = value;
        text.height = 12;
        return text;
      },
      container: (_x: number, _y: number, children: TestDisplayObject[]) => {
        const container = new TestDisplayObject();
        container.children = children;
        return container;
      },
    },
  };
}

class TestDisplayObject {
  children: TestDisplayObject[] = [];
  visible = true;
  destroyed = false;
  depth = 0;
  height = 0;
  text = '';
  position = { x: 0, y: 0 };
  private readonly listeners = new Map<string, Array<() => void>>();

  setOrigin(): this { return this; }
  setDisplaySize(): this { return this; }
  setSize(): this { return this; }
  setInteractive(): this { return this; }
  clear(): this { return this; }
  fillStyle(): this { return this; }
  lineStyle(): this { return this; }
  fillRoundedRect(): this { return this; }
  strokeRoundedRect(): this { return this; }
  fillTriangle(): this { return this; }

  setDepth(value: number): this {
    this.depth = value;
    return this;
  }

  setPosition(x: number, y: number): this {
    this.position = { x, y };
    return this;
  }

  setVisible(value: boolean): this {
    this.visible = value;
    return this;
  }

  setText(value: string): this {
    this.text = value;
    return this;
  }

  on(event: string, listener: () => void): this {
    const listeners = this.listeners.get(event) ?? [];
    listeners.push(listener);
    this.listeners.set(event, listeners);
    return this;
  }

  emit(event: string): void {
    for (const listener of this.listeners.get(event) ?? []) listener();
  }

  destroy(): void {
    this.destroyed = true;
  }
}
