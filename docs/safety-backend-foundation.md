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
- preview URLs: enabled
- D1 binding: `everybodys-platformer-safety-db`

Before the first safety deploy:

1. create a dedicated D1 database for safety
2. replace `REPLACE_WITH_SAFETY_DATABASE_ID` in `wrangler.jsonc`
3. deploy with:

```bash
npm run cf:d1:migrate:safety
npm run cf:deploy:safety
```

Recommended Worker vars/secrets for `--env safety`:

- `PARTYKIT_PARTY=main`
- `PARTYKIT_HOST=<your safety PartyKit hostname>`
- `PARTYKIT_INTERNAL_TOKEN=<shared random secret>`
- `AUTH_DEBUG_MAGIC_LINKS=0`
- `ENABLE_TEST_RESET=0`
- leave `APP_BASE_URL` unset for Pages preview testing so auth redirects follow the requesting preview origin
- optionally set `AUTH_TRUSTED_REDIRECT_HOSTS` for extra non-`*.wampland.pages.dev` preview frontends

## PartyKit Safety Project

`partykit.safety.json` defines a separate PartyKit project:

- project name: `everybodys-platformer-presence-safety`

Deploy it with:

```bash
npm run presence:deploy:safety
```

Then add the shared token to that PartyKit project:

```bash
npx partykit env add PARTYKIT_INTERNAL_TOKEN --config partykit.safety.json
```

Use the same token value in the Worker `PARTYKIT_INTERNAL_TOKEN` safety secret.

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
