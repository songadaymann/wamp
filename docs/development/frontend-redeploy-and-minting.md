# Frontend Redeploy And Minting Setup

## Frontend Redeploy

CLI shortcuts now available from the repo root:

- `npm run deploy:prod`
  - requires clean local `main`
  - fetches `origin/main` and refuses to deploy unless `HEAD === origin/main`
  - refuses when the production D1 databases (`everybodys-platformer-db`, `wamp-solo-room-jam-db`) have migrations that are not applied; add `--migrate` to apply them before the Worker deploy
  - runs `npm run check` (lint, tests, typecheck, build; `--skip-check` builds only), deploys the Worker, deploys the `wampland` Pages frontend, then runs `npm run smoke:prod`
  - records the Worker version it replaces and, if anything after the Worker deploy fails, prints the exact rollback command
- `npm run pages:deploy:prod`
  - same clean-`main` preflight, but redeploys only the `wampland` Pages frontend
- `npm run smoke:prod`
  - checks `wamp.land`, verifies the frontend API target, verifies JSON health/session responses from `api.wamp.land`, and fails if the API session payload no longer exposes a wallet project id

How to undo a bad deploy:

- API Worker: `node node_modules/wrangler/bin/wrangler.js rollback <version-id>`. `deploy:prod` prints the previous version id when a step after the Worker deploy fails; otherwise find it with `node node_modules/wrangler/bin/wrangler.js deployments list`. Rollback is instant and keeps the database as it is.
- Frontend: Cloudflare dashboard > Pages > `wampland` > Deployments > the previous production deployment > Rollback. Pages also rebuilds from GitHub on every push to `main`, so reverting the commit on `main` redeploys too.
- Database: migrations are not rolled back. If one must be undone, write a new migration that reverses it, and roll the Worker back first if the new code depends on the change.
- After any rollback, run `npm run smoke:prod` and check `https://api.wamp.land/api/health` (it reports the newest applied migration and whether the code expects a newer one).

Best-guess stable setup for the Pages frontend:

- Pages project serving `wamp.land`: `wampland`
- Branch: `main`
- Build command: `npm ci && npm run build`
- Build output directory: `dist`
- Clear build cache on the first retry after dependency or env changes
- Note: there is also a separate Pages project named `wamp`, but it is not the project currently attached to `wamp.land`

Recommended source of truth for wallet sign-in:

- set `REOWN_PROJECT_ID=<your reown project id>` on the Worker environment
- `/api/auth/session` now returns that public id so deployed frontends do not depend on whoever ran `vite build`
- keep `VITE_REOWN_PROJECT_ID` only as an optional local/frontend build override for development or unusual Pages-only builds

Frontend env vars Pages should still have when needed:

- `VITE_PARTYKIT_HOST=everybodys-platformer-presence.songadaymann.partykit.dev`

Frontend API base guidance:

- For the intended production setup, leave `VITE_ROOM_API_BASE_URL` unset so the app uses same-origin `/api`.
- Only set `VITE_ROOM_API_BASE_URL` when you intentionally want the frontend to talk to a different backend, such as:
  - local remote-debugging against `https://everybodys-platformer.novox-robot.workers.dev`
  - the current public API hostname `https://api.wamp.land`
  - a temporary staging/custom API hostname
- Do not ship the `wamp.land` frontend with `VITE_ROOM_API_BASE_URL=https://everybodys-platformer.novox-robot.workers.dev`; that forces cross-site auth/session behavior and breaks mobile magic-link sign-in.

Notes:

- Do **not** try to reuse the current `wrangler.jsonc` as a shared Pages config. This repo already uses an `ASSETS` binding for the Worker, and adding `pages_build_output_dir` makes Wrangler treat it as a Pages config and fail.
- The safest frontend redeploy path is the Pages dashboard: point `wampland` at `main`, use the build command/output above, and clear build cache when needed.
- For backend-changing safety branches, use the dedicated safety backend flow in [safety-backend-foundation.md](./safety-backend-foundation.md) instead of pointing a Pages preview at production services.
- `wamp.land` currently runs as a Pages frontend while the public API is exposed separately at `https://api.wamp.land`. If the frontend later serves the Worker API on same-origin `/api`, leaving `VITE_ROOM_API_BASE_URL` unset remains the preferred setup.
- If you want CLI Pages deploys later, use a separate Pages config file instead of the Worker `wrangler.jsonc`.
- The Pages CLI deploy still depends on the `wampland` project existing in the same Cloudflare account Wrangler is logged into.

## Minting Setup

Production uses **Base mainnet**. **Base Sepolia** remains the isolated test network; Ethereum Sepolia is not a minting target. Minting requires an explicit `ROOM_MINT_CHAIN_ID`: an omitted/invalid ID fails closed, and the server checks its RPC network before using chain data or returning wallet instructions.

Current known production deployment:

- Base mainnet contract: `0xc3032d5e67c8a67c9745943929f8dff2410dd9a1`
- Base mainnet chain id: `8453`
- Base mainnet explorer: `https://basescan.org`

Historical test deployment still referenced elsewhere:

- Base Sepolia contract: `0x4F2c0b0eEe60dB8cD45fa317DcaE56EC02F0D53b`
- Base Sepolia chain id: `84532`
- Base Sepolia explorer: `https://sepolia.basescan.org`

For a separately authorized, isolated Base Sepolia mint test (not routine production verification):

- a funded **Base Sepolia** deployer private key
- a separate contract owner address
- a separate mint-authority address that matches the Worker signing key
- a separate withdraw-authority address
- a Base Sepolia RPC URL
- a wallet with a little Base Sepolia ETH for the actual mint test
- remote Worker env configured with the deployed contract
- remote Worker wallet project id configured (`REOWN_PROJECT_ID`)

### 1. Deploy the contract

From the repo root:

```bash
export ROOM_MINT_RPC_URL="<base-sepolia-rpc-url>"
export PRIVATE_KEY="<funded-base-sepolia-private-key>"
export ROOM_MINT_OWNER_ADDRESS="<cold-owner-address>"
export ROOM_MINT_AUTH_ADDRESS="<worker-mint-authority-address>"
export ROOM_MINT_WITHDRAW_ADDRESS="<withdraw-authority-address>"
npm --prefix contracts run deploy:base-sepolia
```

Expected output:

- Forge broadcasts the transaction
- contract address is printed in the script output

Important:

- `PRIVATE_KEY` is the deployer/broadcaster only
- `ROOM_MINT_OWNER_ADDRESS` becomes the contract owner
- `ROOM_MINT_AUTH_ADDRESS` becomes the on-chain `mintAuthority`
- `ROOM_MINT_WITHDRAW_ADDRESS` receives withdrawals
- do **not** reuse the owner/deployer key as the Worker mint signer

You do **not** need an explorer API key unless you also want source verification.

### 2. Configure the remote Worker

A new backend without mint configuration returns `503 Room minting is not configured on this backend.` Production is already configured; this is a setup diagnostic, not its current status. Required bindings for a new mint backend include:

- `ROOM_MINT_RPC_URL`
- `ROOM_MINT_CONTRACT_ADDRESS`
- `ROOM_MINT_AUTH_PRIVATE_KEY`
- `ROOM_MINT_CHAIN_ID`

`ROOM_MINT_RPC_URL` stays on the Worker. Mint and metadata preparation return the public Base mainnet or Base Sepolia endpoint for wallet network setup, according to `ROOM_MINT_CHAIN_ID`. There is no fallback to the server's transport for other chains. See [Base network details](https://docs.base.org/get-started/connect-to-base).

Production network values:

- `ROOM_MINT_CHAIN_ID=8453`
- `ROOM_MINT_CHAIN_NAME=Base`
- `ROOM_MINT_BLOCK_EXPLORER_URL=https://basescan.org`

For an isolated safety backend, select84532, Base Sepolia and https://sepolia.basescan.org explicitly. Local `.dev.vars` Sepolia examples remain appropriate.

Existing production deployments already have these bindings, including network labels, stored as secrets. Keep their existing types and values; do not add duplicate vars or delete/rotate credentials for this fix or a frontend redeploy. A public label being stored as a secret does not make it necessary to migrate it.

For a new, isolated safety backend only, use interactive prompts so private values never enter shell arguments/history:

```bash
npx wrangler secret put ROOM_MINT_RPC_URL --env safety
npx wrangler secret put ROOM_MINT_CONTRACT_ADDRESS --env safety
npx wrangler secret put ROOM_MINT_AUTH_PRIVATE_KEY --env safety
npx wrangler secret put ROOM_MINT_CHAIN_ID --env safety
npx wrangler secret put ROOM_MINT_CHAIN_NAME --env safety
npx wrangler secret put ROOM_MINT_BLOCK_EXPLORER_URL --env safety
```

Provide Sepolia's84532 and matching labels in those safety prompts. A new deployment or real wallet transaction requires its own explicit authorization; do not rerun setup against production as a verification shortcut. Routine checks use synthetic keys, RPC responses and isolated data, plus read-only public contract evidence.

The Worker now verifies that `ROOM_MINT_AUTH_PRIVATE_KEY` resolves to the same address as the contract's on-chain `mintAuthority`. If they do not match, mint prepare fails immediately instead of handing the wallet a reverting transaction.

### 3. Verify minting

For a separately authorized safety-network transaction test, once the Worker is configured:

1. sign in with a wallet-linked account
2. publish a room
3. click `Mint`
4. approve the Base Sepolia transaction in the wallet
5. wait for `confirmMint`
6. reload the room and confirm:
   - `mintedTokenId` is set
   - `permissions.canSaveDraft` / `canPublish` follow token ownership
   - a second account cannot edit if it does not own the minted token

### 4. New isolated test deployments

The production mainnet deployment is already complete. For any new isolated test deployment, arrange:

- the Base Sepolia RPC URL you want to use
- the deployed contract address
- confirmation of the three addresses you want to use for:
  - owner
  - mint authority / Worker signer
  - withdraw authority

The safer split is:

- you run the contract deploy locally with your private key
- record the deployed contract address and explicit network
- you configure the Worker with the mint-authority private key
- verify that isolated backend and its mint/edit gating; preserve existing production settings

Read-only October20 evidence: Base RPC reports chain8453 and8,941 runtime bytes at the documented contract. [Sourcify](https://sourcify.dev/server/v2/contract/8453/0xc3032d5E67C8A67C9745943929F8DFf2410Dd9A1?fields=all) reports exact runtime/source matching; `src/RoomOwnershipToken.sol` matches the repository. This does not imply that historical token metadata or ownership/UX backlog items are complete. No real transaction or credential change was made.
