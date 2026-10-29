-- Plaza Accountability Hub, Phase 1: organizations, stores, staff, cases and their history.
-- One transaction: if any statement fails, none apply (docs/agent/database.md).
BEGIN;

-- CreateTable
CREATE TABLE "organizations" (
    "id" SERIAL NOT NULL,
    "slug" VARCHAR(48) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "time_zone" VARCHAR(48) NOT NULL DEFAULT 'America/New_York',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stores" (
    "id" SERIAL NOT NULL,
    "org_id" INTEGER NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "short_name" VARCHAR(32) NOT NULL,
    "manufacturer" VARCHAR(32) NOT NULL,
    "has_service" BOOLEAN NOT NULL DEFAULT true,
    "address" VARCHAR(200),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff" (
    "user_id" INTEGER NOT NULL,
    "org_id" INTEGER NOT NULL,
    "first_name" VARCHAR(40) NOT NULL,
    "last_name" VARCHAR(40) NOT NULL,
    "department" VARCHAR(16) NOT NULL DEFAULT 'sales',
    "manager_user_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "staff_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "staff_stores" (
    "user_id" INTEGER NOT NULL,
    "store_id" INTEGER NOT NULL,

    CONSTRAINT "staff_stores_pkey" PRIMARY KEY ("user_id","store_id")
);

-- CreateTable
CREATE TABLE "store_routes" (
    "store_id" INTEGER NOT NULL,
    "kind" VARCHAR(16) NOT NULL,
    "user_id" INTEGER NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "store_routes_pkey" PRIMARY KEY ("store_id","kind")
);

-- CreateTable
CREATE TABLE "case_counters" (
    "org_id" INTEGER NOT NULL,
    "type" VARCHAR(8) NOT NULL,
    "next" INTEGER NOT NULL,

    CONSTRAINT "case_counters_pkey" PRIMARY KEY ("org_id","type")
);

-- CreateTable
CREATE TABLE "cases" (
    "id" SERIAL NOT NULL,
    "org_id" INTEGER NOT NULL,
    "number" VARCHAR(16) NOT NULL,
    "type" VARCHAR(8) NOT NULL,
    "store_id" INTEGER NOT NULL,
    "department" VARCHAR(16) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'new',
    "customer_name" VARCHAR(80) NOT NULL,
    "phone" VARCHAR(15) NOT NULL,
    "customer_email" VARCHAR(254),
    "customer_words" VARCHAR(300) NOT NULL,
    "created_by" INTEGER NOT NULL,
    "created_team" VARCHAR(16) NOT NULL,
    "owner_id" INTEGER NOT NULL,
    "owner_since" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accepted_at" TIMESTAMP(3),
    "first_contact_at" TIMESTAMP(3),
    "source" VARCHAR(16),
    "vehicle_year" SMALLINT,
    "vehicle_make" VARCHAR(40),
    "vehicle_model" VARCHAR(60),
    "vehicle_condition" VARCHAR(8),
    "stock_number" VARCHAR(20),
    "has_trade" BOOLEAN NOT NULL DEFAULT false,
    "trade_year" SMALLINT,
    "trade_make" VARCHAR(40),
    "trade_model" VARCHAR(60),
    "trade_miles" INTEGER,
    "reason" VARCHAR(24),
    "urgency" VARCHAR(8),
    "callback_at" TIMESTAMP(3),
    "manufacturer" VARCHAR(32),
    "ref_number" VARCHAR(20),
    "event_date" DATE,
    "staff_involved_id" INTEGER,
    "stage" VARCHAR(16),
    "sentiment" VARCHAR(10),
    "survey_score" VARCHAR(20),
    "problems" VARCHAR(24)[] DEFAULT ARRAY[]::VARCHAR(24)[],
    "outcome" VARCHAR(16),
    "outcome_note" VARCHAR(1000),
    "appointment_at" TIMESTAMP(3),
    "lost_reason" VARCHAR(24),
    "follow_up_at" TIMESTAMP(3),
    "showed" VARCHAR(12),
    "final_survey" VARCHAR(12),
    "closed_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_participants" (
    "case_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,

    CONSTRAINT "case_participants_pkey" PRIMARY KEY ("case_id","user_id")
);

-- CreateTable
CREATE TABLE "case_events" (
    "id" BIGSERIAL NOT NULL,
    "case_id" INTEGER NOT NULL,
    "actor_id" INTEGER NOT NULL,
    "kind" VARCHAR(16) NOT NULL,
    "from_user_id" INTEGER,
    "to_user_id" INTEGER,
    "from_status" VARCHAR(16),
    "to_status" VARCHAR(16),
    "method" VARCHAR(8),
    "result" VARCHAR(24),
    "note" VARCHAR(1000),
    "at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "case_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE INDEX "stores_org_id_sort_order_idx" ON "stores"("org_id", "sort_order");

-- CreateIndex
CREATE INDEX "staff_org_id_last_name_first_name_idx" ON "staff"("org_id", "last_name", "first_name");

-- CreateIndex
CREATE INDEX "staff_stores_store_id_user_id_idx" ON "staff_stores"("store_id", "user_id");

-- CreateIndex
CREATE INDEX "cases_owner_id_status_idx" ON "cases"("owner_id", "status");

-- CreateIndex
CREATE INDEX "cases_created_by_id_idx" ON "cases"("created_by", "id");

-- CreateIndex
CREATE INDEX "cases_org_id_id_idx" ON "cases"("org_id", "id");

-- CreateIndex
CREATE INDEX "cases_org_id_type_store_id_id_idx" ON "cases"("org_id", "type", "store_id", "id");

-- CreateIndex
CREATE INDEX "cases_org_id_phone_created_at_idx" ON "cases"("org_id", "phone", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "cases_org_id_number_key" ON "cases"("org_id", "number");

-- CreateIndex
CREATE INDEX "case_participants_user_id_case_id_idx" ON "case_participants"("user_id", "case_id");

-- CreateIndex
CREATE INDEX "case_events_case_id_id_idx" ON "case_events"("case_id", "id");

-- AddForeignKey
ALTER TABLE "stores" ADD CONSTRAINT "stores_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff" ADD CONSTRAINT "staff_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_stores" ADD CONSTRAINT "staff_stores_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "staff"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_stores" ADD CONSTRAINT "staff_stores_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_routes" ADD CONSTRAINT "store_routes_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_participants" ADD CONSTRAINT "case_participants_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_events" ADD CONSTRAINT "case_events_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Reference data, IDEMPOTENT (matched by slug / name, never by id). No people:
-- accounts are added in the portal (People) by the admin.
INSERT INTO "organizations" ("slug", "name", "time_zone", "updated_at")
VALUES ('plaza', 'Plaza Auto Mall', 'America/New_York', CURRENT_TIMESTAMP)
ON CONFLICT ("slug") DO NOTHING;

INSERT INTO "stores" ("org_id", "name", "short_name", "manufacturer", "has_service", "address", "sort_order", "updated_at")
SELECT o."id", s.name, s.short_name, s.manufacturer, s.has_service, s.address, s.sort_order, CURRENT_TIMESTAMP
FROM "organizations" o
CROSS JOIN (VALUES
  ('Plaza Acura',     'Acura',     'Acura',   true,  NULL, 1),
  ('Plaza Honda',     'Honda',     'Honda',   true,  NULL, 2),
  ('Plaza Hyundai',   'Hyundai',   'Hyundai', true,  NULL, 3),
  ('Plaza Kia',       'Kia',       'Kia',     true,  NULL, 4),
  ('Plaza Toyota',    'Toyota',    'Toyota',  true,  NULL, 5),
  ('Plaza Used Cars', 'Used Cars', 'Used',    false, '2800 Nostrand Ave, Brooklyn, NY 11210', 6)
) AS s(name, short_name, manufacturer, has_service, address, sort_order)
WHERE o."slug" = 'plaza'
  AND NOT EXISTS (SELECT 1 FROM "stores" x WHERE x."org_id" = o."id" AND x."short_name" = s.short_name);

INSERT INTO "case_counters" ("org_id", "type", "next")
SELECT o."id", t.type, t.next
FROM "organizations" o
CROSS JOIN (VALUES ('hot', 1001), ('csi', 2001)) AS t(type, next)
WHERE o."slug" = 'plaza'
ON CONFLICT ("org_id", "type") DO NOTHING;

-- The Plaza roles. What each may do is the permission catalogue's `roles`
-- (src/server/permissions.ts), granted on the first request after deploy.
INSERT INTO "roles" ("slug", "name", "description", "is_system", "updated_at") VALUES
  ('executive',           'Owner / Executive',      'Sees every case in every store.',                                    false, CURRENT_TIMESTAMP),
  ('director-ops',        'Director of Operations', 'Sees every case in every store; reassigns and reopens cases.',       false, CURRENT_TIMESTAMP),
  ('bdc-director',        'BDC Director',           'Sees every Hot Prospect in every store.',                            false, CURRENT_TIMESTAMP),
  ('bdc-manager',         'BDC Manager',            'Sees every Hot Prospect a BDC rep created; receives BDC cases.',     false, CURRENT_TIMESTAMP),
  ('sales-manager',       'Sales Manager',          'Sees the sales cases of their store(s); receives cases.',           false, CURRENT_TIMESTAMP),
  ('salesperson',         'Salesperson',            'Sees only the cases they created or were given.',                   false, CURRENT_TIMESTAMP),
  ('sales-bdc-rep',       'Sales BDC Rep',          'Sees only the cases they created or were given.',                   false, CURRENT_TIMESTAMP),
  ('csi-rep',             'CSI Rep',                'Sees every CSI case; logs check-in calls.',                          false, CURRENT_TIMESTAMP),
  ('service-manager',     'Service Manager',        'Sees the service CSI cases of their store(s); receives cases.',     false, CURRENT_TIMESTAMP),
  ('service-advisor',     'Service Advisor',        'Sees only the cases they were given.',                              false, CURRENT_TIMESTAMP),
  ('service-bdc-rep',     'Service BDC Rep',        'Sees only the cases they created or were given.',                   false, CURRENT_TIMESTAMP),
  ('service-bdc-manager', 'Service BDC Manager',    'Sees every case a Service BDC rep created; receives cases.',        false, CURRENT_TIMESTAMP)
ON CONFLICT ("slug") DO NOTHING;

COMMIT;
