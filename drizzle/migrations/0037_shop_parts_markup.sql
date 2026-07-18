-- drizzle/migrations/0037_shop_parts_markup.sql
--
-- shops.parts_markup_bps — the shop's default parts markup in basis points
-- (4000 = 40%). Management sets it once in Settings -> Shop; the part-sourcing
-- flow uses it to suggest a customer price from the supplier cost so techs and
-- advisors never have to invent a retail number. Nullable: a shop that has not
-- set a markup keeps today's behavior (customer price typed by hand).
--
-- Additive only: new nullable column, no backfill, no data path can break.
-- Bounded 0..100000 bps (0%..1000%) to match the schema check constraint.
-- Rollback = revert this migration; the column + constraint stay (harmless).

alter table shops
  add column parts_markup_bps integer,
  add constraint shops_parts_markup_bps_range check (
    parts_markup_bps is null or parts_markup_bps between 0 and 100000
  );
