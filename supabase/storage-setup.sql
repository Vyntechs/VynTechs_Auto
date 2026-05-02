-- Vyntechs Storage bucket bootstrap.
-- Apply once per fresh Supabase project (or after a project reset). Idempotent.
-- Storage schema is not managed by Drizzle, so this file is the canonical source of truth
-- for bucket creation.

INSERT INTO storage.buckets (id, name, public)
VALUES ('artifacts', 'artifacts', false)
ON CONFLICT (id) DO NOTHING;
