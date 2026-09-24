ALTER TABLE "companies" ADD COLUMN "billing_pricing_mode" text DEFAULT 'passthrough' NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "billing_markup_percent" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "billing_byok_fee_per_million_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "hide_internal_cost_from_client" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "cost_events" ADD COLUMN "simulated_cost_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "cost_events" ADD COLUMN "billable_cents" integer DEFAULT 0 NOT NULL;