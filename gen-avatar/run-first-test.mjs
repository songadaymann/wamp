import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MODEL = 'gpt-image-1.5';
const ALPHA_PROMPT = 'Be sure that the background is alpha but the character itself is completely filled in.';
const GENERATION_PROMPT = [
  'Generate a 16 bit video game character of a blue robot.',
  ALPHA_PROMPT,
].join(' ');
const EDIT_PROMPT = [
  'The first image is the blue robot character.',
  'The second image is a reference frame of animation.',
  'Can you make this blue robot character be in the exact pose of this frame of animation.',
  'Keep the dimensions the same.',
  ALPHA_PROMPT,
].join(' ');

const repoRoot = path.resolve(__dirname, '..');
const envFilePath = path.resolve(repoRoot, 'env.local');
const referenceFramesDir = path.resolve(
  repoRoot,
  'public/assets/player/default/Run',
);
const outputRoot = path.resolve(__dirname, 'output');

async function main() {
  const startedAt = new Date();
  const runId = `${formatRunStamp(startedAt)}-blue-robot-run-sequence`;
  const runDir = path.join(outputRoot, runId);
  const copiedReferenceDir = path.join(runDir, 'reference-frames');
  const posedFramesDir = path.join(runDir, 'posed-frames');

  await mkdir(copiedReferenceDir, { recursive: true });
  await mkdir(posedFramesDir, { recursive: true });

  const env = parseEnvFile(await readFile(envFilePath, 'utf8'));
  const apiKey = env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error(`OPENAI_API_KEY not found in ${envFilePath}`);
  }

  const referenceFramePaths = await listReferenceFramePaths(referenceFramesDir);

  if (referenceFramePaths.length === 0) {
    throw new Error(`No PNG frames found in ${referenceFramesDir}`);
  }

  console.log(`Run folder: ${runDir}`);
  console.log(`Reference frames: ${referenceFramePaths.length}`);
  console.log(`Generating source character with ${MODEL}...`);

  const generatedResult = await generateImage({
    apiKey,
    prompt: GENERATION_PROMPT,
  });
  const generatedImage = decodeBase64Image(generatedResult);
  const generatedImagePath = path.join(runDir, 'character-source.png');
  await writeFile(generatedImagePath, generatedImage.bytes);

  const generatedDimensions = readPngDimensions(generatedImage.bytes);
  const frameResults = [];

  for (const referenceFramePath of referenceFramePaths) {
    const frameName = path.basename(referenceFramePath);
    const referenceBuffer = await readFile(referenceFramePath);
    const referenceDimensions = readPngDimensions(referenceBuffer);
    const copiedReferencePath = path.join(copiedReferenceDir, frameName);
    await copyFile(referenceFramePath, copiedReferencePath);

    console.log(
      `Generating posed frame for ${frameName} with reference ${referenceDimensions.width}x${referenceDimensions.height}...`,
    );

    const editedResult = await editImage({
      apiKey,
      prompt: EDIT_PROMPT,
      imageEntries: [
        { filename: 'character-source.png', bytes: generatedImage.bytes, contentType: 'image/png' },
        { filename: frameName, bytes: referenceBuffer, contentType: 'image/png' },
      ],
    });
    const posedImage = decodeBase64Image(editedResult);
    const posedImagePath = path.join(posedFramesDir, frameName);
    await writeFile(posedImagePath, posedImage.bytes);

    const posedDimensions = readPngDimensions(posedImage.bytes);
    const dimensionsMatch =
      posedDimensions.width === referenceDimensions.width &&
      posedDimensions.height === referenceDimensions.height;

    frameResults.push({
      frameName,
      paths: {
        referenceFrame: copiedReferencePath,
        posedImage: posedImagePath,
      },
      dimensions: {
        referenceFrame: referenceDimensions,
        posedImage: posedDimensions,
        posedMatchesReference: dimensionsMatch,
      },
      usage: editedResult.usage ?? null,
    });

    console.log(
      `Dimension check for ${frameName}: reference ${referenceDimensions.width}x${referenceDimensions.height}, output ${posedDimensions.width}x${posedDimensions.height}, match=${dimensionsMatch}`,
    );
  }

  const matchedFrames = frameResults.filter((frameResult) => frameResult.dimensions.posedMatchesReference).length;

  const report = {
    model: MODEL,
    startedAt: startedAt.toISOString(),
    runId,
    prompts: {
      generation: GENERATION_PROMPT,
      edit: EDIT_PROMPT,
    },
    paths: {
      generatedImage: generatedImagePath,
      copiedReferenceDir,
      posedFramesDir,
    },
    dimensions: {
      generatedImage: generatedDimensions,
      totalFrames: frameResults.length,
      matchedFrames,
    },
    usage: {
      generation: generatedResult.usage ?? null,
    },
    frames: frameResults,
  };

  await writeFile(
    path.join(runDir, 'report.json'),
    `${JSON.stringify(report, null, 2)}\n`,
    'utf8',
  );

  console.log(`Source image saved to: ${generatedImagePath}`);
  console.log(`Copied reference frames saved to: ${copiedReferenceDir}`);
  console.log(`Posed frames saved to: ${posedFramesDir}`);
  console.log(`Dimension summary: ${matchedFrames}/${frameResults.length} frames matched the reference dimensions.`);
}

function formatRunStamp(date) {
  const parts = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
    String(date.getHours()).padStart(2, '0'),
    String(date.getMinutes()).padStart(2, '0'),
    String(date.getSeconds()).padStart(2, '0'),
  ];

  return `${parts[0]}${parts[1]}${parts[2]}-${parts[3]}${parts[4]}${parts[5]}`;
}

function parseEnvFile(contents) {
  const env = {};

  for (const rawLine of contents.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    env[key] = value;
  }

  return env;
}

async function generateImage({ apiKey, prompt }) {
  const response = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      prompt,
      size: 'auto',
      quality: 'medium',
      background: 'transparent',
      output_format: 'png',
    }),
  });

  return parseApiResponse(response);
}

async function listReferenceFramePaths(directoryPath) {
  const entries = await readdir(directoryPath, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.png'))
    .map((entry) => path.join(directoryPath, entry.name))
    .sort((leftPath, rightPath) => path.basename(leftPath).localeCompare(path.basename(rightPath)));
}

async function editImage({ apiKey, prompt, imageEntries }) {
  const formData = new FormData();
  formData.append('model', MODEL);
  formData.append('prompt', prompt);
  formData.append('size', 'auto');
  formData.append('quality', 'medium');
  formData.append('background', 'transparent');
  formData.append('output_format', 'png');

  for (const imageEntry of imageEntries) {
    formData.append(
      'image[]',
      new File([imageEntry.bytes], imageEntry.filename, { type: imageEntry.contentType }),
      imageEntry.filename,
    );
  }

  const response = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
  });

  return parseApiResponse(response);
}

async function parseApiResponse(response) {
  const json = await response.json().catch(() => null);

  if (!response.ok) {
    const message = json?.error?.message ?? `OpenAI request failed with status ${response.status}`;
    throw new Error(message);
  }

  if (!json?.data?.[0]?.b64_json) {
    throw new Error('OpenAI response did not include image data.');
  }

  return json;
}

function decodeBase64Image(apiResult) {
  return {
    bytes: Buffer.from(apiResult.data[0].b64_json, 'base64'),
  };
}

function readPngDimensions(buffer) {
  const signature = buffer.subarray(0, 8).toString('hex');
  if (signature !== '89504e470d0a1a0a') {
    throw new Error('Expected a PNG image when reading dimensions.');
  }

  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
