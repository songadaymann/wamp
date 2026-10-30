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
  it('updates a visible comment identity without replacing its pin or losing legacy author names', () => {
    const scene = createScene();
    const controller = new RoomCommentsPlayPresentationController({ scene: scene as never,
      getRoomOrigin: () => ({ x: 0, y: 0 }) });
    const original = comment('same-comment', 0, 0, 18, 42);
    controller.sync([original]);
    const container = controller.getIgnoredObjects()[0] as unknown as TestDisplayObject;
    container.emit('pointerover');
    controller.sync([{ ...original, authorUsername: 'unique_account' }]);
    expect(controller.getIgnoredObjects()[0]).toBe(container);
    expect(container.children[2].text).toBe('Player A (@unique_account)');
    expect(container.children[2].visible).toBe(true);
    controller.sync([{ ...original, authorDisplayName: 'Updated', authorUsername: null }]);
    expect(container.children[2].text).toBe('Updated');
  });
  it('owns pin creation, position, popover interaction, reconciliation, and teardown', () => {
    const scene = createScene();
    const controller = new RoomCommentsPlayPresentationController({
      scene: scene as never,
      getRoomOrigin: ({ x, y }) => ({ x: x * 640, y: y * 352 }),
    });

    controller.sync([comment('comment-a', 2, 3, 18, 42)]);
    expect(controller.getRenderedCount()).toBe(1);
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

    controller.sync([]);
    expect(controller.getRenderedCount()).toBe(0);
    expect(container.destroyed).toBe(true);

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
