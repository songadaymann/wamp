# XP, Badges, Ratings, and Progression PRD

Status: Draft  
Date: April 3, 2026  
Owner: Jonathan / WAMP  

## Summary

This document proposes a progression system for WAMP built around four distinct tracks:

- `PXP` = Player XP
- `BXP` = Builder XP
- `CXP` = Curator XP
- `Trust` = hidden reputation used for weighting, caps, unlocks, and anti-abuse

Core direction:

- Players should see the three visible XP lanes and the cosmetic/status rewards attached to them.
- Users should not see raw `Trust`.
- `Trust` should quietly buff or debuff XP earning, rating weight, builder privileges, and leaderboard-side influence.
- `Points` / `$WAMP` can remain the Play.fun-facing reward language.

This is intentionally not a one-number system.

- `Points` are external-facing reward.
- `PXP`, `BXP`, and `CXP` are visible identity and progression.
- `Trust` is the hidden ecosystem-quality control layer.

## Product Goals

1. Reward the behaviors WAMP actually wants more of:
   - playing real rooms and courses
   - building rooms other people genuinely enjoy
   - rating thoughtfully after completion
   - curating good content and helping discovery
2. Give accounts a readable long-term identity:
   - visible XP lanes
   - role medals / badges
   - crowns, trophies, and founder identity markers
   - profile skins and flair
3. Gate risky builder powers through hidden trust, not grind alone.
4. Prevent spam, alt abuse, rating farms, room hoarding, and tiny-improvement grinding.
5. Encourage return visits without creating aggressive daily-compulsion loops.

## Non-Goals

- This is not a replacement for Play.fun points.
- This is not a pure economy system.
- This is not a moderation system by itself.
- This should not reward trivial republishes, draft spam, room hoarding, or self-dealing.
- This should not force players into harsh daily streak pressure.

## Core Decisions

### 1. Visible progression is split into three lanes

WAMP should not use one visible XP pool for everything.

- `PXP` rewards play, clears, mastery, and competitive improvement.
- `BXP` rewards meaningful room authorship and audience response.
- `CXP` rewards thoughtful rating, discovery, and curation.

This gives users a clearer identity:

- strong player
- strong builder
- strong curator
- or a mix

### 2. Trust is hidden

Users should not see a raw trust number in the main UI.

Instead, trust operates behind the scenes and affects:

- rating weight
- XP buff/debuff pressure
- builder cap increases
- room claim / publish allowances
- anomaly scoring
- whether an account is treated as reliable

In-product, users can see the outcomes of trust:

- badges
- skins
- builder unlocks
- trophies
- higher limits

But they do not need to see the raw internal score.

### 3. Quality and difficulty are separate

WAMP should keep two different post-run ratings:

- `Quality` = how good was this room?
- `Difficulty` = how hard was this room?

They should affect different reward lanes:

- quality primarily affects `BXP` and builder-side trust
- difficulty primarily affects `PXP` values and player-facing challenge status

### 4. Ratings only count meaningfully after completion

Ratings should be tied to completion and version significance.

- players rate after finishing a room or course
- one meaningful vote per player per significant version
- changing a rating on the same version grants no new XP
- self-rating is disabled

### 5. Builder power should scale with trust, not only XP

`BXP` should matter, but it should not be enough by itself to unlock stronger creation powers.

Trust should be the main gate for:

- publish frequency
- claim frequency
- placed-object caps
- collectible caps
- access to stronger builder affordances

### 6. Weekly cadence is safer than harsh daily streaks

Daily streak pressure is likely the wrong tone for WAMP.

Preferred approach:

- weekly participation bonuses
- or a rolling `every 4 days` cadence
- not a punitive "come back every day or lose everything" system

## Design Principles

### 1. Reward breadth and quality over raw volume

The system should care more about:

- first clears
- unique players
- meaningful ratings
- audience response
- long-term account behavior

It should care less about:

- spam publishing
- tiny PB nudges
- alt-account loops
- low-effort room churn

### 2. Keep high-leverage rewards capped

No single input should dominate:

- not ratings
- not leaderboard camping
- not publish spam
- not endless replays

Use soft caps, daily caps, and diminishing returns where needed.

### 3. Make fraud expensive and visible

The system should detect and discount:

- bursts of new accounts rating one creator
- bot-like completions
- suspicious star outliers
- suspicious review bombing
- suspicious self-boost rings

### 4. Attribute builder credit proportionally

Minor edits to an existing room should not steal full builder credit.

Likewise:

- minor cleanup should earn some reward
- vandalizing or degrading a room should not fully tank the original builder
- versioned trophies should belong to the version that earned them

### 5. Cosmetics are safe, powers are not

Safe unlocks can come from visible XP lanes.

Riskier creation power should require hidden trust and long-term account quality.

## System Overview

### 1. Points

Use existing points for Play.fun-facing reward.

- primary surface: Play.fun
- language: points / `$WAMP`
- points can remain tied to current reward logic

Main-site progression should foreground:

- `PXP`
- `BXP`
- `CXP`
- badges
- trophies
- profile expression

### 2. Player XP (`PXP`)

`PXP` is for the act of playing well.

It should reward:

- first clears
- course clears
- meaningful PB improvement
- top-10 leaderboard breakthroughs
- top-spot breakthroughs
- post-run rating participation

Visible outputs:

- player medal progress
- player profile skins
- player badges
- crowns and leaderboard markers

### 3. Builder XP (`BXP`)

`BXP` is for making good rooms and courses.

It should reward:

- meaningful first publishes
- unique players completing your work
- quality ratings on your work
- trophy-worthy rooms
- long-term audience engagement

Visible outputs:

- builder medal progress
- builder profile skins
- creator trophies
- builder badges

### 4. Curator XP (`CXP`)

`CXP` is for good taste and useful discovery behavior.

It should reward:

- rating completed rooms and courses
- rating accuracy over time
- tagging / award systems later
- sending meaningful traffic through curated profile links later
- future feed/discovery actions that actually help other players find good rooms

Visible outputs:

- curator medal progress
- curator profile skins
- curator badge sets
- expanded profile curation options

### 5. Hidden Trust

Trust is a slower, hidden, cross-cutting value.

It should influence:

- rating weight
- XP multipliers within sane bounds
- builder promotions / demotions
- publish and claim caps
- anomaly review thresholds
- who counts as a strong signal

Trust signals can be role-aware, but the raw number should stay hidden.

## Visible Rank Expression

The UI should stay compact.

Recommended direction:

- use one compact medal per lane: player, builder, curator
- each medal can change color, emblem, crown, and ribbons as milestones unlock
- if one medal becomes too visually noisy, fall back to three separate role medals

This keeps progression readable without covering the game in numeric clutter.

Important:

- avoid floating raw numbers over player heads
- founder identity and exact WAMP number belong primarily on profiles
- over-head display should favor simple icons, medals, or crowns

## XP Earning Model

## Player XP (`PXP`)

Player XP should reward clears, mastery, and meaningful post-run feedback.

Starting recommendation:

| Action | PXP | Notes |
| --- | ---: | --- |
| First clear of a room challenge version | 20 | Once per significant version lineage |
| First clear of a course version | 40 | Higher because courses are longer |
| Post-run rating submission | 5 | Includes quality + difficulty together |
| Weekly participation bonus | 10 | Once per participation window, not daily pressure |
| Featured room/course completion | +5 bonus | Optional later |

### Personal Best Improvement PXP

PB improvement should be real, but tightly guarded.

Recommendation:

- award PB PXP at most once per room/course per UTC day
- additional PXP can still be granted on the same day if the run changes leaderboard position
- tiny gains should not pay repeatedly
- PB on its own should never re-award full first-clear PXP

Suggested rules:

- PB reward requires a completed run
- minimum improvement threshold:
  - timed challenges: at least `0.5s` or `1%`, whichever is larger
  - score-based challenges: at least `1` meaningful unit
- if the PB does not change leaderboard placement, it should not repeatedly farm rewards in the same day
- if the PB newly enters top 10, improves within top 10, or takes #1, it can earn an additional event bonus

Suggested PXP values:

| Action | PXP | Notes |
| --- | ---: | --- |
| Daily PB improvement reward | 8 | Max once per board/day without placement change |
| Break into top 10 | +10 | Paid when entering top 10 |
| Improve position within top 10 | +5 | Paid on meaningful rank change |
| Take #1 | +15 | Kingslayer / dethrone moment |

### Difficulty and PXP

Difficulty should influence `PXP`, not builder reward.

Recommendation:

- use difficulty to scale clear PXP modestly
- base the system on an auto-suggested difficulty score informed by completion time, deaths, and room data
- allow the player to override the suggestion before submitting

Suggested difficulty multiplier band:

- easy: `0.9x`
- normal: `1.0x`
- hard: `1.1x`
- very hard: `1.2x`

Keep the multiplier small.

## Builder XP (`BXP`)

Builder XP should reward meaningful authorship and audience response.

Starting recommendation:

| Action | BXP | Notes |
| --- | ---: | --- |
| First publish of a room with a real challenge goal | 25 | No XP for empty-room publish |
| First publish of a course | 40 | Higher effort |
| Unique player completes your room | 10 | Count each player once per significant version lineage |
| Unique player completes your course | 16 | Count each player once per significant version lineage |
| Unique player rates your room/course | 5 | Count once per significant version lineage |
| High adjusted quality milestone reached | 20-100 | Milestone-based |
| Trophy-eligible room/course | bonus | Optional later |

Important:

- `BXP` should be driven by unique users, not repeat clears
- quality stars should affect `BXP`
- difficulty should not directly determine `BXP`
- alt-heavy traffic should be discounted by trust and anomaly systems

### Builder Daily Caps

`BXP` should have caps and scaling, especially early.

Recommendation:

- apply a daily `BXP` soft cap
- trust can slowly raise that cap
- top trusted builders can eventually earn more in a day than brand-new builders
- the gap should be wide enough to matter, but only after long-term trust is proven

This is the right place for later high-tier rewards:

- manual quarterly free mints
- optional custom object / tileset requests
- other non-automatic recognition for top trusted builders

## Curator XP (`CXP`)

Curator XP should be its own real lane.

Starting recommendation:

| Action | CXP | Notes |
| --- | ---: | --- |
| Rate a completed room | 5 | After a real completion |
| Rate a completed course | 7 | Higher effort |
| Accurate rating over time | variable | Hidden trust-linked reliability bonus |
| Weekly curation participation | small bonus | Weekly, not daily |
| Profile link sends a meaningful visit/play | optional later | Future discovery feature |

Important:

- `CXP` should reward breadth of curation, not repetitive rescoring
- first-time ratings should pay the most
- rerating after a significant room change can pay reduced XP
- rating your own content should award no XP and should be blocked

### Curator Trust

Curator trust should increase when someone behaves like a reliable signal.

Positive signs:

- ratings that generally track eventual consensus
- thoughtful breadth across many creators
- real completion history
- account age and verified identity

Negative signs:

- suspiciously inflated `5-star` behavior for low-quality creators
- suspicious review bombing of creators others consistently like
- extreme outlier behavior that persists over time

This should not mean "you must agree with the crowd every time."

It should mean:

- persistent manipulative behavior lowers trust
- occasional disagreement is normal

## Hidden Trust Model

Trust should be slower than XP and harder to game.

Working name in the doc:

- `Trust`

This is a good behind-the-scenes name and does not need heavy branding.

### What Trust Controls

Trust should influence:

- rating weight
- how much of your activity counts at full value
- builder tier promotion/demotion
- room claim allowance
- publish allowance
- placed-object cap increases
- collectible cap increases
- anomaly review thresholds

### Positive Trust Signals

- account age
- verified email and/or wallet
- real play history on non-owned rooms
- unique players completing your work over time
- strong adjusted quality on your work
- consistent good-faith curation
- low moderation burden
- long-term loyalty

### Negative Trust Signals

- suspicious rating rings
- suspicious self-boost patterns
- bot-like new-account activity
- trivial republish churn
- creator alt loops
- repeated low-effort spam
- moderation issues

### Trust and XP Weighting

Trust can quietly buff or debuff XP earning, but only within modest bands.

Recommendation:

- trust should not create runaway multipliers
- trust can decide whether an action counts fully, partially, or barely at all
- brand-new accounts should still matter, but not as much as established good-faith accounts

This matters especially for:

- ratings
- unique-player builder rewards
- leaderboard-side signals

### Bootstrap Steering

In the early phase, WAMP can maintain a small steward list with maximum steering weight.

Initial candidates mentioned so far:

- Jonathan
- Fares
- Alex / Kamiswaze

This should be a deliberate bootstrap rule, not an invisible forever privilege by default.

## Ratings System

## Post-Run Rating UX

Ratings should happen at the moment of completion.

Recommended UX direction:

- on goal completion, briefly freeze the player or enter a short result state
- show leaderboard placement and completion summary
- present quality and difficulty submission together
- pre-select difficulty automatically
- allow manual difficulty override before submit
- let the player submit quickly, then continue

The interaction should be fast and low-friction.

## Quality Rating

Add a `1-5 star` quality rating for rooms and courses.

Rules:

- only available after completion
- one meaningful vote per player per significant version
- self-rating disabled
- displayed average should be confidence-adjusted
- trust affects weight
- changing your rating on the same significant version grants no new XP

### Quality Rating Meaning

Hover or tap help text should explain the intended meaning.

Suggested interpretation:

- `1`: bad, broken, or frustrating
- `2`: weak
- `3`: fine
- `4`: good
- `5`: great, memorable, or loved it

### Adjusted Rating

Use an adjusted or Bayesian average, not raw average.

Why:

- it reduces volatility
- it rewards consistency
- it prevents tiny sample sizes from dominating

### Versioned Rating Rules

Players should not farm XP by changing ratings back and forth.

Recommendation:

- each player gets one rewarded rating event per significant room version
- re-rating the same version is allowed for expression, but does not pay new XP
- if a room changes significantly, the player can rate again
- rerating after a significant update should pay reduced XP compared to the first-ever rating

Suggested significance rule:

- use a hidden weighted `percent_change` score
- room changes below roughly `10%` should not unlock a new rewarded vote
- room changes above that threshold can create a new rating window

## Difficulty Rating

Difficulty should remain separate from quality.

Recommendation:

- include difficulty in the same post-run submission flow
- auto-suggest a difficulty based on time, deaths, and room metrics
- let the player correct it before submit

Difficulty is useful for:

- player XP scaling
- search and discovery
- difficulty-based badges
- surfacing hard rooms

## Leaderboards and Competitive Rewards

Leaderboards should matter, but they should not become infinite farms.

### 1. PB Improvement

Handled in `PXP` above:

- once per board per day by default
- extra awards only when leaderboard placement changes

### 2. Holding Position

Leaderboard holding reward should be passive and snapshot-based.

Recommendation:

- do not pay per failure by other players
- pay once per UTC day based on held position at snapshot
- reward "you were not dethroned today," not "someone failed against you 80 times"

Suggested values:

| Action | PXP | Notes |
| --- | ---: | --- |
| Hold top 10 for a UTC day | 3 | Optional if board has enough competition |
| Hold #1 for a UTC day | 10 | Once per board/day |
| Hold #1 on a difficult room | +5 | Optional later |

Rules:

- require minimum competitor count before paying
- top-10 holding should be modest
- #1 should be meaningfully better than top-10 holding

### 3. Kingslayer Rewards

Taking a crown should feel memorable.

Suggested rewards:

- bonus PXP when entering top 10
- larger bonus when taking #1
- repeat "kingslayer" badge progress for dethroning strong leaders

## Trophies and Version Honors

Highly rated rooms should earn a trophy marker.

Recommended behavior:

- a room version can earn a trophy icon on map and profile surfaces
- if the room is updated, the trophy is removed from the live version until the new version earns it again
- the trophy remains attached to the historical version that earned it
- if the creator reverts to the trophy-winning version, that trophy returns with it

Builders with many trophies can unlock:

- special placeable objects
- profile trophies
- prestige builder cosmetics

## Builder Attribution Across Versions

This is a key anti-abuse rule.

WAMP should maintain a hidden `percent_change` or contribution score per significant version.

Purpose:

- prevent small edits from stealing full builder credit
- prevent bad follow-up edits from fully punishing original builders
- still reward cleanup and improvement work proportionally

### Attribution Model Direction

Recommendation:

- measure weighted room change across tiles, objects, routes, goals, hazards, and structure
- use that to estimate how much authorship belongs to the new editor vs the prior lineage
- split builder reward and trust impact proportionally across contributors

Implications:

- small cleanup pass = small `BXP` and trust share
- major redesign = larger share
- minor vandalism or bad balancing changes should primarily hurt the editor responsible for that version

### Significant Version Threshold

The system needs a threshold where an edit becomes meaningfully new.

Suggested direction:

- below roughly `10%` weighted change: treat as a minor revision
- above that: treat as a significant new version for rating and reward purposes
- much larger change can eventually qualify as a near-new authored work for most reward calculations

Thresholds should be tuned later, but the PRD should assume this mechanism exists.

## Builder Capacity and Publish Limits

Trust should govern expansion pressure early.

### Room Claim Limits

Recommendation:

- start conservative, such as `1` room claim per day
- scale upward with trust
- an upper range around `9` per day may be acceptable later, but only for proven builders

### Publish Limits

Recommendation:

- saving drafts should be unlimited
- publishing should be trust-limited
- trust should also influence how many meaningful updates can be pushed in a day

This is the cleanest way to reduce spam and farm loops.

### Editing Over Cap

If a user edits an older room that already exceeds their current object cap:

- they should still be allowed to edit and publish the room
- they should not be allowed to add new objects while the room remains over their current limit
- they can remove or rework content to get back under the cap

This prevents old high-trust rooms from becoming impossible to maintain.

## Cadence Bonuses Instead of Harsh Daily Streaks

WAMP should avoid weaponized streak design.

Preferred direction:

- weekly participation bonus
- or a rolling `4-day` cadence window
- low-pressure return incentives

Possible cadence families:

- play something this week
- build something meaningful this week
- rate and review something this week

If streak-style presentation is used:

- make loss feel soft
- avoid "you missed a day, start over from zero" punishment

## Levels, Medals, and Cosmetic Unlocks

Levels should be readable and role-aware.

Instead of one generic progression identity, use:

- player medal level
- builder medal level
- curator medal level

These can feed:

- profile skins
- name flair
- badge slots
- medal ornamentation

### Example Cosmetic Unlock Themes

- basic player skin
- basic builder skin
- basic curator skin
- higher-tier versions for each role
- kingslayer profile skin
- curator-heavy profile skins and gallery upgrades

Curator-specific unlocks can later include:

- more favorite slots
- custom curated profile sections
- predefined award-tag sets
- feed / discovery customization

## Badge Catalog

Badge categories should stay readable.

## Founder / Identity

- `WAMP #N`
- `First 99`
- `First 999`
- `First 9999`

Guidance:

- exact number belongs on profile
- not as a giant floating number over the player

## Player

- first clear
- 10 clears
- 100 clears
- first course clear
- no-death clear
- top 10 entrant
- top 1 finisher
- difficult-room top 10
- kingslayer streak

Important:

- player badges should count only on unique, non-owned rooms

## Builder

- first published challenge
- first published course
- 10 unique players
- 100 unique players
- first trophy room
- highly rated room
- highly rated course
- multi-trophy builder

## Curator

- first rating
- 50 ratings
- 200 ratings
- consistent curator
- trusted taste
- discovery guide

## Crowns and Competitive Markers

Suggested icon language:

- crown = top 10
- crown with diamond = top 1
- crown with emerald = top 10 on a difficult room
- bloodied crown = repeated kingslayer action

## Trophy / Room Awards

Future curator/tag systems can award room traits such as:

- beautiful
- challenging
- clever
- elegant

Enough tag support can surface a room award and later feed builder trophies.

## WAMP Number

The founder number should be a real identity flourish, but not a power source.

Recommendation:

- award founder number when the account becomes a real WAMP identity
- prefer assignment after linking email or wallet, not raw anonymous Play.fun row order
- show exact number on profile and expanded identity surfaces

This avoids burning founder numbers on throwaway accounts.

## Main Site vs Play.fun

### Main WAMP Site

Primary progression UI:

- `PXP`
- `BXP`
- `CXP`
- medal states
- badges
- crowns
- trophies
- founder identity

Trust should remain mostly invisible.

### Play.fun Surface

Primary reward UI:

- points / `$WAMP`

Secondary possibilities:

- light medal or badge display
- low-key XP gain acknowledgment
- trust still hidden

The same actions can feed both systems, but the surface emphasis should differ.

## Data Model Direction

This PRD does not define final schema, but the likely model includes:

- `pxp_events`
  - user_id
  - source_type
  - source_id
  - amount
  - multiplier_breakdown
  - created_at
- `bxp_events`
  - user_id
  - source_type
  - source_id
  - amount
  - weighting_breakdown
  - created_at
- `cxp_events`
  - user_id
  - source_type
  - source_id
  - amount
  - weighting_breakdown
  - created_at
- `trust_events`
  - user_id
  - source_type
  - source_id
  - amount
  - weighting_breakdown
  - created_at
- `user_progress`
  - user_id
  - total_pxp
  - total_bxp
  - total_cxp
  - player_level
  - builder_level
  - curator_level
  - hidden_trust_score
  - trust_tier_internal
  - founder_number
- `room_ratings`
  - user_id
  - room_id
  - lineage_key
  - version_key
  - stars_1_to_5
  - difficulty_choice
  - auto_difficulty_choice
  - updated_at
- `course_ratings`
  - user_id
  - course_id
  - lineage_key
  - version_key
  - stars_1_to_5
  - difficulty_choice
  - auto_difficulty_choice
  - updated_at
- `room_version_attribution`
  - room_id
  - version_key
  - prior_version_key
  - percent_change
  - contributor_weight_breakdown
- `badge_awards`
  - user_id
  - badge_id
  - awarded_at
- `room_trophies`
  - room_id
  - version_key
  - trophy_type
  - awarded_at
- `leaderboard_holding_rewards`
  - user_id
  - board_key
  - awarded_for_utc_day

Important assumptions:

- ratings follow significant versions, not only raw room ids
- builder rewards count unique users
- leaderboard holding rewards are daily snapshots
- attribution exists so builder reward can be shared proportionally
- trust has its own ledger or at least a clearly separate aggregation path

## UI Surfaces

Likely surfaces:

- profile modal / profile page
  - player / builder / curator medals
  - founder number
  - featured badges
  - profile skins
  - trophy shelf
  - published rooms should list only rooms the profile owner claimed and published, not rooms they merely edited later
  - future room/profile categories can expand to claimed/published, minted, favorites, curated lists, and custom ordering
- post-run modal
  - completion summary
  - leaderboard placement
  - quality stars
  - auto-selected difficulty
  - submit and continue
- room/course cards
  - adjusted quality stars
  - difficulty
  - trophy icon
  - creator snippets
- leaderboard modal
  - top-10 crowns
  - top-1 crown variant
  - kingslayer markers
- HUD
  - small PXP/BXP/CXP gain toasts when appropriate

## Anti-Abuse Rules

These should be designed in from the start.

- no self-rating
- ratings only after completion
- one rewarded rating per player per significant version
- no XP for changing a rating on the same version
- reduced XP for rerating after a significant update
- creator rewards based on unique users
- PB thresholds required
- PB reward once per board/day unless leaderboard position improves
- minimum account age / trust weighting on ratings and creator rewards
- anomaly review for bursts of brand-new accounts targeting one room or creator
- no heavy reward for room claiming
- no publish XP for empty rooms
- no trivial republish farming
- no per-failure farming off other players on leaderboards
- no uncapped grind source that can dominate the system

## Rollout Plan

### Phase 1: Core Progression Split

- implement `PXP`, `BXP`, and `CXP` ledgers
- implement profile-visible medal states / levels
- keep trust internal only

### Phase 2: Post-Run Ratings

- add quality stars for rooms and courses
- add difficulty selection with auto-suggest
- only allow submission after completion
- connect quality to `BXP`
- connect difficulty to `PXP`

### Phase 3: Builder Trust Gates

- add trust-weighted rating inputs
- ship first trust-gated builder cap
- ship claim/publish limits tied to trust

### Phase 4: Competitive Rewards

- add PB improvement rewards
- add top-10 / top-1 entry rewards
- add daily holding rewards
- add kingslayer tracking

### Phase 5: Trophies and Badges

- add founder badges
- add role badges
- add trophy versions for highly rated rooms

### Phase 6: Curation Expansion

- add curator unlocks
- add profile favorites / curation sections
- consider award tags and feed mechanics
- if feed surfaces reviews, prefer showing stronger signals such as `4+ star` reviews

## Open Questions

1. What exact weighted formula should define `significant version change` for ratings and builder attribution?
2. Should the weekly cadence be a strict calendar week, or a rolling `every 4 days` system?
3. What minimum competitor count is required before top-10 and top-1 holding rewards become active?
4. What exact trust bands should raise publish cap, claim cap, object cap, and collectible cap?
5. At what point should a major room rewrite stop sharing builder credit and behave like mostly new authorship?
6. Which curator tags should exist first, if tag-based room awards ship?
7. Should profile-follow/feed systems be in scope for the first curator release, or deferred?

## Recommended MVP

If this ships in the smallest high-value slice:

1. Split visible progression into `PXP`, `BXP`, and `CXP`.
2. Keep `Trust` hidden and use it only for weighting and gates.
3. Add post-run quality + difficulty ratings after completion.
4. Give `PXP` for clears, guarded PB improvement, and leaderboard breakthroughs.
5. Give `BXP` for meaningful publishes, unique completions, and quality response.
6. Add the first trust-gated builder limits for claim/publish/object growth.
7. Surface founder badges, role medals, and simple crowns.

That gives WAMP:

- clearer role identity
- safer builder progression
- better rating quality
- meaningful mastery reward
- a cleaner anti-farm story

without forcing the full trophy, feed, or advanced curator systems on day one.
