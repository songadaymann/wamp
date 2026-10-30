# F479 — connected Protected sorting and room crypto presentation

Protected Explore sorting requires an actual connected wallet, rather than merely
an installed provider. Disconnected/programmatic picks cannot start a Protected
request. Disconnect or disabling the wallet gate resets to Featured, clears the
old results and invalidates outstanding responses. Protection badges remain useful
to all builders. The button also uses the existing initial crypto visibility gate.

Room record, summary, current and ownership-refresh responses omit all eight
minted* fields by default, and always carry isProtected plus computed permissions.
Normal/compact room mutations and mint/artwork confirmations use the same view.
crypto=1 explicitly includes the details. Anonymous summary caches retain separate
URL keys; authenticated responses retain their private policy. A versioned internal
summary cache key bypasses pre-change full-detail entries immediately on rollout. This is payload
presentation, not a new authorization boundary. OpenAPI documents the opt-in and
optional crypto fields; existing server ownership checks remain authoritative.

The normal repository opts in only while connected and discards detailed responses
that arrive after disconnection. A narrowly named pending-recovery option preserves
read-only verification of an already authorized transaction after reload, while
still respecting the existing wallet-capability gate and recovery's matching
user/wallet/room checks. It never starts a wallet or sends a transaction. Ordinary
browsing cannot activate that option. Recovered metadata stays out of the editor
until connection; checking the pending outcome does not require reconnecting.

Internal hydration restores nullable metadata fields and preserves protection
through summary/current/clone/local-record paths. HUD ownership and ordinary editor
permissions use the server result rather than an address payload. Protected editor
status, mint availability, entry restrictions and publish nudges use protection,
without inventing a token ID. Idle text branches before building crypto wording.
Connection/account changes refresh presentation without replacing a dirty draft
or its save baseline; old reads are aborted/ignored and shutdown cancels them.
The now-unused scene crypto getter indirection is removed and its line pin shrinks.

## Verification before PR

- Full local check passes742files/6262tests, one existing expected failure/two skips,
  all remaining stages and669.1KB/670KB boot JavaScript. Final source includes the
  small getter cleanup and receives a final combined-head check before release.
- Real migrated API/D1 tests cover default/opt-in record, summary and current views,
  protected/unprotected rooms, anonymous/owner/non-owner rights, legacy cached DTOs, fresh ownership
  refresh, mutation confirmation and separation of anonymous cache entries.
- Repository tests cover absent, installed/disconnected and connected wallets,
  all four read/refresh paths, delayed responses and the prior-pending recovery
  exception. Editor tests cover permission/protection preservation, dirty draft
  and baseline preservation, connection, account changes and cancellation.
- Native workerd/D1 plus real desktop and phone browsers cover default redaction,
  walletless owner editing, an actual signed wallet challenge/verification with a
  disposable local signer, retained dirty draft/baseline, connected Protected sort
  and immediate reset on disconnect. Zero page errors. Screenshots inspected.
- Additional native desktop/phone owners with the wallet gate off can edit and see
  Protected, with no crypto-detail request or SDK startup. Browsing makes no RPC;
  entering a protected edit retains the existing server ownership check for its
  construction-preview permission token. That guard is deliberately preserved.
- The older ownership smoke now models default redacted responses and explicitly
  connects its isolated SDK/auth fixture for metadata inspection. Buyer, outsider,
  current, stale and unknown metadata scenarios pass. No application auth code is
  replaced by the fixture.
- Real browser recovery cases pass for mint reload, artwork reload, no-wallet,
  no-wallet readonly and dirty recovery. Pending records clear without SDK startup.
  Disconnected views show Protected; inspecting artwork then explicitly connects
  and still verifies canonical metadata. Shared busy-lock, transaction approval,
  request, permission and no-wallet assertions remain in place.
- Native harness corrections wait for completed room metadata, allow the existing
  default Popular fallback, open Email/wallet details and use phone More → Back.
  They change navigation waits, not product assertions. A zero-RPC assumption on
  entering the editor was traced to its existing construction-preview guard;
  the final check asserts zero while browsing and preserves that edit guard.
- No schema migration, production room/player writes, live email or real wallet
  transaction. Native external sends are disabled and RPC responses are local.

Evidence: /tmp/wamp-f479-check-final.log, /tmp/wamp-f479-check-pr.log,
/tmp/wamp-f479-native-3.log (desktop), /tmp/wamp-f479-native-phone-2.log,
/tmp/wamp-f479-no-wallet-native-final.log, /tmp/wamp-f479-ownership-smoke-2.log,
/tmp/wamp-f479-recovery-smoke-3.log and ignored output/f479-native/.
Delivery requires PR checks and an independently verified production rollout.
