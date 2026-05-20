-- Add cache-hit FK columns to sessions for Phase 3 PR 1.
-- Both nullable: cache-hit sessions populate these; cache-miss + legacy sessions leave them NULL.
-- ON DELETE SET NULL so a platform/symptom row can be retired without losing the session record.

ALTER TABLE "sessions"
  ADD COLUMN "cache_hit_platform_id" uuid REFERENCES "platforms"("id") ON DELETE SET NULL,
  ADD COLUMN "cache_hit_symptom_id" uuid REFERENCES "symptoms"("id") ON DELETE SET NULL;

CREATE INDEX "sessions_cache_hit_symptom_id_idx" ON "sessions" USING btree ("cache_hit_symptom_id");
