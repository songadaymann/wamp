-- Where a visit came from, kept from its first heartbeat (F127). The existing referrer column only
-- ever held WAMP's own origin, because the heartbeat is a cross-origin request.
ALTER TABLE guest_visits ADD COLUMN first_landing_path TEXT;
ALTER TABLE guest_visits ADD COLUMN first_referrer_host TEXT;
ALTER TABLE guest_visits ADD COLUMN first_source TEXT;
CREATE INDEX IF NOT EXISTS idx_guest_visits_first_seen ON guest_visits (first_seen_at);

-- Which guest identity, and so which first visit, an account grew out of.
ALTER TABLE users ADD COLUMN signup_guest_user_id TEXT;
ALTER TABLE users ADD COLUMN signup_source TEXT;
CREATE INDEX IF NOT EXISTS idx_users_signup_guest ON users (signup_guest_user_id) WHERE signup_guest_user_id IS NOT NULL;
