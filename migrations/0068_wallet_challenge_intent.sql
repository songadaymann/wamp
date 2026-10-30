-- Existing sign-in proofs remain sign-in proofs; they cannot become wallet links.
ALTER TABLE wallet_challenges ADD COLUMN purpose TEXT NOT NULL DEFAULT 'sign_in'
  CHECK (purpose IN ('sign_in', 'link_wallet'));
ALTER TABLE wallet_challenges ADD COLUMN target_user_id TEXT;
ALTER TABLE wallet_challenges ADD COLUMN target_session_id TEXT;
