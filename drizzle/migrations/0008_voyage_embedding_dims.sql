-- Resize embedding column from 1536 (OpenAI text-embedding-3-small)
-- to 1024 (Voyage voyage-3, Anthropic's recommended embedding provider).
-- corpus_entries is empty at the time of this migration, so dropping
-- and recreating the column is safe.
DROP INDEX IF EXISTS "corpus_entries_embedding_idx";--> statement-breakpoint
ALTER TABLE "corpus_entries" DROP COLUMN "embedding";--> statement-breakpoint
ALTER TABLE "corpus_entries" ADD COLUMN "embedding" vector(1024);--> statement-breakpoint
CREATE INDEX "corpus_entries_embedding_idx" ON "corpus_entries" USING hnsw ("embedding" vector_cosine_ops);
