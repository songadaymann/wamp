import { afterEach, describe, expect, it } from 'vitest';
import { getTouchInputState, setTouchControlsActive, setTouchMove } from './touchControls';
import { resolveTouchStickDirections, TouchStickPresses } from './touchStick';

// Normalized values follow the portrait stick: horizontal 3px dead zone / 15px full tilt,
// vertical 10px dead zone / 38px full tilt; direction is the raw thumb offset in pixels.
const stick = (moveX: number, moveY: number, directionX: number, directionY: number) =>
  ({ active: true, moveX, moveY, directionX, directionY });
const none = { left: false, right: false, up: false, down: false };

describe('touch stick directions (F358)', () => {
  afterEach(() => setTouchControlsActive(false));

  it('ignores the stick while touch controls are off', () => {
    expect(resolveTouchStickDirections({ ...stick(1, 1, 40, 40), active: false })).toEqual(none);
  });

  it('keeps a running thumb that drifts down or up a run, not a crouch or a climb', () => {
    // 60px right and 22px down is about 20 degrees below horizontal.
    expect(resolveTouchStickDirections(stick(1, 0.43, 60, 22))).toEqual({ ...none, right: true });
    expect(resolveTouchStickDirections(stick(-1, -0.6, -40, -27))).toEqual({ ...none, left: true });
  });

  it('still crouches, climbs and crawls when the thumb points clearly up or down', () => {
    expect(resolveTouchStickDirections(stick(0, 1, 2, 40))).toEqual({ ...none, down: true });
    expect(resolveTouchStickDirections(stick(0, -1, -1, -40))).toEqual({ ...none, up: true });
    // A steep down-right push (about 76 degrees) crawls right.
    expect(resolveTouchStickDirections(stick(0.58, 1, 10, 40))).toEqual({ ...none, right: true, down: true });
  });

  it('judges the angle from the raw thumb offset, not the axes’ different full-tilt scales', () => {
    // Both axes are at full tilt, but the thumb points 52 degrees below horizontal.
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

  it('leaves an exact digital diagonal to the walking axis', () => {
    expect(resolveTouchStickDirections(stick(1, 1, 1, 1))).toEqual({ ...none, right: true });
    expect(resolveTouchStickDirections(stick(1, 1, 1, 1), 'vertical')).toEqual({ ...none, down: true });
  });

  it('reads the stick direction the portrait controls publish', () => {
    setTouchControlsActive(true);
    setTouchMove(1, 0.43, 60, 22);
    expect(getTouchInputState()).toMatchObject({ directionX: 60, directionY: 22 });
    expect(resolveTouchStickDirections(getTouchInputState())).toEqual({ ...none, right: true });
    setTouchMove(0, 1);
    expect(resolveTouchStickDirections(getTouchInputState())).toEqual({ ...none, down: true });
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
