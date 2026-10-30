# F263: retire the Mac avatar queue — 2026-10-29

Delivered in [PR #334](https://github.com/songadaymann/wamp/pull/334), merged
`b27f2ca9c4666146f604784c3b307723cc49d394`.

Jonathan approved retiring the old Mac queue, including its manual processor.
The current Mac has neither the `land.wamp.cryptopunk-avatar-queue` LaunchAgent
plist nor a registered service under that label (checked 2026-10-29).

Removed the installer, one-shot runner and queue processor, their five package
commands, their dead-code entry points and the local-runner-only bucket setting.
The Cloudflare Worker/container, container deployment/prepare commands, avatar
pack builder and preview atlas builder are retained.

No runtime code or configuration changes require an avatar Worker deployment.

Targeted verification: five files / nine tests passed (executable-entry contract,
avatar registry/dynamic/unlocks and Worker entitlements). Dead-code check found
nothing new (785 existing findings). Live code/config searches have no remaining
references to the three removed scripts or the local-only bucket setting.

All 18 [CI jobs](https://github.com/songadaymann/wamp/actions/runs/40878078970)
passed. The complete merged tree matches the tested candidate `90704d0d`.
No runtime source/config changed, so no avatar Worker or API deployment is needed.
The 28-item goal is 1/28 delivered; F273 is in progress.
