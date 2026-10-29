import {Prisma, type PrismaClient} from '../../generated/prisma/client';
import type {Hub} from './context';

/**
 * Dashboard numbers (build prompt sections 10 and 11), computed live in SQL.
 *
 * EVERY number is a MEASURE: a named condition on a case. The dashboard counts
 * the cases that meet it; the drill-down LISTS the cases that meet it, from the
 * SAME condition, so a number and the list behind it can never disagree. Both
 * are ANDed with `visibleSql(hub)`, the SQL twin of `visibleCases()` (tested
 * to agree), so a drill-down never shows a case the viewer may not see.
 *
 * Counts are a cohort: the cases OPENED in the date range, and what has become
 * of them since. Bounded: a range is at most 400 days, every query is one
 * aggregate over the indexed `cases(org_id, …)` rows of that range, and the
 * screens are for managers and up (not every request of every user).
 *
 * Only constant SQL is ever spliced in (`Prisma.raw` of fixed aliases and the
 * fixed measure table below); every value is a bound parameter.
 */

export type Filter = {from: Date; to: Date; storeIds: number[] | null; department: string | null; type: 'hot' | 'csi'};

const sql = Prisma.sql;

/** The SQL twin of `visibleCases()` (src/server/hub/context.ts). */
export function visibleSql(hub: Pick<Hub, 'userId' | 'orgId' | 'storeIds' | 'scopes'>): Prisma.Sql {
  if (hub.scopes.all) return sql`c.org_id = ${hub.orgId}`;
  const any: Prisma.Sql[] = [sql`EXISTS (SELECT 1 FROM case_participants p WHERE p.case_id = c.id AND p.user_id = ${hub.userId})`];
  const {scopes, storeIds} = hub;
  const stores = storeIds.length ? Prisma.join(storeIds) : null;
  if (scopes.hot) any.push(sql`c.type = 'hot'`);
  if (scopes.hotBdc) any.push(sql`(c.type = 'hot' AND c.created_team = 'sales_bdc')`);
  if (scopes.storeSales && stores) {
    any.push(sql`(c.type = 'hot' AND c.store_id IN (${stores}))`);
    any.push(sql`(c.type = 'csi' AND c.department = 'sales' AND c.store_id IN (${stores}))`);
  }
  if (scopes.csi) any.push(sql`c.type = 'csi'`);
  if (scopes.storeService && stores) any.push(sql`(c.type = 'csi' AND c.department = 'service' AND c.store_id IN (${stores}))`);
  if (scopes.serviceBdc) any.push(sql`c.created_team = 'service_bdc'`);
  return sql`c.org_id = ${hub.orgId} AND (${Prisma.join(any, ' OR ')})`;
}

const clockMet = (kind: string) => sql`EXISTS (SELECT 1 FROM case_clocks k WHERE k.case_id = c.id AND k.kind = ${kind} AND k.status = 'met')`;
/** The case's FIRST accept clock (the person it was sent to) was met. */
const firstAcceptMet = sql`(SELECT k.status FROM case_clocks k WHERE k.case_id = c.id AND k.kind = 'accept' ORDER BY k.id LIMIT 1) = 'met'`;
/** The CURRENT owner's own accept clock was met (the "who closes them" on-time rate). */
const ownerAcceptMet = sql`EXISTS (SELECT 1 FROM case_clocks k WHERE k.case_id = c.id AND k.kind = 'accept' AND k.owner_id = c.owner_id AND k.status = 'met')`;
/** Red right now: a clock missed and not done, or running past its deadline. */
const redNow = sql`(c.status <> 'closed' AND EXISTS (SELECT 1 FROM case_clocks k WHERE k.case_id = c.id AND ((k.status = 'missed' AND k.done_at IS NULL) OR (k.status = 'running' AND k.due_at < now()))))`;
const closed = sql`c.status = 'closed'`;
const recovery = sql`(c.outcome IS NULL OR c.outcome <> 'no_issue')`;
const checkin = sql`c.stage = 'pre_survey'`;

/** Every measure, by type. The label is what the screens say. */
export const MEASURES = {
  hot: {
    opened: {label: 'Cases opened', where: sql`TRUE`},
    accepted_on_time: {label: 'Accepted on time', where: firstAcceptMet},
    contacted_on_time: {label: 'Customer contacted on time', where: clockMet('contact')},
    contacted: {label: 'Contact logged', where: sql`c.first_contact_at IS NOT NULL`},
    reached: {label: 'Reached the customer', where: sql`c.reached_at IS NOT NULL`},
    attempted_only: {label: 'Attempted only (not reached)', where: sql`(c.first_contact_at IS NOT NULL AND c.reached_at IS NULL)`},
    closed: {label: 'Cases closed', where: closed},
    appointment: {label: 'Converted to appointment', where: sql`(${closed} AND c.appointment_at IS NOT NULL)`},
    appointment_past: {label: 'Appointments with a past date', where: sql`(${closed} AND c.appointment_at IS NOT NULL AND c.appointment_at < now())`},
    showed: {label: 'Appointments that showed', where: sql`(${closed} AND c.appointment_at IS NOT NULL AND c.appointment_at < now() AND c.showed = 'yes')`},
    sold: {label: 'Sold', where: sql`(${closed} AND c.outcome = 'sold')`},
    lost: {label: 'Lost', where: sql`(${closed} AND c.outcome = 'lost')`},
    open: {label: 'Still open', where: sql`c.status <> 'closed'`},
    overdue_now: {label: 'Overdue now (red)', where: redNow},
    owner_accepted_on_time: {label: 'Accepted on time by this owner', where: ownerAcceptMet},
  },
  csi: {
    checkins: {label: 'Check-in calls logged', where: checkin},
    checkins_reached: {label: 'Reached on the check-in call', where: sql`(${checkin} AND c.sentiment <> 'no_reach')`},
    checkins_unhappy: {label: 'Unhappy', where: sql`(${checkin} AND c.sentiment = 'unhappy')`},
    recovery_opened: {label: 'Recovery cases opened', where: recovery},
    called_on_time: {label: 'Manager called on time', where: sql`(${recovery} AND ${clockMet('contact')})`},
    called: {label: 'Manager call logged', where: sql`(${recovery} AND c.first_contact_at IS NOT NULL)`},
    reached: {label: 'Reached the customer', where: sql`(${recovery} AND c.reached_at IS NOT NULL)`},
    attempted_only: {label: 'Attempted only (not reached)', where: sql`(${recovery} AND c.first_contact_at IS NOT NULL AND c.reached_at IS NULL)`},
    recovery_closed: {label: 'Recovery cases closed', where: sql`(${recovery} AND ${closed})`},
    recovered: {label: 'Recovered', where: sql`(${closed} AND c.outcome = 'recovered')`},
    partly: {label: 'Partly recovered', where: sql`(${closed} AND c.outcome = 'partly')`},
    not_recovered: {label: 'Not recovered', where: sql`(${closed} AND c.outcome = 'not_recovered')`},
    no_reach: {label: 'Could not reach', where: sql`(${closed} AND c.outcome = 'no_reach')`},
    unhappy: {label: 'Unhappy customers', where: sql`c.sentiment = 'unhappy'`},
    unhappy_returned: {label: 'Unhappy, survey came back', where: sql`(c.sentiment = 'unhappy' AND c.final_survey IN ('good', 'bad'))`},
    turned_around: {label: 'Turned around (final survey Good)', where: sql`(c.sentiment = 'unhappy' AND c.final_survey = 'good')`},
    open: {label: 'Still open', where: sql`c.status <> 'closed'`},
    overdue_now: {label: 'Overdue now (red)', where: redNow},
  },
} as const;

export type MeasureKey<T extends 'hot' | 'csi'> = keyof (typeof MEASURES)[T];

/** What a breakdown groups by. `int` keys are ids; `text` keys are codes. */
export const DIMENSIONS = {
  store: {expr: sql`c.store_id`, kind: 'int'},
  sender: {expr: sql`c.created_by`, kind: 'int'},
  owner: {expr: sql`c.owner_id`, kind: 'int'},
  staff: {expr: sql`c.staff_involved_id`, kind: 'int'},
  reason: {expr: sql`c.reason`, kind: 'text'},
  lost_reason: {expr: sql`c.lost_reason`, kind: 'text'},
  manufacturer: {expr: sql`c.manufacturer`, kind: 'text'},
  problem: {expr: sql`pr.code`, kind: 'text'},
  week: {expr: sql`to_char(date_trunc('week', c.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York'), 'YYYY-MM-DD')`, kind: 'text'},
} as const;
export type Dimension = keyof typeof DIMENSIONS;

/** The cases of the filter that the viewer may see (no measure yet). */
function baseWhere(hub: Hub, f: Filter): Prisma.Sql {
  const parts = [
    visibleSql(hub),
    sql`c.type = ${f.type}`,
    sql`c.created_at >= ${f.from}`,
    sql`c.created_at < ${f.to}`,
  ];
  if (f.storeIds) parts.push(f.storeIds.length ? sql`c.store_id IN (${Prisma.join(f.storeIds)})` : sql`FALSE`);
  if (f.department) parts.push(sql`c.department = ${f.department}`);
  return Prisma.join(parts, ' AND ');
}

const fromClause = (dim?: Dimension) =>
  dim === 'problem' ? sql`FROM cases c CROSS JOIN LATERAL unnest(c.problems) AS pr(code)` : sql`FROM cases c`;

export type GroupRow = {key: string | number | null; counts: Record<string, number>; medianMinutes: number | null};

/**
 * Counts every measure in `keys`, overall or per `dim` value, in ONE query,
 * with the median BUSINESS minutes from opening to the first logged contact.
 */
export async function aggregate<T extends 'hot' | 'csi'>(
  db: PrismaClient,
  hub: Hub,
  f: Filter & {type: T},
  keys: MeasureKey<T>[],
  dim?: Dimension
): Promise<GroupRow[]> {
  const measures = MEASURES[f.type] as Record<string, {where: Prisma.Sql}>;
  const columns = keys.map((key, i) => sql`COUNT(*) FILTER (WHERE ${measures[key as string]!.where}) AS ${Prisma.raw(`m${i}`)}`);
  // Business minutes (store hours, as the clocks count), stored when the contact was logged.
  const contactMedian = f.type === 'csi' ? sql`(${recovery} AND c.first_contact_min IS NOT NULL)` : sql`c.first_contact_min IS NOT NULL`;
  const median = sql`percentile_cont(0.5) WITHIN GROUP (ORDER BY c.first_contact_min) FILTER (WHERE ${contactMedian}) AS median`;
  const keyExpr = dim ? DIMENSIONS[dim].expr : sql`NULL`;
  const rows = await db.$queryRaw<Record<string, unknown>[]>`
    SELECT ${keyExpr} AS key, ${Prisma.join(columns)}, ${median}
    ${fromClause(dim)}
    WHERE ${baseWhere(hub, f)}
    GROUP BY 1
    ORDER BY 2 DESC
    LIMIT 500`;
  return rows.map(row => ({
    key: row.key === null || row.key === undefined ? null : typeof row.key === 'string' ? row.key : Number(row.key),
    counts: Object.fromEntries(keys.map((key, i) => [key as string, Number(row[`m${i}`] ?? 0)])),
    medianMinutes: row.median === null || row.median === undefined ? null : Math.round(Number(row.median)),
  }));
}

/**
 * The drill-down: the cases behind ONE number. The exact count (it equals the
 * number on the dashboard) and the newest `limit` of them.
 */
export async function drill<T extends 'hot' | 'csi'>(
  db: PrismaClient,
  hub: Hub,
  f: Filter & {type: T},
  measure: MeasureKey<T>,
  group?: {dim: Dimension; key: string | number | null}
): Promise<{total: number; ids: number[]}> {
  const where = (MEASURES[f.type] as Record<string, {where: Prisma.Sql}>)[measure as string]!.where;
  let groupWhere = sql`TRUE`;
  if (group) {
    const expr = DIMENSIONS[group.dim].expr;
    groupWhere = group.key === null ? sql`${expr} IS NULL` : sql`${expr} = ${group.key}`;
  }
  const condition = sql`${baseWhere(hub, f)} AND ${where} AND ${groupWhere}`;
  const [count, rows] = await Promise.all([
    db.$queryRaw<{n: bigint}[]>`SELECT COUNT(DISTINCT c.id) AS n ${fromClause(group?.dim)} WHERE ${condition}`,
    db.$queryRaw<{id: number}[]>`SELECT DISTINCT c.id ${fromClause(group?.dim)} WHERE ${condition} ORDER BY c.id DESC LIMIT 200`,
  ]);
  return {total: Number(count[0]?.n ?? 0), ids: rows.map(r => Number(r.id))};
}

/** Every red case across the group (the Overdue panel), oldest deadline first. */
export async function redCases(db: PrismaClient, hub: Hub, f: Omit<Filter, 'type' | 'from' | 'to'>): Promise<number[]> {
  const parts = [visibleSql(hub), redNow];
  if (f.storeIds) parts.push(f.storeIds.length ? sql`c.store_id IN (${Prisma.join(f.storeIds)})` : sql`FALSE`);
  if (f.department) parts.push(sql`c.department = ${f.department}`);
  const rows = await db.$queryRaw<{id: number}[]>`
    SELECT c.id FROM cases c
    WHERE ${Prisma.join(parts, ' AND ')}
    ORDER BY (SELECT MIN(k.due_at) FROM case_clocks k WHERE k.case_id = c.id AND (k.status = 'missed' AND k.done_at IS NULL OR k.status = 'running' AND k.due_at < now())) ASC
    LIMIT 100`;
  return rows.map(r => Number(r.id));
}
