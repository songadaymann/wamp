import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OPENAI_TEXT_MODEL = 'gpt-5-mini';
const OPENAI_IMAGE_MODEL = 'gpt-image-1.5';
const ENV_FILE_PATH = path.resolve(__dirname, '.env');
const OUTPUT_ROOT = path.resolve(__dirname, 'output');
const PLAYER_ANIMATIONS_ROOT = path.resolve(
  __dirname,
  '..',
  'public',
  'assets',
  'player',
  'default',
);

const SPRITE_SPEC_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'summary',
    'subject',
    'species_and_build',
    'attire',
    'pose',
    'view',
    'style',
    'palette',
    'linework',
    'shading',
    'framing',
    'background',
    'constraints',
    'negative_constraints',
  ],
  properties: {
    summary: { type: 'string' },
    subject: { type: 'string' },
    species_and_build: { type: 'string' },
    attire: { type: 'string' },
    pose: { type: 'string' },
    view: { type: 'string' },
    style: { type: 'string' },
    palette: { type: 'string' },
    linework: { type: 'string' },
    shading: { type: 'string' },
    framing: { type: 'string' },
    background: { type: 'string' },
    constraints: {
      type: 'array',
      items: { type: 'string' },
    },
    negative_constraints: {
      type: 'array',
      items: { type: 'string' },
    },
  },
};

async function main() {
  const simplePrompt = process.argv.slice(2).join(' ').trim();

  if (!simplePrompt) {
    throw new Error(
      'Usage: node run-first-test.mjs "an anthropomorphic frog 16 bit video game sprite in a walking pose"',
    );
  }

  const startedAt = new Date();
  const runId = `${formatRunStamp(startedAt)}-${slugify(simplePrompt).slice(0, 48)}`;
  const runDir = path.join(OUTPUT_ROOT, runId);
  await mkdir(runDir, { recursive: true });

  const env = parseEnvFile(await readFile(ENV_FILE_PATH, 'utf8'));
  const openAiApiKey = process.env.OPENAI_API_KEY ?? env.OPENAI_API_KEY;
  const pixelEngineApiKey =
    process.env.PIXEL_ENGINE_API_KEY ??
    env.PIXEL_ENGINE_API_KEY ??
    process.env.PIXELENGINE_API_KEY ??
    env.PIXELENGINE_API_KEY ??
    null;

  if (!openAiApiKey) {
    throw new Error(`OPENAI_API_KEY not found in ${ENV_FILE_PATH}`);
  }

  const animationTargets = await listAnimationTargets(PLAYER_ANIMATIONS_ROOT);

  console.log(`Run folder: ${runDir}`);
  console.log(`Expanding short prompt into sprite JSON with ${OPENAI_TEXT_MODEL}...`);

  const spriteSpecResult = await expandPromptToSpriteSpec({
    apiKey: openAiApiKey,
    simplePrompt,
  });
  const spriteSpec = spriteSpecResult.spriteSpec;

  const imagePromptPayload = buildImagePromptPayload({
    simplePrompt,
    spriteSpec,
  });
  const imagePrompt = `${JSON.stringify(imagePromptPayload, null, 2)}\n`;

  await writeFile(path.join(runDir, 'input-prompt.txt'), `${simplePrompt}\n`, 'utf8');
  await writeFile(
    path.join(runDir, 'sprite-spec.json'),
    `${JSON.stringify(spriteSpec, null, 2)}\n`,
    'utf8',
  );
  await writeFile(path.join(runDir, 'image-prompt.json'), imagePrompt, 'utf8');

  console.log(`Generating transparent base sprite with ${OPENAI_IMAGE_MODEL}...`);

  const imageResult = await generateImage({
    apiKey: openAiApiKey,
    prompt: imagePrompt,
  });
  const baseSprite = decodeBase64Image(imageResult);
  const baseSpritePath = path.join(runDir, 'base-sprite.png');
  await writeFile(baseSpritePath, baseSprite.bytes);

  const dimensions = readPngDimensions(baseSprite.bytes);
  const pixelEngineInputReady = dimensions.width <= 256 && dimensions.height <= 256;

  const report = {
    startedAt: startedAt.toISOString(),
    runId,
    models: {
      promptExpansion: OPENAI_TEXT_MODEL,
      imageGeneration: OPENAI_IMAGE_MODEL,
    },
    input: {
      simplePrompt,
    },
    paths: {
      runDir,
      inputPrompt: path.join(runDir, 'input-prompt.txt'),
      spriteSpec: path.join(runDir, 'sprite-spec.json'),
      imagePrompt: path.join(runDir, 'image-prompt.json'),
      baseSprite: baseSpritePath,
      playerAnimationsRoot: PLAYER_ANIMATIONS_ROOT,
    },
    baseSprite: {
      dimensions,
      outputFormat: 'png',
      transparentBackgroundRequested: true,
    },
    pixelEngine: {
      apiKeyConfigured: Boolean(pixelEngineApiKey),
      inputConstraints: {
        maxDimension: 256,
        maxAspectRatio: '2:1',
      },
      baseSpriteReadyWithoutResize: pixelEngineInputReady,
      nextStep:
        'After approval, resize/canvas-fit the base sprite to Pixel Engine limits, then submit animation jobs for the targets below.',
      animationTargets,
    },
    usage: {
      promptExpansion: spriteSpecResult.usage ?? null,
      imageGeneration: imageResult.usage ?? null,
    },
  };

  await writeFile(
    path.join(runDir, 'report.json'),
    `${JSON.stringify(report, null, 2)}\n`,
    'utf8',
  );

  console.log(`Base sprite saved to: ${baseSpritePath}`);
  console.log(`Sprite spec saved to: ${path.join(runDir, 'sprite-spec.json')}`);
  console.log(
    `Pixel Engine ready without resize: ${pixelEngineInputReady} (${dimensions.width}x${dimensions.height})`,
  );
  console.log('Review the PNG before doing any animation jobs.');
}

async function expandPromptToSpriteSpec({ apiKey, simplePrompt }) {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENAI_TEXT_MODEL,
      input: [
        {
          role: 'system',
          content: [
            {
              type: 'input_text',
              text: [
                'You turn short character ideas into production-ready JSON specs for a single 2D side-view platformer player sprite.',
                'Keep the design readable at classic 16-bit scale.',
                'Always assume one centered full-body character, transparent background, and no environment unless the user explicitly asks for props.',
                'If the prompt implies motion, describe one representative key pose that will be easy to animate later.',
              ].join(' '),
            },
          ],
        },
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: `Expand this short prompt into a detailed sprite JSON spec: ${simplePrompt}`,
            },
          ],
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'sprite_spec',
          strict: true,
          schema: SPRITE_SPEC_SCHEMA,
        },
      },
    }),
  });

  const json = await parseJsonResponse(response, 'OpenAI prompt expansion request failed');
  const refusal = extractResponseRefusal(json);
  if (refusal) {
    throw new Error(`OpenAI refused prompt expansion: ${refusal}`);
  }

  const outputText = extractResponseOutputText(json);

  return {
    spriteSpec: JSON.parse(outputText),
    usage: json.usage ?? null,
  };
}

function buildImagePromptPayload({ simplePrompt, spriteSpec }) {
  return {
    task: 'Generate one transparent-background player base sprite from this JSON spec.',
    original_prompt: simplePrompt,
    spec: spriteSpec,
    hard_requirements: [
      'single character only',
      'full body visible',
      'transparent background',
      'all non-character pixels must be fully transparent (alpha 0)',
      'character fully inside frame',
      'no scene background',
      'no cast shadow or floor shadow',
      'no text or logos',
      'readable silhouette for a side-view platformer',
    ],
    output_intent: {
      asset_type: 'player_base_sprite',
      animation_pipeline: 'This sprite will be used as the source image for later animation generation.',
    },
  };
}

async function generateImage({ apiKey, prompt }) {
  const response = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENAI_IMAGE_MODEL,
      prompt,
      size: '1024x1024',
      quality: 'medium',
      background: 'transparent',
      output_format: 'png',
    }),
  });

  return parseImageResponse(response);
}

async function listAnimationTargets(rootDirectoryPath) {
  const entries = await readdir(rootDirectoryPath, { withFileTypes: true });
  const directories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  const targets = [];

  for (const directoryName of directories) {
    const directoryPath = path.join(rootDirectoryPath, directoryName);
    const files = await readdir(directoryPath, { withFileTypes: true });
    const frameCount = files.filter(
      (entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.png'),
    ).length;

    targets.push({
      name: directoryName,
      directory: directoryPath,
      existingFrameCount: frameCount,
      pixelEngineOutputFormat: 'spritesheet',
    });
  }

  return targets;
}

async function parseImageResponse(response) {
  const json = await parseJsonResponse(response, 'OpenAI image generation request failed');

  if (!json?.data?.[0]?.b64_json) {
    throw new Error('OpenAI image generation response did not include image data.');
  }

  return json;
}

async function parseJsonResponse(response, fallbackMessage) {
  const json = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      json?.error?.message ??
      json?.message ??
      `${fallbackMessage} with status ${response.status}`;
    throw new Error(message);
  }

  return json;
}

function extractResponseOutputText(responseJson) {
  if (typeof responseJson.output_text === 'string' && responseJson.output_text.trim()) {
    return responseJson.output_text.trim();
  }

  const messageTexts = [];

  for (const outputItem of responseJson.output ?? []) {
    if (!Array.isArray(outputItem?.content)) {
      continue;
    }

    for (const contentItem of outputItem.content) {
      if (typeof contentItem?.text === 'string' && contentItem.text.trim()) {
        messageTexts.push(contentItem.text.trim());
      }
    }
  }

  if (messageTexts.length === 0) {
    throw new Error('OpenAI response did not include structured text output.');
  }

  return messageTexts.join('\n');
}

function extractResponseRefusal(responseJson) {
  for (const outputItem of responseJson.output ?? []) {
    if (!Array.isArray(outputItem?.content)) {
      continue;
    }

    for (const contentItem of outputItem.content) {
      if (typeof contentItem?.refusal === 'string' && contentItem.refusal.trim()) {
        return contentItem.refusal.trim();
      }
    }
  }

  return null;
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

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
