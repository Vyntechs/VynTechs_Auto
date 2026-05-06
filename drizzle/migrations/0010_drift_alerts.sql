-- Phase Q — calibration drift alerts. Append-only log written by the weekly
-- calibration cron (app/api/cron/calibration-weekly/route.ts) when a per-cell
-- threshold moves by ≥5 points and the sample size is adequate. The curator
-- drift dashboard reads this table to surface cells where the AI's
-- calibration has shifted (corpus-quality signal).
CREATE TABLE "drift_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"risk_class" text NOT NULL,
	"vehicle_family" text NOT NULL,
	"symptom_class" text NOT NULL,
	"old_threshold" real NOT NULL,
	"new_threshold" real NOT NULL,
	"comeback_rate" real NOT NULL,
	"sample_size" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
