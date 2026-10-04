-- The copy, ownership and guest receipt are committed together, once per saved guest draft.
CREATE TABLE guest_room_draft_claims (
  guest_draft_id TEXT PRIMARY KEY REFERENCES guest_room_drafts(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  room_id TEXT NOT NULL,
  claimed_at TEXT NOT NULL,
  applied INTEGER NOT NULL DEFAULT 0 CHECK(applied IN (0, 1)),
  eligible INTEGER NOT NULL CONSTRAINT guest_draft_claim_eligible CHECK(eligible = 1)
);
CREATE INDEX idx_guest_room_draft_claims_user ON guest_room_draft_claims(user_id, claimed_at);

-- Ephemeral checks used inside the same batch as a room mutation. Failed checks roll it back.
CREATE TABLE room_mutation_checks (
  id TEXT PRIMARY KEY,
  owner_matches INTEGER NOT NULL CONSTRAINT room_mutation_owner CHECK(owner_matches = 1),
  frontier_matches INTEGER NOT NULL CONSTRAINT room_mutation_frontier CHECK(frontier_matches = 1),
  quota_available INTEGER NOT NULL CONSTRAINT room_mutation_claim_quota CHECK(quota_available = 1)
);
