import { afterEach, describe, expect, it } from 'vitest';
import { MannCoolControllerInput, setMannCoolInputSource } from '../../integrations/mannCoolInput';
import { getTouchInputState, setTouchControlsActive, setTouchMove } from './touchControls';
import { resolveTouchStickDirections, TouchStickPresses } from './touchStick';

// Normalized values follow the portrait stick: horizontal 3px dead zone / 15px full tilt,
// vertical 10px dead zone / 38px full tilt; direction is the raw thumb offset in pixels.
const stick = (stickMoveX: number, stickMoveY: number, stickDirectionX: number, stickDirectionY: number) =>
  ({ active: true, stickMoveX, stickMoveY, stickDirectionX, stickDirectionY, forwardedMoveX: 0, forwardedMoveY: 0 });
// Keys forwarded by the mann.cool shell: each direction is fully on or off.
const keys = (forwardedMoveX: number, forwardedMoveY: number) => ({ ...stick(0, 0, 0, 0), forwardedMoveX, forwardedMoveY });
const none = { left: false, right: false, up: false, down: false };

describe('touch stick directions (F358)', () => {
  afterEach(() => { setMannCoolInputSource(null); setTouchControlsActive(false); });

  it('ignores the stick while touch controls are off', () => {
    expect(resolveTouchStickDirections({ ...stick(1, 1, 40, 40), active: false })).toEqual(none);
  });

  it('keeps a running thumb that drifts down or up a run, not a crouch', () => {
    // 60px right and 22px down is about 20 degrees below horizontal.
    expect(resolveTouchStickDirections(stick(1, 0.43, 60, 22))).toEqual({ ...none, right: true });
    expect(resolveTouchStickDirections(stick(-1, -0.6, -40, -27))).toEqual({ ...none, left: true });
  });

  it('still crouches and crawls when the thumb points clearly up or down', () => {
    expect(resolveTouchStickDirections(stick(0, 1, 2, 40))).toEqual({ ...none, down: true });
    expect(resolveTouchStickDirections(stick(0, -1, -1, -40))).toEqual({ ...none, up: true });
    // A steep down-right push (about 76 degrees) crawls right.
    expect(resolveTouchStickDirections(stick(0.58, 1, 10, 40))).toEqual({ ...none, right: true, down: true });
  });

  it('judges the angle from the raw thumb offset, not the axes’ different full-tilt scales', () => {
    // Both axes are at full tilt, but the thumb points 53 degrees below horizontal.
    expect(resolveTouchStickDirections(stick(1, 1, 30, 40))).toEqual({ ...none, right: true, down: true });
    // And here only 32 degrees.
    expect(resolveTouchStickDirections(stick(1, 1, 64, 40))).toEqual({ ...none, right: true });
  });

  it('walks along the vertical axis in left or right gravity and needs a clear sideways push to jump', () => {
    // Walking up the wall with the thumb drifting 10px sideways stays a walk.
    expect(resolveTouchStickDirections(stick(0.58, -1, 10, -40), 'vertical')).toEqual({ ...none, up: true });
    expect(resolveTouchStickDirections(stick(-1, 1, -20, 38), 'vertical')).toEqual({ ...none, down: true });
    expect(resolveTouchStickDirections(stick(1, 0, 20, 4), 'vertical')).toEqual({ ...none, right: true });
    expect(resolveTouchStickDirections(stick(-1, -1, -50, -38), 'vertical')).toEqual({ ...none, left: true, up: true });
  });

  it('counts both axes at their plain thresholds on a ladder or in water', () => {
    // A 40-degree up-right push climbs instead of walking off the ladder.
    expect(resolveTouchStickDirections(stick(1, -0.86, 40, -34))).toEqual({ ...none, right: true });
    expect(resolveTouchStickDirections(stick(1, -0.86, 40, -34), 'both')).toEqual({ ...none, right: true, up: true });
    expect(resolveTouchStickDirections(stick(1, 0.43, 60, 22), 'both')).toEqual({ ...none, right: true, down: true });
  });

  it('keeps forwarded mann.cool keys at the plain thresholds, diagonals included', () => {
    for (const axis of ['horizontal', 'vertical', 'both'] as const) {
      expect(resolveTouchStickDirections(keys(1, 1), axis)).toEqual({ ...none, right: true, down: true });
      expect(resolveTouchStickDirections(keys(-1, -1), axis)).toEqual({ ...none, left: true, up: true });
    }
    // A forwarded key still counts while the on-screen stick points elsewhere.
    expect(resolveTouchStickDirections({ ...stick(1, 0, 60, 0), forwardedMoveY: 1 })).toEqual({ ...none, right: true, down: true });
  });

  it('reads the stick direction the portrait controls publish and the shell’s keys apart', () => {
    setTouchControlsActive(true);
    setTouchMove(1, 0.43, 60, 22);
    expect(getTouchInputState()).toMatchObject({ moveX: 1, moveY: 0.43, stickDirectionX: 60, stickDirectionY: 22 });
    expect(resolveTouchStickDirections(getTouchInputState())).toEqual({ ...none, right: true });
    setTouchMove(0, 1);
    expect(resolveTouchStickDirections(getTouchInputState())).toEqual({ ...none, down: true });

    setTouchMove(0, 0);
    const shell = new MannCoolControllerInput();
    shell.setEnabled(true);
    setMannCoolInputSource(shell);
    shell.handle({ type: 'keyEvent', key: 'ArrowRight', eventType: 'keydown' });
    shell.handle({ type: 'keyEvent', key: 'ArrowDown', eventType: 'keydown' });
    expect(getTouchInputState()).toMatchObject({ forwardedMoveX: 1, forwardedMoveY: 1, stickMoveX: 0, stickMoveY: 0 });
    expect(resolveTouchStickDirections(getTouchInputState())).toEqual({ ...none, right: true, down: true });
  });
});

describe('touch stick presses (F358)', () => {
  it('presses a direction once when it starts and again only after it is let go', () => {
    const presses = new TouchStickPresses();
    expect(presses.step({ ...none, right: true })).toEqual({ ...none, right: true });
    expect(presses.step({ ...none, right: true })).toEqual(none);
    expect(presses.step({ ...none, right: true, down: true })).toEqual({ ...none, down: true });
    expect(presses.step(none)).toEqual(none);
    expect(presses.step({ ...none, right: true })).toEqual({ ...none, right: true });
  });
});
