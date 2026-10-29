import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';

import {app} from '../../src/server/app';
import {Browser, configureEnv, DATABASE_URL, db, resetDatabase, userId} from './support/harness';
import {csi, detail, hot, loadPlaza, person, plaza, seedRoles} from './support/hub';

/**
 * The Accountability Hub's rules against the real Site API and a real
 * Postgres (build prompt section 15, tests 1, 2, 4, 5, 9, 10, plus the
 * walled-off organizations). People are made the way the platform makes any
 * account (sign-up in the test harness), then given Plaza roles and a Staff
 * profile directly, as the admin's People screen would.
 */
let stores: Record<string, number> = {};

describe.skipIf(!DATABASE_URL)('accountability hub (integration, real Postgres)', () => {
  beforeAll(async () => {
    configureEnv();
    await loadPlaza();
    stores = plaza.stores;
  });
  beforeEach(async () => {
    await resetDatabase();
    await seedRoles();
  });
  afterAll(() => db.$disconnect());

  it('test 1: a rep never sees another rep’s case: not in lists, search, phone check or by its link', async () => {
    const mgr = await person('honda.mgr@example.test', ['sales-manager'], ['Honda']);
    const repA = await person('rep.a@example.test', ['sales-bdc-rep'], [], 'group');
    const repB = await person('rep.b@example.test', ['sales-bdc-rep'], [], 'group');

    const created = await repA.browser.post('/site-api/cases/hot', hot(stores.Honda!, mgr.id));
    expect(created.status).toBe(201);
    const {id, number} = created.json.case as {id: number; number: string};
    expect(number).toMatch(/^HP-\d+$/);

    // Rep A and the manager see it.
    expect((await detail(repA.browser, id)).status).toBe(200);
    expect((await detail(mgr.browser, id)).status).toBe(200);

    // Rep B: nowhere.
    expect((await detail(repB.browser, id)).status).toBe(404);
    const mine = await repB.browser.request('GET', '/site-api/cases/mine');
    expect(mine.json.waiting).toEqual([]);
    expect(mine.json.created).toEqual([]);
    for (const q of [number, '7185550101', '555-0101', 'Pat', 'customer']) {
      for (const state of ['open', 'closed', 'all']) {
        const search = await repB.browser.request('GET', `/site-api/cases?q=${encodeURIComponent(q)}&state=${state}`);
        expect(search.status).toBe(200);
        expect(search.json.items).toEqual([]);
      }
    }
    // The repeat flag says only that another case exists, never which.
    const check = await repB.browser.request('GET', '/site-api/cases/phone-check?phone=7185550101');
    expect(check.json).toEqual({visible: [], hidden: 1});
    // Acting on it by its id: the same 404 as a case that does not exist.
    expect((await repB.browser.post(`/site-api/cases/${id}/note`, {note: 'hi'})).status).toBe(404);
    expect((await repB.browser.post(`/site-api/cases/${id}/accept`, {version: 1})).status).toBe(404);
    expect((await repB.browser.request('GET', `/site-api/cases/${id}/people`)).status).toBe(404);

    // Rep A finds their own case by number, phone and name.
    for (const q of [number, '7185550101', 'pat']) {
      const search = await repA.browser.request('GET', `/site-api/cases?q=${encodeURIComponent(q)}`);
      expect(search.json.items.map((c: {id: number}) => c.id)).toEqual([id]);
    }
  });

  it('test 2: store walls: Kia sales manager vs a Honda case; Honda service manager vs a Toyota CSI case', async () => {
    const hondaMgr = await person('honda.mgr@example.test', ['sales-manager'], ['Honda']);
    const kiaMgr = await person('kia.mgr@example.test', ['sales-manager'], ['Kia']);
    const hondaSvc = await person('honda.svc@example.test', ['service-manager'], ['Honda'], 'service');
    const toyotaSvc = await person('toyota.svc@example.test', ['service-manager'], ['Toyota'], 'service');
    const salesperson = await person('sam@example.test', ['salesperson'], ['Honda']);
    const csiRep = await person('csi@example.test', ['csi-rep'], [], 'group');
    const bdcManager = await person('bdc.mgr@example.test', ['bdc-manager'], ['Honda'], 'group');

    const hotCase = (await salesperson.browser.post('/site-api/cases/hot', hot(stores.Honda!, hondaMgr.id))).json.case.id as number;
    const toyotaCsi = (await csiRep.browser.post('/site-api/cases/csi', csi(stores.Toyota!, 'service', toyotaSvc.id))).json.case
      .id as number;

    expect((await detail(hondaMgr.browser, hotCase)).status).toBe(200);
    expect((await detail(kiaMgr.browser, hotCase)).status).toBe(404);
    const kiaSearch = await kiaMgr.browser.request('GET', '/site-api/cases?state=all');
    expect(kiaSearch.json.items).toEqual([]);

    expect((await detail(toyotaSvc.browser, toyotaCsi)).status).toBe(200);
    expect((await detail(hondaSvc.browser, toyotaCsi)).status).toBe(404);

    // The CSI rep sees every CSI case, never a Hot Prospect.
    expect((await detail(csiRep.browser, toyotaCsi)).status).toBe(200);
    expect((await detail(csiRep.browser, hotCase)).status).toBe(404);

    // The BDC Manager sees BDC reps' cases, not a salesperson's.
    expect((await detail(bdcManager.browser, hotCase)).status).toBe(404);
  });

  it('test 4: closing needs an outcome AND a note; an appointment needs a date AND time; Lost needs a reason', async () => {
    const mgr = await person('honda.mgr@example.test', ['sales-manager'], ['Honda']);
    const rep = await person('rep@example.test', ['sales-bdc-rep'], [], 'group');
    const id = (await rep.browser.post('/site-api/cases/hot', hot(stores.Honda!, mgr.id))).json.case.id as number;
    // Not accepted yet: no working it.
    expect((await mgr.browser.post(`/site-api/cases/${id}/close`, {version: 1, outcome: 'sold', note: 'x'})).json.error).toBe(
      'not_accepted'
    );
    expect((await mgr.browser.post(`/site-api/cases/${id}/accept`, {version: 1})).status).toBe(200);

    const close = (body: Record<string, unknown>) => mgr.browser.post(`/site-api/cases/${id}/close`, {version: 2, ...body});
    let res = await close({});
    expect(res.status).toBe(422);
    expect(Object.keys(res.json.fields).sort()).toEqual(['note', 'outcome']);
    res = await close({outcome: 'sold'});
    expect(res.json.fields).toEqual({note: expect.any(String)});
    res = await close({outcome: 'appointment', note: 'Coming in'});
    expect(res.json.fields).toEqual({appointmentAt: expect.any(String)});
    res = await close({outcome: 'appointment', note: 'Coming in', appointmentAt: '2026-11-03'});
    expect(res.json.fields).toEqual({appointmentAt: expect.any(String)});
    res = await close({outcome: 'lost', note: 'Gone'});
    expect(res.json.fields).toEqual({lostReason: expect.any(String)});
    // A rep cannot close a case that is not theirs to work.
    expect((await rep.browser.post(`/site-api/cases/${id}/close`, {version: 2, outcome: 'sold', note: 'x'})).status).toBe(403);

    res = await close({outcome: 'appointment', note: 'Coming in Tuesday', appointmentAt: '2026-11-03T15:30'});
    expect(res.status).toBe(200);
    const after = (await detail(mgr.browser, id)).json.case;
    expect(after.status).toBe('closed');
    // 3:30 PM Eastern (EST, after daylight saving ends) = 20:30 UTC.
    expect(after.appointmentAt).toBe('2026-11-03T20:30:00.000Z');
    expect(after.events.map((e: {kind: string}) => e.kind)).toEqual(['created', 'accepted', 'outcome']);
  });

  it('test 5: a hand-off writes a history line, and the new owner must Accept before working it', async () => {
    const bdcMgr = await person('bdc.mgr@example.test', ['bdc-manager'], ['Honda'], 'group');
    const salesMgr = await person('honda.mgr@example.test', ['sales-manager'], ['Honda']);
    const rep = await person('rep@example.test', ['sales-bdc-rep'], [], 'group');
    const id = (await rep.browser.post('/site-api/cases/hot', hot(stores.Honda!, bdcMgr.id))).json.case.id as number;
    await bdcMgr.browser.post(`/site-api/cases/${id}/accept`, {version: 1});

    let res = await bdcMgr.browser.post(`/site-api/cases/${id}/handoff`, {version: 2, toUserId: salesMgr.id});
    expect(res.json.fields).toEqual({reason: expect.any(String)});
    res = await bdcMgr.browser.post(`/site-api/cases/${id}/handoff`, {version: 2, toUserId: salesMgr.id, reason: 'Needs a desk manager on price'});
    expect(res.status).toBe(200);

    const c = (await detail(salesMgr.browser, id)).json.case;
    expect(c.owner.id).toBe(salesMgr.id);
    expect(c.accepted).toBe(false);
    expect(c.can).toMatchObject({accept: true, work: false});
    const line = c.events.at(-1);
    expect(line).toMatchObject({kind: 'handed_off', from: {id: bdcMgr.id}, to: {id: salesMgr.id}, note: 'Needs a desk manager on price'});
    expect(c.touchChain.map((t: {person: {id: number}}) => t.person.id)).toEqual([rep.id, bdcMgr.id, salesMgr.id]);

    // Not accepted: no logging contact yet. The old owner can no longer act, but still sees it.
    expect((await salesMgr.browser.post(`/site-api/cases/${id}/contact`, {version: 3, method: 'call', result: 'reached'})).json.error).toBe(
      'not_accepted'
    );
    expect((await bdcMgr.browser.post(`/site-api/cases/${id}/contact`, {version: 3, method: 'call', result: 'reached'})).status).toBe(403);
    expect((await detail(bdcMgr.browser, id)).status).toBe(200);
    expect((await salesMgr.browser.post(`/site-api/cases/${id}/accept`, {version: 3})).status).toBe(200);
    expect((await salesMgr.browser.post(`/site-api/cases/${id}/contact`, {version: 4, method: 'call', result: 'reached'})).status).toBe(200);
    expect((await detail(salesMgr.browser, id)).json.case.status).toBe('contacted');
  });

  it('test 10: two people saving the same case at once: one wins, the other is told to reload', async () => {
    const mgr = await person('honda.mgr@example.test', ['sales-manager'], ['Honda']);
    const director = await person('unice@example.test', ['director-ops'], [], 'group');
    const other = await person('honda.mgr2@example.test', ['sales-manager'], ['Honda']);
    const rep = await person('rep@example.test', ['salesperson'], ['Honda']);
    const id = (await rep.browser.post('/site-api/cases/hot', hot(stores.Honda!, mgr.id))).json.case.id as number;
    await mgr.browser.post(`/site-api/cases/${id}/accept`, {version: 1});
    // Both looked at version 2.
    const [a, b] = await Promise.all([
      mgr.browser.post(`/site-api/cases/${id}/close`, {version: 2, outcome: 'sold', note: 'Delivered'}),
      director.browser.post(`/site-api/cases/${id}/handoff`, {version: 2, toUserId: other.id, reason: 'Covering'}),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const loser = a.status === 409 ? a : b;
    // Refused either because the case changed meanwhile, or (when the close landed first) because it is closed.
    expect(['stale', 'closed']).toContain(loser.json.error);
    const c = (await detail(mgr.browser, id)).json.case;
    expect(c.version).toBe(3);
    // Exactly one of the two changes is in the history.
    expect(c.events.filter((e: {kind: string}) => e.kind === 'outcome' || e.kind === 'reassigned')).toHaveLength(1);
    // Notes never conflict.
    expect((await rep.browser.post(`/site-api/cases/${id}/note`, {note: 'Customer called back'})).status).toBe(201);
  });

  it('test 9: a deactivated person cannot sign in, but their cases and history stay', async () => {
    const mgr = await person('honda.mgr@example.test', ['sales-manager'], ['Honda']);
    const rep = await person('leaver@example.test', ['salesperson'], ['Honda']);
    const director = await person('unice@example.test', ['director-ops'], [], 'group');
    const id = (await rep.browser.post('/site-api/cases/hot', hot(stores.Honda!, mgr.id))).json.case.id as number;

    await db.user.update({where: {id: rep.id}, data: {status: 'suspended', sessionVersion: {increment: 1}}});
    const again = new Browser(app);
    const login = await again.post('/site-api/auth/login', {email: 'leaver@example.test', password: 'a long test passphrase'});
    expect(login.status).not.toBe(200);
    expect((await rep.browser.request('GET', '/site-api/cases/mine')).status).toBe(401);

    const c = (await detail(director.browser, id)).json.case;
    expect(c.createdBy).toEqual({id: rep.id, name: 'leaver'});
    expect(c.events[0].actor.id).toBe(rep.id);
  });

  it('organizations are walled off: another group never sees Plaza’s cases', async () => {
    const other = await db.organization.create({data: {slug: `other-${Date.now()}`, name: 'Other Motors'}});
    try {
      const mgr = await person('honda.mgr@example.test', ['sales-manager'], ['Honda']);
      const rep = await person('rep@example.test', ['salesperson'], ['Honda']);
      const outsider = await person('boss@other.test', ['executive'], [], 'group', other.id);
      const id = (await rep.browser.post('/site-api/cases/hot', hot(stores.Honda!, mgr.id))).json.case.id as number;
      expect((await detail(outsider.browser, id)).status).toBe(404);
      expect((await outsider.browser.request('GET', '/site-api/cases?state=all')).json.items).toEqual([]);
      // Nor can they pick a Plaza store.
      const res = await outsider.browser.post('/site-api/cases/hot', hot(stores.Honda!, mgr.id));
      expect(res.status).toBe(422);
      expect(res.json.fields).toEqual({storeId: expect.any(String)});
    } finally {
      await db.staff.deleteMany({where: {orgId: other.id}});
      await db.organization.delete({where: {id: other.id}});
    }
  });

  it('CSI: a happy check-in closes at once as "No issue"; unhappy needs what went wrong', async () => {
    const svc = await person('honda.svc@example.test', ['service-manager'], ['Honda'], 'service');
    const csiRep = await person('csi@example.test', ['csi-rep'], [], 'group');
    let res = await csiRep.browser.post('/site-api/cases/csi', csi(stores.Honda!, 'service', svc.id, {problems: []}));
    expect(res.json.fields).toEqual({problems: expect.any(String)});
    res = await csiRep.browser.post('/site-api/cases/csi', csi(stores['Used Cars']!, 'service', svc.id));
    expect(res.json.fields).toEqual({department: expect.any(String)});
    res = await csiRep.browser.post(
      '/site-api/cases/csi',
      csi(stores.Honda!, 'service', 0, {sentiment: 'happy', problems: [], closeNoIssue: true, assigneeId: undefined})
    );
    expect(res.status).toBe(201);
    const c = (await detail(csiRep.browser, res.json.case.id)).json.case;
    expect(c).toMatchObject({status: 'closed', outcome: 'no_issue', manufacturer: 'Honda', owner: {id: csiRep.id}});
  });

  it('a Service BDC rep sends a Hot Prospect to the store’s sales manager, and still sees it', async () => {
    const mgr = await person('honda.mgr@example.test', ['sales-manager'], ['Honda']);
    const rep = await person('svc.rep@example.test', ['service-bdc-rep'], [], 'group');
    const res = await rep.browser.post('/site-api/cases/hot', hot(stores.Honda!, mgr.id));
    expect(res.status).toBe(201);
    const c = (await detail(rep.browser, res.json.case.id)).json.case;
    expect(c).toMatchObject({type: 'hot', owner: {id: mgr.id}});
  });

  it('only the Director of Operations or Admin reopens a closed case', async () => {
    const mgr = await person('honda.mgr@example.test', ['sales-manager'], ['Honda']);
    const director = await person('unice@example.test', ['director-ops'], [], 'group');
    const rep = await person('rep@example.test', ['salesperson'], ['Honda']);
    const id = (await rep.browser.post('/site-api/cases/hot', hot(stores.Honda!, mgr.id))).json.case.id as number;
    await mgr.browser.post(`/site-api/cases/${id}/accept`, {version: 1});
    await mgr.browser.post(`/site-api/cases/${id}/close`, {version: 2, outcome: 'lost', lostReason: 'price', note: 'Too high'});
    expect((await mgr.browser.post(`/site-api/cases/${id}/reopen`, {version: 3, reason: 'x'})).status).toBe(403);
    expect((await director.browser.post(`/site-api/cases/${id}/reopen`, {version: 3, reason: 'Customer called back'})).status).toBe(200);
    const c = (await detail(mgr.browser, id)).json.case;
    expect(c).toMatchObject({status: 'working', outcome: null});
    // The earlier outcome is still in the history.
    expect(c.events.map((e: {kind: string}) => e.kind)).toEqual(['created', 'accepted', 'outcome', 'reopened']);
  });

  it('the starter list loads once, with routing, and the admin can add a person who signs in by code', async () => {
    const admin = await person('admin@example.test', ['admin'], [], 'group');
    // The template admin role does not hold every Plaza permission; give it the hub's as an owner would.
    await db.userRole.deleteMany({where: {userId: admin.id}});
    const owner = await db.role.findUniqueOrThrow({where: {slug: 'owner'}, select: {id: true}});
    await db.userRole.create({data: {userId: admin.id, roleId: owner.id}});
    const first = await admin.browser.post('/site-api/hub/admin/starter', {});
    expect(first.status).toBe(200);
    expect(first.json.problems).toEqual([]);
    expect(first.json.added).toContain('Unice Bailey');
    const second = await admin.browser.post('/site-api/hub/admin/starter', {});
    expect(second.json.added).toEqual([]);
    const unice = await db.user.findUniqueOrThrow({where: {email: 'uniceb@plazacars.com'}, select: {name: true, passwordHash: true}});
    expect(unice.name).toBe('Unice Bailey');
    // The owner's corrected addresses, not the "first name + last initial" guess.
    for (const email of [
      'adam@plazacars.com',
      'alexzandras@plazacars.com',
      'angel@plazacars.com',
      'mohamedb2@plazacars.com',
      'kevincr@plazacars.com',
      'santiago@plazacars.com',
      'brianta@plazacars.com',
      'dominic@plazacars.com',
      'wilson@plazacars.com',
      'rod@plazacars.com',
      'christopherr@plazacars.com',
      'michaelra@plazacars.com',
    ]) {
      expect(await userId(email)).toEqual(expect.any(Number));
    }
    expect(await db.user.findUnique({where: {email: 'adamr@plazacars.com'}})).toBeNull();
    expect((await db.storeRoute.findUniqueOrThrow({where: {storeId_kind: {storeId: stores.Acura!, kind: 'hot_sales'}}})).userId).toBe(
      await userId('kevincr@plazacars.com')
    );
    const route = await db.storeRoute.findUniqueOrThrow({where: {storeId_kind: {storeId: stores.Honda!, kind: 'hot_bdc'}}});
    expect(route.userId).toBe(await userId('michaelo@plazacars.com'));

    const added = await admin.browser.post('/site-api/hub/admin/people', {
      firstName: 'Rita',
      lastName: 'Rep',
      email: 'ritar@plazacars.com',
      department: 'group',
      storeIds: [],
      roles: ['sales-bdc-rep'],
    });
    expect(added.status).toBe(201);
    const code = await new Browser(app).post('/site-api/auth/code', {email: 'ritar@plazacars.com'});
    expect(code.status).toBe(200);
  });
});

