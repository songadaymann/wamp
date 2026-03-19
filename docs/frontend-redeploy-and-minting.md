# Frontend Redeploy And Minting Setup

## Frontend Redeploy

Best-guess stable setup for the Pages frontend:

- Pages project serving `wamp.land`: `wampland`
- Branch: `main`
- Build command: `npm ci && npm run build`
- Build output directory: `dist`
- Clear build cache on the first retry after dependency or env changes
- Note: there is also a separate Pages project named `wamp`, but it is not the project currently attached to `wamp.land`

Frontend env vars Pages should have:

- `VITE_REOWN_PROJECT_ID=<your reown project id>`
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
- `wamp.land` currently runs as a Pages frontend while the public API is exposed separately at `https://api.wamp.land`. If the frontend later serves the Worker API on same-origin `/api`, leaving `VITE_ROOM_API_BASE_URL` unset remains the preferred setup.
- If you want CLI Pages deploys later, use a separate Pages config file instead of the Worker `wrangler.jsonc`.
- The Pages CLI deploy still depends on the `wampland` project existing in the same Cloudflare account Wrangler is logged into.

## Minting Setup

The app is wired for **Base Sepolia**, not Ethereum Sepolia.

Current known production deployment:

- Base mainnet contract: `0xc3032d5e67c8a67c9745943929f8dff2410dd9a1`
- Base mainnet chain id: `8453`
- Base mainnet explorer: `https://basescan.org`

Historical test deployment still referenced elsewhere:

- Base Sepolia contract: `0x4F2c0b0eEe60dB8cD45fa317DcaE56EC02F0D53b`
- Base Sepolia chain id: `84532`
- Base Sepolia explorer: `https://sepolia.basescan.org`

What is required to test real minting:

- a funded **Base Sepolia** deployer private key
- a separate contract owner address
- a separate mint-authority address that matches the Worker signing key
- a separate withdraw-authority address
- a Base Sepolia RPC URL
- a wallet with a little Base Sepolia ETH for the actual mint test
- remote Worker env configured with the deployed contract
- frontend wallet connect env already configured (`VITE_REOWN_PROJECT_ID`)

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

The remote Worker currently returns:

- `503 Room minting is not configured on this backend.`

That means at least these env vars are missing remotely:

- `ROOM_MINT_RPC_URL`
- `ROOM_MINT_CONTRACT_ADDRESS`
- `ROOM_MINT_AUTH_PRIVATE_KEY`

Recommended remote values:

- `ROOM_MINT_CHAIN_ID=84532`
- `ROOM_MINT_CHAIN_NAME=Base Sepolia`
- `ROOM_MINT_BLOCK_EXPLORER_URL=https://sepolia.basescan.org`

Set them with Wrangler secrets/vars or in the Cloudflare dashboard, then redeploy the Worker.

Example CLI flow:

```bash
printf '%s' "<base-sepolia-rpc-url>" | npx wrangler secret put ROOM_MINT_RPC_URL
printf '%s' "<deployed-contract-address>" | npx wrangler secret put ROOM_MINT_CONTRACT_ADDRESS
printf '%s' "<mint-authority-private-key>" | npx wrangler secret put ROOM_MINT_AUTH_PRIVATE_KEY
printf '%s' "84532" | npx wrangler secret put ROOM_MINT_CHAIN_ID
printf '%s' "Base Sepolia" | npx wrangler secret put ROOM_MINT_CHAIN_NAME
printf '%s' "https://sepolia.basescan.org" | npx wrangler secret put ROOM_MINT_BLOCK_EXPLORER_URL
npm run cf:deploy
```

If you prefer, the non-secret values can live in dashboard vars instead.

The Worker now verifies that `ROOM_MINT_AUTH_PRIVATE_KEY` resolves to the same address as the contract's on-chain `mintAuthority`. If they do not match, mint prepare fails immediately instead of handing the wallet a reverting transaction.

### 3. Verify minting

Once the Worker is configured:

1. sign in with a wallet-linked account
2. publish a room
3. click `Mint`
4. approve the Base Sepolia transaction in the wallet
5. wait for `confirmMint`
6. reload the room and confirm:
   - `mintedTokenId` is set
   - `permissions.canSaveDraft` / `canPublish` follow token ownership
   - a second account cannot edit if it does not own the minted token

### 4. What I still need from you

To finish real remote mint testing, I need:

- the Base Sepolia RPC URL you want to use
- the deployed contract address
- confirmation of the three addresses you want to use for:
  - owner
  - mint authority / Worker signer
  - withdraw authority

The safer split is:

- you run the contract deploy locally with your private key
- you give me the deployed contract address
- you configure the Worker with the mint-authority private key
- then I wire the remote Worker env and finish the mint/edit-gating verification
