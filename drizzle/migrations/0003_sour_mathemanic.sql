CREATE TABLE "tech_assist_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"node_id" text NOT NULL,
	"gap_description" text NOT NULL,
	"requested_artifact_kind" text NOT NULL,
	"request_prompt" text NOT NULL,
	"follow_up_count" integer DEFAULT 0 NOT NULL,
	"resolved" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tech_assist_requests" ADD CONSTRAINT "tech_assist_requests_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;