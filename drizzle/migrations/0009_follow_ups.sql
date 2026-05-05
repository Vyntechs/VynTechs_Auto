-- Phase R — comeback follow-up automation. Two rows are inserted per
-- closed session (7d + 30d). A daily cron flips surfaced_at when due_at
-- passes; a tech resolution flips resolved_at + comeback_recorded.
-- comeback_recorded = true triggers recordCorpusComeback() which decays
-- matching corpus entries.
CREATE TABLE "follow_ups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"shop_id" uuid NOT NULL,
	"tech_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"surfaced_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"comeback_recorded" boolean,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_tech_id_profiles_id_fk" FOREIGN KEY ("tech_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "follow_ups_session_id_idx" ON "follow_ups" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "follow_ups_shop_id_idx" ON "follow_ups" USING btree ("shop_id");--> statement-breakpoint
CREATE INDEX "follow_ups_tech_id_idx" ON "follow_ups" USING btree ("tech_id");--> statement-breakpoint
CREATE INDEX "follow_ups_due_at_idx" ON "follow_ups" USING btree ("due_at");
