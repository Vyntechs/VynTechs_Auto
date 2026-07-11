ALTER TABLE sessions
  ADD COLUMN adaptive_diagnostic_state jsonb,
  ADD COLUMN adaptive_revision bigint NOT NULL DEFAULT 0;

ALTER TABLE sessions
  ADD CONSTRAINT sessions_adaptive_diagnostic_state_object
  CHECK (
    adaptive_diagnostic_state IS NULL
    OR jsonb_typeof(adaptive_diagnostic_state) = 'object'
  );

ALTER TABLE session_events
  ADD COLUMN request_key uuid,
  ADD COLUMN request_actor_profile_id uuid REFERENCES profiles(id) ON DELETE RESTRICT,
  ADD COLUMN request_fingerprint text;

ALTER TABLE session_events
  ADD CONSTRAINT session_events_request_actor_pair
  CHECK (
    (request_key IS NULL AND request_actor_profile_id IS NULL AND request_fingerprint IS NULL)
    OR (request_key IS NOT NULL AND request_actor_profile_id IS NOT NULL AND request_fingerprint IS NOT NULL)
  );

CREATE UNIQUE INDEX session_events_session_actor_request_key_uq
  ON session_events (session_id, request_actor_profile_id, request_key)
  WHERE request_key IS NOT NULL;
