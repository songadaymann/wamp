# F447 — builder recognition notices and republish warnings

Delivered through PR #345, merge `f5ae30a8`. All20 checks passed for tested
head `808a30b5`. Reviewed Featured version pins remain unchanged.

Builders receive private Activity notices for Featured, Room of the Day and Build
Prompt results. Winners see their rank; other entrants see the entry count. Results
open the matching prompt, including through a new tab. Email remains opt-in.
Migration0077 preserves existing Activity rows, deleted ID high-water marks,
triggers, views and indexes. A system actor avoids inventing a player. Explicit
idempotence guards work under outer SQLite upserts. Repicking a newer version on
the same UTC date creates a new daily notice; repeated picks of that version do not.

Exact-version warnings precede recognized republishes, including title/music
edits, in ordinary publication, both Expanded publish screens and standalone cell
batch publication. Cancel stops the write; account/mode/World/shutdown changes
cancel stale operations. Failed reads use a truthful conservative confirmation.
Private World/classroom and seed publication skip public recognition checks.
Warning orchestration is extracted into a helper; the existing sign-text action
was moved unchanged to keep the workspace within its file limit. No limit raised.

Native verification exposed a first-visit navigation bug: returning from a directly
opened Expanded cell editor tried to wake setup before it had ever started. The
return now uses Phaser's run operation, which starts or wakes setup as needed.
The actual native desktop and phone paths pass with this repair.

## Verification

- Migrated SQLite tests cover recipient-owned privacy, native/legacy Expanded
  attribution, rank/entry-count results, duplicate upserts, daily version repicks,
  existing event triggers, preserved ID sequence and foreign keys.
- Helper/API/UI tests cover exact target/version flags, private caching, invalid
  inputs, signed-out denial, Cancel, failed reads, stale identities/lifetimes,
  private Worlds, result-link navigation and deferred startup. Actual publish
  methods are tested to stop before saving or publishing after Cancel.
- Native workerd/D1 plus real desktop and phone browsers show recognition notices
  and open matching results. Ordinary publishes: Cancel sends no publish request;
  acceptance returns200, creates the next version, retains the old pin, and leaves
  the new catalog version unfeatured. Zero page errors.
- Native desktop and phone Expanded paths enter the cell workspace, return to
  setup, show the warning and exercise Cancel/accept. Both retain the reviewed
  whole-room pin and leave the new version unfeatured. Zero page errors. Other
  workspace publish entry points have actual-method cancellation regression tests.
- A real modified-click opens results in a new browser tab; the expected prompt
  appears and its startup parameter is consumed. Zero page errors. Test setup
  avoids localStorage writes on the transient opaque about:blank page.
- Native D1 daily repick: two real published Expanded versions produce notices
  for v1/v2, while repeating v2 adds none. Desktop/phone screenshots inspected.
- No production player/room writes or emails; native outbound network and email
  are disabled. Migration0077 has not been applied remotely.

Native evidence: `/tmp/wamp-f447-native-browser-2.log` (desktop result link),
`/tmp/wamp-f447-native-browser-3.log` (ordinary desktop/phone),
`/tmp/wamp-f447-native-expanded-2.log` (desktop Expanded),
`/tmp/wamp-f447-native-expanded-phone-link.log` (phone Expanded),
`/tmp/wamp-f447-native-new-tab.log` (isolated new-tab flow),
`/tmp/wamp-f447-native-daily-repick.log`, ignored `output/f447-native/`.
Harness-only failures were corrected at the first failed boundary: hidden legacy
Publish selector, asynchronous response polling, the phone More menu and opaque
new-tab setup. No application assertion was relaxed.

Final complete check passed732files/6210tests, one existing expected failure/two
skips, and all lint/type/DOM/generated-binding/build/asset stages. Boot668.4KB/670KB.
Evidence: `/tmp/wamp-f447-release-check.log`. Worker-safety passes. The native
browser evidence includes the final navigation repair; native D1 repick evidence
includes the final version-aware deduplication key. CI and live delivery remain.
F436's pending draft also reserves0077; renumber/rebase it before its later merge.
The delivery record below verifies the remaining gates.


## Live delivery

The clean merged-main artifact passed the exact-tree, migration and strict map
asset guards. Migration0077 applied to the main DB; all1,748 old Activity rows
remain, sequence1781 is retained, all7 old triggers/3 indexes remain, the5 new
triggers exist, and Activity foreign-key violations are0. The jam DB uses its own
migration folder and remains current at0003; it needed no schema change.

Worker `0bada192-7857-4456-b63b-db044f603fa0` is confirmed at100%. The initial
manual Pages release was a993f4ca; the custom domain settled on the simultaneous
automatic build for the same merged commit. Republishing the already-built verified
frontend artifact selected Pages `c8dc1091`, without rebuilding or redeploying the
Worker/database. Live entry `main-CWNpcThx.js`, runtime, both editors, Composer,
warning/feedback module and styles now match release bytes. Final production smoke
passes all19 boot scripts, migration0077, database/maps and email health.

Signed-out recognition reads return401. Public Activity's30 entries contain no
private recognition kinds. No production player/room writes or emails were used.
The pre-migration audit first hit transient D1 error7403; read-only database listing
and the exact audit retry passed before any schema change.

Evidence: `/tmp/wamp-f447-pre-migration-retry.json`,
`/tmp/wamp-f447-post-migration.json`, `/tmp/wamp-f447-deploy.log`,
`/tmp/wamp-f447-deployments.json`, `/tmp/wamp-f447-pages-final.log`,
`/tmp/wamp-f447-live-assets.json`, `/tmp/wamp-f447-live-api.json`,
`/tmp/wamp-f447-prod-smoke-final.log`.
