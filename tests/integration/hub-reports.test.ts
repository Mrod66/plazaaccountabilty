import {Prisma} from '../../src/generated/prisma-node/client';
import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';

import {type Hub, visibleCases} from '../../src/server/hub/context';
import {MEASURES, visibleSql} from '../../src/server/hub/metrics';
import {configureEnv, DATABASE_URL, db, resetDatabase} from './support/harness';
import {csi, hot, type Loose, loadPlaza, person, plaza, seedRoles} from './support/hub';

/**
 * Phase 3: the Leadership Dashboard, its drill-downs, the scorecards and the
 * Store Board (build prompt tests 1 and 6). Every number on the dashboard is
 * compared with the count of the case list behind it.
 */

type Panel = {totals: {counts: Record<string, number>}; tables: Record<string, {key: string | number | null; counts: Record<string, number>}[]>};
const DIMS: Record<string, string> = {
  stores: 'store',
  senders: 'sender',
  owners: 'owner',
  reasons: 'reason',
  lostReasons: 'lost_reason',
  trend: 'week',
  manufacturers: 'manufacturer',
  problems: 'problem',
  staff: 'staff',
};

/** A small, varied month of cases. */
async function seedCases() {
  const director = await person('unice@example.test', ['director-ops'], [], 'group');
  const honda = await person('honda.mgr@example.test', ['sales-manager'], ['Honda']);
  const kia = await person('kia.mgr@example.test', ['sales-manager'], ['Kia']);
  const svc = await person('honda.svc@example.test', ['service-manager'], ['Honda'], 'service');
  const repA = await person('rep.a@example.test', ['sales-bdc-rep'], [], 'group');
  const repB = await person('rep.b@example.test', ['sales-bdc-rep'], [], 'group');
  const csiRep = await person('csi@example.test', ['csi-rep'], [], 'group');
  const bdcDirector = await person('amy@example.test', ['bdc-director'], [], 'group');
  const S = plaza.stores;

  const make = async (who: {browser: Loose}, path: string, body: object) => (await who.browser.post(path, body)).json.case.id as number;
  // 1. Appointment, reached, on time.
  const a = await make(repA, '/site-api/cases/hot', hot(S.Honda!, honda.id));
  await honda.browser.post(`/site-api/cases/${a}/accept`, {version: 1});
  await honda.browser.post(`/site-api/cases/${a}/contact`, {version: 2, method: 'call', result: 'reached'});
  await honda.browser.post(`/site-api/cases/${a}/close`, {version: 3, outcome: 'appointment', note: 'Tue', appointmentAt: '2026-01-06T10:00'});
  // 2. Lost on price, attempted only.
  const b = await make(repB, '/site-api/cases/hot', hot(S.Honda!, honda.id, {reason: 'payment', phone: '7185550111'}));
  await honda.browser.post(`/site-api/cases/${b}/accept`, {version: 1});
  await honda.browser.post(`/site-api/cases/${b}/contact`, {version: 2, method: 'text', result: 'no_answer'});
  await honda.browser.post(`/site-api/cases/${b}/close`, {version: 3, outcome: 'lost', lostReason: 'price', note: 'Too high'});
  // 3. Open at Kia, a hand-off.
  const k = await make(repA, '/site-api/cases/hot', hot(S.Kia!, kia.id, {phone: '7185550122'}));
  await kia.browser.post(`/site-api/cases/${k}/handoff`, {version: 1, toUserId: director.id, reason: 'Covering'});
  // 4. Sold.
  const s = await make(repA, '/site-api/cases/hot', hot(S.Honda!, honda.id, {phone: '7185550133', reason: 'trade_value'}));
  await honda.browser.post(`/site-api/cases/${s}/accept`, {version: 1});
  await honda.browser.post(`/site-api/cases/${s}/close`, {version: 2, outcome: 'sold', note: 'Delivered'});
  // CSI: a recovery, a happy call, an open unhappy one.
  const r = await make(csiRep, '/site-api/cases/csi', csi(S.Honda!, 'service', svc.id, {problems: ['wait_time', 'communication']}));
  await svc.browser.post(`/site-api/cases/${r}/accept`, {version: 1});
  await svc.browser.post(`/site-api/cases/${r}/contact`, {version: 2, method: 'call', result: 'reached'});
  await svc.browser.post(`/site-api/cases/${r}/close`, {version: 3, outcome: 'recovered', note: 'Free oil change'});
  await svc.browser.post(`/site-api/cases/${r}/after`, {version: 4, finalSurvey: 'good'});
  await make(csiRep, '/site-api/cases/csi', csi(S.Honda!, 'service', 0, {sentiment: 'happy', problems: [], closeNoIssue: true, assigneeId: undefined, phone: '7185550144'}));
  await make(csiRep, '/site-api/cases/csi', csi(S.Honda!, 'service', svc.id, {phone: '7185550155', problems: ['price_fees']}));
  return {director, honda, kia, svc, repA, repB, csiRep, bdcDirector, ids: {a, b, k, s, r}};
}

describe.skipIf(!DATABASE_URL)('hub reports (integration, real Postgres)', () => {
  beforeAll(async () => {
    configureEnv();
    await loadPlaza();
  });
  beforeEach(async () => {
    await resetDatabase();
    await seedRoles();
  });
  afterAll(() => db.$disconnect());

  it('test 6: every dashboard number equals the count of the case list behind it', async () => {
    const {director} = await seedCases();
    const dash = (await director.browser.request('GET', '/site-api/reports')).json as {hot: Panel; csi: Panel; overdue: unknown[]};
    expect(dash.hot.totals.counts).toMatchObject({opened: 3 + 0 + 1, closed: 3, appointment: 1, sold: 1, lost: 1, reached: 1, attempted_only: 1, open: 1});
    expect(dash.csi.totals.counts).toMatchObject({checkins: 3, recovery_opened: 2, recovered: 1, turned_around: 1, unhappy_returned: 1});

    let checked = 0;
    for (const type of ['hot', 'csi'] as const) {
      const panel = dash[type];
      for (const measure of Object.keys(MEASURES[type])) {
        const drill = await director.browser.request('GET', `/site-api/reports/cases?type=${type}&measure=${measure}`);
        expect([type, measure, drill.json.total]).toEqual([type, measure, panel.totals.counts[measure]]);
        expect(drill.json.items).toHaveLength(Math.min(drill.json.total, 200));
        checked++;
      }
      for (const [table, rows] of Object.entries(panel.tables)) {
        for (const row of rows) {
          for (const [measure, value] of Object.entries(row.counts)) {
            const key = row.key === null ? 'null' : encodeURIComponent(String(row.key));
            const drill = await director.browser.request('GET', `/site-api/reports/cases?type=${type}&measure=${measure}&dim=${DIMS[table]}&key=${key}`);
            expect([table, row.key, measure, drill.json.total]).toEqual([table, row.key, measure, value]);
            checked++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  it('test 1 (dashboards): a rep cannot open the dashboard or its drill-downs; a BDC Director sees Hot Prospects only', async () => {
    const {repB, bdcDirector, kia, ids} = await seedCases();
    expect((await repB.browser.request('GET', '/site-api/reports')).status).toBe(403);
    expect((await repB.browser.request('GET', '/site-api/reports/cases?type=hot&measure=opened')).status).toBe(403);
    // Rep B's own scorecard counts only what Rep B sent.
    const mine = (await repB.browser.request('GET', '/site-api/reports/scorecards/me')).json;
    expect(mine.thisMonth.frontLine).toEqual([expect.objectContaining({id: repB.id, counts: expect.objectContaining({sent: 1, lost: 1})})]);

    const dash = (await bdcDirector.browser.request('GET', '/site-api/reports')).json;
    expect(dash.csi).toBeNull();
    expect(dash.hot.totals.counts.opened).toBe(4);
    const csiDrill = await bdcDirector.browser.request('GET', '/site-api/reports/cases?type=csi&measure=checkins');
    expect(csiDrill.json.total).toBe(0);

    // A Kia manager's Store Board: Kia only (the Honda cases never appear), and no other store.
    const board = (await kia.browser.request('GET', '/site-api/reports/board')).json;
    expect(board.items.map((c: {id: number}) => c.id)).toEqual([ids.k]);
    expect((await kia.browser.request('GET', `/site-api/reports/board?store=${plaza.stores.Honda}`)).status).toBe(403);
    expect((await kia.browser.request('GET', `/site-api/reports/scorecards?store=${plaza.stores.Honda}`)).status).toBe(403);
  });

  it('scorecards count each person’s own work, with reached apart from attempted only', async () => {
    const {director, honda, repA, csiRep} = await seedCases();
    const cards = (await director.browser.request('GET', '/site-api/reports/scorecards')).json;
    const row = (group: string, id: number) => cards[group].find((r: {id: number}) => r.id === id).counts;
    expect(row('frontLine', repA.id)).toMatchObject({sent: 3, hotSent: 3, appointment: 1, sold: 1, lost: 0});
    expect(row('managers', honda.id)).toMatchObject({
      received: 3,
      acceptedOnTime: 3,
      reached: 1,
      attemptedOnly: 1,
      hotClosed: 3,
      appointment: 1,
      sold: 1,
    });
    expect(row('managers', director.id)).toMatchObject({received: 1});
    expect(cards.csiReps).toEqual([expect.objectContaining({id: csiRep.id, counts: {calls: 3, reached: 3, unhappy: 2, opened: 2}})]);
  });

  it('every scorecard number equals the count of the case list behind it; a rep can open only their own', async () => {
    const {director, repA, repB} = await seedCases();
    const cards = (await director.browser.request('GET', '/site-api/reports/scorecards')).json;
    let checked = 0;
    for (const group of ['frontLine', 'managers', 'csiReps']) {
      for (const person of cards[group] as {id: number; counts: Record<string, number>}[]) {
        for (const [metric, value] of Object.entries(person.counts)) {
          const drill = await director.browser.request('GET', `/site-api/reports/scorecards/cases?group=${group}&metric=${metric}&person=${person.id}`);
          expect([group, person.id, metric, drill.json.total]).toEqual([group, person.id, metric, value]);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(40);
    // A rep opens their own numbers' cases, never someone else's.
    expect((await repA.browser.request('GET', `/site-api/reports/scorecards/cases?group=frontLine&metric=sent&person=${repA.id}`)).json.total).toBe(3);
    expect((await repA.browser.request('GET', `/site-api/reports/scorecards/cases?group=frontLine&metric=sent&person=${repB.id}`)).status).toBe(403);
  });

  it('medians are business time: sent 8:55 PM, contacted 9:05 AM the next morning = 10 minutes', async () => {
    const {director, ids} = await seedCases();
    // Honda sales: Thu Oct 29 2026 closes 9 PM, Fri opens 9 AM (Eastern, UTC-4).
    const sent = new Date('2026-10-29T20:55:00-04:00');
    const contacted = new Date('2026-10-30T09:05:00-04:00');
    await db.case.update({where: {id: ids.a}, data: {createdAt: sent, firstContactAt: contacted, firstContactMin: null}});
    await db.caseEvent.updateMany({where: {caseId: ids.a, kind: 'contacted'}, data: {createdAt: contacted, elapsedMin: null}});
    await db.caseClock.updateMany({where: {caseId: ids.a, kind: 'accept'}, data: {startedAt: sent}});
    const {fillBusinessMinutes} = await import('../../src/server/hub/clocks');
    await fillBusinessMinutes(db as never);
    expect((await db.case.findUniqueOrThrow({where: {id: ids.a}})).firstContactMin).toBe(10);
    expect((await db.caseEvent.findFirstOrThrow({where: {caseId: ids.a, kind: 'contacted'}})).elapsedMin).toBe(10);
    // The other contacted Hot Prospect (contacted within a minute) is moved out of the range, so the median is this case's.
    await db.case.update({where: {id: ids.b}, data: {createdAt: new Date('2026-09-15T12:00:00-04:00')}});
    const dash = (await director.browser.request('GET', '/site-api/reports?from=2026-10-01&to=2026-10-31')).json;
    expect(dash.hot.totals.medianMinutes).toBe(10);
  });

  it('the Acura store is "Acura of Brooklyn"', async () => {
    const acura = await db.store.findUniqueOrThrow({where: {id: plaza.stores.Acura!}});
    expect(acura.name).toBe('Acura of Brooklyn');
  });

  it('the dashboard’s visibility rule (SQL) agrees with the case lists’ (Prisma) for every role shape', async () => {
    const {repA, honda, svc, director} = await seedCases();
    const base = {orgId: plaza.orgId, scopes: {all: false, hot: false, hotBdc: false, storeSales: false, csi: false, storeService: false, serviceBdc: false}};
    const shapes: Pick<Hub, 'userId' | 'orgId' | 'storeIds' | 'scopes'>[] = [
      {...base, userId: repA.id, storeIds: []},
      {...base, userId: honda.id, storeIds: [plaza.stores.Honda!], scopes: {...base.scopes, storeSales: true}},
      {...base, userId: svc.id, storeIds: [plaza.stores.Honda!], scopes: {...base.scopes, storeService: true}},
      {...base, userId: 1, storeIds: [], scopes: {...base.scopes, csi: true}},
      {...base, userId: 1, storeIds: [], scopes: {...base.scopes, hot: true}},
      {...base, userId: 1, storeIds: [], scopes: {...base.scopes, hotBdc: true}},
      {...base, userId: 1, storeIds: [], scopes: {...base.scopes, serviceBdc: true}},
      {...base, userId: director.id, storeIds: [], scopes: {...base.scopes, all: true}},
    ];
    for (const shape of shapes) {
      const viaPrisma = (await db.case.findMany({where: visibleCases(shape), select: {id: true}})).map(c => c.id).sort();
      const viaSql = (await db.$queryRaw<{id: number}[]>(Prisma.sql`SELECT c.id FROM cases c WHERE ${visibleSql(shape)}`)).map(c => Number(c.id)).sort();
      expect(viaSql).toEqual(viaPrisma);
    }
  });
});
