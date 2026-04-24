import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const BODY_PARTS = ['Torso', 'LeftArm', 'RightArm', 'LeftLeg', 'RightLeg'];
const CANONICAL_BASE_COLORS = {
  Alien: '#C8FBFB',
  Ape: '#352410',
  Zombie: '#7DA269',
  Albino: '#EAD9D9',
  Light: '#DBB180',
  Medium: '#AE8B61',
  Dark: '#713F1D',
};
const LADDER_HEAD_TOPMOST_ACCESSORIES = new Set([
  'Messy Hair',
  'Dark Hair',
  'Frumpy Hair',
  'Purple Hair',
  'Blonde Short',
  'Blonde Bob',
  'Straight Hair',
  'Straight Hair Dark',
  'Straight Hair Blonde',
  'Stringy Hair',
  'Vampire Hair',
  'Wild Hair',
  'Wild White Hair',
  'Wild Blonde',
  'Pigtails',
  'Hoodie',
]);
const DEFAULT_BODY_SOURCE_PALETTE = ['#FFFCFC', '#BAC6D4', '#8595A8'];
const DEFAULT_STATES = ['Idle', 'Run'];
const DEFAULT_HEAD_SCALE = 1;
const DEFAULT_HEAD_OFFSET = { x: 0, y: 1 };
const HEAD_FLIP_STATES = new Set(['WallSlide']);
const STATE_HEAD_OFFSET_OVERRIDES = {
  Idle: { x: 2, y: 0 },
};
const TYPE_HEAD_OFFSET_OVERRIDES = {
  Alien: { x: -2, y: 0 },
};
const DEFAULT_PREVIEW_BACKGROUND = '#1E1E1E';
const CONTACT_SHEET_FRAME_GAP = 4;
const HISTOGRAM_LINE_PATTERN =
  /^\s*(?<count>\d+):\s+\((?<r>\d+),(?<g>\d+),(?<b>\d+)(?:,(?<a>\d+))?\)\s+#(?<hex>[0-9A-F]{6,8})/iu;
const TRIM_BOX_PATTERN = /^(?<width>\d+)x(?<height>\d+)\+(?<x>-?\d+)\+(?<y>-?\d+)$/u;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (!options.sourceRoot || !options.punkPath) {
    throw new Error(
      'Usage: node prototype-punk-avatar.mjs --source-root /absolute/path/to/SpritesSeparated --punk /absolute/path/to/punk.png [--metadata /absolute/path/to/punks-metadata.json] [--head-image /absolute/path/to/override.png] [--states Idle,Run] [--output /absolute/path/to/output] [--head-scale 1] [--head-offset-x 0] [--head-offset-y 1] [--export-layers]',
    );
  }

  await ensureImageMagick();

  const sourceRoot = path.resolve(options.sourceRoot);
  const punkPath = path.resolve(options.punkPath);
  const states = normalizeStateSpecs(options.states);
  const punkName = path.basename(punkPath, path.extname(punkPath));
  const outputDir =
    options.outputDir ??
    path.resolve(__dirname, 'output', `punk-prototype-${punkName}`);

  await assertDirectoryExists(sourceRoot, 'source sprite root');
  await assertFileExists(punkPath, 'punk image');
  await mkdir(outputDir, { recursive: true });

  const headImagePath = options.headImagePath ? path.resolve(options.headImagePath) : punkPath;
  await assertFileExists(headImagePath, 'head image');
  const headImageSize = await identifyImage(headImagePath);
  const headVisibleBox = await identifyTrimBox(headImagePath);
  const metadataPath = await resolveMetadataPath(options.metadataPath, punkPath);
  const metadata = metadataPath ? await readPunkMetadata(metadataPath, punkPath) : null;
  const punkVisibleBox = await identifyTrimBox(punkPath);
  const fullPunkHistogram = await readHistogram(punkPath);
  const faceBaseColor = await sampleFaceBaseColor(punkPath, punkVisibleBox);
  const partPalettes = derivePartPalettes({ faceBaseColor, fullHistogram: fullPunkHistogram }, metadata);

  const previewDir = path.join(outputDir, 'preview');
  await mkdir(previewDir, { recursive: true });

  const report = {
    createdAt: new Date().toISOString(),
    sourceRoot,
    punkPath,
    headImagePath,
    headVisibleBox,
    states: states.map(({ label, sourcePath }) => ({ label, sourcePath })),
    headScale: options.headScale,
    headOffset: options.headOffset,
    metadataPath,
    punkMetadata: metadata,
    bodySourcePalette: DEFAULT_BODY_SOURCE_PALETTE,
    partPalettes,
    headImageSize,
    outputDir,
    previews: {},
  };

  for (const stateSpec of states) {
    const frameNames = await listFrameNames(sourceRoot, stateSpec.sourcePath);
    const stateOutputDir = path.join(outputDir, stateSpec.label);
    await mkdir(stateOutputDir, { recursive: true });

    const renderedFramePaths = [];
    const bodyLayerFramePaths = [];
    const headLayerFramePaths = [];

    for (const frameName of frameNames) {
      const headLayerPath = path.join(sourceRoot, stateSpec.sourcePath, 'Head', frameName);
      const headBox = await identifyTrimBox(headLayerPath);
      const targetHeadPlacement = placeHeadImage({
        state: stateSpec.placementKey,
        punkType: metadata?.type ?? null,
        sourceVisibleBox: headBox,
        headImageSize,
        headVisibleBox,
        flipHead: HEAD_FLIP_STATES.has(stateSpec.placementKey),
        headScale: options.headScale,
        headOffset: options.headOffset,
      });
      const outputFramePath = path.join(stateOutputDir, frameName);
      const bodyLayerFramePath = options.exportLayers
        ? path.join(outputDir, 'layers', stateSpec.label, 'body', frameName)
        : null;
      const headLayerFramePath = options.exportLayers
        ? path.join(outputDir, 'layers', stateSpec.label, 'head', frameName)
        : null;

      if (bodyLayerFramePath) {
        await mkdir(path.dirname(bodyLayerFramePath), { recursive: true });
      }

      if (headLayerFramePath) {
        await mkdir(path.dirname(headLayerFramePath), { recursive: true });
      }

      await renderFrame({
        outputFramePath,
        headImagePath,
        flipHead: HEAD_FLIP_STATES.has(stateSpec.placementKey),
        sourceRoot,
        sourceStatePath: stateSpec.sourcePath,
        placementKey: stateSpec.placementKey,
        frameName,
        partPalettes,
        targetHeadPlacement,
        metadata,
        bodyLayerFramePath,
        headLayerFramePath,
      });

      renderedFramePaths.push(outputFramePath);

      if (bodyLayerFramePath) {
        bodyLayerFramePaths.push(bodyLayerFramePath);
      }

      if (headLayerFramePath) {
        headLayerFramePaths.push(headLayerFramePath);
      }
    }

    const statePreviewContactSheetPath = path.join(previewDir, `${stateSpec.previewSlug}-contact-sheet.png`);
    const statePreviewGifPath = path.join(previewDir, `${stateSpec.previewSlug}.gif`);

    await mkdir(path.dirname(statePreviewContactSheetPath), { recursive: true });
    await mkdir(path.dirname(statePreviewGifPath), { recursive: true });

    await createContactSheet({
      framePaths: renderedFramePaths,
      outputPath: statePreviewContactSheetPath,
      background: DEFAULT_PREVIEW_BACKGROUND,
    });

    await createPreviewGif({
      framePaths: renderedFramePaths,
      outputPath: statePreviewGifPath,
      background: DEFAULT_PREVIEW_BACKGROUND,
      frameDelay: stateSpec.placementKey === 'Run' ? 6 : 10,
    });

    report.previews[stateSpec.label] = {
      sourceState: stateSpec.sourcePath,
      frameCount: renderedFramePaths.length,
      framesDir: stateOutputDir,
      contactSheet: statePreviewContactSheetPath,
      gif: statePreviewGifPath,
    };

    if (options.exportLayers) {
      const bodyContactSheetPath = path.join(previewDir, `${stateSpec.previewSlug}-body-contact-sheet.png`);
      const bodyGifPath = path.join(previewDir, `${stateSpec.previewSlug}-body.gif`);
      const headContactSheetPath = path.join(previewDir, `${stateSpec.previewSlug}-head-contact-sheet.png`);
      const headGifPath = path.join(previewDir, `${stateSpec.previewSlug}-head.gif`);

      await createContactSheet({
        framePaths: bodyLayerFramePaths,
        outputPath: bodyContactSheetPath,
        background: DEFAULT_PREVIEW_BACKGROUND,
      });
      await createPreviewGif({
        framePaths: bodyLayerFramePaths,
        outputPath: bodyGifPath,
        background: DEFAULT_PREVIEW_BACKGROUND,
        frameDelay: stateSpec.placementKey === 'Run' ? 6 : 10,
      });
      await createContactSheet({
        framePaths: headLayerFramePaths,
        outputPath: headContactSheetPath,
        background: DEFAULT_PREVIEW_BACKGROUND,
      });
      await createPreviewGif({
        framePaths: headLayerFramePaths,
        outputPath: headGifPath,
        background: DEFAULT_PREVIEW_BACKGROUND,
        frameDelay: stateSpec.placementKey === 'Run' ? 6 : 10,
      });

      report.previews[stateSpec.label].layers = {
        bodyFramesDir: path.join(outputDir, 'layers', stateSpec.label, 'body'),
        headFramesDir: path.join(outputDir, 'layers', stateSpec.label, 'head'),
        bodyContactSheet: bodyContactSheetPath,
        bodyGif: bodyGifPath,
        headContactSheet: headContactSheetPath,
        headGif: headGifPath,
      };
    }
  }

  await writeFile(path.join(outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(`Prototype output saved to: ${outputDir}`);
  console.log(`Head image: ${headImagePath}`);
  console.log(`Part palettes: ${JSON.stringify(partPalettes)}`);

  for (const stateSpec of states) {
    const preview = report.previews[stateSpec.label];
    console.log(`${stateSpec.label}: ${preview.frameCount} frames`);
    console.log(`  Contact sheet: ${preview.contactSheet}`);
    console.log(`  GIF: ${preview.gif}`);
  }
}

function parseArgs(argv) {
  const options = {
    sourceRoot: null,
    punkPath: null,
    headImagePath: null,
    outputDir: null,
    metadataPath: null,
    states: [...DEFAULT_STATES],
    headScale: DEFAULT_HEAD_SCALE,
    headOffset: { ...DEFAULT_HEAD_OFFSET },
    exportLayers: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (value === '--source-root') {
      options.sourceRoot = argv[index + 1] ? path.resolve(argv[index + 1]) : null;
      index += 1;
      continue;
    }

    if (value === '--punk') {
      options.punkPath = argv[index + 1] ? path.resolve(argv[index + 1]) : null;
      index += 1;
      continue;
    }

    if (value === '--output') {
      options.outputDir = argv[index + 1] ? path.resolve(argv[index + 1]) : null;
      index += 1;
      continue;
    }

    if (value === '--head-image') {
      options.headImagePath = argv[index + 1] ? path.resolve(argv[index + 1]) : null;
      index += 1;
      continue;
    }

    if (value === '--metadata') {
      options.metadataPath = argv[index + 1] ? path.resolve(argv[index + 1]) : null;
      index += 1;
      continue;
    }

    if (value === '--states') {
      const raw = argv[index + 1] ?? '';
      options.states = raw
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
      index += 1;
      continue;
    }

    if (value === '--head-scale') {
      const parsed = Number(argv[index + 1]);

      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`Invalid --head-scale value: ${argv[index + 1] ?? ''}`);
      }

      options.headScale = parsed;
      index += 1;
      continue;
    }

    if (value === '--head-offset-x') {
      const parsed = Number(argv[index + 1]);

      if (!Number.isFinite(parsed)) {
        throw new Error(`Invalid --head-offset-x value: ${argv[index + 1] ?? ''}`);
      }

      options.headOffset.x = parsed;
      index += 1;
      continue;
    }

    if (value === '--head-offset-y') {
      const parsed = Number(argv[index + 1]);

      if (!Number.isFinite(parsed)) {
        throw new Error(`Invalid --head-offset-y value: ${argv[index + 1] ?? ''}`);
      }

      options.headOffset.y = parsed;
      index += 1;
      continue;
    }

    if (value === '--export-layers') {
      options.exportLayers = true;
    }
  }

  return options;
}

function normalizeStateSpecs(rawStates) {
  return rawStates.map((rawState) => normalizeStateSpec(rawState));
}

function normalizeStateSpec(rawState) {
  const input = String(rawState ?? '').trim();

  if (!input) {
    throw new Error('State entries must be non-empty.');
  }

  const separatorIndex = input.indexOf('=');
  const label = separatorIndex === -1 ? defaultStateLabel(input) : input.slice(0, separatorIndex).trim();
  const sourcePath = separatorIndex === -1 ? input : input.slice(separatorIndex + 1).trim();

  if (!label || !sourcePath) {
    throw new Error(`Invalid state entry: ${input}`);
  }

  return {
    input,
    label,
    sourcePath,
    placementKey: path.basename(sourcePath),
    previewSlug: slugifySegment(label),
  };
}

function defaultStateLabel(sourcePath) {
  const segments = sourcePath
    .split(/[\\/]/u)
    .map((segment) => segment.trim())
    .filter(Boolean);

  return segments.at(-1) ?? sourcePath;
}

function slugifySegment(value) {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');

  return slug || 'state';
}

async function ensureImageMagick() {
  try {
    await execFileAsync('magick', ['-version']);
  } catch {
    throw new Error('ImageMagick (`magick`) is required but was not found.');
  }
}

async function assertDirectoryExists(directoryPath, label) {
  let stats;

  try {
    stats = await stat(directoryPath);
  } catch {
    throw new Error(`Missing ${label}: ${directoryPath}`);
  }

  if (!stats.isDirectory()) {
    throw new Error(`Expected ${label} to be a directory: ${directoryPath}`);
  }
}

async function assertFileExists(filePath, label) {
  let stats;

  try {
    stats = await stat(filePath);
  } catch {
    throw new Error(`Missing ${label}: ${filePath}`);
  }

  if (!stats.isFile()) {
    throw new Error(`Expected ${label} to be a file: ${filePath}`);
  }
}

async function resolveMetadataPath(metadataPath, punkPath) {
  if (metadataPath) {
    return path.resolve(metadataPath);
  }

  const punkDir = path.dirname(punkPath);
  const candidatePaths = [
    path.join(punkDir, 'punks-metadata.json'),
    path.join(path.dirname(punkDir), 'punks-metadata.json'),
  ];

  for (const candidatePath of candidatePaths) {
    try {
      const stats = await stat(candidatePath);
      if (stats.isFile()) {
        return candidatePath;
      }
    } catch {
      // Keep searching nearby metadata files.
    }
  }

  return null;
}

async function listFrameNames(sourceRoot, state) {
  const headDir = path.join(sourceRoot, state, 'Head');
  await assertDirectoryExists(headDir, `${state} head directory`);

  const entries = await readdir(headDir, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.png'))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
}

async function renderFrame({
  outputFramePath,
  headImagePath,
  flipHead,
  sourceRoot,
  sourceStatePath,
  placementKey,
  frameName,
  partPalettes,
  targetHeadPlacement,
  metadata,
  bodyLayerFramePath,
  headLayerFramePath,
}) {
  const magickArgs = ['-size', '96x84', 'xc:none'];
  const headLayerMode = resolveLadderHeadLayerMode({ placementKey, metadata });
  const bodyPartPaths = await Promise.all(
    BODY_PARTS.map(async (part) => {
      const partPath = path.join(sourceRoot, sourceStatePath, part, frameName);
      await assertFileExists(partPath, `${sourceStatePath}/${part}/${frameName}`);
      return {
        part,
        partPath,
        palette: partPalettes[part] ?? partPalettes.default,
      };
    }),
  );

  if (headLayerMode === 'belowBody') {
    appendHeadComposite({
      magickArgs,
      headImagePath,
      flipHead,
      targetHeadPlacement,
    });
  }

  if (headLayerMode === 'betweenArmsAndTorso') {
    for (const partName of ['LeftArm', 'RightArm', 'LeftLeg', 'RightLeg']) {
      const partInfo = bodyPartPaths.find(({ part }) => part === partName);
      if (partInfo) {
        appendBodyPartComposite({ magickArgs, ...partInfo });
      }
    }

    appendHeadComposite({
      magickArgs,
      headImagePath,
      flipHead,
      targetHeadPlacement,
    });

    const torsoInfo = bodyPartPaths.find(({ part }) => part === 'Torso');
    if (torsoInfo) {
      appendBodyPartComposite({ magickArgs, ...torsoInfo });
    }
  } else {
    for (const partInfo of bodyPartPaths) {
      appendBodyPartComposite({ magickArgs, ...partInfo });
    }

    if (headLayerMode === 'topmost') {
      appendHeadComposite({
        magickArgs,
        headImagePath,
        flipHead,
        targetHeadPlacement,
      });
    }
  }

  magickArgs.push(outputFramePath);

  const jobs = [execFileAsync('magick', magickArgs)];

  if (bodyLayerFramePath) {
    jobs.push(
      execFileAsync('magick', [
        ...buildBodyLayerArgs({
          sourceRoot,
          sourceStatePath,
          frameName,
          partPalettes,
        }),
        bodyLayerFramePath,
      ]),
    );
  }

  if (headLayerFramePath) {
    jobs.push(
      execFileAsync('magick', [
        ...buildHeadLayerArgs({
          headImagePath,
          flipHead,
          targetHeadPlacement,
        }),
        headLayerFramePath,
      ]),
    );
  }

  await Promise.all(jobs);
}

function buildBodyLayerArgs({ sourceRoot, sourceStatePath, frameName, partPalettes }) {
  const magickArgs = ['-size', '96x84', 'xc:none'];

  for (const part of BODY_PARTS) {
    const partPath = path.join(sourceRoot, sourceStatePath, part, frameName);
    const palette = partPalettes[part] ?? partPalettes.default;
    appendBodyPartComposite({
      magickArgs,
      partPath,
      palette,
    });
  }

  return magickArgs;
}

function appendBodyPartComposite({ magickArgs, partPath, palette }) {
  magickArgs.push(
    '(',
    partPath,
    '-fill',
    palette[0],
    '-opaque',
    DEFAULT_BODY_SOURCE_PALETTE[0],
    '-fill',
    palette[1],
    '-opaque',
    DEFAULT_BODY_SOURCE_PALETTE[1],
    '-fill',
    palette[2],
    '-opaque',
    DEFAULT_BODY_SOURCE_PALETTE[2],
    ')',
    '-composite',
  );
}

function buildHeadLayerArgs({ headImagePath, flipHead, targetHeadPlacement }) {
  const magickArgs = ['-size', '96x84', 'xc:none'];
  appendHeadComposite({
    magickArgs,
    headImagePath,
    flipHead,
    targetHeadPlacement,
  });
  return magickArgs;
}

function appendHeadComposite({ magickArgs, headImagePath, flipHead, targetHeadPlacement }) {
  magickArgs.push('(', headImagePath);

  if (
    targetHeadPlacement.width !== targetHeadPlacement.sourceWidth ||
    targetHeadPlacement.height !== targetHeadPlacement.sourceHeight
  ) {
    magickArgs.push(
      '-filter',
      'point',
      '-resize',
      `${targetHeadPlacement.width}x${targetHeadPlacement.height}`,
    );
  }

  if (flipHead) {
    magickArgs.push('-flop');
  }

  magickArgs.push(
    ')',
    '-geometry',
    `+${targetHeadPlacement.x}+${targetHeadPlacement.y}`,
    '-composite',
  );
}

function resolveLadderHeadLayerMode({ placementKey, metadata }) {
  if (placementKey !== 'LadderClimb') {
    return 'belowBody';
  }

  const accessories = metadata?.accessories ?? [];
  if (accessories.some((accessory) => LADDER_HEAD_TOPMOST_ACCESSORIES.has(accessory))) {
    return 'topmost';
  }

  return 'betweenArmsAndTorso';
}

async function createContactSheet({ framePaths, outputPath, background }) {
  if (framePaths.length === 0) {
    return;
  }

  const tempPreviewPaths = await createOpaquePreviewFrames(framePaths, background);

  try {
    await execFileAsync('montage', [
      ...tempPreviewPaths,
      '-tile',
      `${framePaths.length}x1`,
      '-geometry',
      `+${CONTACT_SHEET_FRAME_GAP}+${CONTACT_SHEET_FRAME_GAP}`,
      outputPath,
    ]);
  } finally {
    await cleanupTempFiles(tempPreviewPaths);
  }
}

async function createPreviewGif({ framePaths, outputPath, background, frameDelay }) {
  if (framePaths.length === 0) {
    return;
  }

  const tempPreviewPaths = await createOpaquePreviewFrames(framePaths, background);

  try {
    await execFileAsync('magick', [
      ...tempPreviewPaths,
      '-dispose',
      'previous',
      '-delay',
      String(frameDelay),
      '-loop',
      '0',
      outputPath,
    ]);
  } finally {
    await cleanupTempFiles(tempPreviewPaths);
  }
}

async function createOpaquePreviewFrames(framePaths, background) {
  const previewPaths = [];

  for (const framePath of framePaths) {
    const previewPath = path.join(
      os.tmpdir(),
      `punk-preview-${path.basename(framePath, '.png')}-${process.pid}-${randomUUID()}.png`,
    );

    await execFileAsync('magick', [
      framePath,
      '-background',
      background,
      '-alpha',
      'remove',
      '-alpha',
      'off',
      previewPath,
    ]);

    previewPaths.push(previewPath);
  }

  return previewPaths;
}

async function cleanupTempFiles(filePaths) {
  await Promise.all(
    filePaths.map(async (filePath) => {
      try {
        await execFileAsync('rm', ['-f', filePath]);
      } catch {
        // Temp preview cleanup is best-effort.
      }
    }),
  );
}

async function identifyImage(filePath) {
  const { stdout } = await execFileAsync('magick', ['identify', '-format', '%w %h', filePath]);
  const [widthText, heightText] = stdout.trim().split(/\s+/u);

  return {
    width: Number(widthText),
    height: Number(heightText),
  };
}

async function identifyTrimBox(filePath) {
  const { stdout } = await execFileAsync('magick', [filePath, '-trim', '-format', '%wx%h%O', 'info:']);
  const match = stdout.trim().match(TRIM_BOX_PATTERN);

  if (!match?.groups) {
    throw new Error(`Unable to identify trim box for ${filePath}`);
  }

  return {
    width: Number(match.groups.width),
    height: Number(match.groups.height),
    x: Number(match.groups.x),
    y: Number(match.groups.y),
  };
}

function placeHeadImage({
  state,
  punkType,
  sourceVisibleBox,
  headImageSize,
  headVisibleBox,
  flipHead,
  headScale,
  headOffset,
}) {
  const effectiveHeadVisibleBox = flipHead
    ? {
        ...headVisibleBox,
        x: headImageSize.width - headVisibleBox.x - headVisibleBox.width,
      }
    : headVisibleBox;
  const stateOffset = STATE_HEAD_OFFSET_OVERRIDES[state] ?? { x: 0, y: 0 };
  const typeOffset = punkType ? TYPE_HEAD_OFFSET_OVERRIDES[punkType] ?? { x: 0, y: 0 } : { x: 0, y: 0 };
  const targetWidth = Math.max(1, Math.round(headImageSize.width * headScale));
  const targetHeight = Math.max(1, Math.round(headImageSize.height * headScale));
  const targetVisibleWidth = Math.max(1, Math.round(effectiveHeadVisibleBox.width * headScale));
  const targetVisibleHeight = Math.max(1, Math.round(effectiveHeadVisibleBox.height * headScale));
  const targetVisibleX = Math.round(effectiveHeadVisibleBox.x * headScale);
  const targetVisibleY = Math.round(effectiveHeadVisibleBox.y * headScale);
  const anchorBottom = sourceVisibleBox.y + sourceVisibleBox.height + headOffset.y + stateOffset.y + typeOffset.y;
  const anchorCenter =
    sourceVisibleBox.x + sourceVisibleBox.width / 2 + headOffset.x + stateOffset.x + typeOffset.x;

  return {
    width: targetWidth,
    height: targetHeight,
    sourceWidth: headImageSize.width,
    sourceHeight: headImageSize.height,
    x: Math.round(anchorCenter - targetVisibleWidth / 2 - targetVisibleX),
    y: Math.round(anchorBottom - targetVisibleHeight - targetVisibleY),
  };
}

async function readHistogram(filePath) {
  return readHistogramForArgs([filePath]);
}

async function readHistogramForArgs(magickArgs) {
  const { stdout } = await execFileAsync('magick', [...magickArgs, '-format', '%c', 'histogram:info:-']);
  const colors = [];

  for (const line of stdout.split('\n')) {
    const match = line.match(HISTOGRAM_LINE_PATTERN);

    if (!match?.groups) {
      continue;
    }

    colors.push({
      count: Number(match.groups.count),
      r: Number(match.groups.r),
      g: Number(match.groups.g),
      b: Number(match.groups.b),
      a: match.groups.a ? Number(match.groups.a) : 255,
      hex: `#${match.groups.hex.slice(0, 6).toUpperCase()}`,
    });
  }

  return colors;
}

async function sampleFaceBaseColor(filePath, visibleBox) {
  const samplePoints = [
    { x: 0.72, y: 0.36 },
    { x: 0.78, y: 0.42 },
    { x: 0.72, y: 0.5 },
    { x: 0.78, y: 0.58 },
  ];
  const sampleCoordinates = [];

  for (const point of samplePoints) {
    const centerX = visibleBox.x + Math.round((visibleBox.width - 1) * point.x);
    const centerY = visibleBox.y + Math.round((visibleBox.height - 1) * point.y);

    for (let radius = 0; radius <= 2; radius += 1) {
      for (let dy = -radius; dy <= radius; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          sampleCoordinates.push({
            x: Math.max(0, centerX + dx),
            y: Math.max(0, centerY + dy),
          });
        }
      }
    }
  }

  const sampledPixels = await readPixelsAtCoordinates(filePath, sampleCoordinates);
  const firstOpaqueNonBlack = sampledPixels.find((pixel) => pixel && pixel.a > 0 && pixel.hex !== '#000000');

  if (firstOpaqueNonBlack) {
    return firstOpaqueNonBlack;
  }

  const fallbackHistogram = await readHistogramForArgs([
    filePath,
    '-crop',
    buildFaceFallbackGeometry(visibleBox),
    '+repage',
  ]);
  return fallbackHistogram.find((entry) => entry.a > 0 && entry.count > 0 && entry.hex !== '#000000') ?? null;
}

function buildFaceFallbackGeometry(visibleBox) {
  const cropWidth = Math.max(4, Math.round(visibleBox.width * 0.42));
  const cropHeight = Math.max(6, Math.round(visibleBox.height * 0.48));
  const cropX = Math.max(0, visibleBox.x + Math.round(visibleBox.width * 0.58) - Math.floor(cropWidth / 2));
  const cropY = Math.max(0, visibleBox.y + Math.round(visibleBox.height * 0.46) - Math.floor(cropHeight / 2));
  return `${cropWidth}x${cropHeight}+${cropX}+${cropY}`;
}

async function readPixelsAtCoordinates(filePath, coordinates) {
  if (coordinates.length === 0) {
    return [];
  }

  const format = coordinates
    .map(({ x, y }) => `%[pixel:p{${x},${y}}]`)
    .join('|');
  const { stdout } = await execFileAsync('magick', [filePath, '-format', format, 'info:-']);

  return stdout
    .trim()
    .split('|')
    .map((value) => parseMagickPixel(value.trim()));
}

function parseMagickPixel(value) {
  if (!value || value === 'none') {
    return null;
  }

  const match = value.match(
    /^s?rgba?\((?<r>[\d.]+),(?<g>[\d.]+),(?<b>[\d.]+)(?:,(?<a>[\d.]+))?\)$/iu,
  );

  if (!match?.groups) {
    return null;
  }

  const r = Math.round(Number(match.groups.r));
  const g = Math.round(Number(match.groups.g));
  const b = Math.round(Number(match.groups.b));
  const rawAlpha = match.groups.a === undefined ? 1 : Number(match.groups.a);
  const a = Math.round(rawAlpha <= 1 ? rawAlpha * 255 : rawAlpha);

  return {
    r,
    g,
    b,
    a,
    hex: rgbToHex({ r, g, b }),
  };
}

function derivePartPalettes(histograms, metadata) {
  const canonicalBaseHex = resolveCanonicalBaseHex(metadata);
  const skinPalette =
    canonicalBaseHex === null
      ? deriveTargetPalette(histograms.fullHistogram, histograms.faceBaseColor)
      : buildCanonicalPalette(canonicalBaseHex);

  if (metadata?.accessories?.includes('Hoodie')) {
    const hoodiePalette = deriveHoodiePalette(histograms.fullHistogram);

    return {
      default: skinPalette,
      Torso: hoodiePalette,
      LeftArm: skinPalette,
      RightArm: skinPalette,
      LeftLeg: skinPalette,
      RightLeg: skinPalette,
    };
  }

  return {
    default: skinPalette,
    Torso: skinPalette,
    LeftArm: skinPalette,
    RightArm: skinPalette,
    LeftLeg: skinPalette,
    RightLeg: skinPalette,
  };
}

function resolveCanonicalBaseHex(metadata) {
  if (!metadata) {
    return null;
  }

  if (metadata.type === 'Alien') {
    return CANONICAL_BASE_COLORS.Alien;
  }

  if (metadata.type === 'Ape') {
    return CANONICAL_BASE_COLORS.Ape;
  }

  if (metadata.type === 'Zombie') {
    return CANONICAL_BASE_COLORS.Zombie;
  }

  if (metadata.skinTone === 'Albino') {
    return CANONICAL_BASE_COLORS.Albino;
  }

  if (metadata.skinTone === 'Light') {
    return CANONICAL_BASE_COLORS.Light;
  }

  if (metadata.skinTone === 'Medium') {
    return CANONICAL_BASE_COLORS.Medium;
  }

  if (metadata.skinTone === 'Dark') {
    return CANONICAL_BASE_COLORS.Dark;
  }

  return null;
}

function buildCanonicalPalette(baseHex) {
  const baseRgb = hexToRgb(baseHex);

  return [
    rgbToHex(scaleRgb(baseRgb, 1.14)),
    baseHex,
    rgbToHex(scaleRgb(baseRgb, 0.74)),
  ];
}

function deriveTargetPalette(histogram, preferredBaseColor = null) {
  const opaqueColors = histogram
    .filter((entry) => entry.a > 0 && entry.count > 0)
    .filter((entry) => entry.hex !== '#000000')
    .sort((left, right) => right.count - left.count);

  if (opaqueColors.length === 0) {
    throw new Error('Prepared punk head contains no opaque colors.');
  }

  const base =
    preferredBaseColor === null
      ? opaqueColors[0]
      : [...opaqueColors].sort(
          (left, right) =>
            colorDistance(left, preferredBaseColor) - colorDistance(right, preferredBaseColor),
        )[0];
  const nearestCandidates = opaqueColors
    .filter((entry) => entry.hex !== base.hex)
    .map((entry) => ({
      ...entry,
      distance: colorDistance(base, entry),
      hueDifference: hueDifference(base, entry),
    }))
    .filter((entry) => entry.distance <= 140 && entry.hueDifference <= 22)
    .sort((left, right) => left.distance - right.distance)
    .slice(0, 2);

  const palette = [base, ...nearestCandidates].map((entry) => entry.hex);
  const uniquePalette = [...new Set(palette)];

  if (uniquePalette.length === 1) {
    return buildGeneratedPalette(uniquePalette[0]);
  }

  if (uniquePalette.length === 2) {
    const [light, dark] = sortByLuminance(uniquePalette);
    const midpoint = mixHexColors(light, dark, 0.5);

    return sortByLuminance([light, midpoint, dark]);
  }

  return sortByLuminance(uniquePalette.slice(0, 3));
}

function deriveHoodiePalette(histogram) {
  const opaqueColors = histogram
    .filter((entry) => entry.a > 0 && entry.count > 0)
    .filter((entry) => entry.hex !== '#000000')
    .sort((left, right) => right.count - left.count);

  if (opaqueColors.length === 0) {
    throw new Error('Punk image contains no opaque colors.');
  }

  const neutralCandidate = opaqueColors.find((entry) => {
    const maxChannel = Math.max(entry.r, entry.g, entry.b);
    const minChannel = Math.min(entry.r, entry.g, entry.b);

    return maxChannel - minChannel <= 18;
  });

  const baseHex = neutralCandidate?.hex ?? opaqueColors[0].hex;

  return [
    rgbToHex(scaleRgb(hexToRgb(baseHex), 1.16)),
    baseHex,
    rgbToHex(scaleRgb(hexToRgb(baseHex), 0.72)),
  ];
}

async function readPunkMetadata(metadataPath, punkPath) {
  const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
  const punkId = Number(path.basename(punkPath, path.extname(punkPath)));

  if (!Array.isArray(metadata)) {
    throw new Error(`Expected metadata array in ${metadataPath}`);
  }

  return metadata.find((entry) => entry.id === punkId) ?? null;
}

function buildGeneratedPalette(baseHex) {
  const baseRgb = hexToRgb(baseHex);

  return [
    baseHex,
    rgbToHex(scaleRgb(baseRgb, 0.84)),
    rgbToHex(scaleRgb(baseRgb, 0.68)),
  ];
}

function sortByLuminance(hexColors) {
  return [...hexColors].sort((left, right) => luminance(hexToRgb(right)) - luminance(hexToRgb(left)));
}

function mixHexColors(leftHex, rightHex, weight) {
  const left = hexToRgb(leftHex);
  const right = hexToRgb(rightHex);

  return rgbToHex({
    r: Math.round(left.r + (right.r - left.r) * weight),
    g: Math.round(left.g + (right.g - left.g) * weight),
    b: Math.round(left.b + (right.b - left.b) * weight),
  });
}

function scaleRgb(rgb, multiplier) {
  return {
    r: clamp(Math.round(rgb.r * multiplier), 0, 255),
    g: clamp(Math.round(rgb.g * multiplier), 0, 255),
    b: clamp(Math.round(rgb.b * multiplier), 0, 255),
  };
}

function colorDistance(left, right) {
  return Math.sqrt(
    (left.r - right.r) ** 2 +
      (left.g - right.g) ** 2 +
      (left.b - right.b) ** 2,
  );
}

function hueDifference(left, right) {
  const leftHue = rgbToHsl(left).h;
  const rightHue = rgbToHsl(right).h;
  const difference = Math.abs(leftHue - rightHue);

  return Math.min(difference, 360 - difference);
}

function luminance(rgb) {
  return rgb.r * 0.2126 + rgb.g * 0.7152 + rgb.b * 0.0722;
}

function rgbToHsl(rgb) {
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const delta = max - min;

  if (delta === 0) {
    return { h: 0, s: 0, l: lightness };
  }

  const saturation =
    lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);

  let hue;

  switch (max) {
    case r:
      hue = (g - b) / delta + (g < b ? 6 : 0);
      break;
    case g:
      hue = (b - r) / delta + 2;
      break;
    default:
      hue = (r - g) / delta + 4;
      break;
  }

  return {
    h: hue * 60,
    s: saturation,
    l: lightness,
  };
}

function hexToRgb(hex) {
  const normalized = hex.replace('#', '');

  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

function rgbToHex(rgb) {
  return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`;
}

function toHex(value) {
  return clamp(value, 0, 255).toString(16).padStart(2, '0').toUpperCase();
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
