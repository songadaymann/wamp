import { expect, it, vi } from 'vitest';
import { createSpecialTileCallbacks } from './specialTileCallbacks';
it('does not read a scene collaborator until its callback is invoked', () => {
  const lookup = vi.fn();const callbacks = createSpecialTileCallbacks(lookup);
  expect(lookup).not.toHaveBeenCalled();
  const controller = { getConveyorDirectionForBody: vi.fn(() => 1), getBodyRoomId: vi.fn(() => '0,0'),
    getEnvironmentForBody: vi.fn(() => ({ onDamage: false })), isBodyOnDamageTile: vi.fn(() => true) };
  lookup.mockReturnValue(controller);const body = {} as never;
  expect(callbacks.getConveyorDirectionForBody(body, 'left')).toBe(1);
  expect(controller.getConveyorDirectionForBody).toHaveBeenCalledWith(body, 'left');
  expect(callbacks.getBodyRoomId(body)).toBe('0,0');expect(callbacks.isBodyOnDamageTile(body)).toBe(true);
  expect(callbacks.getSpecialTileEnvironmentForBody(body, 'down')).toEqual({ onDamage: false });
});
