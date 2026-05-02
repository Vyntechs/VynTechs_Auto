CREATE TABLE "confidence_calibration" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"risk_class" text NOT NULL,
	"vehicle_family" text NOT NULL,
	"symptom_class" text NOT NULL,
	"threshold_pct" real NOT NULL,
	"sample_size" integer DEFAULT 0 NOT NULL,
	"comeback_rate" real DEFAULT 0 NOT NULL,
	"last_refit_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
