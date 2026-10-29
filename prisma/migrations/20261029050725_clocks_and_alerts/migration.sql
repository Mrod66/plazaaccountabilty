-- Plaza Accountability Hub, Phase 2: clocks, business hours, alerts and the email log.
BEGIN;

-- AlterTable
ALTER TABLE "staff" ADD COLUMN     "alert_mode" VARCHAR(10) NOT NULL DEFAULT 'batched';

-- CreateTable
CREATE TABLE "business_hours" (
    "store_id" INTEGER NOT NULL,
    "department" VARCHAR(16) NOT NULL,
    "weekday" SMALLINT NOT NULL,
    "open_min" SMALLINT NOT NULL,
    "close_min" SMALLINT NOT NULL,

    CONSTRAINT "business_hours_pkey" PRIMARY KEY ("store_id","department","weekday")
);

-- CreateTable
CREATE TABLE "clock_settings" (
    "org_id" INTEGER NOT NULL,
    "case_type" VARCHAR(8) NOT NULL,
    "kind" VARCHAR(10) NOT NULL,
    "amount" INTEGER NOT NULL,
    "unit" VARCHAR(8) NOT NULL,

    CONSTRAINT "clock_settings_pkey" PRIMARY KEY ("org_id","case_type","kind")
);

-- CreateTable
CREATE TABLE "case_clocks" (
    "id" SERIAL NOT NULL,
    "case_id" INTEGER NOT NULL,
    "kind" VARCHAR(10) NOT NULL,
    "owner_id" INTEGER NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "due_at" TIMESTAMP(3) NOT NULL,
    "status" VARCHAR(10) NOT NULL DEFAULT 'running',
    "done_at" TIMESTAMP(3),
    "missed_at" TIMESTAMP(3),
    "escalate_at" TIMESTAMP(3),
    "escalated_at" TIMESTAMP(3),
    "escalated_to" INTEGER,
    "overdue_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "case_clocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" BIGSERIAL NOT NULL,
    "org_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "case_id" INTEGER NOT NULL,
    "kind" VARCHAR(16) NOT NULL,
    "message" VARCHAR(200) NOT NULL,
    "dedupe_key" VARCHAR(64),
    "escalation" BOOLEAN NOT NULL DEFAULT false,
    "read_at" TIMESTAMP(3),
    "email_state" VARCHAR(10) NOT NULL DEFAULT 'pending',
    "emailed_at" TIMESTAMP(3),
    "capped_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_log" (
    "id" BIGSERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "status" VARCHAR(10) NOT NULL,
    "items" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "case_clocks_case_id_kind_idx" ON "case_clocks"("case_id", "kind");

-- CreateIndex
CREATE INDEX "case_clocks_status_due_at_idx" ON "case_clocks"("status", "due_at");

-- CreateIndex
CREATE INDEX "case_clocks_status_escalate_at_idx" ON "case_clocks"("status", "escalate_at");

-- CreateIndex
CREATE INDEX "case_clocks_status_overdue_at_idx" ON "case_clocks"("status", "overdue_at");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_dedupe_key_key" ON "notifications"("dedupe_key");

-- CreateIndex
CREATE INDEX "notifications_user_id_id_idx" ON "notifications"("user_id", "id");

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_idx" ON "notifications"("user_id", "read_at");

-- CreateIndex
CREATE INDEX "notifications_email_state_user_id_idx" ON "notifications"("email_state", "user_id");

-- CreateIndex
CREATE INDEX "notifications_case_id_idx" ON "notifications"("case_id");

-- CreateIndex
CREATE INDEX "email_log_user_id_created_at_idx" ON "email_log"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "email_log_created_at_idx" ON "email_log"("created_at");

-- AddForeignKey
ALTER TABLE "business_hours" ADD CONSTRAINT "business_hours_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_clocks" ADD CONSTRAINT "case_clocks_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Default business hours (Eastern), editable in Admin → Clocks and hours.
-- Sales: Mon–Fri 9 AM–9 PM, Sat 9 AM–7 PM, Sun 11 AM–5 PM.
-- Service (stores that have one): Mon–Fri 7:30 AM–6 PM, Sat 8 AM–4 PM, closed Sunday.
INSERT INTO "business_hours" ("store_id", "department", "weekday", "open_min", "close_min")
SELECT s."id", h.department, h.weekday, h.open_min, h.close_min
FROM "stores" s
CROSS JOIN (VALUES
  ('sales', 1, 540, 1260), ('sales', 2, 540, 1260), ('sales', 3, 540, 1260), ('sales', 4, 540, 1260), ('sales', 5, 540, 1260),
  ('sales', 6, 540, 1140), ('sales', 0, 660, 1020),
  ('service', 1, 450, 1080), ('service', 2, 450, 1080), ('service', 3, 450, 1080), ('service', 4, 450, 1080), ('service', 5, 450, 1080),
  ('service', 6, 480, 960)
) AS h(department, weekday, open_min, close_min)
WHERE h.department = 'sales' OR s."has_service"
ON CONFLICT DO NOTHING;

-- Default clocks (build prompt section 7), business time. Editable in Admin.
INSERT INTO "clock_settings" ("org_id", "case_type", "kind", "amount", "unit")
SELECT o."id", c.case_type, c.kind, c.amount, c.unit
FROM "organizations" o
CROSS JOIN (VALUES
  ('hot', 'accept', 15, 'minutes'), ('hot', 'contact', 1, 'hours'), ('hot', 'close', 2, 'days'),
  ('hot', 'escalate', 30, 'minutes'), ('hot', 'overdue', 2, 'days'),
  ('csi', 'accept', 1, 'hours'), ('csi', 'contact', 4, 'hours'), ('csi', 'close', 2, 'days'),
  ('csi', 'escalate', 2, 'hours'), ('csi', 'overdue', 2, 'days')
) AS c(case_type, kind, amount, unit)
ON CONFLICT DO NOTHING;

COMMIT;
