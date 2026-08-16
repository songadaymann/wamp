# Platformer Pulse Cinematic — Shot and Prompt Bible

## Working premise

Wamp is not the hero of these remembered games. Wamp is an impossible witness who appears at the edge of each scene, watching the Pulse move through the history of platformers.

Each game receives three independent cinematic shots:

1. An atmospheric establishing wide that turns the game screen into a world.
2. A signature close-up built around the game's defining object or physical gesture.
3. A lateral action shot in which the game's hero carries the Pulse toward Wamp.

The shots should be generated individually. Do not ask a video or image model to create the whole montage in one pass.

## Reference stack

Use five reference images for every generation:

1. Flashback landscape reference: `Screenshot 2026-08-16 at 1.31.15 PM.jpg`
2. Flashback lateral-pursuit reference: `Screenshot 2026-08-16 at 1.29.45 PM.jpg`
3. Flashback mechanical close-up reference: `Screenshot 2026-08-16 at 1.29.58 PM.jpg`
4. One actual gameplay screenshot from the game being depicted.
5. `wamp-avatar-reference.png`, assembled from the canonical WAMP idle, run, jump, and land frames.

The Flashback images control style, palette, scale, atmosphere, and composition. The gameplay screenshot controls content and character identity. The Wamp board controls the witness's identity. None of the references are edit targets.

## Shared prompt block

> Use case: illustration-story. Asset type: one individual keyframe from a cinematic opening sequence, ultrawide landscape, no storyboard borders. Images 1–3 are style, palette, lighting, scale, and cinematic-composition references from the Flashback opening. Image 4 is an actual gameplay reference for the named game and controls its recognizable content. Image 5 is the canonical Wamp-avatar identity reference.
>
> Reproduce the severe visual language of Images 1–3: very low-resolution early-1990s cinematic cutscene, flat hard-edged pixel shapes, limited navy/cobalt/black palette with a few game-specific accent colors, huge areas of darkness, atmospheric silhouettes, deliberate blocky stair-step edges, and sparse detail. It must look like a frame from the same cutscene sequence, not modern low-poly art.
>
> Wamp is the same faceless slim white humanoid from Image 5, with a rectangular blank white head, white torso, pale blue-gray shadowed limbs, and no eyes, mouth, hair, clothing, or accessories. Wamp is a quiet witness. Wamp never replaces the named game's protagonist and never performs the main heroic action.
>
> One cinematic shot only. No HUD, score, timer, text, logo, caption, border, or watermark. Avoid glossy 3D, polygon triangle facets, painterly rendering, photorealism, anime, contemporary pixel-art glow, cute redesign of Wamp, and extra protagonists.

## 1. Pitfall!

Content reference: `references/pitfall-gameplay.jpg`

### Shot 1 — Establishing wide

A vast primordial jungle valley at predawn, seen across several layers of black silhouetted tree trunks and blue-green mist. Far below, the narrow crocodile pool from Pitfall! crosses the frame, and Pitfall Harry is only a tiny silhouette beginning his vine swing. Wamp stands very small on a high foreground ledge, watching across the valley.

Output: `frames/pitfall/01-establishing-wide.png`

### Shot 2 — Signature close-up

Pitfall Harry's blocky hand clamps around the twisting vine in the foreground. Far below, three crocodile jaws break the dark water. Wamp appears as a tiny pale reflection in one crocodile's eye. A muted red heartbeat glints on the vine.

Output: `frames/pitfall/02-signature-closeup.png`

### Shot 3 — Action witness

Pitfall Harry swings at maximum speed across the crocodile pool, body stretched with weight and momentum. The camera is at water level, with enormous jaws in the foreground. Wamp is half-concealed behind a dark tree on the landing side. The Pulse crosses from Harry toward Wamp at the apex.

Output: `frames/pitfall/03-action-witness.png`

## 2. Super Mario Bros.

Content reference: `references/mario-gameplay.jpg`

### Shot 1 — Establishing wide

The underground blue-brick coin chamber becomes an immense subterranean cathedral, with vaults disappearing into darkness and one monumental green pipe at the far end. Mario is tiny at lower left. Rows of coins hang like constellations. Wamp watches from a high gallery.

Output: `frames/mario/01-establishing-wide.png`

### Shot 2 — Signature close-up

Mario's white-gloved fist strikes the underside of one blue brick. A gold coin erupts upward into darkness. The coin's surface reflects the tiny white silhouette of Wamp. A muted heartbeat glints inside the coin.

Output: `frames/mario/02-signature-closeup.png`

### Shot 3 — Action witness

Mario leaps over the blue-brick floor toward a towering green pipe. Coins trail behind him. Wamp is concealed in the pipe's black mouth, watching Mario approach. The Pulse crosses the gap between them.

Output: `frames/mario/03-action-witness.png`

## 3. Bonk's Adventure

Content reference: `references/bonk-gameplay.png`

### Shot 1 — Establishing wide

A prehistoric valley at night, with jagged orange mountains reduced to distant silhouettes and dinosaur skeletons half-buried in a black plain. Bonk is tiny, bouncing high against the cobalt sky. Wamp watches from a foreground cave.

Output: `frames/bonk/01-establishing-wide.png`

### Shot 2 — Signature close-up

Bonk's enormous forehead fills the frame just before striking a fossilized dinosaur skull. In the skull's black eye socket, Wamp is reflected. The Pulse is trapped at the instant between forehead and bone.

Output: `frames/bonk/02-signature-closeup.png`

### Shot 3 — Action witness

Bonk launches headfirst through prehistoric stone toward a charging dinosaur. Wamp crouches behind the wooden arrow sign from the game. The Pulse travels through the impact line toward Wamp.

Output: `frames/bonk/03-action-witness.png`

## 4. Alex Kidd in Miracle World

Content reference: `references/alex-kidd-gameplay.jpg`

### Shot 1 — Establishing wide

Miracle World becomes a chain of colossal grassy islands above an endless cobalt abyss. Star blocks form paths through distant mist. Alex Kidd is tiny on one island facing an enemy. Wamp watches from a separate foreground island.

Output: `frames/alex-kidd/01-establishing-wide.png`

### Shot 2 — Signature close-up

Alex Kidd's oversized fist strikes a star-marked block. Huge hard-edged fragments hang in black space. One shard contains Wamp's tiny reflection. A heartbeat glints at the impact point.

Output: `frames/alex-kidd/02-signature-closeup.png`

### Shot 3 — Action witness

Alex Kidd throws his enormous punch at the green enemy on a narrow ledge. Wamp is partly hidden behind a question block on the far side. The Pulse travels through the punch toward Wamp.

Output: `frames/alex-kidd/03-action-witness.png`

## 5. N+

Content reference: `references/n-plus-gameplay.jpg`

### Shot 1 — Establishing wide

The N+ chamber becomes a vast vertical megastructure of pale walls, charcoal ramps, and gold constellations. The black ninja is almost microscopic in a huge leap. Wamp watches from an isolated observation ledge behind glass.

Output: `frames/n-plus/01-establishing-wide.png`

### Shot 2 — Signature close-up

The ninja's foot compresses against a vertical wall at the start of a wall-jump. Three gold squares hang beside it. The nearest gold reflects Wamp. A thin heartbeat line marks the point of contact.

Output: `frames/n-plus/02-signature-closeup.png`

### Shot 3 — Action witness

The ninja rebounds between slanted walls while a homing missile curves behind. Gold forms a path toward an exit. Wamp remains motionless in an observation window. The Pulse traces part of the jump trajectory toward Wamp.

Output: `frames/n-plus/03-action-witness.png`

## 6. Super Meat Boy

Content reference: `references/super-meat-boy-gameplay.jpg`

### Shot 1 — Establishing wide

A saw gauntlet stretches across a fog-filled industrial canyon. Rock pillars, mechanical arms, and circular blades form a lethal landscape. Meat Boy is a tiny red square in midair. Wamp watches from a protected foreground alcove.

Output: `frames/super-meat-boy/01-establishing-wide.png`

### Shot 2 — Signature close-up

A colossal saw tooth passes within pixels of Meat Boy. In the saw's dark axle cap, Wamp is reflected. A red-white heartbeat appears between tooth and Meat Boy.

Output: `frames/super-meat-boy/02-signature-closeup.png`

### Shot 3 — Action witness

Meat Boy rockets through the gap between counter-rotating blades. Wamp stands behind a maintenance window. The Pulse follows Meat Boy's jump arc toward Wamp.

Output: `frames/super-meat-boy/03-action-witness.png`

## Editing and sequencing notes

- Use hard cuts between close-ups and wide shots.
- Use match cuts between equivalent motions: vine swing to Mario jump, coin ascent to Bonk's bounce, Bonk impact to Alex's fist, flying block shard to N+ gold, N+ missile curve to Meat Boy jump arc.
- The Pulse should be subtle in early scenes. It becomes legible only after the viewer has seen it repeat.
- Wamp should initially be easy to miss. The audience should gradually realize the same witness has been present in every era.
- Keep Wamp silent and passive until the final scene. The accumulated Pulse should be what eventually wakes the sleeping avatar.
- Generate video from these approved stills rather than asking a video model to rediscover the style, game content, and Wamp identity simultaneously.
