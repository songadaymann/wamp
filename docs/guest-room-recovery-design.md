# Guest Room Recovery Design

## Problem

Guest builders can make real work, leave, and later see traces of that work in the overworld without having a reliable way to recover, claim, or publish it. The current visible `BUILDING` state can come from PartyKit presence preview storage, which is useful for live world feedback but is not a durable product model for creative work.

The ideal behavior is:

- hold onto non-empty guest work durably
- recognize the same guest when they come back from the same browser profile
- strongly push them to sign up and publish
- if they cannot or will not sign up, give their work a secondary recovery/submission path instead of letting it vanish

## Current Behavior

Guest identity:

- `src/presence/worldPresence.ts` stores a guest identity in `localStorage` under `ep_presence_guest_identity_v1`.
- Returning from the same browser/profile normally reuses the same `guest-...` id and `Guest xxxx` display name.
- This identity is not secure ownership by itself because it is a client-side identifier and is sent through presence/activity systems.

Local editor recovery:

- `src/scenes/editor/roomSession.ts` can save unauthenticated drafts locally when a guest tries to save or publish.
- Local recovery only works from the same browser storage.
- Local recovery is compared against the remote room draft timestamp. For an unclaimed frontier room, the generated default remote record can make this recovery brittle.

PartyKit preview:

- `partykit/presenceServer.ts` stores shared room previews under the `preview:` storage prefix.
- Previews are loaded back into memory on server start.
- There is no age-based expiry in the current preview path.
- Browser close does not clear the persisted preview; explicit preview clearing only happens from an active connection that still has the preview.

So the game currently has a public-looking "someone built here" artifact without a matching durable guest draft and recovery flow.

## Product Model

Split the concepts cleanly:

- `presence preview`: live or recently-live visual world feedback. It may disappear.
- `guest draft`: durable, private-ish autosaved work owned by a returning browser guest.
- `signed draft`: canonical room draft owned by an authenticated user.
- `published room`: canonical public room in the world.
- `guest submission`: public fallback for a guest who cannot or will not sign up.

PartyKit should not be the storage of record for creative work. It should remain the live presence/preview layer.

## Desired UX

### While Building As Guest

When a guest places meaningful content:

- autosave the room snapshot to the backend as a guest draft
- keep localStorage as a backup cache
- show a restrained save status such as `Saved as guest`
- after a build threshold or manual save/publish attempt, show the existing guest-builder claim modal pattern with stronger copy:
  - primary: `Sign up and publish`
  - secondary: `Keep building`
  - later/escape hatch: `Submit as guest`

Do not block building before sign-up. Push at the moments where the work has value.

### Returning Guest

On boot, after guest identity resolution:

1. request recoverable guest drafts for this browser
2. if any non-empty drafts exist, show a modal or compact drawer:
   - "You have an unfinished room"
   - room coordinate/title/last edited time
   - preview thumbnail if cheap to render
3. primary action: `Sign up to save and publish`
4. secondary action: `Publish to Guest Rooms`
5. quiet escape: `Not now`

The copy should make ownership clear:

- signing up makes the room yours
- guest recovery only works from this browser
- guest submission may be visible publicly but is not the same as account ownership
- there is no top-level `Resume editing` escape from the returning prompt; editing resumes after the guest chooses the account publish path or the Guest Rooms path

### Returning Guest Nudge Modal

Use the existing nudge modal language from:

- `guest-builder-claim-modal`: focused builder conversion, strong account CTA, small "keep building" escape hatch, and per-room seen suppression.
- `run-guest-claim`: reward/progress framing, one strong save-progress CTA, one continue action, and delayed opening when reward stings are active.

The returning guest recovery modal should feel like the builder claim modal, not a new settings surface.

Visual structure:

- same `history-modal` shell and square pixel panel treatment as `guest-builder-claim-modal`
- kicker: `Saved Guest Room`
- title: `You left a room unfinished`
- meta: `Room 0,-8 - Last edited May 17`
- room preview image in the main visual slot
- fallback visual only if the snapshot cannot render: room coordinate and last edited time in the same framed slot
- concise body copy
- action row with one dominant green button and one or two quieter alternatives

First-return copy:

```txt
Your room is still saved for this browser. Sign in to make it yours and publish it in the world.

If you can't sign in, publish it to Guest Rooms. People can play it there, but guest-published rooms do not earn XP or account benefits.
```

First-return actions:

- primary green button: `Sign In To Publish`
- secondary blue button: `Publish To Guest Rooms`
- small text/link button: `Go To Room`

Publish-attempt copy:

```txt
This room is ready to share. Sign in to publish it as yours.

Can't sign in? Publish it to Guest Rooms instead. It can be played there, but it will not be owned, minted, tied to an account, or eligible for XP.
```

Publish-attempt actions:

- primary green button: `Sign In To Publish`
- secondary blue button: `Publish To Guest Rooms`
- small button: `Go To Room`

Multiple-draft copy:

```txt
You have saved guest rooms on this browser.
```

For multiple drafts, show a compact list with a small thumbnail, coordinate, title/fallback label, and last edited time. Selecting one opens the single-draft action state above.

Trigger rules:

- show after boot only when the overworld is stable and no welcome/reward modal is active
- show once per session automatically
- do not auto-show again for the same draft unless it changed meaningfully or at least 24 hours passed
- always show the stronger version on an explicit guest publish attempt
- do not show for blank snapshots

Action behavior:

- `Sign In To Publish`: opens the existing sign-in flow, then returns to claim the guest draft and open the editor in an account-owned publish flow.
- `Publish To Guest Rooms`: opens a short confirmation state explaining guest repository limits before submitting. If a pre-submit edit step is needed, it should be framed as editing the Guest Rooms submission, not continuing anonymous world-room building.
- `Go To Room`: closes the modal and warps to the saved room in the editor using the durable guest draft snapshot. The editor should continue to make the two destination choices prominent: sign in to publish, or publish to Guest Rooms.
- close: dismisses for the current session but keeps the draft.

Guest Rooms confirmation copy:

```txt
Guest Rooms lets people play this without an account. It will show your guest name, but you will not earn XP, profile credit, minting rights, or other account benefits.
```

Confirmation actions:

- primary: `Publish To Guest Rooms`
- secondary: `Back`

After the guest chooses either destination, the app can open the editor with the durable draft snapshot if the selected path needs last-minute edits. The important product rule is that the modal does not make indefinite guest editing the easiest path.

This keeps sign-up as the preferred path while still giving kids, school-device users, and temporary visitors a legitimate way to share the work.

### Publish Attempt As Guest

When a guest presses publish:

1. save latest snapshot as a guest draft
2. show the strongest signup prompt in the flow
3. if they decline, expose `Submit as guest`

The secondary path should exist because some builders will be kids, temporary visitors, school-device users, or people without email/wallet access.

### Coordinate Conflict

A guest draft does not permanently reserve its world coordinate.

If the original coordinate is still frontier when the guest signs up or submits:

- signed path can claim/publish at that coordinate
- guest submission can keep the coordinate as source metadata, and optionally display there if the product chooses that later

If the coordinate has since been claimed or published by someone else:

- keep the guest work recoverable
- explain that the original spot was taken
- offer to pick a new spot, save to account as an unplaced draft, or submit to guest rooms

This avoids giving anonymous browser state the power to block the world forever.

## Guest Rooms Repository

Guest rooms are the fallback path for good work that cannot become account-owned yet.

Recommended v1 behavior:

- guest submissions live outside canonical world ownership
- they are playable from a repository/list/detail route
- they show attribution like `Guest rlaq`
- they keep source coordinate metadata, but do not automatically claim the coordinate
- they are not mintable
- they do not grant XP, profile credit, minting rights, or other account benefits unless later claimed through an account-supported flow
- they can be hidden by admins/moderation
- they can be claimed later from the same browser token or by admin-assisted support

Potential surfaces:

- `Explore` modal tab: `Guest Rooms`
- room detail route: `/guest-rooms/:submissionId`
- admin queue: recent guest submissions, hide/promote controls

For safety, default to either lightweight moderation or strong abuse controls before making the repository prominent.

## Ownership And Recovery Token

Do not use `guestUserId` alone as the recovery secret.

Add a second browser-local secret:

- `guestUserId`: public-ish identity used for presence/activity display
- `guestRecoveryToken`: private random token used only for guest draft endpoints

Store only a hash of the recovery token server-side.

Suggested browser storage:

- keep the existing `ep_presence_guest_identity_v1`
- add `ep_guest_recovery_token_v1`

The backend should require both:

- guest user id, for indexing/display
- recovery token, for loading/updating/claiming private guest drafts

This is still not account-grade security, but it prevents anyone who merely sees `Guest rlaq` or `guest-...` from taking the draft.

## Data Model

Add a dedicated table for durable guest drafts.

```sql
CREATE TABLE guest_room_drafts (
  id TEXT PRIMARY KEY,
  guest_user_id TEXT NOT NULL,
  guest_display_name TEXT NOT NULL,
  recovery_token_hash TEXT NOT NULL,
  room_id TEXT NOT NULL,
  room_x INTEGER NOT NULL,
  room_y INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  title TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_seen_at TEXT,
  last_prompted_at TEXT,
  prompt_count INTEGER NOT NULL DEFAULT 0,
  claimed_by_user_id TEXT,
  claimed_room_id TEXT,
  claimed_at TEXT,
  submitted_at TEXT,
  hidden_at TEXT,
  hidden_by_user_id TEXT,
  moderation_status TEXT NOT NULL DEFAULT 'private'
);

CREATE INDEX idx_guest_room_drafts_guest_updated
  ON guest_room_drafts (guest_user_id, updated_at DESC);

CREATE INDEX idx_guest_room_drafts_room_active
  ON guest_room_drafts (room_id, status, updated_at DESC);

CREATE INDEX idx_guest_room_drafts_status_updated
  ON guest_room_drafts (status, updated_at DESC);
```

Status values:

- `active`: recoverable private guest draft
- `claimed`: copied into signed user room ownership
- `submitted`: public/semi-public guest repository item
- `discarded`: explicitly abandoned
- `hidden`: removed from public guest surfaces

If multiple guest drafts for the same guest/room become useful later, keep `id` as the stable handle and enforce uniqueness in application logic instead of a hard database unique constraint.

## API Shape

Guest draft endpoints:

- `PUT /api/guest-room-drafts/:roomId`
  - unauthenticated
  - requires guest user id, display name, recovery token, coordinates, snapshot
  - ignores blank snapshots
  - rate limited by guest id, token hash, session, and IP
  - returns draft id, updated time, status

- `GET /api/guest-room-drafts/mine`
  - unauthenticated
  - requires guest user id and recovery token
  - returns active/submitted drafts belonging to this browser guest

- `GET /api/guest-room-drafts/:draftId`
  - unauthenticated for owner token
  - admin authenticated for moderation
  - returns snapshot and metadata

- `DELETE /api/guest-room-drafts/:draftId`
  - owner token or admin
  - marks `discarded`

Claim endpoint:

- `POST /api/guest-room-drafts/:draftId/claim`
  - authenticated user required
  - owner recovery token required unless admin
  - if target coordinate is available, save/claim into `rooms`
  - if target coordinate is taken, return a conflict payload with recovery options
  - marks guest draft `claimed` after successful copy

Guest submission endpoint:

- `POST /api/guest-room-drafts/:draftId/submit`
  - owner recovery token required
  - Turnstile or equivalent abuse check recommended
  - marks draft `submitted`
  - creates public repository visibility if moderation allows

Repository endpoints:

- `GET /api/guest-room-submissions`
- `GET /api/guest-room-submissions/:draftId`
- `POST /api/admin/guest-room-submissions/:draftId/hide`
- `POST /api/admin/guest-room-submissions/:draftId/promote`

The implementation can use one table for both drafts and submissions at first. Split into `guest_room_submissions` only if public listing needs a different shape later.

## Frontend Integration

Editor:

- autosave guest snapshots to the guest draft API when unauthenticated
- keep existing local draft writes as fallback
- record the returned `guestDraftId` in memory/localStorage
- keep the current guest-builder prompt trigger, but make it point at the durable draft

Overworld:

- on boot, fetch `mine` for the current guest identity/recovery token
- show recovery UI when drafts exist
- `Build Here` on a room with a matching owned guest draft should open that draft
- a shared PartyKit preview owned by the same guest should also prefer opening the guest draft if available

Auth transition:

- after sign-up/sign-in, check for local guest drafts
- ask to attach them to the account
- run the claim endpoint for selected drafts

Explore:

- add `Guest Rooms` only after the backend submission path has abuse controls
- show playable submitted snapshots without implying permanent account ownership

## PartyKit Preview Changes

Presence previews should expire.

Recommended behavior:

- keep active in-memory previews while a builder is connected
- persist previews only as recent world hints
- expire stored previews after 24 hours by default, or 7 days if we want the world to look more actively built
- never rely on PartyKit preview storage for recovery

When `broadcastPopulations()` includes preview snapshots, it can include enough metadata for the UI to say:

- live editing now
- recently edited by a guest

But the editor should load from `guest_room_drafts`, local draft storage, or canonical `rooms`, not from stale PartyKit preview state.

## Retention

Recommended v1 retention:

- non-empty active guest drafts: keep indefinitely until a formal data-retention policy exists
- blank drafts: do not save
- discarded drafts: purge after 30 days
- hidden/abusive submissions: retain only as long as needed for moderation/audit
- PartyKit presence previews: expire separately and aggressively

This matches the product goal: creative work should survive; live presence artifacts should not linger forever.

## Abuse And Safety

Guest submissions are public UGC without account identity, so they need guardrails:

- maximum active drafts per guest and per IP
- minimum meaningful content before server save
- snapshot size and object count limits
- profanity/link checks for title/sign text if present
- Turnstile or similar check before public guest submission
- admin hide/delete controls
- do not award XP, marketplace value, or minting rights to anonymous submissions

If school/kid usage becomes explicit, copy should avoid "email required" assumptions and emphasize "save to an account" rather than wallet language.

## Rollout Plan

### Phase 1: Durable Guest Autosave And Recovery

- add `guest_room_drafts` migration
- add worker store/routes for saving, listing, loading, and discarding owned guest drafts
- add browser recovery token generation
- send guest autosaves from the editor
- fetch recoverable drafts on boot and show a recovery prompt
- expire old PartyKit previews so stale world hints stop lasting forever

Phase 1 is enough to stop losing work.

### Phase 2: Signup Claim Flow

- after sign-in, detect local guest drafts
- add `claim` endpoint to copy guest drafts into signed room ownership
- handle coordinate conflicts explicitly
- update the guest-builder claim modal copy/actions around this flow

Phase 2 is enough to convert returning guest builders into account-owned creators.

### Phase 3: Guest Rooms Repository

- add `submit as guest`
- add repository list/detail/play surfaces
- add admin moderation controls
- decide whether guest submissions can later be promoted into canonical world rooms

Phase 3 is the fallback for people who cannot or will not sign up.

### Phase 4: Admin And Analytics

- show active guest drafts/submissions in launch admin
- connect guest draft activity to existing `guest_visits`
- add metrics for guest draft saves, returns, claims, submissions, and signup conversion

## Open Questions

- Should guest submissions appear in the overworld, or only in a separate guest repository?
- Should public guest submissions be immediate, queued for moderation, or soft-public until reviewed?
- How long should a same-browser guest be able to claim a submitted room into a new account?
- Should a guest draft on a taken coordinate open directly into "choose a new spot" or into the editor first?
- Should the first implementation include thumbnail rendering, or just text metadata?

## Suggested Acceptance Criteria

- A guest can build meaningful content, close the browser, return later from the same browser profile, and recover the room from the backend.
- A guest recovery prompt strongly favors sign-up and publish.
- If the guest signs in, the guest draft can be attached to their account or moved to a new coordinate if the original spot is taken.
- If the guest refuses sign-up, the room can be submitted through a guest fallback path without becoming a minted/account-owned room.
- PartyKit previews no longer persist indefinitely as the only evidence of guest work.
