ALTER TABLE "issues" ADD COLUMN "last_activity_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
UPDATE "issues" SET "last_activity_at" = "updated_at" WHERE "updated_at" > "created_at";--> statement-breakpoint
CREATE INDEX "issues_company_last_activity_idx" ON "issues" USING btree ("company_id","last_activity_at" DESC NULLS LAST);--> statement-breakpoint
CREATE OR REPLACE FUNCTION paperclip_sync_issue_last_activity()
RETURNS trigger AS $$
BEGIN
	IF NEW."updated_at" > NEW."last_activity_at" THEN
		NEW."last_activity_at" := NEW."updated_at";
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER IF EXISTS paperclip_issue_last_activity_trigger ON "issues";--> statement-breakpoint
CREATE TRIGGER paperclip_issue_last_activity_trigger
BEFORE UPDATE ON "issues"
FOR EACH ROW EXECUTE FUNCTION paperclip_sync_issue_last_activity();--> statement-breakpoint
CREATE OR REPLACE FUNCTION paperclip_touch_issue_comment_last_activity()
RETURNS trigger AS $$
BEGIN
	UPDATE "issues"
	SET "last_activity_at" = GREATEST("last_activity_at", NEW."created_at")
	WHERE "id" = NEW."issue_id";
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER IF EXISTS paperclip_issue_comment_last_activity_trigger ON "issue_comments";--> statement-breakpoint
CREATE TRIGGER paperclip_issue_comment_last_activity_trigger
AFTER INSERT ON "issue_comments"
FOR EACH ROW EXECUTE FUNCTION paperclip_touch_issue_comment_last_activity();--> statement-breakpoint
CREATE OR REPLACE FUNCTION paperclip_touch_activity_log_issue_last_activity()
RETURNS trigger AS $$
BEGIN
	IF NEW."entity_type" = 'issue' AND NEW."action" NOT IN ('issue.read_marked', 'issue.read_unmarked', 'issue.inbox_archived', 'issue.inbox_unarchived') THEN
		BEGIN
			UPDATE "issues"
			SET "last_activity_at" = GREATEST("last_activity_at", NEW."created_at")
			WHERE "id" = NEW."entity_id"::uuid;
		EXCEPTION
			WHEN invalid_text_representation THEN
				NULL;
		END;
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER IF EXISTS paperclip_activity_log_issue_last_activity_trigger ON "activity_log";--> statement-breakpoint
CREATE TRIGGER paperclip_activity_log_issue_last_activity_trigger
AFTER INSERT ON "activity_log"
FOR EACH ROW EXECUTE FUNCTION paperclip_touch_activity_log_issue_last_activity();