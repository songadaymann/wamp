# Art sources outside the production asset tree

These files are retained for future editing and generation; Vite does not deploy
this directory. Runtime atlases remain under `public/assets`.

- `player/default/PlayerCombatSheet.{png,json}` are inputs to
  `scripts/build-player-combat-actions-atlas.mjs`. That script still writes the
  runtime `PlayerCombatActionsSheet.{png,json}` under `public/assets/player/default`.
- `player/default/frames/` and `Sleep.png` retain the individual animation source
  images formerly read by the retired OpenAI avatar prototype. Current play uses
  the registered atlases rather than these individual source files.
- `player/gamejew-{green,purple,yellow}/` retain unregistered variants. Only red
  is currently registered and stays in production. These variants still need
  complete matching combat atlas metadata before they can be registered.
- `unused-assets/` preserves unreferenced art at its former path relative to
  `public/assets`. Move an asset back and register/reference it before runtime use.

The archive move preserves every file byte for byte. Do not point runtime URLs
into this directory; add reviewed runtime assets under `public/assets` instead.
