import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { OverworldPhysicsCadence, type OverworldMovementInput } from './physicsCadence';

function input(overrides: Partial<OverworldMovementInput> = {}): OverworldMovementInput {
  return { left: false, right: false, upKeyHeld: false, downHeld: false, spaceHeld: false,
    touchLeft: false, touchRight: false, touchUp: false, touchDown: false,
    upPressed: false, downPressed: false, leftPressed: false, rightPressed: false, spacePressed: false,
    ...overrides };
}

function harness() {
  const scene = new EventEmitter();
  const world = new EventEmitter();
  let currentInput = input();
  let player: object | null = {};
  let active = true;
  const simulateEnvironment = vi.fn();
  const simulateMovement = vi.fn((_delta: number, value: OverworldMovementInput) => ({
    grounded: true, downHeld: value.downHeld, horizontalInput: Number(value.right) - Number(value.left),
    verticalInput: Number(value.downHeld) - Number(value.upKeyHeld), jumpPressed: value.spacePressed,
  }));
  const cadence = new OverworldPhysicsCadence(scene, world, {
    canSimulate: () => active, getPlayerIdentity: () => player,
    captureInput: () => ({ ...currentInput }), simulateEnvironment, simulateMovement,
  });
  return { scene, world, cadence, simulateEnvironment, simulateMovement,
    setInput: (value: OverworldMovementInput) => { currentInput = value; },
    setPlayer: (value: object | null) => { player = value; },
    setActive: (value: boolean) => { active = value; },
    frame: () => scene.emit('preupdate'), step: () => world.emit('worldstep', 1 / 60) };
}

describe('render input handoff to fixed physics', () => {
  it('retains a released short tap across render frames with no physics step', () => {
    const h = harness();
    h.setInput(input({ spacePressed: true, spaceHeld: true, right: true })); h.frame();
    h.setInput(input({ left: true })); h.frame();
    expect(h.simulateMovement).not.toHaveBeenCalled();
    h.step();
    expect(h.simulateMovement).toHaveBeenLastCalledWith(1000 / 60, expect.objectContaining({
      spacePressed: true, spaceHeld: false, left: true, right: false,
    }));
    h.step();
    expect(h.simulateMovement).toHaveBeenLastCalledWith(1000 / 60, expect.objectContaining({
      spacePressed: false, spaceHeld: false, left: true,
    }));
  });

  it('applies both catch-up steps at 30fps and consumes pressed edges only once', () => {
    const h = harness(); h.setInput(input({ spacePressed: true, downHeld: true })); h.frame();
    h.step(); h.step();
    expect(h.simulateEnvironment).toHaveBeenCalledTimes(2);
    expect(h.simulateMovement.mock.calls.map(call => call[1].spacePressed)).toEqual([true, false]);
    expect(h.cadence.getMovement().jumpPressed).toBe(true);
    expect(h.cadence.getStepsThisFrame()).toBe(2);
    h.frame(); expect(h.cadence.getStepsThisFrame()).toBe(0);
    expect(h.cadence.getMovement().jumpPressed).toBe(false);
  });

  it('reports one jump to render-owned traces without repeating it at high refresh', () => {
    const h = harness(); h.setInput(input({ spacePressed: true })); h.frame(); h.step();
    expect(h.cadence.getMovement().jumpPressed).toBe(true);
    h.setInput(input()); h.frame();
    expect(h.cadence.getMovement().jumpPressed).toBe(false);
    h.frame(); h.step(); expect(h.cadence.getMovement().jumpPressed).toBe(false);
  });

  it.each(['pause', 'sleep', 'wake', 'resume'])('does not replay a tap after %s', event => {
    const h = harness(); h.setInput(input({ spacePressed: true })); h.frame();
    h.scene.emit(event); h.setInput(input()); h.frame(); h.step();
    expect(h.simulateMovement).toHaveBeenLastCalledWith(1000 / 60, expect.objectContaining({ spacePressed: false }));
  });

  it('discards input when the player is replaced or respawned during environmental simulation', () => {
    const h = harness(); h.setInput(input({ spacePressed: true })); h.frame();
    h.simulateEnvironment.mockImplementationOnce(() => { h.setPlayer({}); }); h.step();
    expect(h.simulateMovement).not.toHaveBeenCalled();
    h.setInput(input({ spacePressed: true })); h.frame();
    h.simulateEnvironment.mockImplementationOnce(() => { h.cadence.reset(); }); h.step();
    expect(h.simulateMovement).not.toHaveBeenCalled();
  });

  it('clears the cached result when simulation resets the same player body', () => {
    const h = harness(); h.setInput(input({ spacePressed: true })); h.frame();
    h.simulateMovement.mockImplementationOnce(() => {
      h.cadence.reset(); return { grounded: true, downHeld: false, horizontalInput: 1, verticalInput: 0, jumpPressed: true };
    });
    h.step(); expect(h.cadence.getMovement().jumpPressed).toBe(false);
    expect(h.cadence.getMovement().horizontalInput).toBe(0);
  });

  it('can update live objects without a player and removes every hook on shutdown', () => {
    const h = harness(); h.setPlayer(null); h.frame(); h.step();
    expect(h.simulateEnvironment).toHaveBeenCalledOnce();
    expect(h.simulateMovement).not.toHaveBeenCalled();
    h.scene.emit('shutdown');
    expect(h.world.listenerCount('worldstep')).toBe(0);
    expect(h.scene.eventNames()).toEqual([]);
    h.step(); expect(h.simulateEnvironment).toHaveBeenCalledOnce();
  });

  it('does not simulate Browse or replay input after returning to play', () => {
    const h = harness(); h.setInput(input({ spacePressed: true })); h.frame();
    h.setActive(false); h.frame(); h.step(); expect(h.simulateEnvironment).not.toHaveBeenCalled();
    h.setActive(true); h.setInput(input()); h.frame(); h.step();
    expect(h.simulateMovement).toHaveBeenLastCalledWith(1000 / 60, expect.objectContaining({ spacePressed: false }));
  });
});
