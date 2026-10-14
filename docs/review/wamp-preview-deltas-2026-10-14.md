# F035 — room preview deltas

Work authorized October 14: finish preview deltas, test and ship if the checks pass. Preserve full playable snapshots and existing preview authorization, persistence, expiry and clear behavior. Older open tabs retain full-map population messages; updated clients negotiate `previewDeltas=1` and receive counts-only populations plus changed-room upsert/removal messages.

## Plan and current evidence

1. Server: version changed preview contents, retain coalescing, full reconnect baselines and legacy compatibility. Use small lease-refresh messages for unchanged active previews; restore full data if a lease could have expired.
2. Client: own each changed snapshot once, retain its identity for duplicate revisions and lease refreshes, and distinguish a counts-only message from a legacy full-map replacement.
3. Validate server/client contracts, restart/expiry/clear paths, byte savings and real WebSocket/browser construction-room playback. Run full quality and mobile CI.
4. Merge after hosted checks, deploy from clean main, deliver matching PartyKit code and verify the actual production site and transport. Only then tick F035.

Initial focused tests pass: delta selection/revisions/lease refresh, current/legacy viewers, changed/cleared/disconnected rooms, persisted preview restoration and expiry, coalesced edits, capability negotiation and client snapshot ownership. Twelve population changes use less than one twentieth of the legacy population bytes in the unit fixture, with no repeated preview payload. Existing preview authorization/persistence and shared-output contract tests pass. TypeScript passes. Full gates, native transport/playback and delivery remain pending; master 140/215.

Implementation uses the existing [PartyKit server lifecycle](https://docs.partykit.io/reference/partyserver-api/). No hibernation mode, sharding, chat transport, identity policy or preview-authorization policy changes are included.

## Native transport and gameplay evidence

Actual local PartyKit runtime plus native desktop Chrome/Metal, phone Chrome and phone WebKit: full preview terrain and Jimothy load through the real client/streaming path and remain playable. Jumps lift the player 52/51/50 px; Chrome phone uses the actual touch button. Changed previews acquire a new owned snapshot, hidden-tab/reconnect restores the full baseline, and clearing removes the room. Screenshots inspected; zero application errors.

Across the test's population messages, counts-only payload totals are 1,185 versus 130,967 bytes on desktop, and 1,106 versus 121,620 bytes on both phone cases (about 99% less). This measures population messages in one construction fixture, not all multiplayer traffic. The client snapshot reference stays identical and the synchronous wire-ingress clone counter stays at zero across unchanged population updates. Ordinary scene bookkeeping is outside that counter. Proof: ignored `output/f035-preview-deltas-2026-10-14/browser-probe.ts`, `/tmp/wamp-f035-2026-10-14/browser/` and the per-browser final logs.

The probe waits for the playable snapshot before entering Play and for landing before sending Jump. Its initial generic scene-wide clone counter included unrelated scene work; final measurement brackets the synchronous wire handler. A late startup subscription refresh and WebKit's local cross-origin token request required an isolated observer subscription and explicit CORS on the test token issuer. These are probe corrections, not production input/auth changes.

## Open-source readiness

The user supplied open-source AGENTS instructions during this work. The initial required checker reported one blocker (missing LICENSE), two metadata/asset-documentation warnings and no secret patterns. Added MIT code license, matching package metadata, names-only environment example, README licensing/required Reown attribution, the dependency's license copy, and ASSETS.md. Third-party/NFT artwork is not relicensed; the existing asset inventory records its unresolved provenance for follow-up. No media is added by F035. Final staged readiness check and delivery are pending.

## Release gates

Full quality completes through lint, 486 files / 3,588 passing tests, TypeScript, DOM/type contracts, build/bundle budgets and PNG/tree/audio checks. Mobile CI passes all 13 cases with zero console/page errors and zero API fixture misses (431 responses served). The staged open-source check passes with zero blockers and zero warnings. Hosted checks, merge and full Worker/Pages plus PartyKit delivery remain pending; F035 remains partial and master remains 140/215 until production verification.
