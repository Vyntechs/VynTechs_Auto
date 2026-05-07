-- drizzle/migrations/0011_drift_alerts_lifecycle.sql
--
-- Phase P — drift_alerts lifecycle fields + novel_pattern_queue table.
-- Lets the curator mark recommendations as 'applied' or 'dismissed' with
-- audit-trail fields, and surfaces sessions where retrieval found no
-- corpus matches above the similarity floor.

ALTER TABLE drift_alerts
  ADD COLUMN decision text CHECK (decision IN ('applied','dismissed')),
  ADD COLUMN decided_at timestamp with time zone,
  ADD COLUMN decided_by_user_id uuid REFERENCES profiles(id),
  ADD COLUMN decision_note text;
--> statement-breakpoint
CREATE INDEX drift_alerts_pending_idx ON drift_alerts (created_at DESC)
  WHERE decision IS NULL;
--> statement-breakpoint
CREATE TABLE novel_pattern_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  max_retrieval_similarity real NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  reviewed_at timestamp with time zone,
  reviewed_decision text CHECK (reviewed_decision IN ('corpus','dismissed')),
  reviewed_by_user_id uuid REFERENCES profiles(id),
  reviewed_note text
);
--> statement-breakpoint
CREATE INDEX novel_pattern_queue_pending_idx ON novel_pattern_queue (created_at DESC)
  WHERE reviewed_at IS NULL;
--> statement-breakpoint
ALTER TABLE novel_pattern_queue ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "novel_pattern_queue_curator_only" ON novel_pattern_queue
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.user_id = auth.uid()
      AND profiles.role = 'curator'
    )
  );
