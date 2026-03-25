# Safety Backend Foundation

This branch establishes the non-production rollout path for backend-changing safety branches.

## Goals

- keep backend refactors off production until they pass on a dedicated safety backend
- give safety Pages previews a matching non-production Worker and PartyKit target
- keep automated preview verification read-only
- keep mutation-heavy rollout checks away from populated live data

## Worker Safety Environment

`wrangler.jsonc` now includes `env.safety` with a separate Worker name:

- Worker name: `everybodys-platformer-safety`
- Worker URL: `https://everybodys-platformer-safety.novox-robot.workers.dev`
- preview URLs: enabled
- D1 binding: `everybodys-platformer-safety-db`
- D1 database id: `27f64d18-5d6d-45a0-9361-c09ec1a805a6`
- PartyKit host: `everybodys-platformer-presence-safety.songadaymann.partykit.dev`

To deploy the safety Worker:

1. apply migrations:

```bash
npm run cf:d1:migrate:safety
```

2. deploy with:

```bash
npm run cf:deploy:safety
```

Recommended Worker vars/secrets for `--env safety`:

- `PARTYKIT_PARTY=main`
- `PARTYKIT_HOST=<your safety PartyKit hostname>`
- `PARTYKIT_HOST=everybodys-platformer-presence-safety.songadaymann.partykit.dev`
- `PARTYKIT_INTERNAL_TOKEN=<shared random secret>`
- `AUTH_DEBUG_MAGIC_LINKS=0`
- `ENABLE_TEST_RESET=0`
- leave `APP_BASE_URL` unset for Pages preview testing so auth redirects follow the requesting preview origin
- optionally set `AUTH_TRUSTED_REDIRECT_HOSTS` for extra non-`*.wampland.pages.dev` preview frontends

## PartyKit Safety Project

`partykit.safety.json` defines a separate PartyKit project:

- project name: `everybodys-platformer-presence-safety`
- deployed host: `everybodys-platformer-presence-safety.songadaymann.partykit.dev`

Deploy it with:

```bash
npm run presence:deploy:safety
```

Then add the shared token to that PartyKit project:

```bash
npx partykit env add PARTYKIT_INTERNAL_TOKEN --config partykit.safety.json
```

Use the same token value in the Worker `PARTYKIT_INTERNAL_TOKEN` safety secret.

## Current Safety Data State

The safety backend is live, but the D1 database is a fresh safety database, not a copy of production.

- `GET /api/health` returns healthy auth + D1 status from `https://everybodys-platformer-safety.novox-robot.workers.dev/api/health`
- `GET /api/world?centerX=0&centerY=0&radius=1` currently returns the default frontier origin window rather than populated live world data

If you need backend-changing safety branches to exercise production-like data, add an explicit seed/snapshot step instead of pointing them at production D1.

## Pages Preview Wiring

For safety branches, set branch preview env vars in the `wampland` Pages project so the preview frontend talks to the safety backend instead of production:

- `VITE_ROOM_API_BASE_URL=https://<your-safety-worker>.workers.dev`
- `VITE_PARTYKIT_HOST=<your-safety-partykit>.partykit.dev`
- `VITE_PARTYKIT_PARTY=main`
- `VITE_REOWN_PROJECT_ID=<existing project id>`

Keep production Pages env unchanged.

## Verification Commands

New root commands:

- `npm run typecheck`
- `npm run check`
- `npm run smoke:preview:readonly`

Read-only preview smoke usage:

```bash
PREVIEW_SMOKE_URL="https://<preview>.wampland.pages.dev" npm run smoke:preview:readonly
```

Optional target room override:

```bash
PREVIEW_SMOKE_URL="https://<preview>.wampland.pages.dev" \
PREVIEW_SMOKE_ROOM_ID="0,0" \
npm run smoke:preview:readonly
```

Artifacts land in `output/web-game/preview-readonly-smoke/<host>/`.

The smoke verifies:

- app boot reaches overworld browse mode
- a loaded published/draft room can be entered in play mode
- the same room can be opened in the editor scene without mutating backend data
- `window.render_game_to_text` stays readable during the flow

## Mutating Rollout Check Guardrails

`scripts/remote_rollout_check.mjs` now:

- defaults to local Worker + local PartyKit
- requires `ROLL_OUT_ALLOW_MUTATIONS=1`
- refuses the known production Worker and PartyKit hosts
- refuses unknown targets that are not clearly local/safety/preview/staging
- defaults remote D1 writes to the Wrangler `safety` environment

Example safety usage:

```bash
ROLL_OUT_ALLOW_MUTATIONS=1 \
ROLL_OUT_BASE_URL="https://<your-safety-worker>.workers.dev" \
ROLL_OUT_PARTYKIT_HOST="<your-safety-partykit>.partykit.dev" \
ROLL_OUT_WRANGLER_ENV="safety" \
node scripts/remote_rollout_check.mjs
```
