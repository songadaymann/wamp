# WAMP Worlds Pilot

## Goal

Worlds are numbered communities on WAMP's existing global grid. They grow from their own distant origin while published rooms remain publicly playable. The pilot is complimentary and admin-onboarded, with provider-neutral entitlement plumbing for later payment integration.

## Product contract

- WAMP 0 is Prime. Numbered World origins follow a counter-clockwise square spiral at 129-coordinate spacing, leaving 128 empty coordinates between adjacent origins. WAMP 1 is east and WAMP 2 is north-east in the game's screen-coordinate grid.
- A complimentary grant has a private server-saved seed draft but no number. Its first successful publication atomically allocates the next permanent number and origin.
- Published rooms are always public and playable. A frozen World is play-only and preserves all unpublished state.
- Building is either invite-only or request-to-join. Invitations use verified email identity.
- Owners control policies, caps, managers, names, and entitlement actions. Managers operate membership, publication review, and room history. Every active member may edit every standard room in the World.
- Publishing is either direct for members or subject to owner/manager approval of an unchanged submitted draft.
- Complimentary ceilings are 10 claims and 25 publications per builder per UTC day; owner defaults are 5 and 10 and may only be lowered.
- World room minting, Expanded Rooms, courses, physical portals, private play, transfers, on-chain behavior, Stripe, Universes, and Education are outside this release.
- Worlds may collide naturally. The first atomic valid claim wins an empty coordinate; adjacent published rooms remain separately governed and normally traversable.
- Active Worlds appear in a directory and have stable `/w/{number}` links. Optional names require admin approval.

## Pilot success signals

Track grants, seed activation, time to first publication, active builders, membership and publication requests, rooms claimed and published, directory warps, and freezes/reactivations. The pilot should make it possible to onboard and support twenty active Worlds without database or permission ambiguity.

## Growth planning model

The dedicated Worlds admin page includes a deterministic collision simulator. It treats every claim as immediately published, keeps DAU and claim rate constant, and uses a configurable probability that expansion favors the nearest World. It is a scenario tool rather than a forecast: real Worlds will have uneven activity, unpublished claims, and authored expansion shapes.

With two neighboring Worlds, one claim per active builder per day, 20% directional bias, and seed `129`, representative trials produced:

| DAU per World | Trials | Median collision | Middle 50% |
| ---: | ---: | ---: | ---: |
| 1 | 50 | 1,005 days | 900–1,052 days |
| 5 | 50 | 197 days | 188–210 days |
| 20 | 25 | 50 days | 47–54 days |

The admin can rerun different DAU, claim-rate, directional-bias, World-count, and time-window assumptions without changing production data.

## Pilot operations

- `WORLDS_ENABLED` is checked in as `0` for production and safety. Set it to `1` only after migration `0045` is applied in that environment.
- Complimentary onboarding happens in `/worlds-admin.html`; the admin grants an email address and may resend its action email.
- The entitlement boundary stores future provider, customer, subscription, interval, and period fields. A later Stripe adapter should translate webhook lifecycle events into the existing idempotent freeze/reactivate service rather than changing room permissions directly.
- Freezing and reactivation are admin/provider operations during the complimentary pilot. There is no checkout, webhook, cancellation UI, transfer, or on-chain action in this release.
