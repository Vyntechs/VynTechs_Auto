create index messaging_consent_events_shop_customer_idx
on messaging_consent_events (shop_id, customer_id);
--> statement-breakpoint
create index messaging_consent_state_shop_customer_idx
on messaging_consent_state (shop_id, customer_id);
--> statement-breakpoint
create index messaging_consent_state_shop_source_event_idx
on messaging_consent_state (shop_id, source_event_id);
--> statement-breakpoint
create index messaging_deletion_work_items_parent_work_item_idx
on messaging_deletion_work_items (parent_work_item_id);
--> statement-breakpoint
create index messaging_deletion_work_items_shop_request_idx
on messaging_deletion_work_items (shop_id, request_id);
--> statement-breakpoint
create index messaging_retention_holds_shop_actor_idx
on messaging_retention_holds (shop_id, authorizing_actor_profile_id);
--> statement-breakpoint
create index quote_sends_shop_customer_idx
on quote_sends (shop_id, customer_id);
--> statement-breakpoint
create index sms_suppressions_shop_source_event_idx
on sms_suppressions (shop_id, source_event_id);
