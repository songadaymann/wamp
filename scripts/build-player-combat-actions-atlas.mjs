import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const repoRoot = process.cwd();
const assetRoot = path.join(repoRoot, 'public/assets/player/default');
const sourcePngPath = path.join(assetRoot, 'PlayerCombatSheet.png');
const sourceJsonPath = path.join(assetRoot, 'PlayerCombatSheet.json');
const outputPngPath = path.join(assetRoot, 'PlayerCombatActionsSheet.png');
const outputJsonPath = path.join(assetRoot, 'PlayerCombatActionsSheet.json');

const FRAME_WIDTH = 96;
const FRAME_HEIGHT = 84;
const GRID_COLUMNS = 6;
const GRID_ROWS = 3;

const animationRows = [
  [
    'PlayerCombat 89.aseprite',
    'PlayerCombat 90.aseprite',
    'PlayerCombat 91.aseprite',
    'PlayerCombat 92.aseprite',
    'PlayerCombat 93.aseprite',
  ],
  [
    'PlayerCombat 107.aseprite',
    'PlayerCombat 108.aseprite',
    'PlayerCombat 109.aseprite',
    'PlayerCombat 110.aseprite',
    'PlayerCombat 111.aseprite',
    'PlayerCombat 112.aseprite',
  ],
  [
    'PlayerCombat 233.aseprite',
    'PlayerCombat 234.aseprite',
    'PlayerCombat 235.aseprite',
    'PlayerCombat 236.aseprite',
    'PlayerCombat 237.aseprite',
  ],
];

const sourceAtlas = JSON.parse(fs.readFileSync(sourceJsonPath, 'utf8'));
const outputFrames = {};
const magickArgs = [
  '-size',
  `${FRAME_WIDTH * GRID_COLUMNS}x${FRAME_HEIGHT * GRID_ROWS}`,
  'xc:none',
];

for (const [rowIndex, frameNames] of animationRows.entries()) {
  for (const [columnIndex, frameName] of frameNames.entries()) {
    const sourceFrame = sourceAtlas.frames[frameName];
    if (!sourceFrame) {
      throw new Error(`Missing source frame: ${frameName}`);
    }

    const sourceRect = sourceFrame.frame;
    const targetX = columnIndex * FRAME_WIDTH;
    const targetY = rowIndex * FRAME_HEIGHT;

    magickArgs.push(
      '(',
      sourcePngPath,
      '-crop',
      `${sourceRect.w}x${sourceRect.h}+${sourceRect.x}+${sourceRect.y}`,
      '+repage',
      ')',
      '-geometry',
      `+${targetX}+${targetY}`,
      '-composite',
    );

    outputFrames[frameName] = {
      frame: { x: targetX, y: targetY, w: sourceRect.w, h: sourceRect.h },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: sourceRect.w, h: sourceRect.h },
      sourceSize: { w: sourceRect.w, h: sourceRect.h },
      duration: sourceFrame.duration,
    };
  }
}

magickArgs.push(outputPngPath);
execFileSync('magick', magickArgs, { stdio: 'inherit' });

const outputAtlas = {
  frames: outputFrames,
  meta: {
    app: 'https://www.aseprite.org/',
    version: '1.3.x-repacked',
    image: path.basename(outputPngPath),
    format: 'RGBA8888',
    size: {
      w: FRAME_WIDTH * GRID_COLUMNS,
      h: FRAME_HEIGHT * GRID_ROWS,
    },
    scale: '1',
  },
};

fs.writeFileSync(outputJsonPath, `${JSON.stringify(outputAtlas, null, 2)}\n`, 'utf8');

console.log(`Wrote ${path.relative(repoRoot, outputPngPath)}`);
console.log(`Wrote ${path.relative(repoRoot, outputJsonPath)}`);
