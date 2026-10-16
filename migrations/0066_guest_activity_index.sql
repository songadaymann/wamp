-- Guest drill-down uses the existing identity, without a new public identity table.
CREATE INDEX idx_builder_activity_guest_actor
  ON builder_activity(actor_user_id, id DESC) WHERE source_kind = 'guest';
