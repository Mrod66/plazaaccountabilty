import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';

import {getDb} from '../../src/platform/db';
import {inRequestScope} from '../../src/platform/request-scope';
import {flushEmails} from '../../src/server/hub/alerts';
import {processClocks} from '../../src/server/hub/clocks';
import {configureEnv, DATABASE_URL, db, emails, resetDatabase} from './support/harness';
import {detail, hot, loadPlaza, person, plaza, seedRoles} from './support/hub';

/**
 * Clocks, escalation and alert emails (build prompt section 7, 8, test 3),
 * against the real Site API and Postgres. Time is moved by editing the
 * clocks' deadlines and by passing `now` to the background work, which is
 * exactly what the `case-clock` and `hub-sweep` jobs run.
 */

const minutes = (n: number) => n * 60_000;
/** Runs what the background jobs run, at `now`, in its own request scope. */
const runJobs = (now: Date) =>
  inRequestScope(async () => {
    const work = getDb()!;
    await processClocks(work, now);
    const result = await flushEmails(work, now);
    await work.$disconnect();
    return result;
  });

const mailsTo = (to: string, subject: RegExp) => emails.filter(e => e.kind === 'notification' && e.to === to && subject.test((e as {subject?: string}).subject ?? ''));

describe.skipIf(!DATABASE_URL)('hub clocks and alerts (integration, real Postgres)', () => {
  beforeAll(async () => {
    configureEnv();
    await loadPlaza();
  });
  beforeEach(async () => {
    await resetDatabase();
    await seedRoles();
  });
  afterAll(() => db.$disconnect());

  it('a new case starts three clocks and alerts its manager, who gets one email', async () => {
    const mgr = await person('honda.mgr@example.test', ['sales-manager'], ['Honda']);
    const rep = await person('rep@example.test', ['sales-bdc-rep'], [], 'group');
    const id = (await rep.browser.post('/site-api/cases/hot', hot(plaza.stores.Honda!, mgr.id))).json.case.id as number;

    const c = (await detail(mgr.browser, id)).json.case;
    expect(c.clocks.map((k: {kind: string}) => k.kind)).toEqual(['accept', 'contact', 'close']);
    expect(c.clocks.every((k: {state: string}) => ['on_time', 'warning'].includes(k.state) || k.state === 'missed')).toBe(true);
    expect(c.clock.kind).toBe('accept');

    const count = await mgr.browser.request('GET', '/site-api/alerts/count');
    expect(count.json.unread).toBe(1);
    // The clock job ran (locally) right after the case was made: one email, with case details, no phone number.
    const sent = mailsTo('honda.mgr@example.test', /new or overdue/);
    expect(sent).toHaveLength(1);
    const text = (sent[0] as {text?: string}).text ?? '';
    expect(text).toContain(c.number);
    expect(text).toContain('Pat C.');
    expect(text).not.toMatch(/555.?0101/);
    expect(sent[0]!.path).toBe('/portal/alerts');
  });

  it('test 3: past its clock, a case turns red, emails the owner once, then the manager once; never twice', async () => {
    const director = await person('unice@example.test', ['director-ops'], [], 'group');
    const mgr = await person('honda.mgr@example.test', ['sales-manager'], ['Honda']);
    await db.staff.update({where: {userId: mgr.id}, data: {managerUserId: director.id}});
    const rep = await person('rep@example.test', ['sales-bdc-rep'], [], 'group');
    const id = (await rep.browser.post('/site-api/cases/hot', hot(plaza.stores.Honda!, mgr.id))).json.case.id as number;
    emails.length = 0;

    // The accept clock's deadline passes.
    const now = new Date();
    await db.caseClock.updateMany({where: {caseId: id, kind: 'accept'}, data: {startedAt: new Date(now.getTime() - minutes(30)), dueAt: new Date(now.getTime() - minutes(1))}});
    await runJobs(now);
    let c = (await detail(mgr.browser, id)).json.case;
    expect(c.clock).toMatchObject({kind: 'accept', state: 'missed'});
    expect(c.events.map((e: {kind: string}) => e.kind)).toContain('clock_missed');
    // The manager was emailed about the new case moments ago: the miss waits for the 15-minute window.
    expect(mailsTo('honda.mgr@example.test', /./)).toHaveLength(0);

    const later = new Date(now.getTime() + minutes(16));
    await runJobs(later);
    await runJobs(later);
    expect(mailsTo('honda.mgr@example.test', /new or overdue/)).toHaveLength(1);

    // Still not accepted when the escalation time comes: the owner's manager hears, once.
    await db.caseClock.updateMany({where: {caseId: id, kind: 'accept'}, data: {escalateAt: new Date(later.getTime() - minutes(1))}});
    await runJobs(later);
    await runJobs(new Date(later.getTime() + minutes(1)));
    await runJobs(new Date(later.getTime() + minutes(30)));
    expect(mailsTo('unice@example.test', /escalated to you/)).toHaveLength(1);
    expect(mailsTo('honda.mgr@example.test', /./)).toHaveLength(1);
    expect(emails).toHaveLength(2);

    c = (await detail(director.browser, id)).json.case;
    expect(c.events.filter((e: {kind: string}) => e.kind === 'escalated')).toHaveLength(1);
    expect(c.clock).toMatchObject({kind: 'accept', state: 'missed', escalatedTo: {id: director.id}});

    // Accepting late: recorded as missed (kept forever), and nothing more is sent about it.
    expect((await mgr.browser.post(`/site-api/cases/${id}/accept`, {version: 1})).status).toBe(200);
    c = (await detail(mgr.browser, id)).json.case;
    const accept = c.clocks.find((k: {kind: string}) => k.kind === 'accept');
    expect(accept.state).toBe('missed');
    expect(accept.doneAt).not.toBeNull();
    // Only the accept clock is under test: keep the contact and close clocks (business minutes,
    // so their deadlines depend on when this runs) out of the window.
    await db.caseClock.updateMany({where: {caseId: id, kind: {in: ['contact', 'close']}}, data: {dueAt: new Date(later.getTime() + minutes(7 * 24 * 60))}});
    await runJobs(new Date(later.getTime() + minutes(120)));
    expect(emails).toHaveLength(2);
  });

  it('a hand-off starts an accept clock for the new owner; closing settles every clock', async () => {
    const bdc = await person('bdc.mgr@example.test', ['bdc-manager'], ['Honda'], 'group');
    const mgr = await person('honda.mgr@example.test', ['sales-manager'], ['Honda']);
    const rep = await person('rep@example.test', ['sales-bdc-rep'], [], 'group');
    const id = (await rep.browser.post('/site-api/cases/hot', hot(plaza.stores.Honda!, bdc.id))).json.case.id as number;
    await bdc.browser.post(`/site-api/cases/${id}/accept`, {version: 1});
    await bdc.browser.post(`/site-api/cases/${id}/handoff`, {version: 2, toUserId: mgr.id, reason: 'Price'});
    let clocks = await db.caseClock.findMany({where: {caseId: id}, orderBy: {id: 'asc'}});
    expect(clocks.map(k => [k.kind, k.ownerId, k.status])).toEqual([
      ['accept', bdc.id, 'met'],
      ['contact', mgr.id, 'running'],
      ['close', mgr.id, 'running'],
      ['accept', mgr.id, 'running'],
    ]);
    await mgr.browser.post(`/site-api/cases/${id}/accept`, {version: 3});
    await mgr.browser.post(`/site-api/cases/${id}/close`, {version: 4, outcome: 'sold', note: 'Delivered'});
    clocks = await db.caseClock.findMany({where: {caseId: id}, orderBy: {id: 'asc'}});
    expect(clocks.every(k => k.status === 'met' && k.doneAt)).toBe(true);
  });

  it('a follow-up starts a clock for the end of that business day; any attempt meets it, and "reached" is kept apart', async () => {
    const mgr = await person('honda.mgr@example.test', ['sales-manager'], ['Honda']);
    const rep = await person('rep@example.test', ['salesperson'], ['Honda']);
    const id = (await rep.browser.post('/site-api/cases/hot', hot(plaza.stores.Honda!, mgr.id))).json.case.id as number;
    await mgr.browser.post(`/site-api/cases/${id}/accept`, {version: 1});
    // Thursday Nov 5 2026, 10:00 AM Eastern: Honda sales closes at 9 PM that day.
    const res = await mgr.browser.post(`/site-api/cases/${id}/close`, {
      version: 2,
      outcome: 'follow_up',
      note: 'Wants to talk to his wife first',
      followUpAt: '2026-11-05T10:00',
    });
    expect(res.status).toBe(200);
    let follow = await db.caseClock.findFirstOrThrow({where: {caseId: id, kind: 'follow_up'}});
    expect(follow).toMatchObject({status: 'running', ownerId: mgr.id});
    expect(follow.dueAt.toISOString()).toBe('2026-11-06T02:00:00.000Z');
    expect((await db.caseClock.findFirstOrThrow({where: {caseId: id, kind: 'close'}})).status).toBe('met');

    // An attempt that did not reach the customer: the clocks are met, but the case is "attempted only".
    await mgr.browser.post(`/site-api/cases/${id}/contact`, {version: 3, method: 'call', result: 'no_answer'});
    follow = await db.caseClock.findFirstOrThrow({where: {caseId: id, kind: 'follow_up'}});
    expect(follow.status).toBe('met');
    let c = (await detail(mgr.browser, id)).json.case;
    expect(c.firstContactAt).not.toBeNull();
    expect(c.reachedAt).toBeNull();
    await mgr.browser.post(`/site-api/cases/${id}/contact`, {version: 4, method: 'call', result: 'reached'});
    c = (await detail(mgr.browser, id)).json.case;
    expect(c.reachedAt).not.toBeNull();
  });

  it('a missed follow-up alerts the owner, then escalates like any other clock', async () => {
    const director = await person('unice@example.test', ['director-ops'], [], 'group');
    const mgr = await person('honda.mgr@example.test', ['sales-manager'], ['Honda']);
    await db.staff.update({where: {userId: mgr.id}, data: {managerUserId: director.id}});
    const rep = await person('rep@example.test', ['salesperson'], ['Honda']);
    const id = (await rep.browser.post('/site-api/cases/hot', hot(plaza.stores.Honda!, mgr.id))).json.case.id as number;
    await mgr.browser.post(`/site-api/cases/${id}/accept`, {version: 1});
    await mgr.browser.post(`/site-api/cases/${id}/close`, {version: 2, outcome: 'follow_up', note: 'Call Friday', followUpAt: '2026-11-06T10:00'});
    const now = new Date();
    await db.caseClock.updateMany({where: {caseId: id, kind: 'follow_up'}, data: {startedAt: new Date(now.getTime() - minutes(120)), dueAt: new Date(now.getTime() - minutes(1))}});
    await runJobs(now);
    const missed = await db.notification.findMany({where: {caseId: id, kind: 'clock_missed'}});
    expect(missed.map(n => [n.userId, n.message])).toEqual([[mgr.id, 'Follow up (log a contact or close) clock missed']]);
    await db.caseClock.updateMany({where: {caseId: id, kind: 'follow_up'}, data: {escalateAt: new Date(now.getTime() - minutes(1))}});
    await runJobs(now);
    expect(await db.notification.count({where: {caseId: id, kind: 'escalation', userId: director.id}})).toBe(1);
  });

  it('Acura sales keeps its own hours', async () => {
    const hours = await db.businessHours.findMany({where: {storeId: plaza.stores.Acura!, department: 'sales'}, orderBy: {weekday: 'asc'}});
    expect(hours.map(h => [h.weekday, h.openMin, h.closeMin])).toEqual([
      [0, 660, 1020],
      [1, 540, 1200],
      [2, 540, 1200],
      [3, 540, 1200],
      [4, 540, 1200],
      [5, 540, 1140],
      [6, 540, 1140],
    ]);
  });

  it('a sending limit is noted once in the case history; the alert stays in the app', async () => {
    const mgr = await person('honda.mgr@example.test', ['sales-manager'], ['Honda']);
    const rep = await person('rep@example.test', ['salesperson'], ['Honda']);
    const realFetch = globalThis.fetch;
    // The platform answers "limit reached" to every email.
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith('/api/site/v1/emails')) return new Response('{}', {status: 429});
      return realFetch(input, init);
    }) as typeof fetch;
    try {
      const id = (await rep.browser.post('/site-api/cases/hot', hot(plaza.stores.Honda!, mgr.id))).json.case.id as number;
      await runJobs(new Date());
      const c = (await detail(mgr.browser, id)).json.case;
      expect(c.events.filter((e: {kind: string}) => e.kind === 'email_capped')).toHaveLength(1);
      const alerts = await mgr.browser.request('GET', '/site-api/alerts');
      expect(alerts.json.items[0]).toMatchObject({caseId: id, emailState: 'capped', capped: true, read: false});
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('someone on the 8 AM / 4 PM summary gets no email during the day, then one summary', async () => {
    const mgr = await person('honda.mgr@example.test', ['sales-manager'], ['Honda']);
    const rep = await person('rep@example.test', ['salesperson'], ['Honda']);
    expect((await mgr.browser.request('PUT', '/site-api/alerts/prefs', {alertMode: 'summary'})).json.alertMode).toBe('summary');
    await rep.browser.post('/site-api/cases/hot', hot(plaza.stores.Honda!, mgr.id));
    await rep.browser.post('/site-api/cases/hot', hot(plaza.stores.Honda!, mgr.id, {phone: '7185550199'}));
    await runJobs(new Date());
    expect(mailsTo('honda.mgr@example.test', /./)).toHaveLength(0);
    await inRequestScope(async () => {
      const work = getDb()!;
      await flushEmails(work, new Date(), {summary: true});
      await work.$disconnect();
    });
    const sent = mailsTo('honda.mgr@example.test', /2 new or overdue cases/);
    expect(sent).toHaveLength(1);
  });

  it('reading an alert in the app before its batch means no email; the Overdue panel shows cases 2 business days late', async () => {
    const director = await person('unice@example.test', ['director-ops'], [], 'group');
    const mgr = await person('honda.mgr@example.test', ['sales-manager'], ['Honda']);
    const rep = await person('rep@example.test', ['salesperson'], ['Honda']);
    await db.staff.update({where: {userId: mgr.id}, data: {alertMode: 'summary'}});
    const id = (await rep.browser.post('/site-api/cases/hot', hot(plaza.stores.Honda!, mgr.id))).json.case.id as number;
    await mgr.browser.post('/site-api/alerts/read', {caseId: id});
    await db.staff.update({where: {userId: mgr.id}, data: {alertMode: 'batched'}});
    await runJobs(new Date());
    expect(mailsTo('honda.mgr@example.test', /./)).toHaveLength(0);

    const now = new Date();
    await db.caseClock.updateMany({where: {caseId: id, kind: 'accept'}, data: {dueAt: new Date(now.getTime() - minutes(5))}});
    await runJobs(now);
    expect((await director.browser.request('GET', '/site-api/cases/overdue')).json.items).toEqual([]);
    await db.caseClock.updateMany({where: {caseId: id, kind: 'accept'}, data: {overdueAt: new Date(now.getTime() - minutes(1))}});
    const overdue = await director.browser.request('GET', '/site-api/cases/overdue');
    expect(overdue.json.items.map((x: {id: number}) => x.id)).toEqual([id]);
    // Not for a rep.
    expect((await rep.browser.request('GET', '/site-api/cases/overdue')).status).toBe(403);
  });
});
