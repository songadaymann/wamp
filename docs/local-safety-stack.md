# Local Safety Stack

Use the standardized local safety stack when backend-changing work needs real authored rooms, debug email sign-in, and isolated non-production services.

## Start the stack

```bash
npm run dev:safety
```

The command starts and verifies:

- the safety Worker through `wrangler dev --env safety --remote` on `127.0.0.1:8787`
- debug magic links that redirect back to localhost
- local PartyKit on `127.0.0.1:1999`
- Vite on `http://127.0.0.1:3008/?renderer=canvas`
- remote room storage backed by the safety D1 database

The preflight checks the Worker health marker, debug auth flags, frontend runtime configuration, populated safety world chunks, and a complete debug magic-link session round trip.

To skip the safety migration step when the remote schema is already current:

```bash
DEV_SAFETY_SKIP_MIGRATIONS=1 npm run dev:safety
```

## Verify an existing stack

```bash
npm run dev:safety:check
```

The health endpoint must return `devStack: "safety-local"`. If a required port is already occupied, the launcher reuses it only when the preflight proves that it belongs to this standardized stack.

Optional overrides:

- `DEV_SAFETY_EMAIL`
- `DEV_SAFETY_WORLD_CHUNK_QUERY`
- `DEV_SAFETY_SKIP_MIGRATIONS=1`
- `DEV_SAFETY_FRONTEND_PORT`
- `DEV_SAFETY_API_PORT`
- `DEV_SAFETY_PARTYKIT_PORT`

Run `npm run dev:safety -- --help` for the equivalent command-line flags.
