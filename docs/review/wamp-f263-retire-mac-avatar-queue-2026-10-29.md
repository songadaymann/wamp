# F263: retire the Mac avatar queue — 2026-10-29

Implementation and targeted local verification complete; PR CI and delivery pending.

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
