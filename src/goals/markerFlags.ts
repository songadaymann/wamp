import Phaser from 'phaser';

export type GoalMarkerFlagVariant =
  | 'checkpoint-pending'
  | 'checkpoint-reached'
  | 'finish-pending'
  | 'finish-cleared';

export const GOAL_MARKER_FLAG_SHEETS = [
  {
    textureKey: 'goal-marker-flag-red',
    animationKey: 'goal-marker-flag-red-anim',
    path: 'assets/objects/flag.png',
  },
  {
    textureKey: 'goal-marker-flag-green',
    animationKey: 'goal-marker-flag-green-anim',
    path: 'assets/objects/flag-green.png',
  },
  {
    textureKey: 'goal-marker-flag-checkered',
    animationKey: 'goal-marker-flag-checkered-anim',
    path: 'assets/objects/flag-checkered.png',
  },
  {
    textureKey: 'goal-marker-flag-checkered-gold',
    animationKey: 'goal-marker-flag-checkered-gold-anim',
    path: 'assets/objects/flag-checkered-gold.png',
  },
] as const;

const GOAL_MARKER_FLAG_ANIMATION_FRAME_RATE = 8;
const GOAL_MARKER_FLAG_FRAME_WIDTH = 32;
const GOAL_MARKER_FLAG_FRAME_HEIGHT = 32;
const GOAL_MARKER_FLAG_FRAME_COUNT = 9;

const VARIANT_TO_SHEET: Record<
  GoalMarkerFlagVariant,
  (typeof GOAL_MARKER_FLAG_SHEETS)[number]
> = {
  'checkpoint-pending': GOAL_MARKER_FLAG_SHEETS[0],
  'checkpoint-reached': GOAL_MARKER_FLAG_SHEETS[1],
  'finish-pending': GOAL_MARKER_FLAG_SHEETS[2],
  'finish-cleared': GOAL_MARKER_FLAG_SHEETS[3],
};

export function loadGoalMarkerFlagSheets(scene: Phaser.Scene): void {
  for (const sheet of GOAL_MARKER_FLAG_SHEETS) {
    scene.load.spritesheet(sheet.textureKey, sheet.path, {
      frameWidth: GOAL_MARKER_FLAG_FRAME_WIDTH,
      frameHeight: GOAL_MARKER_FLAG_FRAME_HEIGHT,
    });
  }
}

export function createGoalMarkerFlagAnimations(scene: Phaser.Scene): void {
  for (const sheet of GOAL_MARKER_FLAG_SHEETS) {
    if (scene.anims.exists(sheet.animationKey)) {
      continue;
    }

    scene.anims.create({
      key: sheet.animationKey,
      frames: scene.anims.generateFrameNumbers(sheet.textureKey, {
        start: 0,
        end: GOAL_MARKER_FLAG_FRAME_COUNT - 1,
      }),
      frameRate: GOAL_MARKER_FLAG_ANIMATION_FRAME_RATE,
      repeat: -1,
    });
  }
}

export function createGoalMarkerFlagSprite(
  scene: Phaser.Scene,
  variant: GoalMarkerFlagVariant,
  x: number,
  y: number,
  depth: number,
): Phaser.GameObjects.Sprite {
  const sheet = VARIANT_TO_SHEET[variant];
  const sprite = scene.add.sprite(x, y, sheet.textureKey, 0);
  sprite.setOrigin(0.5, 1);
  sprite.setDepth(depth);
  sprite.play(sheet.animationKey);
  return sprite;
}
