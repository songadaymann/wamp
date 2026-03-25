# Env And Config Guide

This repo now has one documented config path per surface:

## Frontend Vite Dev

- Copy [`.env.local.example`](../.env.local.example) to `.env.local`.
- Only put `VITE_*` variables there.
- Vite loads `.env.local` natively; repo-local `env.local` is no longer read.

Common frontend vars:

- `VITE_REOWN_PROJECT_ID`
- `VITE_WALLET_CONNECT_PROJECT_ID` as the legacy alias
- `VITE_ROOM_API_BASE_URL` only when intentionally targeting a different backend
- `VITE_ROOM_STORAGE_BACKEND`
- `VITE_PARTYKIT_HOST`
- `VITE_PARTYKIT_PARTY`

Default frontend guidance:

- leave `VITE_ROOM_API_BASE_URL` unset for same-origin `/api`
- leave `VITE_ROOM_STORAGE_BACKEND=remote` unless you explicitly want local storage
- leave `VITE_PARTYKIT_HOST` unset in deployed builds unless you intentionally want a non-default host

## Worker And Local PartyKit Dev

- Copy [`.dev.vars.example`](../.dev.vars.example) to `.dev.vars`.
- Put Worker secrets, auth settings, minting config, and local PartyKit server settings there.

Common server vars:

- `APP_BASE_URL`
- `AUTH_DEBUG_MAGIC_LINKS`
- `ENABLE_TEST_RESET`
- `PARTYKIT_HOST`
- `PARTYKIT_PARTY`
- `PARTYKIT_INTERNAL_TOKEN`
- `ROOM_MINT_*`

## Pages Preview / Production

- Set frontend `VITE_*` variables in the Cloudflare Pages dashboard for the relevant environment.
- `Preview` can point at safety backends.
- `Production` should normally leave `VITE_ROOM_API_BASE_URL` unset unless there is an intentional cross-origin API deployment.

## Remote Worker

- Set Worker vars/secrets in Wrangler or the Cloudflare dashboard.
- Keep frontend `VITE_*` config out of Worker env and keep Worker secrets out of Pages env.
