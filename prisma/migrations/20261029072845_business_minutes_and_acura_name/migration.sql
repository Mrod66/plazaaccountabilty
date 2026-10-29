-- Medians in business time; "Plaza Acura" is "Acura of Brooklyn".
BEGIN;

-- AlterTable
ALTER TABLE "case_events" ADD COLUMN     "elapsed_min" INTEGER;

-- AlterTable
ALTER TABLE "cases" ADD COLUMN     "first_contact_min" INTEGER;

-- CreateIndex
CREATE INDEX "case_events_kind_elapsed_min_idx" ON "case_events"("kind", "elapsed_min");

-- CreateIndex
CREATE INDEX "cases_first_contact_min_first_contact_at_idx" ON "cases"("first_contact_min", "first_contact_at");

-- The store's name (its short label stays "Acura").
UPDATE "stores" SET "name" = 'Acura of Brooklyn', "updated_at" = CURRENT_TIMESTAMP
WHERE "short_name" = 'Acura' AND "name" = 'Plaza Acura';

COMMIT;
