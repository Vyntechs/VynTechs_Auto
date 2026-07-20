-- Supports bounded newest-job reads per tenant-scoped repair order.
create index ticket_jobs_shop_ticket_created_idx
  on public.ticket_jobs (shop_id, ticket_id, created_at desc, id desc);
