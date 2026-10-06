import { describe, expect, it } from 'vitest';
import { PlayerBodyFeedback } from './playerBodyFeedback';

function sample(controller: PlayerBodyFeedback, now: number, position: number, grounded = false,
  velocity = 100, gravityDirection = 'down', climbing = false) {
  return controller.sample({ now, positionAlongGravity: position, grounded, velocityAlongGravity: velocity, gravityDirection, climbing });
}

describe('player body feedback', () => {
  it('keeps initial spawning and small ground steps quiet', () => {
    const feedback = new PlayerBodyFeedback();
    expect(sample(feedback, 0, 200, true).landed).toBe(false);
    sample(feedback, 10, 200);
    expect(sample(feedback, 20, 219, true).landed).toBe(false);
  });

  it('measures landing from the apex, including held enemy bounces', () => {
    const feedback = new PlayerBodyFeedback();
    sample(feedback, 0, 200, true, 0);
    sample(feedback, 20, 195, false, -280);
    sample(feedback, 200, 150, false, 0);
    const landing = sample(feedback, 400, 200, true);
    expect(landing.landed).toBe(true);
    expect(landing.scaleY).toBeCloseTo(0.88);
    expect(sample(feedback, 445, 200, true).scaleY).toBeGreaterThan(0.88);
    expect(sample(feedback, 490, 200, true).scaleY).toBe(1);
    expect(sample(feedback, 510, 200, true).landed).toBe(false);
  });

  it('stretches only the visual profile briefly when upward movement begins', () => {
    const feedback = new PlayerBodyFeedback();
    sample(feedback, 0, 200, true, 0);
    expect(sample(feedback, 10, 195, false, -280).scaleY).toBeCloseTo(1.12);
    expect(sample(feedback, 50, 185, false, -220).scaleY).toBeGreaterThan(1);
    expect(sample(feedback, 90, 175, false, -150).scaleY).toBe(1);
  });

  it('uses projected gravity distance for upward and sideways falls', () => {
    for (const gravity of ['up', 'left', 'right']) {
      const feedback = new PlayerBodyFeedback();
      sample(feedback, 0, -200, true, 0, gravity);
      sample(feedback, 10, -200, false, 100, gravity);
      expect(sample(feedback, 200, -180, true, 0, gravity).landed).toBe(true);
    }
  });

  it('never treats gravity changes, ladders or checkpoint teleports as landings', () => {
    const feedback = new PlayerBodyFeedback();
    sample(feedback, 0, 200);
    expect(sample(feedback, 10, 400, true, 0, 'left').landed).toBe(false);
    sample(feedback, 20, 400, false, 0, 'left', true);
    expect(sample(feedback, 30, 500, true, 0, 'left').landed).toBe(false);
    sample(feedback, 40, 500, false, 100, 'left');
    feedback.reset();
    expect(sample(feedback, 50, 900, true, 0, 'left').landed).toBe(false);
  });
});
