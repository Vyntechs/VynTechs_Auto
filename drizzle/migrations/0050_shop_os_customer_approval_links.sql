alter table quote_sends drop constraint quote_sends_channel_valid;
--> statement-breakpoint
alter table quote_sends add constraint quote_sends_channel_valid
check (channel in ('sms', 'link'));
--> statement-breakpoint
alter table quote_sends add constraint quote_sends_link_state_consistent
check (
  channel <> 'link'
  or (
    fingerprint_key_version = 'link_v1'
    and (
      (state = 'submitted' and token_hash is not null and token_expires_at is not null)
      or (state in ('responded', 'expired') and token_hash is null and token_expires_at is null)
    )
  )
);
--> statement-breakpoint
create unique index quote_sends_active_link_token_uq
on quote_sends (token_hash)
where channel = 'link' and token_hash is not null;
--> statement-breakpoint
create index quote_sends_link_request_fingerprint_idx
on quote_sends (request_fingerprint)
where channel = 'link';
--> statement-breakpoint
create unique index quote_sends_shop_ticket_version_submitted_link_uq
on quote_sends (shop_id, ticket_id, quote_version_id)
where channel = 'link' and state = 'submitted';
