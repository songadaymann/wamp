# F381 — World publication feedback

## Behavior

In approval-required Worlds, Publish now returns the committed draft and a typed
submission outcome. The editor updates its save baseline and clears the saved
changes without claiming that a version was published, showing an edit-conflict
error, or triggering publish celebrations/entries. If submission fails after the
draft save, the editor still preserves that committed baseline and any later edits,
and tells the builder to retry Publish.

Authenticated builders can read their own request history through mine=1. It is
filtered by the signed-in user, privately cached with no-store, and supports the
latest request for a single room. Changed pending drafts display Out of date before
a reviewer tries to act. Unscoped review access still requires reviewer permission.

My Worlds details show the builder's latest request for each room: Waiting,
Approved, Needs changes with its reason, or Out of date with resubmission guidance.
Reviewers can enter a reason (up to500characters) when rejecting a draft. Persistent
editor feedback shows the same states and warns that edits require resubmission.
Phone builders find full review details in More. Status reads are deferred until
entering a numbered World editor, refresh on focus/every30seconds while visible,
and discard stale room/account responses. Hidden tabs and leaving the editor stop
polling; game destruction removes listeners.

New publication decisions and membership approvals send transactional messages
through the configured existing email provider. Repeated identical publication
resolutions do not send again. Reasons are escaped for HTML, missing email and
student accounts are excluded, and provider failure does not undo a decision.
Existing permission, optimistic-concurrency and stale-draft guards remain.

## Verification before PR

- Full local check passes738files/6237tests, one existing expected failure/two skips,
  and all lint/dead-code/type/DOM/generated-binding/build/asset stages.
- Boot669.6KB/670KB; no budget increase. No schema migration.
- API/D1 tests cover own-history isolation, spoofed identity parameters, signed-out
  denial, private caching, stale requests, rejection reasons and decision dedup.
- Repository/session tests cover successful submission, the next save's baseline,
  failures after committed saves, and preservation of later edits.
- UI tests cover reasons, latest-per-room status, editing/resubmission, failed reads,
  hidden-tab polling and delayed responses after an account change.
- Email tests use a mock provider only: outcomes, escaped reasons, missing email,
  student exclusion, membership approval and provider failures.
- Native workerd/D1 plus real desktop and phone builder browsers exercise Publish,
  edit/resubmit without a false conflict, reviewer-entered rejection reason,
  Needs changes, resubmission and approval to the first published version. Zero
  page errors. A second phone-sized reviewer uses touch Reject/Approve controls;
  no horizontal panel overflow. Desktop/phone screenshots inspected.
- Native fixture navigation uses /w/1 and actual Warp controls; it waits for the
  initial goal mode before stopping play and dismisses the reviewer's boot intro.
  Harness waits use observed UI state; no product assertion was relaxed.
- No production room/player writes or live emails. Native outbound traffic disabled.

Evidence: `/tmp/wamp-f381-check.log`, `/tmp/wamp-f381-baseline-failure-tests.log`,
`/tmp/wamp-f381-route-email-tests.log`, `/tmp/wamp-f381-editor-feedback.log`,
`/tmp/wamp-f381-notifications.log`, `/tmp/wamp-f381-native-5.log`,
`/tmp/wamp-f381-native-phone-reviewer.log`, ignored `output/f381-native/`.
This was the pre-PR boundary; final delivery is recorded below.

## Final delivery

PR348 testedhead412a7ecc passed all20 checks in CI40966544232 and merged as
e13d607a. The exact combined-head local check passes738files/6238tests, one
existing expected failure/two skips, all remaining check stages and669.2KB/670KB
boot budget. Worker safety and strict map asset checks pass. No schema migration;
mainDB remains0077 and jam0003.

Guarded release from clean maine13d607a passes migration/map guards and production
smoke. Worker89464588-20bd-4deb-a7d7-cc55849dac78 is confirmed at100%.
Pagesbc16366a, entrymain-zlZWf0mw.js, runtime, both editors, the deferred
editorPublicationFeedback module and all selected styles match release bytes.

Signed-out own-request and review reads return401, including a spoofed user-id
query. The public World directory exposes no request/rejection metadata. Existing
matching-version Insights still returns the expected v215 group/comparison in229ms.
Authenticated decisions and emails were verified only in native fixtures/mocks;
no production room/player writes or live email tests were used.

Evidence: `/tmp/wamp-f381-final-check.log`, `/tmp/wamp-f381-worker-safety.log`,
`/tmp/wamp-f381-map-guard.log`, `/tmp/wamp-f381-deploy.log`,
`/tmp/wamp-f381-live-assets.json`, `/tmp/wamp-f381-live-api.json`,
`/tmp/wamp-f381-deployments.json`, `/tmp/wamp-f381-pages.json`.
F381 is delivered; the full28-item goal continues.
