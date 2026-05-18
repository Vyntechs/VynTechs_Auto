-- drizzle/migrations/0015_knowledge_dtc_subcodes.sql
--
-- Root B (DTC) — preserve the sub-code "failure type byte" tail (e.g. "00",
-- "11") as orthogonal metadata. The library-identity key remains the bare
-- canonical DTC stored in dtc_list; this column holds a sparse map of
-- bare_code → tail for the codes on this item that arrived with a tail.
--
-- Shape: { "P0420": "00", "P0430": "11" }
-- Codes without a tail are simply absent from the map; we do not store nulls.
-- No data backfill — existing rows get NULL, which is the correct "no
-- sub-codes" empty value.

ALTER TABLE knowledge_items
  ADD COLUMN dtc_sub_codes jsonb;
