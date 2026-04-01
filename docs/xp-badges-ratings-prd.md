# XP, Badges, Ratings, and Progression PRD

Status: Draft  
Date: March 31, 2026  
Owner: Jonathan / WAMP  

## Summary

This document proposes a progression system for WAMP built around:

- `XP` and `levels` as the main progression language on the core WAMP site
- `badges` as permanent accomplishment markers
- `streaks` as short-term momentum and a gentle XP multiplier
- `quality ratings` for rooms and courses alongside the existing difficulty rating
- `trust and unlocks` as a separate system for gating stronger tools and limits

This design intentionally separates progression from the existing `points` system.

- On the main WAMP site, progression should be expressed primarily as `XP`, `level`, `badges`, `streaks`, and a separate creator-trust track.
- On Play.fun, the headline reward can remain `points` / `$WAMP`.
- The same gameplay actions can feed both systems, but the UI emphasis differs by surface.

This also suggests WAMP should have two internal progression tracks rather than one:

- `XP` for player identity, cosmetics, and social flair
- `Trust` for creator credibility, creator caps, unlocks, and voting weight

In short:

- `Points` = externalized reward / Play.fun-facing reward
- `XP` = in-world progression, identity, cosmetics, and flair
- `Trust` = creator credibility, capability, and permission

## Product Goals

1. Reward the behaviors WAMP actually wants more of:
   - making real challenges
   - playing real challenges
   - rating and curating rooms and courses
   - building things other players actually engage with
2. Give accounts a visible long-term identity:
   - level
   - badge history
   - streaks
   - WAMP number
3. Create progression that can eventually unlock:
   - cosmetics
   - flair
   - advanced tools
   - higher creation limits for trusted builders
4. Avoid encouraging spam, griefing, or low-effort grinding.

## Non-Goals

- This is not a replacement for Play.fun points.
- This is not a pure economy system.
- This is not a moderation system by itself.
- This should not reward repetitive low-signal actions like draft saving, rapid republishes, or room hoarding.

## Design Principles

### 1. Separate reward layers

Do not make one score do everything.

- `Points` handle market-facing / Play.fun-facing reward.
- `XP` handles account progression.
- `Badges` handle memorable accomplishments.
- `Streaks` handle momentum.
- `Trust` handles permission and guardrails.

### 2. Favor meaningful engagement over raw activity

XP should skew toward:

- first-time completions
- unique players
- unique ratings
- high-quality creation
- ongoing audience engagement

XP should not strongly reward:

- claiming rooms repeatedly
- pushing tiny edits
- farming the same challenge over and over
- creator self-play or alt loops

### 3. Keep multipliers gentle

Ratings and streaks should influence XP, but not dominate it.

- rating multiplier should be small
- streak multiplier should be small
- top leaderboard holding bonus should be steady but capped

The system should amplify quality, not create runaway rich-get-richer behavior.

### 4. Do not tie dangerous powers to raw XP alone

Cosmetics can unlock via level.
Creation powers should unlock via `trust` or `trust + level`, not XP alone.

This matters because XP can be farmed more easily than actual community trust.

### 5. Avoid uncapped or whaleable reward inputs

No single reward source should let someone buy, spam, or brute-force their way to the top.

Avoid systems where:

- spending money can dominate a leaderboard directly
- mass room claiming creates progression advantage
- object spam or collectible spam creates progression advantage
- tiny PB improvements can be farmed forever
- fresh alt accounts can swing ratings or unique-player metrics too quickly

The system should reward meaningful participation and loyalty, not uncapped extraction.

## System Overview

### 1. Points

Use existing points for Play.fun-facing reward.

- Primary surface: Play.fun
- Framing: token-adjacent / `$WAMP`-adjacent reward
- Can remain tied to current point-earning logic

Main-site default:

- points can be hidden, deemphasized, or omitted from primary UI
- progression UI should foreground XP instead

### 2. XP and Levels

XP is the primary main-site progression metric.

It should be earned from:

- completing rooms and courses
- improving personal bests
- rating content after completion
- publishing meaningful challenges
- getting unique plays and ratings on authored content
- maintaining useful streaks
- holding meaningful leaderboard positions

XP should primarily unlock:

- avatars
- avatar cosmetics
- emotes
- name flair
- profile frames
- badge slots

### 3. Ratings

Add a `1 to 5 star` quality rating alongside difficulty.

- `difficulty` answers: how hard was this?
- `rating` answers: how good was this?

Ratings should:

- only be available after completion
- be one per player per room/course lineage
- be editable later
- feed creator XP and possibly completion XP multipliers

### 4. Badges

Badges should mark accomplishments that feel memorable and identity-forming.

Examples:

- first clear
- first published challenge
- first 10 unique players
- 30-day streak
- top-ranked room
- highly rated course
- early-adopter / WAMP number identity badges

### 5. Streaks

Streaks should track consistency, not spam.

Recommended streak families:

- play streak
- creator engagement streak
- builder streak
- rater/curator streak

Streaks can also provide a gentle XP multiplier.

### 6. Trust and Unlocks

Progression should eventually unlock more things, but risky creator powers should depend on trust.

- `Level` unlocks cosmetics, flair, and profile expression
- `Trust` unlocks stronger creation privileges

Trust should primarily unlock:

- higher placed-object caps
- higher collectible-item caps
- higher room-claim limits where appropriate
- more tilesets, backgrounds, music, and objects
- advanced creator workflows

## XP Earning Model

## Player XP

Player XP should reward first clears, improvement, and curation.

Starting recommendation:

| Action | XP | Notes |
| --- | ---: | --- |
| First clear of a room challenge version | 20 | Full XP only once per version lineage |
| First clear of a course version | 40 | Higher because courses are longer |
| Personal best improvement on a room | 8 | Only if improvement clears a minimum threshold |
| Personal best improvement on a course | 12 | Same guardrail |
| Submit a quality rating after completion | 5 | Only once until rating changes |
| Submit a difficulty rating after completion | 3 | Optional if kept separate |
| Daily "played today" bonus | 5 | Small, once per UTC day |
| Featured room/course completion | +5 bonus | Optional later |

### Personal Best Improvement XP

This is a good addition, but it needs anti-farm rules.

Recommendation:

- only award PB XP when the player sets a new personal best on a `completed` run
- require a minimum improvement threshold:
  - timed rooms/courses: at least `0.5s` or `1%`, whichever is larger
  - score-based rooms/courses: at least `1` meaningful unit above the prior PB
- cap PB XP awards per room/course lineage per UTC day
- do not award full first-clear XP again on PB improvement

This encourages mastery without letting someone grind tiny improvements for endless XP.

## Creator XP

Creator XP should reward meaningful publishing and real audience engagement.

Starting recommendation:

| Action | XP | Notes |
| --- | ---: | --- |
| First publish of a room with a challenge goal | 25 | No XP for empty-room publish |
| First publish of a course | 40 | More effort, more value |
| Unique player completes your room | 10 | Count each player once per lineage |
| Unique player completes your course | 16 | Count each player once per lineage |
| Unique player rates your room/course | 5 | Count once per lineage |
| High adjusted rating milestone reached | 20-100 | Milestone-based, not per tick |
| Room/course enters featured rotation | bonus | Optional later |

Important:

- creator XP should be weighted by `unique players`, not repeat clears
- creator XP from ratings should use adjusted rating / confidence, not raw average
- ratings from accounts below trust or age thresholds may count less or not at all

## Trust Gain Model

Trust should be a separate and slower-moving track than XP.

Working names:

- `Trust`
- `Builder Trust`
- `Trust Points`
- `Honor`

Core question:

- can this creator be trusted with more power inside WAMP?

Trust should help answer:

- should this account have higher creator caps?
- should this account unlock stronger creator tools?
- should this account's ratings or steering input count more?
- should this account be treated as a more reliable signal in the ecosystem?

Positive trust signals:

- account age
- verified email / wallet
- real play history on other people's content
- unique players completing your rooms and courses
- high adjusted ratings on your authored work
- consistent creator activity over time
- low moderation / report burden
- steward or moderator weighting in the early phase if needed

Trust should primarily unlock creator capacity, not player cosmetics.

Examples:

- higher placed-object cap
- higher collectible-item cap
- higher room-claim allowance
- additional tilesets, backgrounds, music, and object sets
- advanced creator workflows

### Caps That Scale With Trust

This is an especially good place to solve spam problems.

Recommendation:

- keep a base placed-object cap for everyone
- keep a stricter base collectible cap for everyone
- raise those caps gradually with trust, not just XP

This frames the system as:

- good builder behavior increases creative capacity
- bad or low-trust behavior leaves limits tighter

That is better than making raw account level the main gate for stronger builder powers.

## Curator XP

If WAMP wants to reward taste and curation, this should be a real lane.

Starting recommendation:

| Action | XP | Notes |
| --- | ---: | --- |
| Rate a completed room | 5 | After real completion |
| Rate a completed course | 7 | Higher effort |
| Consistent weekly rating participation | small bonus | Optional |

This lane becomes more valuable if discovery and recommendations become more important later.

## Leaderboard XP

Leaderboards should feed XP in two ways:

### 1. Beating your best time / score

Handled above as PB improvement XP.

Reason:

- mastery should matter
- players should feel rewarded for coming back and improving

### 2. Holding the top spot

This can work if it behaves like a small king-of-the-hill stipend, not a jackpot.

Starting recommendation:

| Action | XP | Notes |
| --- | ---: | --- |
| Hold #1 on a room for a UTC day | 10 | Once per room/day |
| Hold #1 on a course for a UTC day | 15 | Once per course/day |
| Hold #1 on a featured challenge | extra bonus | Optional later |

Rules:

- only the current top holder at the daily snapshot gets the reward
- do not pay continuously minute by minute
- pay once per UTC day per leaderboard
- require minimum sample size or minimum number of unique competitors for certain tiers if needed later

This gives leaderboards meaning without turning them into an infinite farm.

## What Should Not Meaningfully Earn XP

These actions should be weakly rewarded or not rewarded at all:

- claiming rooms as a major XP source
- saving drafts
- republishing trivial edits
- replaying the same room endlessly with no PB
- self-rating
- creator farming on alts
- empty room ownership changes

Claiming rooms in particular is risky to reward heavily because it encourages land grabs and spam creation.

## Ratings and Multipliers

## Quality Rating

Add a `1-5 star` rating for both rooms and courses.

Suggested rules:

- a player can rate only after completing the room/course
- one active rating per player per lineage
- can update later
- self-rating disabled
- displayed average should be confidence-adjusted
- rating weight may be reduced for very new or very low-trust accounts if needed

Suggested interpretation:

- `1`: bad / broken / frustrating
- `2`: weak
- `3`: fine
- `4`: good
- `5`: great / loved it

### Adjusted Rating

Use an adjusted or Bayesian average, not raw average.

Why:

- prevents one `5-star` room from outranking a room with twenty `4.6-star` ratings
- reduces volatility early

### Rating Multiplier

Let high-quality content earn slightly more XP.

Suggested multiplier band:

- very low quality: `0.9x`
- neutral quality: `1.0x`
- strong quality: `1.1x`
- excellent quality with enough ratings: `1.2x`

Use this multiplier for:

- creator XP from completions
- player XP from completing that room/course

Do not apply it to everything.
Keep it modest.

## Difficulty Rating

Difficulty should remain separate from quality.

Difficulty can still be useful for:

- search and discovery
- challenge expectations
- badge criteria
- later matchmaking / surfacing logic

## Streaks

Streaks should feel rewarding, but they should not dominate the progression economy.

Recommended streaks:

- `Play streak`: complete at least one challenge today
- `Creator engagement streak`: one of your rooms/courses gets a unique completion today
- `Builder streak`: publish one meaningful challenge today
- `Curator streak`: complete and rate at least one challenge today

### Streak Multiplier

This is a good idea if it stays gentle.

Recommendation:

- streaks grant a small XP multiplier on eligible XP
- do not multiply Play.fun points
- do not multiply publish XP too hard

Suggested formula:

- `+1% XP per day`
- cap at `+15%`

Eligible XP only:

- room/course completion XP
- rating XP
- PB improvement XP

Not eligible:

- publish XP
- top-spot holding XP
- admin or special bonuses

This keeps streaks motivational without making them oppressive.

## Levels and Milestones

Levels should be broad, readable, and identity-forming.

Suggested title bands:

| Level Band | Title |
| --- | --- |
| 1-5 | Newcomer |
| 6-10 | Explorer |
| 11-20 | Builder |
| 21-35 | Architect |
| 36-50 | Worldmaker |
| 51+ | Legend |

Suggested milestone cadence:

- visible milestone at levels `5, 10, 15, 20, 30, 40, 50`
- unlock something visible at those points

Example unlock cadence:

- Level 5: profile badge slot
- Level 10: alternate avatar pack
- Level 15: profile frame
- Level 20: chat flair
- Level 30: creator cosmetic pack
- Level 40: special badge frame
- Level 50: prestige aura / legendary flair

## Badge Catalog

Badge categories should be easy to understand.

### Identity / Founder

- `WAMP #N`
- early adopter
- first 100 / first 1000 accounts

### Player

- first clear
- 10 clears
- 100 clears
- no-death clear
- first course clear
- streak milestones

### Creator

- first published challenge
- first published course
- 10 unique players
- 100 unique players
- highly rated room
- highly rated course
- top-ranked creation

### Curator

- first rating
- 50 ratings
- 200 ratings
- consistent curator

### Community / Seasonal

- featured creation
- event winner
- seasonal participation

## WAMP Number

The sign-up order number is a strong identity flourish.

Recommended treatment:

- display it as a vanity identity marker
- make it visible on profile
- optionally show it on hover / expanded cards / leaderboards

This should not be a power source, only identity and status.

## Unlock Strategy

## Cosmetic Unlocks

Safe to tie to level:

- custom avatars
- profile frames
- chat flair
- badge display slots
- decorative UI flourishes

## Tool / Power Unlocks

These should not unlock from XP alone.

Examples:

- higher room-claim limits
- larger object budgets
- advanced editor tools
- stronger publish permissions

These should depend on a separate trust system.

## Trust System

Trust should be based on signals like:

- account age
- verified email / wallet
- long-term participation without abuse
- number of completed plays
- moderation history
- number of unique players on authored work
- rating quality of authored work

Early bootstrap option:

- allow a small set of elevated steward / moderator accounts to carry extra weighting when the community is still small
- reduce or remove that extra weight later if the organic signal becomes strong enough

Suggested trust bands:

- `Starter`
- `Builder`
- `Trusted Builder`
- `Steward`

Unlock examples:

| Trust Tier | Example Unlock |
| --- | --- |
| Builder | slightly higher claim cap |
| Trusted Builder | higher object and collectible budget, advanced tools |
| Steward | moderation-adjacent creator privileges, larger limits, stronger steering weight early on |

## Main Site vs Play.fun

This is an important product distinction.

### Main WAMP Site

Primary progression UI:

- XP bar
- level
- badges
- streaks
- trust / builder-trust status
- WAMP number

Points should be hidden or relegated to secondary surfaces.

### Play.fun Surface

Primary reward UI:

- points / `$WAMP`

Possible secondary UI:

- show XP lightly or not at all
- trust can remain mostly hidden or implicit
- still award XP and trust behind the scenes if desired

The same actions can feed both systems, but the UI emphasis differs.

## Data Model Direction

This PRD does not define final schema, but the likely model includes:

- `xp_events`
  - user_id
  - source_type
  - source_id
  - amount
  - multiplier_breakdown
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
  - total_xp
  - level
  - streak state
  - trust_score
  - trust tier
  - wamp_number
- `room_ratings`
  - user_id
  - room_id
  - lineage_key
  - stars_1_to_5
  - updated_at
- `course_ratings`
  - user_id
  - course_id
  - lineage_key
  - stars_1_to_5
  - updated_at
- `badge_awards`
  - user_id
  - badge_id
  - awarded_at
- `leaderboard_holding_rewards`
  - user_id
  - board_key
  - awarded_for_utc_day

Important:

- ratings should follow room/course lineage, not raw version number only
- creator rewards should count unique users per lineage
- top-spot holding rewards should be daily snapshots, not real-time ticking
- trust likely wants its own ledger or at least a separate aggregation path from XP

## UI Surfaces

Likely surfaces:

- profile modal / profile page
  - level
  - XP progress
  - WAMP number
  - featured badges
  - streaks
- post-run modal
  - star rating
  - difficulty rating
  - XP earned breakdown
- room/course cards
  - average stars
  - difficulty
  - creator badge snippets
- leaderboard modal
  - top holder markers
  - maybe crown for daily leader
- HUD
  - small XP gain toasts

## Rollout Plan

### Phase 1: XP and Levels

- implement XP event ledger
- implement total XP and levels
- add profile/header display
- no unlocks yet

### Phase 2: Ratings

- add 1-5 star ratings for rooms and courses
- allow rating after completion
- creator XP from ratings
- optional small quality multiplier

### Phase 3: Badges and WAMP Number

- add identity and basic accomplishment badges
- surface WAMP number

### Phase 4: Streaks

- add play streak and creator engagement streak
- apply small streak multiplier to eligible XP

### Phase 5: Leaderboard XP

- PB improvement XP
- top-spot daily holding XP

### Phase 6: Unlocks and Trust

- add cosmetic unlocks first
- later add trust-gated creation-power unlocks

## Anti-Abuse Rules

These should be designed in from the start.

- no self-rating
- rating only after completion
- creator XP based on unique users
- PB improvement threshold required
- daily caps on repeatable XP sources
- minimum account age / trust gates for certain creator-reward sources if needed
- minimum account age before ratings count fully
- account age / trust weighting on ratings and some creator-reward inputs
- anomaly review for bursts of brand-new accounts rating one room or creator
- early-phase steward / moderator weighting may help stabilize the system
- no heavy reward for room claiming
- no publish XP for empty rooms
- no trivial republish farming
- no uncapped reward source that can dominate the system through spending or spam

## Open Questions

1. Should XP be awarded behind the scenes on Play.fun even if not shown there?
2. Should room completion XP use the room's quality multiplier, or should that only affect creator XP?
3. Should courses and rooms use identical star systems, or should courses also get tags like `cohesive`, `creative`, `beautiful` later?
4. Which streaks are worth shipping first without creating pressure or spam?
5. Does WAMP number belong everywhere, or only on profile / expanded identity surfaces?
6. Which unlocks should be level-based, and which should be trust-based?
7. Should top-spot holding XP require a minimum competitor count or rating count to prevent empty-board farming?
8. What should the trust track be called in-product?
9. Should elevated steward / moderator accounts carry extra steering weight only during bootstrap, or permanently?
10. Which caps should trust-gate first: collectibles, placed objects, room claims, or some combination?

## Recommended MVP

If this needs to ship in the smallest high-value slice:

1. Add XP and levels.
2. Add room/course star ratings after completion.
3. Add creator XP from unique completions and ratings.
4. Define and ship the first trust-gated creator cap, likely collectibles or placed objects.
5. Add profile surfaces for badges/streak placeholders.
6. Add PB improvement XP.

That gives WAMP:

- progression
- creator reward
- quality feedback
- a reason to replay
- a reason to care about identity
- a path toward safer creator-cap expansion

without immediately committing to the full unlock/trust surface.
