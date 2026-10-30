# Documentation

This folder is organized by the kind of decision a reader is looking for.

## Start here

For people and AI agents picking up work:

- **What to work on:** the [round 2 checklist](review/wamp-checkup-round-2.md) (F251–F498). Round 1, [wamp-checkup-2026-10.md](review/wamp-checkup-2026-10.md), is done apart from items waiting on Jonathan.
- **One item in depth:** search the details file for its heading, such as `### F301`, in [round 2 details](review/wamp-checkup-round-2-details.md) or [round 1 details](review/wamp-checkup-2026-10-details.md). Each is over 1 MB, so don't read them whole.
- **What shipped:** [feature-ledger.md](../feature-ledger.md), one row per delivery with its PR and receipt. The receipts in [review/](review/) (`wamp-<topic>-<date>.md`) hold each delivery's plan, checks and evidence.
- **Recording a delivery:** add one file to [ledger/](ledger/README.md) and run `npm run ledger`. Tick the checklist item and update its Progress line; `npm test` checks the count.
- **Old logs:** [history/](history/README.md) has the long-form ledger and progress log up to 2026-10-23 (357 KB and 586 KB). Search them instead of reading them. The root `progress.md` is now an untracked local scratch file.

## Review

- [WAMP Checkup, Round 2](review/wamp-checkup-round-2.md): the current checklist (F251–F498); full write-ups per item in [the round 2 details file](review/wamp-checkup-round-2-details.md)
- [WAMP Checkup, October 2026](review/wamp-checkup-2026-10.md): the round 1 checklist (F001–F250); full write-ups per item in [the details file](review/wamp-checkup-2026-10-details.md)

## Product

- [Product requirements](product/product-requirements.md)
- [Backlog](product/backlog.md)
- [Ideas inbox](product/ideas-inbox.md)
- [Design ideas](product/design-ideas.md)
- [XP, badges, ratings PRD](product/xp-badges-ratings-prd.md)

## Features

- [Expanded rooms impact audit](features/expanded-rooms-impact-audit.md)
- [Guest room recovery](features/guest-room-recovery-design.md)
- [Room music design principles](features/room-music-design-principles.md)
- [Sword Hunter AI explainer](features/sword-hunter-ai-explainer.md)

## Development

- [Multiresolution overworld tile pyramid](overworld-tile-pyramid.md)
- [Architecture notes](development/architecture.md)
- [Environment setup](development/environment.md)
- [HTML entry points](development/html-entrypoints.md)
- [Asset intake rules](development/asset-intake-rules.md)
- [Frontend redeploy and minting](development/frontend-redeploy-and-minting.md)
- [Mobile testing](development/mobile-testing.md)
- [Safety backend foundation](development/safety-backend-foundation.md)

## Historical

Earlier plans and delivery logs, kept as evidence. The checkup checklists above replace them as the current plan.

- [Performance and code-health roadmap](performance-code-health-roadmap.md) (June–July audits), with the [June 10 repo improvement plan](2026-06-10-repo-improvement-plan.md) and [July 13 code-health recommendations](2026-07-13-code-health-and-performance-recommendations.md)
- [July 29 gameplay performance plan](2026-07-29-gameplay-performance-plan.md)
- [August 13 refactor plan](development/refactor-plan-2026-08-13.md), its [closeout](development/refactor-performance-closeout-2026-08-13.md) and [manual QA guide](development/refactor-manual-qa-guide-2026-08-14.md)
- [October 3 checkup delivery log](development/checkup-delivery-2026-10-03.md) (274 KB, search it)
- [Archived logs](history/README.md): the long-form ledger, the progress log and the round 1 checklist's status notes
