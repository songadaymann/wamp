# Asset ownership and provenance

The MIT code license does not license third-party media, NFT artwork or dependencies. No new media is added by F035. This inventory distinguishes Jonathan's stated media license from existing imported assets whose provenance needs review; it does not invent licenses or grant rights to those imports.

## 1. Jonathan Mann's media

Media authored by Jonathan Mann is [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) unless a specific asset says otherwise. Credit Jonathan Mann and link to the license when reusing such media. This applies only to media actually authored by Jonathan, not every file under `public/`.

Project-authored traversal artwork is documented in [the traversal asset receipt](docs/assets/traversal-pack-2026-10-07.md). Audio processing and source/output provenance are recorded in [the audio asset receipt](docs/review/wamp-audio-assets-2026-10-13.md); conversion does not change a source's ownership.

## 2. Free third-party assets

IBM Plex Mono fonts in `public/assets/fonts/` retain their accompanying SIL Open Font License. Upstream: [IBM Plex](https://github.com/IBM/plex). Dependency packages retain their own copyright and license files; the Reown AppKit license is included in `licenses/reown-appkit.md`.

Existing imported sprite, background and terrain exports under `public/assets/` need an asset-by-asset provenance audit before independent redistribution. The technical [asset intake rules](docs/development/asset-intake-rules.md) describe runtime formats, not ownership or redistribution rights. A pack being downloadable does not make it CC0 or CC BY.

## 3. Paid or restricted source packs

Put any newly acquired paid/restricted pack source in the gitignored `private-assets/` directory, and record the purchase URL and terms here at intake. No source pack is acquired, copied or licensed by F035. Historical runtime exports must be checked against their original sources before classifying them as freely redistributable; unknown terms are not replaced by the MIT code license.

## 4. Other people's or unverified media

CryptoPunks-derived files under `public/assets/cryptopunks/`, `public/assets/player/punk-465/` and avatar-generation inputs follow the collection's own terms. This document assigns no license to that artwork; any licensing decision requires Jonathan's confirmation. Existing uploaded-background samples and review screenshots likewise retain the rights of their underlying media. In particular, the selected 240px animated-background sample is user-uploaded media of unverified ownership, not covered by Jonathan's CC BY declaration.

These are pre-existing files, not an approved catalog of third-party assets for reuse. Their provenance and any necessary migration to private storage remain an asset-audit follow-up. New third-party media without confirmed rights belongs in `private-assets/`, with a public fallback rather than a new tracked source file.

Keep personal data, captured network logs and generated review output in gitignored `data/`, `logs/` or `output/`. Never commit credentials or signing keys.

## F094 upload encoder

Safari upload conversion lazily loads `@jsquash/webp`1.5.0 (https://github.com/jamsinclair/jSquash/tree/main/packages/webp), Apache2.0, and its bundled Google libwebp codec, BSD3-Clause. Distribution notices: `public/licenses/jsquash-webp-apache-2.0.txt` and `public/licenses/libwebp-bsd.txt`. This is executable codec code, not an art pack. No new third-party media is added. The existing selected background remains the exact user-approved `docs/review/assets/wamp-background-choice-240px-32colors-2026-10-13.webp`.
