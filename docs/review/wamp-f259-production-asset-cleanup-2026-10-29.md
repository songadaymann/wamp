# F259 — production asset and entrypoint cleanup (in progress)

Move53 unreferenced files (889,234bytes) out of public/assets into art-source,
retaining every byte for future work. This is deployment hygiene, not a claim that
players previously downloaded all those files. Keep registered default and red
GameJew atlases, combat/weapon/FX runtime sheets and the avatar feature intact.
Unregistered green/purple/yellow variants and individual source frames are archived
with their provenance. The atlas generator reads its preserved source PNG/JSON at
the new path and keeps the existing public runtime outputs.

Delete the unused run-first-test avatar prototype. The old .cursor debug log is
already absent from the baseline; no new removal is claimed. Keep the reward
preview available in Vite development at /reward-stings-preview.html while removing
it from production inputs. The background-admin compatibility redirect remains;
its remaining internal link now points directly to Launch Admin's photo review.
Update HTML entrypoint documentation, including existing secondary admin pages.

Full check passes747files/6287tests, one existing expected failure/two skips,
all stages; boot662.7/670KB (previous669.7KB). Four focused entrypoint/avatar tests
pass. All53 archive moves verified SHA256-identical. Runtime atlas outputs unchanged.

Real browser verifies the developer preview renders a reward, compatibility URL
redirects correctly, built game reaches appReady using recorded local API fixtures,
and default/red base+combat PNGs decode with their actual atlas metadata. Zero
page errors or missing asset responses. Built dist excludes all53 archived paths
and the reward preview. External network is blocked; no production writes.

ImageMagick is absent here. A non-rendering CLI fixture verifies the actual atlas
script resolves its preserved real inputs, passes the16 expected source/crop
arguments and emits unchanged runtime atlas JSON. It does not regenerate PNGs;
no claim of a real ImageMagick render. The render algorithm and source bytes are
unchanged; only source file location changes.

Evidence: /tmp/wamp-f259-check.log, asset-moves.json, browser.log/browser.json,
atlas-command.json and atlas-path-check.log (same prefix). Native harness is under
ignored output/f259-native/. Not delivered until PR checks and live rollout pass.
