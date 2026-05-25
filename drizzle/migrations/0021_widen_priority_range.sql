-- 0021_widen_priority_range.sql
--
-- Widen symptom_test_implications priority range from 1-10 to 1-20.
-- The original CHECK (priority BETWEEN 1 AND 10) assumed <=10 tests per symptom.
-- The 6.0 PSD cranks-no-start seed has 11 canonical tests (priority 11 needed).
-- Hand-written per established convention (drizzle-kit broken since 0011b).

ALTER TABLE "symptom_test_implications" DROP CONSTRAINT "symptom_test_implications_priority_range";
--> statement-breakpoint
ALTER TABLE "symptom_test_implications" ADD CONSTRAINT "symptom_test_implications_priority_range" CHECK ("priority" BETWEEN 1 AND 20);
