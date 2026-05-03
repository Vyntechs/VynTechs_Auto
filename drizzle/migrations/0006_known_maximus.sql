CREATE TABLE "corpus_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_year" integer NOT NULL,
	"vehicle_make" text NOT NULL,
	"vehicle_model" text NOT NULL,
	"vehicle_engine" text,
	"build_date_start" text,
	"build_date_end" text,
	"symptom_tags" text[] DEFAULT '{}' NOT NULL,
	"dtcs" text[] DEFAULT '{}' NOT NULL,
	"freeze_frame_pattern" jsonb,
	"root_cause" text NOT NULL,
	"summary" text NOT NULL,
	"action_type" text NOT NULL,
	"part_info" jsonb,
	"verification" jsonb NOT NULL,
	"source_shop_id" uuid,
	"source_session_id" uuid,
	"curated_by_user_id" uuid,
	"success_confirm_count" integer DEFAULT 0 NOT NULL,
	"comeback_recorded_count" integer DEFAULT 0 NOT NULL,
	"confidence_score" real DEFAULT 0.5 NOT NULL,
	"is_curator_entry" boolean DEFAULT false NOT NULL,
	"is_retired" boolean DEFAULT false NOT NULL,
	"embedding" extensions.vector(1536),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "corpus_entries" ADD CONSTRAINT "corpus_entries_source_shop_id_shops_id_fk" FOREIGN KEY ("source_shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corpus_entries" ADD CONSTRAINT "corpus_entries_source_session_id_sessions_id_fk" FOREIGN KEY ("source_session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corpus_entries" ADD CONSTRAINT "corpus_entries_curated_by_user_id_profiles_id_fk" FOREIGN KEY ("curated_by_user_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "corpus_entries_embedding_idx" ON "corpus_entries" USING hnsw ("embedding" extensions.vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "corpus_entries_vehicle_idx" ON "corpus_entries" ("vehicle_make", "vehicle_model", "vehicle_year");--> statement-breakpoint
CREATE INDEX "corpus_entries_dtcs_idx" ON "corpus_entries" USING GIN ("dtcs");--> statement-breakpoint
CREATE INDEX "corpus_entries_symptom_tags_idx" ON "corpus_entries" USING GIN ("symptom_tags");