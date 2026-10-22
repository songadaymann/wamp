# Environment Setup

Local environment files are intentionally ignored. Keep real values in local files, Cloudflare/PartyKit project settings, or deployment secret stores.

Use:

- `env.local` for Vite/frontend overrides
- `.dev.vars` for Wrangler Worker development
- PartyKit local env files only when running the presence server locally

Do not commit real keys, private keys, personal email addresses, salts, API tokens, or production project IDs.

## Frontend `env.local`

```dotenv
# Reown / WalletConnect Cloud project id for local wallet testing.
VITE_REOWN_PROJECT_ID=

# Optional legacy alias. If both are set, VITE_REOWN_PROJECT_ID wins.
# VITE_WALLET_CONNECT_PROJECT_ID=

# Optional reset UI outside normal local Vite development.
# VITE_ENABLE_TEST_RESET=1

# remote or local storage behavior for local development.
VITE_ROOM_STORAGE_BACKEND=remote

# Optional PartyKit presence endpoint.
# VITE_PARTYKIT_HOST=127.0.0.1:1999
# VITE_PARTYKIT_PARTY=main

# Optional Cloudflare Web Analytics token.
# VITE_CLOUDFLARE_WEB_ANALYTICS_TOKEN=
```

## Worker `.dev.vars`

```dotenv
RESEND_API_KEY=
AUTH_EMAIL_FROM="Everybody's Platformer <local@example.com>"
APP_BASE_URL="http://127.0.0.1:3000"

REOWN_PROJECT_ID=
AUTH_DEBUG_MAGIC_LINKS=1
ENABLE_TEST_RESET=1

CHAT_OWNER_EMAILS=
ADMIN_REVIEW_EMAIL=
ROOM_DAILY_CLAIM_LIMIT=
ROOM_DAILY_PUBLISH_LIMIT=

PARTYKIT_HOST="127.0.0.1:1999"
PARTYKIT_PARTY="main"
PARTYKIT_INTERNAL_TOKEN=
PARTYKIT_IDENTITY_TOKEN_SECRET=

ROOM_MINT_CHAIN_ID=84532
ROOM_MINT_CHAIN_NAME="Base Sepolia"
ROOM_MINT_RPC_URL=
ROOM_MINT_CONTRACT_ADDRESS=
ROOM_MINT_BLOCK_EXPLORER_URL="https://sepolia.basescan.org"
ROOM_MINT_AUTH_PRIVATE_KEY=

TURNSTILE_SITE_KEY=
TURNSTILE_SECRET_KEY=
GUESTBOOK_IP_HASH_SALT=

CLOUDFLARE_ACCOUNT_ID=
CLOUDFLARE_IMAGES_API_TOKEN=
CLOUDFLARE_IMAGES_ACCOUNT_HASH=
CLOUDFLARE_IMAGES_BACKGROUND_VARIANT=public
CLOUDFLARE_IMAGES_THUMB_VARIANT=public
BACKGROUND_UPLOAD_MAX_BYTES=8388608
BACKGROUND_UPLOAD_MIN_TRUST_TIER=T2
BACKGROUND_UPLOAD_AUTO_APPROVE_TRUST_TIER=
BACKGROUND_UPLOAD_SKIP_AI_MODERATION=0

OPENROUTER_API_KEY=
OPENROUTER_IMAGE_MODERATION_MODEL=

CRYPTOPUNK_AVATAR_R2_BUCKET=
CRYPTOPUNK_AVATAR_R2_PREFIX=avatars/cryptopunks
CRYPTOPUNK_AVATAR_PUBLIC_BASE_URL=
CRYPTOPUNK_AVATAR_MAX_JOBS=1
CRYPTOPUNK_AVATAR_STALE_AFTER_MINUTES=20
```

## Notes

- Production wallet auth should come from Worker env `REOWN_PROJECT_ID`.
- Worker and PartyKit must share the same presence identity signing secret.
- Leave optional moderation/upload/mint values blank unless you are testing that subsystem.
- Prefer the hosting provider's secret store for deployed environments.
- `OTHERS_ROOM_EDITS_PAUSED=1` pauses draft saves and publishes over rooms claimed by other builders, for example during a vandal raid; builders' own rooms keep working. Set it with `wrangler secret put OTHERS_ROOM_EDITS_PAUSED` so a later deploy does not clear it, and remove it with `wrangler secret delete OTHERS_ROOM_EDITS_PAUSED`.
- `ROOM_MINT_RPC_URL` is the server-only blockchain transport and may use a private provider. Wallet network setup receives the public Base RPC for chain8453 or84532, never this setting. Other chain IDs cannot prepare wallet transactions until an explicit public endpoint is supported.

Minting has no implicit network fallback: configure an explicit8453 (production Base) or84532 (isolated Base Sepolia). Matching names/explorers are used when their optional labels are absent. Every server chain operation first checks `eth_chainId` through the server-only RPC with a2-second, no-retry probe; failures/mismatches cannot produce fresh ownership or wallet instructions. Tolerant draft saves keep stored ownership. Standalone `/minted-room` links also require an explicit valid `chainId`. Existing secret binding types/values remain unchanged.
