import {Hono} from 'hono';
import {validator} from 'hono/validator';

import type {Prisma, PrismaClient} from '../../generated/prisma/client';
import {
  CONTACT_METHODS,
  CONTACT_RESULTS,
  CSI_DEPARTMENTS,
  CSI_OUTCOMES,
  CSI_STAGES,
  FINAL_SURVEY,
  HOT_OUTCOMES,
  HOT_SOURCES,
  HOT_URGENCY,
  SENTIMENTS,
  SHOWED,
  VEHICLE_CONDITION,
  valuesOf,
  type CaseDetail,
  type CaseEventRow,
  type CasesPage,
  type CaseSummary,
  type MyCases,
  type PhoneMatch,
  type RouteKind,
  type TouchRow,
  EVENT_LABELS,
  phoneDigits,
} from '../../lib/hub';
import {problem, requireAuth, withDb, withViewer} from '../../platform/guards';
import {kickCase} from '../background';
import {businessMinutesBetween} from '../hub/business-time';
import {notify} from '../hub/alerts';
import {
  clockSelect,
  loadSchedules,
  SYSTEM_ACTOR,
  moveClocks,
  followUpClock,
  newClock,
  planClocks,
  rulesFor,
  scheduleOf,
  settleClocks,
  toClockView,
  urgentClock,
} from '../hub/clocks';
import {type Hub, teamOf, visibleCases, withHub} from '../hub/context';
import {type Lists, loadLists, offered} from '../hub/lists';
import {asBody, Fields, idOf, invalidInput} from '../hub/input';
import {namesOf, orgPeople, personOf, receivers, roleNamesOf, storeStaff} from '../hub/people';

/**
 * Cases: Hot Prospects and CSI Recoveries (`/site-api/cases`). Every route:
 * `withViewer → requireAuth → withDb → withHub`, and EVERY read of a case is
 * ANDed with `visibleCases(hub)`, so a list, a search, a phone match or a
 * direct link never shows a case the viewer may not see (404, never 403, so
 * nothing says it exists).
 *
 *   GET  /mine                     waiting on me (unaccepted first) + created by me
 *   GET  /?q=&state=&type=&before= every case I may see, newest first (search)
 *   GET  /phone-check?phone=       the repeat flag
 *   GET  /options?storeId=&kind=   managers for a store + the default, store staff
 *   GET  /:id                      one case: fields, history, touch chain, what I may do
 *   POST /hot, /csi                create
 *   POST /:id/accept | contact | note | status | handoff | close | reopen | after
 *
 * Writes send the `version` they were looking at; a case changed meanwhile
 * answers 409 and nothing is saved (two people never overwrite each other).
 * Nothing is ever deleted: every action adds a `case_events` line.
 */

const PAGE = 25;
const ACTIVE_LIMIT = 100;

type Db = PrismaClient;

export const summarySelect = {
  id: true,
  number: true,
  type: true,
  status: true,
  storeId: true,
  department: true,
  customerName: true,
  phone: true,
  reason: true,
  sentiment: true,
  urgency: true,
  callbackAt: true,
  ownerId: true,
  createdById: true,
  acceptedAt: true,
  outcome: true,
  createdAt: true,
  ownerSince: true,
  closedAt: true,
} as const satisfies Prisma.CaseSelect;

type SummaryRow = Prisma.CaseGetPayload<{select: typeof summarySelect}>;

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

function toSummary(row: SummaryRow, names: Map<number, string>): CaseSummary {
  return {
    id: row.id,
    number: row.number,
    type: row.type,
    status: row.status,
    storeId: row.storeId,
    department: row.department,
    customerName: row.customerName,
    phone: row.phone,
    reason: row.reason,
    sentiment: row.sentiment,
    urgency: row.urgency,
    callbackAt: iso(row.callbackAt),
    owner: personOf(names, row.ownerId),
    createdBy: personOf(names, row.createdById),
    accepted: row.acceptedAt !== null,
    outcome: row.outcome,
    createdAt: row.createdAt.toISOString(),
    ownerSince: row.ownerSince.toISOString(),
    closedAt: iso(row.closedAt),
    clock: null,
  };
}

/** List rows, each with its most urgent waiting clock (three bounded queries for the whole page). */
export async function summaries(db: Db, orgId: number, rows: SummaryRow[]): Promise<CaseSummary[]> {
  if (!rows.length) return [];
  const [clocks, schedules] = await Promise.all([
    db.caseClock.findMany({
      where: {caseId: {in: rows.map(r => r.id)}, doneAt: null, status: {in: ['running', 'missed']}},
      select: clockSelect,
      take: 1000,
    }),
    loadSchedules(db, orgId),
  ]);
  const names = await namesOf(db, [...rows.flatMap(r => [r.ownerId, r.createdById]), ...clocks.flatMap(k => [k.ownerId, k.escalatedTo])]);
  const now = new Date();
  return rows.map(row => {
    const schedule = scheduleOf(schedules, row.storeId, row.department);
    const views = clocks.filter(k => k.caseId === row.id).map(k => toClockView(k, schedule, now, names));
    return {...toSummary(row, names), clock: urgentClock(views)};
  });
}

const URGENCY = {missed: 0, warning: 1, on_time: 2, met: 3} as const;

/** Waiting on me: not accepted first, then red, then amber, then the ones I have held longest. */
const waitingOrder = (a: CaseSummary, b: CaseSummary) =>
  Number(a.accepted) - Number(b.accepted) ||
  URGENCY[a.clock?.state ?? 'met'] - URGENCY[b.clock?.state ?? 'met'] ||
  a.ownerSince.localeCompare(b.ownerSince);

/** Starts the case's clock job after the answer (in-process in the Preview and tests). */
function kickAfter(c: {req: {url: string}; executionCtx: {waitUntil(promise: Promise<unknown>): void}}, caseId: number) {
  const work = kickCase(c.req.url, caseId).catch(error => console.error(`case-clock ${caseId}: ${(error as Error).message}`));
  try {
    c.executionCtx.waitUntil(work);
  } catch {
    // No execution context here (dev server): it simply runs on.
  }
}

/** The default manager for a new case, by store and kind (Admin → Routing). */
const routeKindOf = (type: 'hot' | 'csi', team: string, department: string): RouteKind =>
  type === 'hot' ? (team === 'sales_bdc' ? 'hot_bdc' : 'hot_sales') : department === 'service' ? 'csi_service' : 'csi_sales';

async function defaultAssignee(db: Db, storeId: number, kind: RouteKind, allowed: Set<number>): Promise<number | null> {
  const route = await db.storeRoute.findUnique({where: {storeId_kind: {storeId, kind}}, select: {userId: true}});
  return route && allowed.has(route.userId) ? route.userId : null;
}

/** The next case number: `HP-1001`, `CSI-2001`… One atomic statement. */
async function nextNumber(db: Db, orgId: number, type: 'hot' | 'csi'): Promise<string> {
  const rows = await db.$queryRaw<{n: number}[]>`
    UPDATE "case_counters" SET "next" = "next" + 1
    WHERE "org_id" = ${orgId} AND "type" = ${type}
    RETURNING "next" - 1 AS n`;
  let n = rows[0]?.n;
  if (n === undefined) {
    // An organization added later: its counter starts on first use.
    const start = type === 'hot' ? 1001 : 2001;
    await db.caseCounter.upsert({where: {orgId_type: {orgId, type}}, create: {orgId, type, next: start + 1}, update: {}});
    return nextNumber(db, orgId, type);
  }
  return `${type === 'hot' ? 'HP' : 'CSI'}-${n}`;
}

async function storeOf(db: Db, orgId: number, storeId: number | null) {
  if (!storeId) return null;
  return db.store.findFirst({
    where: {id: storeId, orgId, active: true},
    select: {id: true, manufacturer: true, hasService: true},
  });
}

/** The case, if the viewer may see it; null otherwise (the route answers 404). */
async function visibleCase<S extends Prisma.CaseSelect>(db: Db, hub: Hub, id: number | undefined, select: S) {
  if (!id) return null;
  return db.case.findFirst({where: {AND: [{id}, visibleCases(hub)]}, select});
}

const NOT_FOUND = problem('not_found', 'No such case, or it is not one of yours.');
const STALE = problem('stale', 'Someone else just changed this case. Reload it to see what changed, then try again.');

/**
 * Applies a change only if the case is still at `version` (else false: 409),
 * and adds its history lines, participants, clocks and alerts in the SAME
 * transaction.
 *
 * The version check is ONE statement, so it cannot race: it bumps the version
 * only where it still matches (Postgres re-checks the WHERE after waiting for a
 * concurrent save's lock), and divides by zero when nothing matched, which
 * aborts the whole transaction. A second save made on the same version
 * therefore changes nothing at all.
 */
async function commit(
  db: Db,
  id: number,
  version: number,
  data: Prisma.CaseUpdateInput,
  events: Omit<Prisma.CaseEventCreateManyInput, 'caseId'>[],
  participants: number[] = [],
  /** More writes that must happen with it: clocks, alerts. */
  extra: Prisma.PrismaPromise<unknown>[] = []
): Promise<boolean> {
  try {
    await db.$transaction([
      db.$queryRaw`
        WITH bumped AS (
          UPDATE "cases" SET "version" = "version" + 1, "updated_at" = now()
          WHERE "id" = ${id} AND "version" = ${version}
          RETURNING 1
        )
        SELECT 1 / (SELECT COUNT(*)::int FROM bumped) AS ok`,
      db.case.update({where: {id}, data, select: {id: true}}),
      db.caseEvent.createMany({data: events.map(event => ({...event, caseId: id}))}),
      ...(participants.length
        ? [db.caseParticipant.createMany({data: participants.map(userId => ({caseId: id, userId})), skipDuplicates: true})]
        : []),
      ...extra,
    ]);
    return true;
  } catch (error) {
    // 22012 (division by zero): the case was no longer at that version.
    const e = error as {code?: unknown; meta?: {code?: unknown}; message?: unknown} | null;
    if (e?.meta?.code === '22012' || String(e?.message ?? '').includes('22012')) return false;
    throw error;
  }
}

/** `{version, ...}` from a write's body. */
const actionBody = validator('json', (value, c) => {
  const body = asBody(value);
  const version = Number(body.version);
  if (!Number.isSafeInteger(version) || version < 1) {
    return c.json(problem('invalid_input', 'Reload the case and try again.'), 422);
  }
  return {...body, version};
});

const listQuery = validator('query', v => ({
  q: typeof v.q === 'string' ? v.q.trim().slice(0, 80) : '',
  state: v.state === 'closed' || v.state === 'all' ? v.state : 'open',
  type: v.type === 'hot' || v.type === 'csi' ? v.type : '',
  before: typeof v.before === 'string' ? v.before : '',
}));

/** Search: a case number, a phone (4+ digits) or part of a customer's name. */
function searchWhere(q: string): Prisma.CaseWhereInput {
  if (!q) return {};
  if (/^(hp|csi)-\d{1,9}$/i.test(q)) return {number: q.toUpperCase()};
  const digits = phoneDigits(q);
  if (/^[\d\s()+.-]+$/.test(q) && digits.length >= 4) return {phone: {contains: digits}};
  return {customerName: {contains: q, mode: 'insensitive'}};
}

const caseSelect = {
  ...summarySelect,
  version: true,
  customerEmail: true,
  customerWords: true,
  createdTeam: true,
  firstContactAt: true,
  reachedAt: true,
  source: true,
  vehicleYear: true,
  vehicleMake: true,
  vehicleModel: true,
  vehicleCondition: true,
  stockNumber: true,
  hasTrade: true,
  tradeYear: true,
  tradeMake: true,
  tradeModel: true,
  tradeMiles: true,
  manufacturer: true,
  refNumber: true,
  eventDate: true,
  staffInvolvedId: true,
  stage: true,
  surveyScore: true,
  problems: true,
  outcomeNote: true,
  appointmentAt: true,
  lostReason: true,
  followUpAt: true,
  showed: true,
  finalSurvey: true,
} as const satisfies Prisma.CaseSelect;

type EventRow = {
  id: bigint;
  kind: string;
  actorId: number;
  fromUserId: number | null;
  toUserId: number | null;
  fromStatus: string | null;
  toStatus: string | null;
  method: string | null;
  result: string | null;
  note: string | null;
  at: Date | null;
  createdAt: Date;
};

const OWNERSHIP = new Set(['handed_off', 'reassigned']);

/**
 * The touch chain: everyone who touched the case, in order of first touch,
 * what they did, and how long they held it (owner time; the clock stops while
 * the case is closed). Built from the history, never stored.
 */
export function touchChain(
  events: EventRow[],
  ownerId: number,
  closed: boolean,
  now = new Date()
): (Omit<TouchRow, 'person' | 'roles'> & {id: number})[] {
  const order: number[] = [];
  const did = new Map<number, Map<string, number>>();
  const held = new Map<number, number>();
  const touch = (id: number) => {
    if (!did.has(id)) {
      order.push(id);
      did.set(id, new Map());
    }
  };
  let owner: number | null = null;
  let since = 0;
  let running = false;
  const stop = (at: number) => {
    if (owner !== null && running) held.set(owner, (held.get(owner) ?? 0) + Math.max(0, at - since));
    running = false;
  };
  for (const event of events) {
    const at = event.createdAt.getTime();
    // Automatic lines (missed clocks, escalations, email limits) are nobody's touch.
    if (event.actorId === SYSTEM_ACTOR) continue;
    touch(event.actorId);
    const counts = did.get(event.actorId)!;
    counts.set(event.kind, (counts.get(event.kind) ?? 0) + 1);
    if (event.kind === 'created' && event.toUserId !== null) {
      owner = event.toUserId;
      since = at;
      running = true;
      touch(owner);
    } else if (OWNERSHIP.has(event.kind) && event.toUserId !== null) {
      stop(at);
      owner = event.toUserId;
      since = at;
      running = true;
      touch(owner);
    } else if (event.kind === 'outcome') {
      stop(at);
    } else if (event.kind === 'reopened') {
      since = at;
      running = true;
    }
  }
  if (!closed) stop(now.getTime());
  return order.map(id => ({
    id,
    did: [...did.get(id)!].map(([kind, n]) => `${EVENT_LABELS[kind] ?? kind}${n > 1 ? ` (${n}×)` : ''}`),
    heldMs: held.get(id) ?? 0,
    current: id === ownerId,
  }));
}

// ---------------------------------------------------------------- create

/** A Hot Prospect's fields, or the field errors. */
function readHot(body: Record<string, unknown>, lists: Lists) {
  const f = new Fields(body);
  const input = {
    storeId: f.id('storeId', 'Pick the store.'),
    source: f.pick('source', valuesOf(HOT_SOURCES), 'Pick where the customer came from.'),
    customerName: f.text('customerName', 80, "Enter the customer's name."),
    phone: f.phone('phone', "Enter the customer's mobile number."),
    customerEmail: f.email('customerEmail'),
    vehicleYear: f.int('vehicleYear', 1980, new Date().getUTCFullYear() + 2, 'Enter a 4-digit year, like 2025.'),
    vehicleMake: f.text('vehicleMake', 40),
    vehicleModel: f.text('vehicleModel', 60),
    vehicleCondition: f.pick('vehicleCondition', valuesOf(VEHICLE_CONDITION), false),
    stockNumber: f.text('stockNumber', 20),
    hasTrade: f.bool('hasTrade'),
    tradeYear: null as number | null,
    tradeMake: null as string | null,
    tradeModel: null as string | null,
    tradeMiles: null as number | null,
    reason: f.pick('reason', offered(lists, 'reason'), 'Pick why a manager is needed.'),
    customerWords: f.text('customerWords', 300, 'Write what the customer said (up to 300 characters).'),
    urgency: f.pick('urgency', valuesOf(HOT_URGENCY), 'Pick how urgent this is.'),
    callbackAt: null as Date | null,
    assigneeId: f.id('assigneeId', false),
  };
  if (input.hasTrade) {
    input.tradeYear = f.int('tradeYear', 1950, new Date().getUTCFullYear() + 1, 'Enter a 4-digit year, like 2019.');
    input.tradeMake = f.text('tradeMake', 40, 'Enter the trade-in make.');
    input.tradeModel = f.text('tradeModel', 60, 'Enter the trade-in model.');
    input.tradeMiles = f.int('tradeMiles', 0, 2_000_000, 'Enter the miles as a whole number, like 45000.');
  }
  if (input.urgency === 'by_time') input.callbackAt = f.when('callbackAt', 'Pick the callback date and time.');
  return {f, input};
}

function readCsi(body: Record<string, unknown>, lists: Lists) {
  const f = new Fields(body);
  const input = {
    storeId: f.id('storeId', 'Pick the store.'),
    department: f.pick('department', valuesOf(CSI_DEPARTMENTS), 'Pick sales delivery or service visit.'),
    customerName: f.text('customerName', 80, "Enter the customer's name."),
    phone: f.phone('phone', "Enter the customer's mobile number."),
    customerEmail: f.email('customerEmail'),
    refNumber: f.text('refNumber', 20),
    eventDate: f.date('eventDate'),
    staffInvolvedId: f.id('staffInvolvedId', false),
    stage: f.pick('stage', valuesOf(CSI_STAGES), 'Pick the stage.'),
    sentiment: f.pick('sentiment', valuesOf(SENTIMENTS), 'Pick how the customer felt.'),
    surveyScore: f.text('surveyScore', 20),
    problems: f.pickMany('problems', offered(lists, 'problem'), 30),
    customerWords: f.text('customerWords', 300, "Write the customer's words (up to 300 characters)."),
    closeNoIssue: f.bool('closeNoIssue'),
    assigneeId: f.id('assigneeId', false),
  };
  if (input.sentiment === 'unhappy' && !input.problems.length) f.fail('problems', "Pick at least one thing that went wrong.");
  if (input.closeNoIssue && input.sentiment !== 'happy') f.fail('sentiment', 'Only a happy customer can be closed as "No issue".');
  if (input.stage !== 'survey_received') input.surveyScore = null;
  return {f, input};
}

export const caseRoutes = new Hono()
  .get('/mine', withViewer, requireAuth, withDb, withHub, async c => {
    const {db, hub} = c.var;
    // Index: cases(owner_id, status) / cases(created_by, id).
    const [waiting, created] = await Promise.all([
      db.case.findMany({
        where: {orgId: hub.orgId, ownerId: hub.userId, status: {not: 'closed'}},
        select: summarySelect,
        orderBy: {id: 'asc'},
        take: ACTIVE_LIMIT,
      }),
      db.case.findMany({
        where: {orgId: hub.orgId, createdById: hub.userId},
        select: summarySelect,
        orderBy: {id: 'desc'},
        take: PAGE,
      }),
    ]);
    const all = await summaries(db, hub.orgId, [...waiting, ...created]);
    const answer: MyCases = {waiting: all.slice(0, waiting.length).sort(waitingOrder), created: all.slice(waiting.length)};
    return c.json(answer);
  })

  .get('/', listQuery, withViewer, requireAuth, withDb, withHub, async c => {
    const {db, hub} = c.var;
    const {q, state, type} = c.req.valid('query');
    const before = idOf(c.req.valid('query').before);
    const rows = await db.case.findMany({
      where: {
        AND: [
          visibleCases(hub),
          searchWhere(q),
          state === 'open' ? {status: {not: 'closed'}} : state === 'closed' ? {status: 'closed'} : {},
          type ? {type} : {},
          before ? {id: {lt: before}} : {},
        ],
      },
      select: summarySelect,
      orderBy: {id: 'desc'},
      take: PAGE + 1,
    });
    const items = await summaries(db, hub.orgId, rows.slice(0, PAGE));
    const page: CasesPage = {items, nextBefore: rows.length > PAGE ? items.at(-1)!.id : null};
    return c.json(page);
  })

  /** The repeat flag: other open or recent (90 days) cases with this phone number. */
  .get(
    '/phone-check',
    validator('query', v => ({phone: typeof v.phone === 'string' ? v.phone : '', except: typeof v.except === 'string' ? v.except : ''})),
    withViewer,
    requireAuth,
    withDb,
    withHub,
    async c => {
      const {db, hub} = c.var;
      const phone = phoneDigits(c.req.valid('query').phone).slice(0, 15);
      const except = idOf(c.req.valid('query').except);
      if (phone.length !== 10) return c.json({visible: [], hidden: 0} satisfies PhoneMatch);
      const since = new Date(Date.now() - 90 * 24 * 3600 * 1000);
      // Index: cases(org_id, phone, created_at). The ORGANIZATION's matches, then
      // split by what the viewer may open: the rest is only counted, never shown.
      const where: Prisma.CaseWhereInput = {
        orgId: hub.orgId,
        phone,
        OR: [{status: {not: 'closed'}}, {createdAt: {gte: since}}],
        ...(except ? {id: {not: except}} : {}),
      };
      const [all, visible] = await Promise.all([
        db.case.findMany({where, select: {id: true}, take: 20}),
        db.case.findMany({
          where: {AND: [where, visibleCases(hub)]},
          select: {id: true, number: true, type: true, status: true, ownerId: true},
          orderBy: {id: 'desc'},
          take: 20,
        }),
      ]);
      const names = await namesOf(db, visible.map(v => v.ownerId));
      const answer: PhoneMatch = {
        visible: visible.map(v => ({id: v.id, number: v.number, type: v.type, status: v.status, owner: personOf(names, v.ownerId)})),
        hidden: Math.max(0, all.length - visible.length),
      };
      return c.json(answer);
    }
  )

  /** For the new-case forms: the managers of a store and who it goes to by default; its staff. */
  .get(
    '/options',
    validator('query', v => ({
      storeId: typeof v.storeId === 'string' ? v.storeId : '',
      type: typeof v.type === 'string' ? v.type : '',
      department: typeof v.department === 'string' ? v.department : '',
    })),
    withViewer,
    requireAuth,
    withDb,
    withHub,
    async c => {
      const {db, hub} = c.var;
      const query = c.req.valid('query');
      const type = query.type === 'csi' ? 'csi' : 'hot';
      const department = query.department === 'service' ? 'service' : 'sales';
      const store = await storeOf(db, hub.orgId, idOf(query.storeId) ?? null);
      if (!store) return c.json({managers: [], defaultId: null, staff: []});
      const [managers, staff] = await Promise.all([
        receivers(db, hub.orgId, store.id),
        type === 'csi' ? storeStaff(db, hub.orgId, store.id) : Promise.resolve([]),
      ]);
      const kind = routeKindOf(type, teamOf(hub.roles), department);
      const defaultId = await defaultAssignee(db, store.id, kind, new Set(managers.map(m => m.id)));
      return c.json({managers, defaultId, staff});
    }
  )

  /**
   * The Overdue panel (Director of Operations, and whoever sees every case):
   * open cases with a clock missed and still not done two business days later,
   * the oldest first. Index: case_clocks(status, overdue_at).
   */
  .get('/overdue', withViewer, requireAuth, withDb, withHub, async c => {
    const {db, hub} = c.var;
    if (!hub.can.reassign && !hub.scopes.all) return c.json(problem('forbidden', 'The Overdue panel is for the Director of Operations.'), 403);
    const now = new Date();
    const late = await db.caseClock.findMany({
      where: {status: 'missed', doneAt: null, overdueAt: {lte: now}, case: {AND: [visibleCases(hub), {status: {not: 'closed'}}]}},
      select: {caseId: true},
      orderBy: {overdueAt: 'asc'},
      take: 300,
    });
    const ids = [...new Set(late.map(l => l.caseId))].slice(0, 100);
    const rows = ids.length ? await db.case.findMany({where: {id: {in: ids}}, select: summarySelect, take: ids.length}) : [];
    rows.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
    return c.json({items: await summaries(db, hub.orgId, rows)});
  })

  .post('/hot', validator('json', v => asBody(v)), withViewer, requireAuth, withDb, withHub, async c => {
    const {db, hub} = c.var;
    if (!hub.can.createHot) return c.json(problem('forbidden', 'Your role cannot create Hot Prospects.'), 403);
    const {f, input} = readHot(c.req.valid('json'), await loadLists(db, hub.orgId));
    const store = await storeOf(db, hub.orgId, input.storeId);
    if (input.storeId && !store) f.fail('storeId', 'Pick a store from the list.');
    if (!f.ok || !store) return c.json(invalidInput(f.errors), 422);

    const team = teamOf(hub.roles);
    const managers = await receivers(db, hub.orgId, store.id);
    const allowed = new Set(managers.map(m => m.id));
    let ownerId = input.assigneeId;
    if (ownerId && !allowed.has(ownerId)) return c.json(invalidInput({assigneeId: 'Pick a manager of this store from the list.'}), 422);
    ownerId ??= await defaultAssignee(db, store.id, routeKindOf('hot', team, 'sales'), allowed);
    if (!ownerId) {
      return c.json(invalidInput({assigneeId: 'No manager is set up to receive these yet. Pick one from the list.'}), 422);
    }

    const [number, rules] = await Promise.all([nextNumber(db, hub.orgId, 'hot'), rulesFor(db, hub.orgId, store.id, 'sales', 'hot')]);
    const {assigneeId: _, ...fields} = input;
    const now = new Date();
    const created = await db.case.create({
      data: {
        ...fields,
        storeId: store.id,
        source: fields.source!,
        customerName: fields.customerName!,
        phone: fields.phone!,
        customerWords: fields.customerWords!,
        reason: fields.reason!,
        urgency: fields.urgency!,
        orgId: hub.orgId,
        number,
        type: 'hot',
        department: 'sales',
        createdById: hub.userId,
        createdTeam: team,
        ownerId,
        participants: {create: [...new Set([hub.userId, ownerId])].map(userId => ({userId}))},
        events: {create: [{actorId: hub.userId, kind: 'created', toUserId: ownerId, toStatus: 'new'}]},
        clocks: {create: planClocks(rules, now, ownerId, fields.callbackAt)},
        createdAt: now,
        ownerSince: now,
      },
      select: {id: true, number: true},
    });
    await alertOwner(db, hub, created.id, ownerId, 'assigned', `New Hot Prospect for you to accept`);
    kickAfter(c, created.id);
    return c.json({case: created}, 201);
  })

  .post('/csi', validator('json', v => asBody(v)), withViewer, requireAuth, withDb, withHub, async c => {
    const {db, hub} = c.var;
    if (!hub.can.createCsi) return c.json(problem('forbidden', 'Your role cannot create CSI cases.'), 403);
    const {f, input} = readCsi(c.req.valid('json'), await loadLists(db, hub.orgId));
    const store = await storeOf(db, hub.orgId, input.storeId);
    if (input.storeId && !store) f.fail('storeId', 'Pick a store from the list.');
    if (store && input.department === 'service' && !store.hasService) {
      f.fail('department', 'This store has no service department. Pick sales delivery.');
    }
    if (!f.ok || !store) return c.json(invalidInput(f.errors), 422);

    const [managers, staff] = await Promise.all([receivers(db, hub.orgId, store.id), storeStaff(db, hub.orgId, store.id)]);
    if (input.staffInvolvedId && !staff.some(p => p.id === input.staffInvolvedId)) {
      return c.json(invalidInput({staffInvolvedId: 'Pick someone from this store’s list.'}), 422);
    }
    let ownerId: number | null;
    const now = new Date();
    if (input.closeNoIssue) {
      // A happy check-in call: logged and closed at once, owned by whoever logged it.
      ownerId = hub.userId;
    } else {
      const allowed = new Set(managers.map(m => m.id));
      ownerId = input.assigneeId;
      if (ownerId && !allowed.has(ownerId)) return c.json(invalidInput({assigneeId: 'Pick a manager of this store from the list.'}), 422);
      ownerId ??= await defaultAssignee(db, store.id, routeKindOf('csi', teamOf(hub.roles), input.department!), allowed);
      if (!ownerId) {
        return c.json(invalidInput({assigneeId: 'No manager is set up to receive these yet. Pick one from the list.'}), 422);
      }
    }

    const [number, rules] = await Promise.all([
      nextNumber(db, hub.orgId, 'csi'),
      rulesFor(db, hub.orgId, store.id, input.department!, 'csi'),
    ]);
    const events: Prisma.CaseEventCreateWithoutCaseInput[] = [
      {actorId: hub.userId, kind: 'created', toUserId: ownerId, toStatus: 'new'},
    ];
    if (input.closeNoIssue) {
      events.push({actorId: hub.userId, kind: 'outcome', fromStatus: 'new', toStatus: 'closed', result: 'no_issue', note: 'Happy customer: no issue.'});
    }
    const created = await db.case.create({
      data: {
        orgId: hub.orgId,
        number,
        type: 'csi',
        storeId: store.id,
        department: input.department!,
        manufacturer: store.manufacturer,
        customerName: input.customerName!,
        phone: input.phone!,
        customerEmail: input.customerEmail,
        customerWords: input.customerWords!,
        refNumber: input.refNumber,
        eventDate: input.eventDate,
        staffInvolvedId: input.staffInvolvedId,
        stage: input.stage,
        sentiment: input.sentiment,
        surveyScore: input.surveyScore,
        problems: input.problems,
        createdById: hub.userId,
        createdTeam: teamOf(hub.roles),
        ownerId,
        ...(input.closeNoIssue
          ? {status: 'closed', outcome: 'no_issue', outcomeNote: 'Happy customer: no issue.', acceptedAt: now, closedAt: now}
          : {}),
        participants: {create: [...new Set([hub.userId, ownerId])].map(userId => ({userId}))},
        events: {create: events},
        ...(input.closeNoIssue ? {} : {clocks: {create: planClocks(rules, now, ownerId, null)}}),
        createdAt: now,
        ownerSince: now,
      },
      select: {id: true, number: true},
    });
    if (!input.closeNoIssue) {
      await alertOwner(db, hub, created.id, ownerId, 'assigned', 'New CSI case for you to accept');
      kickAfter(c, created.id);
    }
    return c.json({case: created}, 201);
  })

  .get('/:id', withViewer, requireAuth, withDb, withHub, async c => {
    const {db, hub} = c.var;
    const row = await visibleCase(db, hub, idOf(c.req.param('id')), caseSelect);
    if (!row) return c.json(NOT_FOUND, 404);
    const events = await db.caseEvent.findMany({
      where: {caseId: row.id},
      select: {
        id: true,
        kind: true,
        actorId: true,
        fromUserId: true,
        toUserId: true,
        fromStatus: true,
        toStatus: true,
        method: true,
        result: true,
        note: true,
        at: true,
        createdAt: true,
      },
      orderBy: {id: 'asc'},
      take: 500,
    });
    const closed = row.status === 'closed';
    const chain = touchChain(events, row.ownerId, closed);
    const [clocks, hours] = await Promise.all([
      db.caseClock.findMany({where: {caseId: row.id}, select: clockSelect, orderBy: {id: 'asc'}, take: 50}),
      db.businessHours.findMany({
        where: {storeId: row.storeId, department: row.department},
        select: {weekday: true, openMin: true, closeMin: true},
        take: 7,
      }),
    ]);
    const schedule = new Map(hours.map(h => [h.weekday, {open: h.openMin, close: h.closeMin}]));
    const ids = [
      row.ownerId,
      row.createdById,
      row.staffInvolvedId,
      ...events.flatMap(e => [e.actorId, e.fromUserId, e.toUserId]),
      ...clocks.flatMap(k => [k.ownerId, k.escalatedTo]),
    ];
    const [names, roles] = await Promise.all([namesOf(db, ids), roleNamesOf(db, chain.map(t => t.id))]);
    const mine = row.ownerId === hub.userId;
    const eventRows: CaseEventRow[] = events.map(e => ({
      id: e.id.toString(),
      kind: e.kind,
      actor: personOf(names, e.actorId),
      from: e.fromUserId ? personOf(names, e.fromUserId) : null,
      to: e.toUserId ? personOf(names, e.toUserId) : null,
      fromStatus: e.fromStatus,
      toStatus: e.toStatus,
      method: e.method,
      result: e.result,
      note: e.note,
      at: iso(e.at),
      createdAt: e.createdAt.toISOString(),
    }));
    const now = new Date();
    const clockViews = clocks.map(k => toClockView(k, schedule, now, names));
    const detail: CaseDetail = {
      ...toSummary(row, names),
      clock: urgentClock(clockViews),
      clocks: clockViews,
      version: row.version,
      customerEmail: row.customerEmail,
      customerWords: row.customerWords,
      createdTeam: row.createdTeam,
      acceptedAt: iso(row.acceptedAt),
      firstContactAt: iso(row.firstContactAt),
      reachedAt: iso(row.reachedAt),
      source: row.source,
      vehicleYear: row.vehicleYear,
      vehicleMake: row.vehicleMake,
      vehicleModel: row.vehicleModel,
      vehicleCondition: row.vehicleCondition,
      stockNumber: row.stockNumber,
      hasTrade: row.hasTrade,
      tradeYear: row.tradeYear,
      tradeMake: row.tradeMake,
      tradeModel: row.tradeModel,
      tradeMiles: row.tradeMiles,
      manufacturer: row.manufacturer,
      refNumber: row.refNumber,
      eventDate: row.eventDate ? row.eventDate.toISOString().slice(0, 10) : null,
      staffInvolved: row.staffInvolvedId ? personOf(names, row.staffInvolvedId) : null,
      stage: row.stage,
      surveyScore: row.surveyScore,
      problems: row.problems,
      outcomeNote: row.outcomeNote,
      appointmentAt: iso(row.appointmentAt),
      lostReason: row.lostReason,
      followUpAt: iso(row.followUpAt),
      showed: row.showed,
      finalSurvey: row.finalSurvey,
      can: {
        accept: mine && !closed && row.acceptedAt === null,
        work: mine && !closed && row.acceptedAt !== null,
        handOff: !closed && (mine || hub.can.reassign),
        note: true,
        reopen: closed && hub.can.reopen,
        afterClose: closed && (mine || hub.can.reassign),
      },
      events: eventRows,
      touchChain: chain.map(t => ({
        person: personOf(names, t.id),
        roles: roles.get(t.id) ?? [],
        did: t.did,
        heldMs: t.heldMs,
        current: t.current,
      })),
    };
    return c.json({case: detail});
  })

  /** Hand-off picker: everyone active in the organization, the case's store first. */
  .get('/:id/people', withViewer, requireAuth, withDb, withHub, async c => {
    const {db, hub} = c.var;
    const row = await visibleCase(db, hub, idOf(c.req.param('id')), {id: true, storeId: true, ownerId: true});
    if (!row) return c.json(NOT_FOUND, 404);
    const people = (await orgPeople(db, hub.orgId, row.storeId)).filter(p => p.id !== row.ownerId);
    return c.json({people});
  })

  // ---------------------------------------------------------------- actions

  .post('/:id/accept', actionBody, withViewer, requireAuth, withDb, withHub, async c => {
    const {db, hub} = c.var;
    const {version} = c.req.valid('json');
    const row = await visibleCase(db, hub, idOf(c.req.param('id')), {id: true, ownerId: true, acceptedAt: true, status: true});
    if (!row) return c.json(NOT_FOUND, 404);
    if (row.ownerId !== hub.userId) return c.json(problem('not_owner', 'Only the person this case is waiting on can accept it.'), 403);
    if (row.status === 'closed') return c.json(problem('closed', 'This case is closed.'), 409);
    if (row.acceptedAt) return c.json(problem('already_accepted', 'You already accepted this case.'), 409);
    const toStatus = row.status === 'new' ? 'accepted' : row.status;
    const now = new Date();
    const ok = await commit(
      db,
      row.id,
      version,
      {acceptedAt: now, status: toStatus},
      [{actorId: hub.userId, kind: 'accepted', fromStatus: row.status, toStatus}],
      [],
      settleClocks(db, row.id, ['accept'], now, hub.userId)
    );
    return ok ? c.json({ok: true}) : c.json(STALE, 409);
  })

  .post('/:id/contact', actionBody, withViewer, requireAuth, withDb, withHub, async c => {
    const {db, hub} = c.var;
    const body = c.req.valid('json');
    const f = new Fields(body);
    const method = f.pick('method', valuesOf(CONTACT_METHODS), 'Pick call, text or email.');
    const result = f.pick('result', valuesOf(CONTACT_RESULTS), 'Pick what happened.');
    const note = f.text('note', 1000);
    if (!f.ok) return c.json(invalidInput(f.errors), 422);
    const row = await visibleCase(db, hub, idOf(c.req.param('id')), {
      id: true,
      type: true,
      storeId: true,
      department: true,
      ownerId: true,
      ownerSince: true,
      createdAt: true,
      acceptedAt: true,
      status: true,
      firstContactAt: true,
      reachedAt: true,
    });
    if (!row) return c.json(NOT_FOUND, 404);
    const blocked = workBlock(row, hub);
    if (blocked) return c.json(blocked, blocked.error === 'not_owner' ? 403 : 409);
    // Moves New/Accepted forward to "Customer contacted" / "Manager called customer".
    const contacted = row.type === 'csi' ? 'called' : 'contacted';
    const toStatus = row.status === 'accepted' ? contacted : row.status;
    const now = new Date();
    // Times in BUSINESS minutes, like the clocks: for the dashboard's and scorecards' medians.
    const {schedule} = await rulesFor(db, hub.orgId, row.storeId, row.department, row.type);
    const elapsedMin = Math.round(businessMinutesBetween(row.ownerSince, now, schedule));
    const ok = await commit(
      db,
      row.id,
      body.version,
      {
        status: toStatus,
        ...(row.firstContactAt ? {} : {firstContactAt: now, firstContactMin: Math.round(businessMinutesBetween(row.createdAt, now, schedule))}),
        // "Reached the customer" is kept apart from "attempted only".
        ...(result === 'reached' && !row.reachedAt ? {reachedAt: now} : {}),
      },
      [{actorId: hub.userId, kind: 'contacted', method, result, note, fromStatus: row.status, toStatus, elapsedMin}],
      [],
      // Any logged attempt (call, text, email; reached or not) stops the contact and follow-up clocks.
      settleClocks(db, row.id, ['contact', 'follow_up'], now)
    );
    return ok ? c.json({ok: true}) : c.json(STALE, 409);
  })

  /** A note never changes the case, so it never conflicts: no version needed. */
  .post('/:id/note', validator('json', v => asBody(v)), withViewer, requireAuth, withDb, withHub, async c => {
    const {db, hub} = c.var;
    const f = new Fields(c.req.valid('json'));
    const note = f.text('note', 1000, 'Write the note (up to 1000 characters).');
    if (!f.ok || !note) return c.json(invalidInput(f.errors), 422);
    const row = await visibleCase(db, hub, idOf(c.req.param('id')), {id: true});
    if (!row) return c.json(NOT_FOUND, 404);
    await db.caseEvent.create({data: {caseId: row.id, actorId: hub.userId, kind: 'note', note}, select: {id: true}});
    return c.json({ok: true}, 201);
  })

  /** Move the case to "Working" (Hot) or "Fix in progress" (CSI). */
  .post('/:id/status', actionBody, withViewer, requireAuth, withDb, withHub, async c => {
    const {db, hub} = c.var;
    const body = c.req.valid('json');
    const row = await visibleCase(db, hub, idOf(c.req.param('id')), {id: true, type: true, ownerId: true, acceptedAt: true, status: true});
    if (!row) return c.json(NOT_FOUND, 404);
    const blocked = workBlock(row, hub);
    if (blocked) return c.json(blocked, blocked.error === 'not_owner' ? 403 : 409);
    const toStatus = row.type === 'csi' ? 'fixing' : 'working';
    if (row.status === toStatus) return c.json({ok: true});
    const ok = await commit(db, row.id, body.version, {status: toStatus}, [
      {actorId: hub.userId, kind: 'status', fromStatus: row.status, toStatus},
    ]);
    return ok ? c.json({ok: true}) : c.json(STALE, 409);
  })

  .post('/:id/handoff', actionBody, withViewer, requireAuth, withDb, withHub, async c => {
    const {db, hub} = c.var;
    const body = c.req.valid('json');
    const f = new Fields(body);
    const toUserId = f.id('toUserId', 'Pick who takes it over.');
    const reason = f.text('reason', 300, 'Say why you are handing it off.');
    if (!f.ok || !toUserId || !reason) return c.json(invalidInput(f.errors), 422);
    const row = await visibleCase(db, hub, idOf(c.req.param('id')), {
      id: true,
      type: true,
      storeId: true,
      department: true,
      ownerId: true,
      status: true,
    });
    if (!row) return c.json(NOT_FOUND, 404);
    const mine = row.ownerId === hub.userId;
    if (!mine && !hub.can.reassign) return c.json(problem('not_owner', 'Only the case’s owner can hand it off.'), 403);
    if (row.status === 'closed') return c.json(problem('closed', 'This case is closed. Reopen it first.'), 409);
    if (toUserId === row.ownerId) return c.json(invalidInput({toUserId: 'They already own this case. Pick someone else.'}), 422);
    const people = await orgPeople(db, hub.orgId, row.storeId);
    if (!people.some(p => p.id === toUserId)) return c.json(invalidInput({toUserId: 'Pick someone from the list.'}), 422);
    // The new owner must Accept: a new accept clock runs until they do. The
    // previous owner's accept clock stops (passing it on is acting on it), and
    // the contact and close clocks now wait on the new owner.
    const now = new Date();
    const rules = await rulesFor(db, hub.orgId, row.storeId, row.department, row.type);
    const ok = await commit(
      db,
      row.id,
      body.version,
      {ownerId: toUserId, ownerSince: now, acceptedAt: null},
      [{actorId: hub.userId, kind: mine ? 'handed_off' : 'reassigned', fromUserId: row.ownerId, toUserId, note: reason}],
      [toUserId],
      [
        ...settleClocks(db, row.id, ['accept'], now, row.ownerId),
        ...moveClocks(db, row.id, toUserId),
        db.caseClock.create({data: {caseId: row.id, ...newClock(rules, 'accept', now, toUserId)}, select: {id: true}}),
        ...(toUserId !== hub.userId
          ? [notify(db, [{orgId: hub.orgId, userId: toUserId, caseId: row.id, kind: 'handed_off', message: 'Handed off to you: accept it'}])]
          : []),
      ]
    );
    if (ok) kickAfter(c, row.id);
    return ok ? c.json({ok: true}) : c.json(STALE, 409);
  })

  .post('/:id/close', actionBody, withViewer, requireAuth, withDb, withHub, async c => {
    const {db, hub} = c.var;
    const body = c.req.valid('json');
    const row = await visibleCase(db, hub, idOf(c.req.param('id')), {
      id: true,
      type: true,
      storeId: true,
      department: true,
      ownerId: true,
      acceptedAt: true,
      status: true,
    });
    if (!row) return c.json(NOT_FOUND, 404);
    const blocked = workBlock(row, hub);
    if (blocked) return c.json(blocked, blocked.error === 'not_owner' ? 403 : 409);

    const f = new Fields(body);
    const outcomes = row.type === 'csi' ? valuesOf(CSI_OUTCOMES) : valuesOf(HOT_OUTCOMES);
    const outcome = f.pick('outcome', outcomes as string[], 'Pick how it ended.');
    const note = f.text('note', 1000, 'Write a note: what happened (up to 1000 characters).');
    const appointmentAt = outcome === 'appointment' ? f.when('appointmentAt', 'Pick the appointment date AND time.') : null;
    const lostReason = outcome === 'lost' ? f.pick('lostReason', offered(await loadLists(db, hub.orgId), 'lost_reason'), 'Pick why it was lost.') : null;
    const followUpAt = outcome === 'follow_up' ? f.when('followUpAt', 'Pick the next follow-up date and time.') : null;
    if (!f.ok || !outcome || !note) return c.json(invalidInput(f.errors), 422);

    const now = new Date();
    if (outcome === 'follow_up') {
      // Not a close: the case stays open, "Working", with its next follow-up.
      const rules = await rulesFor(db, hub.orgId, row.storeId, row.department, row.type);
      const ok = await commit(
        db,
        row.id,
        body.version,
        {status: 'working', followUpAt},
        [{actorId: hub.userId, kind: 'follow_up', fromStatus: row.status, toStatus: 'working', note, at: followUpAt, result: outcome}],
        [],
        [
          // "Closed or follow-up set": a follow-up stops the close clock (and any earlier
          // follow-up clock), and starts a new one: contact or close by the end of that business day.
          ...settleClocks(db, row.id, ['close', 'follow_up'], now),
          db.caseClock.create({data: {caseId: row.id, ...followUpClock(rules, followUpAt!, hub.userId)}, select: {id: true}}),
        ]
      );
      if (ok) kickAfter(c, row.id);
      return ok ? c.json({ok: true}) : c.json(STALE, 409);
    }
    const ok = await commit(
      db,
      row.id,
      body.version,
      {status: 'closed', closedAt: now, outcome, outcomeNote: note, appointmentAt, lostReason, followUpAt: null},
      [{actorId: hub.userId, kind: 'outcome', fromStatus: row.status, toStatus: 'closed', result: outcome, note, at: appointmentAt}],
      [],
      // Closing ends every clock still waiting (a close before any logged contact counts for it too).
      settleClocks(db, row.id, ['accept', 'contact', 'close', 'follow_up'], now)
    );
    return ok ? c.json({ok: true}) : c.json(STALE, 409);
  })

  .post('/:id/reopen', actionBody, withViewer, requireAuth, withDb, withHub, async c => {
    const {db, hub} = c.var;
    const body = c.req.valid('json');
    if (!hub.can.reopen) return c.json(problem('forbidden', 'Only the Director of Operations or Admin can reopen a case.'), 403);
    const f = new Fields(body);
    const reason = f.text('reason', 300, 'Say why it is being reopened.');
    if (!f.ok || !reason) return c.json(invalidInput(f.errors), 422);
    const row = await visibleCase(db, hub, idOf(c.req.param('id')), {
      id: true,
      type: true,
      status: true,
      storeId: true,
      department: true,
      ownerId: true,
    });
    if (!row) return c.json(NOT_FOUND, 404);
    if (row.status !== 'closed') return c.json(problem('not_closed', 'This case is still open.'), 409);
    const toStatus = row.type === 'csi' ? 'fixing' : 'working';
    // The old outcome stays in the history; the case is open again, with a new close clock.
    const now = new Date();
    const rules = await rulesFor(db, hub.orgId, row.storeId, row.department, row.type);
    const ok = await commit(
      db,
      row.id,
      body.version,
      {status: toStatus, closedAt: null, outcome: null, outcomeNote: null},
      [{actorId: hub.userId, kind: 'reopened', fromStatus: 'closed', toStatus, note: reason}],
      [],
      [
        db.caseClock.create({data: {caseId: row.id, ...newClock(rules, 'close', now, row.ownerId)}, select: {id: true}}),
        ...(row.ownerId !== hub.userId
          ? [notify(db, [{orgId: hub.orgId, userId: row.ownerId, caseId: row.id, kind: 'reopened', message: 'Reopened: it is yours again'}])]
          : []),
      ]
    );
    if (ok) kickAfter(c, row.id);
    return ok ? c.json({ok: true}) : c.json(STALE, 409);
  })

  /** After closing: did the appointment show, did it sell later, the final survey. */
  .post('/:id/after', actionBody, withViewer, requireAuth, withDb, withHub, async c => {
    const {db, hub} = c.var;
    const body = c.req.valid('json');
    const row = await visibleCase(db, hub, idOf(c.req.param('id')), {
      id: true,
      type: true,
      status: true,
      ownerId: true,
      outcome: true,
      appointmentAt: true,
    });
    if (!row) return c.json(NOT_FOUND, 404);
    if (row.status !== 'closed') return c.json(problem('not_closed', 'Close the case first.'), 409);
    if (row.ownerId !== hub.userId && !hub.can.reassign) {
      return c.json(problem('not_owner', 'Only the case’s owner can record this.'), 403);
    }
    const f = new Fields(body);
    const note = f.text('note', 1000);
    if (row.type === 'hot') {
      const sold = f.bool('sold');
      const showed = sold ? null : f.pick('showed', valuesOf(SHOWED), 'Pick whether the customer showed.');
      if (!f.ok) return c.json(invalidInput(f.errors), 422);
      if (sold) {
        if (row.outcome === 'sold') return c.json({ok: true});
        const ok = await commit(db, row.id, body.version, {outcome: 'sold'}, [
          {actorId: hub.userId, kind: 'sold_later', result: 'sold', note},
        ]);
        return ok ? c.json({ok: true}) : c.json(STALE, 409);
      }
      if (row.outcome !== 'appointment' || !row.appointmentAt) {
        return c.json(problem('no_appointment', 'Only a case closed with an appointment has a show result.'), 409);
      }
      if (row.appointmentAt.getTime() > Date.now()) {
        return c.json(problem('too_early', 'Record whether they showed after the appointment time.'), 409);
      }
      const ok = await commit(db, row.id, body.version, {showed}, [{actorId: hub.userId, kind: 'showed', result: showed, note}]);
      return ok ? c.json({ok: true}) : c.json(STALE, 409);
    }
    const finalSurvey = f.pick('finalSurvey', valuesOf(FINAL_SURVEY), 'Pick the final survey result.');
    if (!f.ok) return c.json(invalidInput(f.errors), 422);
    const ok = await commit(db, row.id, body.version, {finalSurvey}, [
      {actorId: hub.userId, kind: 'final_survey', result: finalSurvey, note},
    ]);
    return ok ? c.json({ok: true}) : c.json(STALE, 409);
  });

/** An alert for the person a case now waits on, unless they did it themself. */
async function alertOwner(db: Db, hub: Hub, caseId: number, userId: number, kind: string, message: string) {
  if (userId === hub.userId) return;
  await notify(db, [{orgId: hub.orgId, userId, caseId, kind, message}]);
}

/** Why the viewer cannot work this case right now, or null. */
function workBlock(row: {ownerId: number; acceptedAt: Date | null; status: string}, hub: Hub) {
  if (row.ownerId !== hub.userId) return problem('not_owner', 'Only the person who owns this case can do that.');
  if (row.status === 'closed') return problem('closed', 'This case is closed.');
  if (!row.acceptedAt) return problem('not_accepted', 'Accept the case first.');
  return null;
}
