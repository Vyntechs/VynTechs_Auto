-- drizzle/migrations/0011b_session_max_corpus_similarity.sql
--
-- Phase P task 13 (inert-feature fix) — persists the highest corpus retrieval
-- similarity score observed across all advance calls for a session. Written
-- incrementally during /advance (GREATEST(COALESCE(…,0), newMax)) and read at
-- /close to decide whether the session is a novel-pattern candidate.
-- Column is nullable; existing rows are unaffected.
--
-- DO NOT apply to prod yet — the controller handles migration execution.

ALTER TABLE sessions
  ADD COLUMN max_corpus_similarity real;
