import {Hono} from 'hono';
import {validator} from 'hono/validator';

import {type DashboardData, type DrillDown, easternToUtc, presetRange, type ReportPanel, type ReportRow} from '../../lib/hub';
import {can, problem, requireAuth, requirePermission, withDb, withViewer} from '../../platform/guards';
import {type Hub, visibleCases, withHub} from '../hub/context';
import {idOf} from '../hub/input';
import {aggregate, type Dimension, DIMENSIONS, drill, type Filter, MEASURES, redCases} from '../hub/metrics';
import {namesOf} from '../hub/people';
import {SCORE_METRICS, type ScoreGroup, scoreDrill, scorecards} from '../hub/scorecards';
import {PERMISSIONS} from '../permissions';
import {summaries, summarySelect} from './cases';

/**
 * Reports (`/site-api/reports`), build prompt sections 9 D–G, 10 and 11:
 *
 *   GET /?from&to&store&department&type     the Leadership Dashboard (site:hub:dashboard)
 *   GET /cases?…&type&measure&dim&key       the cases behind one number (same permission)
 *   GET /scorecards?from&to&store           People Scorecards (site:hub:scorecards)
 *   GET /scorecards/me                      My Scorecard: this month and last (everyone)
 *   GET /board?store                        the Store Board: open cases of my stores (site:hub:store_board)
 *
 * Every case-level number counts only cases the viewer may see (metrics.ts).
 * Store managers are held to their own stores.
 */

type Query = Record<string, string>;
const raw = validator('query', v => Object.fromEntries(Object.entries(v).map(([k, x]) => [k, typeof x === 'string' ? x.slice(0, 40) : ''])) as Query);

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Sees the whole group (every store), or is held to their own stores. */
const wide = (hub: Hub) => hub.scopes.all || hub.scopes.hot || hub.scopes.csi || hub.scopes.hotBdc || hub.scopes.serviceBdc;

/** The stores a report may cover: one picked store (if allowed), else all (wide) or theirs. */
function storesFor(hub: Hub, store: string): number[] | null | 'forbidden' {
  const id = idOf(store);
  if (id) return wide(hub) || hub.storeIds.includes(id) ? [id] : 'forbidden';
  return wide(hub) ? null : hub.storeIds;
}

type Range = {from: Date; to: Date; fromDay: string; toDay: string};

/** `from`/`to` are Eastern calendar days, both included (default: this month). At most 400 days. */
function rangeOf(q: Query): Range | string {
  const preset = presetRange('month');
  const fromDay = DAY.test(q.from ?? '') ? q.from! : preset.from;
  const toDay = DAY.test(q.to ?? '') ? q.to! : preset.to;
  const from = easternToUtc(`${fromDay}T00:00`);
  const end = new Date(`${toDay}T12:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  const to = easternToUtc(`${end.toISOString().slice(0, 10)}T00:00`);
  if (!from || !to || to <= from) return 'Pick a start date on or before the end date.';
  if (to.getTime() - from.getTime() > 400 * 86_400_000) return 'Pick a range of at most 400 days.';
  return {from, to, fromDay, toDay};
}

/** May the viewer see any case of this type beyond their own? */
const seesType = (hub: Hub, type: 'hot' | 'csi') =>
  hub.scopes.all ||
  (type === 'hot'
    ? hub.scopes.hot || hub.scopes.hotBdc || hub.scopes.storeSales
    : hub.scopes.csi || hub.scopes.storeService || hub.scopes.serviceBdc || hub.scopes.storeSales);

const HOT_ALL = Object.keys(MEASURES.hot) as (keyof typeof MEASURES.hot)[];
const CSI_ALL = Object.keys(MEASURES.csi) as (keyof typeof MEASURES.csi)[];

export const reportRoutes = new Hono()
  .get('/', raw, withViewer, requireAuth, requirePermission(PERMISSIONS.DASHBOARD_READ), withDb, withHub, async c => {
    const {db, hub} = c.var;
    const q = c.req.valid('query');
    const range = rangeOf(q);
    if (typeof range === 'string') return c.json(problem('invalid_input', range), 422);
    const storeIds = storesFor(hub, q.store ?? '');
    if (storeIds === 'forbidden') return c.json(problem('forbidden', 'That store is not one of yours.'), 403);
    const department = q.department === 'sales' || q.department === 'service' ? q.department : null;
    const type = q.type === 'hot' || q.type === 'csi' ? q.type : '';
    const base = {from: range.from, to: range.to, storeIds, department};

    const panel = async <T extends 'hot' | 'csi'>(t: T, all: string[], tables: Record<string, [Dimension, string[]]>): Promise<ReportPanel> => {
      const f = {...base, type: t} as Filter & {type: T};
      const entries = Object.entries(tables);
      const [totals, ...rest] = await Promise.all([
        aggregate(db, hub, f, all as never),
        ...entries.map(([, [dim, keys]]) => aggregate(db, hub, f, keys as never, dim)),
      ]);
      const empty: ReportRow = {key: null, counts: Object.fromEntries(all.map(k => [k, 0])), medianMinutes: null};
      return {
        totals: totals[0] ?? empty,
        tables: Object.fromEntries(entries.map(([name], i) => [name, rest[i]!])),
      };
    };

    const showHot = type !== 'csi' && department !== 'service' && seesType(hub, 'hot');
    const showCsi = type !== 'hot' && seesType(hub, 'csi');
    const [hot, csi, red] = await Promise.all([
      showHot
        ? panel('hot', HOT_ALL, {
            stores: ['store', HOT_ALL],
            senders: ['sender', ['opened', 'closed', 'appointment']],
            owners: ['owner', ['opened', 'owner_accepted_on_time', 'contacted_on_time', 'reached', 'attempted_only', 'closed', 'appointment', 'sold']],
            reasons: ['reason', ['opened', 'closed', 'appointment', 'sold']],
            lostReasons: ['lost_reason', ['lost']],
            trend: ['week', ['opened', 'accepted_on_time', 'closed', 'appointment']],
          })
        : null,
      showCsi
        ? panel('csi', CSI_ALL, {
            manufacturers: ['manufacturer', CSI_ALL],
            problems: ['problem', ['recovery_opened', 'recovery_closed', 'recovered']],
            staff: ['staff', ['unhappy', 'recovery_opened']],
            trend: ['week', ['recovery_opened', 'called_on_time', 'recovery_closed', 'recovered']],
          })
        : null,
      redCases(db, hub, {storeIds, department}),
    ]);

    // Names for the person tables, in one query.
    const personKeys = [hot?.tables.senders, hot?.tables.owners, csi?.tables.staff].flatMap(rows => (rows ?? []).map(r => r.key));
    const names = await namesOf(db, personKeys.filter((k): k is number => typeof k === 'number'));
    for (const rows of [hot?.tables.senders, hot?.tables.owners, csi?.tables.staff]) {
      for (const row of rows ?? []) if (typeof row.key === 'number') row.name = names.get(row.key) ?? 'Former user';
    }
    for (const p of [hot, csi]) p?.tables.trend?.sort((a, b) => String(a.key).localeCompare(String(b.key)));

    const redRows = red.length ? await db.case.findMany({where: {id: {in: red}}, select: summarySelect, take: red.length}) : [];
    redRows.sort((a, b) => red.indexOf(a.id) - red.indexOf(b.id));
    const data: DashboardData = {
      filter: {from: range.fromDay, to: range.toDay, store: q.store ?? '', department: department ?? '', type},
      hot,
      csi,
      overdue: await summaries(db, hub.orgId, redRows),
      generatedAt: new Date().toISOString(),
    };
    return c.json(data);
  })

  /** The cases behind one dashboard number, with the same filter: its count is the number. */
  .get('/cases', raw, withViewer, requireAuth, requirePermission(PERMISSIONS.DASHBOARD_READ), withDb, withHub, async c => {
    const {db, hub} = c.var;
    const q = c.req.valid('query');
    const type = q.type === 'csi' ? 'csi' : q.type === 'hot' ? 'hot' : null;
    const measures = type ? (MEASURES[type] as Record<string, {label: string}>) : null;
    if (!type || !measures || !Object.hasOwn(measures, q.measure ?? '')) return c.json(problem('invalid_input', 'Unknown number.'), 422);
    const range = rangeOf(q);
    if (typeof range === 'string') return c.json(problem('invalid_input', range), 422);
    const storeIds = storesFor(hub, q.store ?? '');
    if (storeIds === 'forbidden') return c.json(problem('forbidden', 'That store is not one of yours.'), 403);
    const department = q.department === 'sales' || q.department === 'service' ? q.department : null;
    let group: {dim: Dimension; key: string | number | null} | undefined;
    if (q.dim) {
      if (!Object.hasOwn(DIMENSIONS, q.dim)) return c.json(problem('invalid_input', 'Unknown breakdown.'), 422);
      const dim = q.dim as Dimension;
      const key = q.key === undefined || q.key === '' || q.key === 'null' ? null : DIMENSIONS[dim].kind === 'int' ? idOf(q.key) : q.key;
      if (key === undefined) return c.json(problem('invalid_input', 'Unknown breakdown value.'), 422);
      group = {dim, key};
    }
    const f = {from: range.from, to: range.to, storeIds, department, type} as Filter;
    const {total, ids} = await drill(db, hub, f as never, q.measure as never, group);
    const rows = ids.length ? await db.case.findMany({where: {id: {in: ids}}, select: summarySelect, take: ids.length}) : [];
    rows.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
    const answer: DrillDown = {label: measures[q.measure!]!.label, total, items: await summaries(db, hub.orgId, rows)};
    return c.json(answer);
  })

  .get('/scorecards', raw, withViewer, requireAuth, requirePermission(PERMISSIONS.SCORECARDS_READ), withDb, withHub, async c => {
    const {db, hub} = c.var;
    const q = c.req.valid('query');
    const range = rangeOf(q);
    if (typeof range === 'string') return c.json(problem('invalid_input', range), 422);
    const storeIds = storesFor(hub, q.store ?? '');
    if (storeIds === 'forbidden') return c.json(problem('forbidden', 'That store is not one of yours.'), 403);
    const cards = await scorecards(db, hub, {orgId: hub.orgId, from: range.from, to: range.to, storeIds});
    return c.json({filter: {from: range.fromDay, to: range.toDay, store: q.store ?? ''}, ...cards, generatedAt: new Date().toISOString()});
  })

  /**
   * The cases behind one scorecard number: the same metric, person, dates and
   * stores. Managers and up (site:hub:scorecards), or anyone for their OWN
   * numbers (My Scorecard). Only cases the viewer may see are counted or listed.
   */
  .get('/scorecards/cases', raw, withViewer, requireAuth, withDb, withHub, async c => {
    const {db, hub} = c.var;
    const q = c.req.valid('query');
    const group = q.group as ScoreGroup;
    if (!Object.hasOwn(SCORE_METRICS, group) || !Object.hasOwn(SCORE_METRICS[group], q.metric ?? '')) {
      return c.json(problem('invalid_input', 'Unknown number.'), 422);
    }
    const person = idOf(q.person);
    if (!person) return c.json(problem('invalid_input', 'Pick a person.'), 422);
    const own = person === hub.userId;
    if (!own && !(await can(c as never, PERMISSIONS.SCORECARDS_READ))) return c.json(problem('forbidden', 'You do not have access to this.'), 403);
    const range = rangeOf(q);
    if (typeof range === 'string') return c.json(problem('invalid_input', range), 422);
    const storeIds = own && !q.store ? null : storesFor(hub, q.store ?? '');
    if (storeIds === 'forbidden') return c.json(problem('forbidden', 'That store is not one of yours.'), 403);
    const {total, ids} = await scoreDrill(db, hub, {orgId: hub.orgId, from: range.from, to: range.to, storeIds}, group, q.metric!, person);
    const rows = ids.length ? await db.case.findMany({where: {id: {in: ids}}, select: summarySelect, take: ids.length}) : [];
    rows.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
    const names = await namesOf(db, [person]);
    const answer: DrillDown & {person: string} = {
      label: SCORE_METRICS[group][q.metric!]!.label,
      person: names.get(person) ?? 'Former user',
      total,
      items: await summaries(db, hub.orgId, rows),
    };
    return c.json(answer);
  })

  /** My own numbers, this month and last month (Eastern calendar months). */
  .get('/scorecards/me', withViewer, requireAuth, withDb, withHub, async c => {
    const {db, hub} = c.var;
    const month = (preset: string) => {
      const r = rangeOf(presetRange(preset) as Query) as Range;
      if (preset === 'month') {
        // The whole month, not only up to today.
        const end = new Date(`${r.fromDay}T12:00:00Z`);
        end.setUTCMonth(end.getUTCMonth() + 1);
        r.to = easternToUtc(`${end.toISOString().slice(0, 10)}T00:00`)!;
      }
      return r;
    };
    const [now, last] = [month('month'), month('last_month')];
    const [thisMonth, lastMonth] = await Promise.all([
      scorecards(db, hub, {orgId: hub.orgId, from: now.from, to: now.to, storeIds: null}, [hub.userId]),
      scorecards(db, hub, {orgId: hub.orgId, from: last.from, to: last.to, storeIds: null}, [hub.userId]),
    ]);
    return c.json({
      thisMonth: {from: now.fromDay, to: now.toDay, ...thisMonth},
      lastMonth: {from: last.fromDay, to: last.toDay, ...lastMonth},
      generatedAt: new Date().toISOString(),
    });
  })

  /** The Store Board: every open case of my stores (or one store) that I may see; sorted and filtered in the browser. */
  .get('/board', raw, withViewer, requireAuth, requirePermission(PERMISSIONS.STORE_BOARD), withDb, withHub, async c => {
    const {db, hub} = c.var;
    const storeIds = storesFor(hub, c.req.valid('query').store ?? '');
    if (storeIds === 'forbidden') return c.json(problem('forbidden', 'That store is not one of yours.'), 403);
    // Index: cases(org_id, type, store_id, id). Bounded: the 300 newest open cases.
    const rows = await db.case.findMany({
      where: {AND: [visibleCases(hub), {status: {not: 'closed'}}, storeIds ? {storeId: {in: storeIds}} : {}]},
      select: summarySelect,
      orderBy: {id: 'desc'},
      take: 300,
    });
    return c.json({items: await summaries(db, hub.orgId, rows), more: rows.length === 300, generatedAt: new Date().toISOString()});
  });
