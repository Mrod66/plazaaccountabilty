-- Plaza Accountability Hub, Phase 4: editable pick lists (Admin → Pick lists).
BEGIN;

-- CreateTable
CREATE TABLE "pick_options" (
    "id" SERIAL NOT NULL,
    "org_id" INTEGER NOT NULL,
    "list" VARCHAR(16) NOT NULL,
    "code" VARCHAR(24) NOT NULL,
    "label" VARCHAR(60) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pick_options_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pick_options_org_id_list_sort_order_idx" ON "pick_options"("org_id", "list", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "pick_options_org_id_list_code_key" ON "pick_options"("org_id", "list", "code");

-- Today's lists, as the starting point (codes match what cases already store).
INSERT INTO "pick_options" ("org_id", "list", "code", "label", "sort_order", "updated_at")
SELECT o."id", v.list, v.code, v.label, v.sort_order, CURRENT_TIMESTAMP
FROM "organizations" o
CROSS JOIN (VALUES
  ('reason', 'discount', 'Wants a discount', 1),
  ('reason', 'payment', 'Payment or budget', 2),
  ('reason', 'trade_value', 'Trade value', 3),
  ('reason', 'credit', 'Credit or financing', 4),
  ('reason', 'availability', 'Vehicle availability', 5),
  ('reason', 'complaint', 'Complaint', 6),
  ('reason', 'manager', 'Wants to talk to a manager', 7),
  ('reason', 'other', 'Other', 99),
  ('lost_reason', 'bought_elsewhere', 'Bought elsewhere', 1),
  ('lost_reason', 'price', 'Price', 2),
  ('lost_reason', 'payment', 'Payment', 3),
  ('lost_reason', 'trade_value', 'Trade value', 4),
  ('lost_reason', 'credit', 'Credit', 5),
  ('lost_reason', 'not_interested', 'No longer interested', 6),
  ('lost_reason', 'no_reach', 'Could not reach', 7),
  ('lost_reason', 'other', 'Other', 99),
  ('problem', 'wait_time', 'Wait time', 1),
  ('problem', 'price_fees', 'Price or fees', 2),
  ('problem', 'paperwork', 'Paperwork or finance', 3),
  ('problem', 'condition', 'Vehicle condition', 4),
  ('problem', 'not_fixed', 'Repair not fixed', 5),
  ('problem', 'communication', 'Communication', 6),
  ('problem', 'attitude', 'Staff attitude', 7),
  ('problem', 'delivery', 'Delivery experience', 8),
  ('problem', 'loaner', 'Loaner or ride', 9),
  ('problem', 'other', 'Other', 99)
) AS v(list, code, label, sort_order)
ON CONFLICT ("org_id", "list", "code") DO NOTHING;

COMMIT;
