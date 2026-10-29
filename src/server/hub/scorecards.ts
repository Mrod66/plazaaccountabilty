import {Prisma, type PrismaClient} from '../../generated/prisma/client';
import {PERMISSIONS} from '../permissions';
import {holdersOf} from './clocks';
import type {Hub} from './context';
import {visibleSql} from './metrics';
import {namesOf} from './people';

/**
 * People scorecards (build prompt section 11): one row per person, every rate
 * with its count. Three groups, by role:
 *   - front line (salespeople, Sales and Service BDC reps): the cases they SENT
 *     (opened in the range);
 *   - managers (whoever receives cases): the cases they RECEIVED in the range
 *     (an accept clock started for them: a new case or a hand-off);
 *   - CSI reps: the check-in calls they logged (opened in the range).
 *
 * Like the dashboard, every number is a METRIC: a condition on a case for one
 * person. The scorecard counts the cases that meet it; the drill-down lists
 * them, from the same condition, so a number and its list never disagree. Both
 * count only cases the viewer may see (`visibleSql`).
 */
export type ScoreFilter = {orgId: number; from: Date; to: Date; storeIds: number[] | null};
export type ScoreGroup = 'frontLine' | 'managers' | 'csiReps';

const sql = Prisma.sql;
const FRONT_LINE_ROLES = ['salesperson', 'sales-bdc-rep', 'service-bdc-rep'];
const CSI_ROLES = ['csi-rep'];

type Pred = (person: Prisma.Sql) => Prisma.Sql;
const contacted = (person: Prisma.Sql, extra = sql``) =>
  sql`EXISTS (SELECT 1 FROM case_events e WHERE e.case_id = c.id AND e.kind = 'contacted' AND e.actor_id = ${person} ${extra})`;
const closedBy = (person: Prisma.Sql) => sql`c.status = 'closed' AND c.owner_id = ${person}`;

/** Every scorecard number, by group. The key is the row's field name. */
export const SCORE_METRICS: Record<ScoreGroup, Record<string, {label: string; where: Pred}>> = {
  frontLine: {
    sent: {label: 'Cases sent', where: () => sql`TRUE`},
    hotSent: {label: 'Hot Prospects sent', where: () => sql`c.type = 'hot'`},
    appointment: {label: 'Ended in appointment', where: () => sql`(c.type = 'hot' AND c.status = 'closed' AND c.appointment_at IS NOT NULL)`},
    sold: {label: 'Sold', where: () => sql`(c.type = 'hot' AND c.status = 'closed' AND c.outcome = 'sold')`},
    lost: {label: 'Lost', where: () => sql`(c.type = 'hot' AND c.status = 'closed' AND c.outcome = 'lost')`},
  },
  managers: {
    received: {label: 'Cases received', where: () => sql`TRUE`},
    acceptedOnTime: {label: 'Accepted on time', where: () => sql`k.status = 'met'`},
    contactClocks: {
      label: 'Had a contact clock',
      where: p => sql`EXISTS (SELECT 1 FROM case_clocks x WHERE x.case_id = c.id AND x.kind = 'contact' AND x.owner_id = ${p})`,
    },
    contactedOnTime: {
      label: 'Contacted on time',
      where: p => sql`EXISTS (SELECT 1 FROM case_clocks x WHERE x.case_id = c.id AND x.kind = 'contact' AND x.owner_id = ${p} AND x.status = 'met')`,
    },
    reached: {label: 'Reached the customer', where: p => contacted(p, sql`AND e.result = 'reached'`)},
    attemptedOnly: {label: 'Attempted only (not reached)', where: p => sql`(${contacted(p)} AND NOT ${contacted(p, sql`AND e.result = 'reached'`)})`},
    hotClosed: {label: 'Hot Prospects they closed', where: p => sql`(c.type = 'hot' AND ${closedBy(p)})`},
    appointment: {label: 'Appointment', where: p => sql`(c.type = 'hot' AND ${closedBy(p)} AND c.appointment_at IS NOT NULL)`},
    sold: {label: 'Sold', where: p => sql`(c.type = 'hot' AND ${closedBy(p)} AND c.outcome = 'sold')`},
    csiClosed: {label: 'CSI cases they closed', where: p => sql`(c.type = 'csi' AND ${closedBy(p)} AND c.outcome <> 'no_issue')`},
    recovered: {label: 'Recovered (CSI)', where: p => sql`(c.type = 'csi' AND ${closedBy(p)} AND c.outcome = 'recovered')`},
    handoffs: {
      label: 'Handed off',
      where: p => sql`EXISTS (SELECT 1 FROM case_events e WHERE e.case_id = c.id AND e.kind = 'handed_off' AND e.actor_id = ${p})`,
    },
  },
  csiReps: {
    calls: {label: 'Calls logged', where: () => sql`TRUE`},
    reached: {label: 'Reached', where: () => sql`c.sentiment <> 'no_reach'`},
    unhappy: {label: 'Unhappy found', where: () => sql`c.sentiment = 'unhappy'`},
    opened: {label: 'Cases opened', where: () => sql`(c.outcome IS NULL OR c.outcome <> 'no_issue')`},
  },
};

const storeWhere = (f: ScoreFilter) =>
  f.storeIds ? (f.storeIds.length ? sql`AND c.store_id IN (${Prisma.join(f.storeIds)})` : sql`AND FALSE`) : sql``;

/** Each group's rows: where its cases come from, and which column is "the person". */
function source(group: ScoreGroup, hub: Hub, f: ScoreFilter) {
  const seen = visibleSql(hub);
  if (group === 'managers') {
    return {
      person: sql`k.owner_id`,
      from: sql`FROM case_clocks k JOIN cases c ON c.id = k.case_id`,
      where: sql`k.kind = 'accept' AND c.org_id = ${f.orgId} AND k.started_at >= ${f.from} AND k.started_at < ${f.to} ${storeWhere(f)} AND ${seen}`,
    };
  }
  return {
    person: sql`c.created_by`,
    from: sql`FROM cases c`,
    where: sql`c.org_id = ${f.orgId} AND c.created_at >= ${f.from} AND c.created_at < ${f.to} ${storeWhere(f)} AND ${seen} ${
      group === 'csiReps' ? sql`AND c.type = 'csi'` : sql``
    }`,
  };
}

/** Business minutes from when a manager got the case to their first logged contact (stored on the event). */
const managerMedian = sql`percentile_cont(0.5) WITHIN GROUP (ORDER BY fc.elapsed_min) FILTER (WHERE fc.elapsed_min IS NOT NULL) AS median`;
const managerFirstContact = sql`LEFT JOIN LATERAL (
  SELECT e.elapsed_min FROM case_events e
  WHERE e.case_id = c.id AND e.kind = 'contacted' AND e.actor_id = k.owner_id AND e.created_at >= k.started_at
  ORDER BY e.id LIMIT 1
) fc ON TRUE`;

export type ScoreRow = {id: number; name: string; counts: Record<string, number>; medianMinutes: number | null};
export type Scorecards = Record<ScoreGroup, ScoreRow[]>;

/** Members of the organization holding one of these role slugs. */
async function withRoles(db: PrismaClient, orgId: number, slugs: string[]): Promise<number[]> {
  const rows = await db.userRole.findMany({where: {role: {slug: {in: slugs}}}, select: {userId: true}, take: 2000});
  const ids = [...new Set(rows.map(r => r.userId))];
  if (!ids.length) return [];
  const staff = await db.staff.findMany({where: {orgId, userId: {in: ids}}, select: {userId: true}, take: 2000});
  return staff.map(s => s.userId);
}

async function groupRows(db: PrismaClient, hub: Hub, f: ScoreFilter, group: ScoreGroup, ids: number[]): Promise<Map<number, Record<string, unknown>>> {
  if (!ids.length) return new Map();
  const src = source(group, hub, f);
  const keys = Object.keys(SCORE_METRICS[group]);
  const columns = keys.map((key, i) => sql`COUNT(DISTINCT c.id) FILTER (WHERE ${SCORE_METRICS[group][key]!.where(src.person)}) AS ${Prisma.raw(`m${i}`)}`);
  const rows = await db.$queryRaw<Record<string, unknown>[]>`
    SELECT ${src.person} AS uid, ${Prisma.join(columns)}${group === 'managers' ? sql`, ${managerMedian}` : sql``}
    ${src.from} ${group === 'managers' ? managerFirstContact : sql``}
    WHERE ${src.where} AND ${src.person} IN (${Prisma.join(ids)})
    GROUP BY 1`;
  return new Map(rows.map(r => [Number(r.uid), Object.fromEntries([...keys.map((k, i) => [k, r[`m${i}`]]), ['median', r.median]])]));
}

export async function scorecards(db: PrismaClient, hub: Hub, f: ScoreFilter, only?: number[]): Promise<Scorecards> {
  const [front, managers, csi] = await Promise.all([
    withRoles(db, f.orgId, FRONT_LINE_ROLES),
    holdersOf(db, f.orgId, PERMISSIONS.CASE_RECEIVE),
    withRoles(db, f.orgId, CSI_ROLES),
  ]);
  const pick = (ids: number[]) => (only ? ids.filter(id => only.includes(id)) : ids);
  const people: Record<ScoreGroup, number[]> = {frontLine: pick(front), managers: pick(managers), csiReps: pick(csi)};
  const groups = Object.keys(people) as ScoreGroup[];
  const [data, names] = await Promise.all([
    Promise.all(groups.map(g => groupRows(db, hub, f, g, people[g]))),
    namesOf(db, [...people.frontLine, ...people.managers, ...people.csiReps]),
  ]);
  const out = {} as Scorecards;
  groups.forEach((g, i) => {
    out[g] = people[g]
      .map(id => {
        const r = data[i]!.get(id) ?? {};
        return {
          id,
          name: names.get(id) ?? 'Former user',
          counts: Object.fromEntries(Object.keys(SCORE_METRICS[g]).map(k => [k, Number(r[k] ?? 0)])),
          medianMinutes: r.median === null || r.median === undefined ? null : Math.round(Number(r.median)),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  });
  return out;
}

/** The cases behind one scorecard number: the exact count and the newest 200. */
export async function scoreDrill(
  db: PrismaClient,
  hub: Hub,
  f: ScoreFilter,
  group: ScoreGroup,
  metric: string,
  person: number
): Promise<{total: number; ids: number[]}> {
  const src = source(group, hub, f);
  const condition = sql`${src.where} AND ${src.person} = ${person} AND ${SCORE_METRICS[group][metric]!.where(src.person)}`;
  const [count, rows] = await Promise.all([
    db.$queryRaw<{n: bigint}[]>`SELECT COUNT(DISTINCT c.id) AS n ${src.from} WHERE ${condition}`,
    db.$queryRaw<{id: number}[]>`SELECT DISTINCT c.id ${src.from} WHERE ${condition} ORDER BY c.id DESC LIMIT 200`,
  ]);
  return {total: Number(count[0]?.n ?? 0), ids: rows.map(r => Number(r.id))};
}
