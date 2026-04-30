import type { GameObjectConfig } from '../../../config';

export const CANNON_BULLET_CONFIG: GameObjectConfig = {
  id: 'cannon_bullet',
  name: 'Cannon Bullet',
  category: 'hazard',
  path: 'assets/enemies/bullet.png',
  frameWidth: 16,
  frameHeight: 16,
  frameCount: 1,
  fps: 0,
  defaultFrame: 0,
  facingDirection: 'left',
  bodyWidth: 10,
  bodyHeight: 10,
  behavior: 'animated',
  description: 'Internal cannon projectile.',
};
