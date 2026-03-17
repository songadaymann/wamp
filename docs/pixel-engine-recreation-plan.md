# Pixel Engine Recreation Plan

## What This Is

This is a first technical approximation of how one might recreate something similar to Pixel Engine's current image-to-video pixel animation workflow using open-source components.

This is not a PRD. A PRD would be the wrong document here because the hard part is not feature definition, it is model and pipeline design. This is a technical design memo for an internal R&D effort.

## Scope

Assumptions for this first pass:

- input is a single approved character PNG
- target outputs are short 2D side-view sprite animations and spritesheets
- training data can be bootstrapped from scraped sprite resources such as The Spriters Resource
- we care more about reproducing the product feel than proving the exact backbone Pixel Engine used

## Working Hypothesis

Based on the behavior we observed locally, the most likely setup is not a sprite-native RGBA model trained fully from scratch. It is more likely:

1. An open image-to-video backbone.
2. Fine-tuned on short pixel-art character clips.
3. Wrapped in strong pixel-specific preprocessing and postprocessing.

The evidence for that:

- broad locomotion loops work better than precise gameplay states
- attack prompts tend to hallucinate big slash FX or props instead of preserving clean layered assets
- the API explicitly flattens alpha onto a matte color before generation
- output dimensions match the input dimensions even though the docs imply internal upscaling
- palette count looks controlled, which suggests quantization is part of the inference pipeline

My current read is: model backbone + sprite dataset + crop/reframe + RGB matte + quantize/export.

## Most Plausible Open-Source Backbones

### Tier 1: Most Plausible Starting Points

#### 1. Wan 2.1 image-to-video

Why it is plausible:

- modern open image-to-video family
- designed for both text-to-video and image-to-video
- strong enough to be worth fine-tuning instead of building older video diffusion stacks from scratch
- likely a better 2025-2026 starting point than earlier research baselines

Why it may fit this product:

- good for first-frame-conditioned motion generation
- can plausibly be adapted to short clip generation
- likely benefits from heavy preprocessing and postprocessing, which matches what we are seeing

Source:

- https://github.com/Wan-Video/Wan2.1

#### 2. CogVideoX image-to-video

Why it is plausible:

- open model family with image-to-video support
- already used by many teams as a practical open video backbone
- can be fine-tuned or adapter-tuned instead of trained from zero

Why it may fit this product:

- good if the goal was to ship a usable product quickly on top of an existing strong backbone
- likely to reproduce the "good at general motion, weaker at strict asset semantics" behavior we saw

Source:

- https://github.com/THUDM/CogVideo

### Tier 2: Plausible Earlier or Simpler Bases

#### 3. Stable Video Diffusion

Why it is plausible:

- widely known open image-to-video baseline from an earlier generation
- good candidate if the original system started earlier and grew a large custom wrapper around it

Why it may fit this product:

- short-clip image-to-video is exactly the use case
- would strongly depend on a custom pixel-art postprocess stack to get product-quality results

Source:

- https://stability.ai/research/stable-video-diffusion-scaling-latent-video-diffusion-models-to-large-datasets

#### 4. I2VGen-XL

Why it is plausible:

- purpose-built open image-to-video research baseline
- old enough that it could have been an early backbone for a niche product

Why it may fit this product:

- first-frame-to-video is core behavior
- it is a credible "build from a paper and then productize hard" starting point

Source:

- https://github.com/ali-vilab/i2vgen-xl

#### 5. VideoCrafter / VideoCrafter 2

Why it is plausible:

- open video generation stack with strong research visibility
- useful if the team wanted more controllable training and editing behavior

Why it may fit this product:

- more of a research base than a turnkey product base
- plausible if the founder is unusually model-forward and wanted deeper control

Source:

- https://github.com/AILab-CVC/VideoCrafter

## My Best Guess

If Pixel Engine was built recently, my first guess would be:

1. Wan 2.1 image-to-video or CogVideoX image-to-video as the backbone.
2. Fine-tune on sprite clips, not generic video only.
3. Keep the model RGB-only during training and inference.
4. Flatten alpha onto a neutral matte before model input.
5. Downscale and quantize after generation.

If it started earlier, Stable Video Diffusion or I2VGen-XL become more plausible as the original base.

## What I Would Build First

### Phase 1: Reproduce the Product Shape Before Training Anything Fancy

Build the wrapper first:

1. Input PNG cleanup.
2. Crop/reframe character.
3. Flatten alpha onto a matte.
4. Upscale to model working resolution.
5. Run image-to-video backbone.
6. Downscale to requested output size.
7. Quantize palette.
8. Export spritesheet.

Reason:

If this phase already gets 60-70% of the way there, then the secret sauce is mostly the wrapper and the data, not a novel architecture.

### Phase 2: Create a Sprite Training Dataset

Assume we scrape The Spriters Resource for research prototyping only.

Dataset construction plan:

1. Scrape character sheets, GIFs, and atlas-like resources.
2. Filter to side-view platformer / action / RPG characters first.
3. Extract clips for:
   - idle
   - run
   - jump rise
   - jump fall
   - land
   - ladder climb
   - crouch
   - crawl
   - sword attack
   - gun attack
4. Normalize everything into:
   - fixed canvas sizes
   - consistent background matte
   - small frame counts like 2-16
5. Auto-caption each clip with:
   - character type
   - motion type
   - props used
   - attack / effect presence
   - loop vs one-shot

Important:

- keep a separate label for "character only" vs "character plus FX"
- keep a separate label for "weapon visible" vs "weapon implied"
- do not merge these cases or the model will learn the same bad combat behavior we just saw

### Phase 3: Fine-Tuning Strategy

The training unit should be:

- first frame image
- text prompt or structured motion label
- short target clip

I would try this in order:

1. adapter or LoRA-style fine-tuning on a strong open i2v backbone
2. small full fine-tune only if adapters plateau
3. train separate specialized heads or adapters for:
   - locomotion
   - static / hold states
   - attacks

Reason:

The failure modes are not uniform. Locomotion and attack semantics are different enough that a single model may keep averaging them together.

### Phase 4: Product-Specific Postprocess

This likely matters as much as the model:

1. nearest-neighbor downscale
2. optional palette locking
3. shadow stripping
4. matte cleanup
5. frame dedupe for weak motions
6. frame subset selection when the runtime wants odd counts like 5 or 7
7. optional atlas packing after generation

The current product behavior strongly suggests the postprocess is a major part of the quality stack.

## Recommended Architecture For Our First Attempt

### Recommended first backbone

Start with Wan 2.1 image-to-video or CogVideoX image-to-video.

My lean:

- choose Wan 2.1 if we want the strongest modern open starting point
- choose CogVideoX if we want the ecosystem with the widest practical community usage

### Recommended training data recipe

Use a three-bucket dataset:

1. Clean locomotion clips with no FX.
2. Clean combat clips with visible weapons but no giant baked-in impact arcs when possible.
3. Separate FX-only clips for slash arcs, muzzle flashes, dust, and impacts.

That separation is important. The current Pixel Engine outputs suggest either:

- the training data mixed character and FX together too often, or
- the prompt/control stack does not cleanly separate them

### Recommended inference stack

1. User uploads approved PNG.
2. System reframes it.
3. System flattens alpha onto matte.
4. System builds a structured internal motion prompt.
5. System runs image-to-video model.
6. System downsamples and quantizes.
7. System returns:
   - spritesheet
   - individual frames
   - optional atlas-ready manifest

## What I Would Not Do First

- do not try to train a novel architecture first
- do not start with transparent RGBA generation as the main problem
- do not start with full atlas packing in the training loop
- do not mix clean character motion and giant attack FX in the same labels
- do not assume the model is the whole product

## Biggest Risks

### Data risk

Scraping Spriters Resource is useful for fast prototyping, but it is risky for anything commercial because the underlying art is copyrighted and the site itself may have restrictions on automated access. Treat that source as prototype-only unless a clean rights story exists.

### Product risk

The hardest part may not be getting a model to animate. The hardest part may be:

- preserving identity
- keeping attacks readable without giant hallucinated FX
- keeping outputs compatible with runtime atlas structure

### Evaluation risk

Raw "looks cool" evaluation is not enough. We need targeted evals for:

- loop smoothness
- prop consistency
- frame-to-frame silhouette stability
- background cleanliness
- palette stability
- attack readability without unwanted FX

## Concrete MVP Plan

1. Implement full wrapper pipeline around an off-the-shelf i2v model.
2. Use a small scraped sprite dataset for research.
3. Fine-tune only on locomotion first.
4. Add hold-state adapter for crouch / jump-rise / jump-fall.
5. Add combat adapter with clean weapon labels.
6. Keep FX generation separate until late.

If that works, then add:

7. atlas packing
8. prompt enhancement
9. FX-only generation
10. runtime export presets

## Bottom Line

If I had to pick a first recreation path today, I would do this:

- backbone: Wan 2.1 image-to-video or CogVideoX image-to-video
- data: scraped sprite clips normalized to matte-backed RGB clips
- training: adapter fine-tune on first-frame-to-short-loop animation
- postprocess: downscale, quantize, export
- product architecture: model plus strong wrapper, not model-only

That is the fastest path to reproducing the behavior we actually saw rather than guessing at a glamorous but probably wrong "secret model."
