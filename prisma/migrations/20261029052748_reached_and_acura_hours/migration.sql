-- Plaza Accountability Hub: "reached the customer" apart from "attempted only"; Acura's sales hours.
BEGIN;

-- AlterTable
ALTER TABLE "cases" ADD COLUMN     "reached_at" TIMESTAMP(3);

-- Cases already contacted: when the customer was first actually reached.
UPDATE "cases" c SET "reached_at" = (
  SELECT MIN(e."created_at") FROM "case_events" e
  WHERE e."case_id" = c."id" AND e."kind" = 'contacted' AND e."result" = 'reached'
)
WHERE c."reached_at" IS NULL AND c."first_contact_at" IS NOT NULL;

-- Acura sales: Mon–Thu 9 AM–8 PM, Fri–Sat 9 AM–7 PM, Sun 11 AM–5 PM (from the owner).
DELETE FROM "business_hours" h USING "stores" s
WHERE h."store_id" = s."id" AND s."short_name" = 'Acura' AND h."department" = 'sales';
INSERT INTO "business_hours" ("store_id", "department", "weekday", "open_min", "close_min")
SELECT s."id", 'sales', d.weekday, d.open_min, d.close_min
FROM "stores" s
CROSS JOIN (VALUES (1, 540, 1200), (2, 540, 1200), (3, 540, 1200), (4, 540, 1200), (5, 540, 1140), (6, 540, 1140), (0, 660, 1020))
  AS d(weekday, open_min, close_min)
WHERE s."short_name" = 'Acura';

COMMIT;
