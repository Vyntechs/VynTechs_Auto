-- drizzle/migrations/0013_founder_knowledge_base.sql
--
-- Founder knowledge base. Two changes:
--
-- 1. corpus_entries.entry_source — provenance tag distinguishing
--    'founder' (highest source of truth, vetted by shop owner) from
--    'curator' (curator-authored) and 'auto_promoted' (lifted from a
--    closed session). Used by retrieveCorpus to surface founder entries
--    above all others, and by the tree-engine prompt to tell Claude
--    which matches it should trust the most.
--
--    Backfill: existing rows with is_curator_entry=true become 'curator';
--    everything else becomes 'auto_promoted'. is_curator_entry stays as
--    the legacy bool — entry_source is the new canonical field.
--
-- 2. founder_notes_queue — every founder-submitted free-form note lands
--    here first. The structuring LLM may produce a partial draft; the
--    founder reviews each row and either promotes it (insert into
--    corpus_entries with entry_source='founder', confidence_score=0.95)
--    or dismisses it. Mirrors novel_pattern_queue's lifecycle pattern.

ALTER TABLE corpus_entries
  ADD COLUMN entry_source text NOT NULL DEFAULT 'auto_promoted'
    CHECK (entry_source IN ('founder','curator','auto_promoted'));
--> statement-breakpoint
UPDATE corpus_entries SET entry_source = 'curator' WHERE is_curator_entry = true;
--> statement-breakpoint
CREATE INDEX corpus_entries_entry_source_idx ON corpus_entries (entry_source)
  WHERE is_retired = false;
--> statement-breakpoint
CREATE TABLE founder_notes_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_text text NOT NULL,
  structured_draft jsonb,
  parse_status text NOT NULL DEFAULT 'failed'
    CHECK (parse_status IN ('parsed','partial','failed')),
  missing_fields text[] NOT NULL DEFAULT '{}',
  llm_notes text,
  created_by_user_id uuid REFERENCES profiles(id),
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  reviewed_at timestamp with time zone,
  reviewed_decision text CHECK (reviewed_decision IN ('promoted','dismissed')),
  reviewed_by_user_id uuid REFERENCES profiles(id),
  reviewed_note text,
  resulting_corpus_entry_id uuid REFERENCES corpus_entries(id) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX founder_notes_queue_pending_idx ON founder_notes_queue (created_at DESC)
  WHERE reviewed_at IS NULL;
--> statement-breakpoint
ALTER TABLE founder_notes_queue ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "founder_notes_queue_curator_only" ON founder_notes_queue
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.user_id = auth.uid()
      AND profiles.role IN ('curator','owner')
    )
  );
