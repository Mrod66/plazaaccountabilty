import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';

import {configureEnv, DATABASE_URL, db, resetDatabase} from './support/harness';
import {detail, hot, loadPlaza, person, plaza, seedRoles} from './support/hub';

/**
 * Phase 4: the people CSV import, pick lists, stores and CSV export logging,
 * against the real Site API and Postgres.
 */

const row = (line: number, o: Partial<Record<string, string>>) => ({
  line,
  firstName: 'Pat',
  lastName: 'Rep',
  email: `pat${line}@plazacars.test`,
  roles: 'Sales BDC Rep',
  stores: '',
  department: 'Group',
  managerEmail: '',
  active: 'Yes',
  ...o,
});

/** An admin who may hand out every role (the site owner). */
async function owner() {
  const admin = await person('admin@example.test', ['admin'], [], 'group');
  const ownerRole = await db.role.findUniqueOrThrow({where: {slug: 'owner'}});
  await db.userRole.deleteMany({where: {userId: admin.id}});
  await db.userRole.create({data: {userId: admin.id, roleId: ownerRole.id}});
  return admin;
}

describe.skipIf(!DATABASE_URL)('hub settings (integration, real Postgres)', () => {
  beforeAll(async () => {
    configureEnv();
    await loadPlaza();
  });
  beforeEach(async () => {
    await resetDatabase();
    await seedRoles();
    await db.pickOption.deleteMany({where: {orgId: plaza.orgId, code: {startsWith: 'rebate'}}});
    await db.pickOption.updateMany({where: {orgId: plaza.orgId}, data: {active: true}});
  });
  afterAll(() => db.$disconnect());

  it('the people CSV: a preview says what each row will do; apply saves the good rows, can run again, and links managers', async () => {
    const admin = await owner();
    const rows = [
      row(2, {firstName: 'Saad', lastName: 'Miraz', email: 'saadm@plazacars.test', roles: 'Sales Manager', stores: 'Honda', department: 'Sales', managerEmail: 'uniceb@plazacars.test'}),
      row(3, {firstName: 'Unice', lastName: 'Bailey', email: 'uniceb@plazacars.test', roles: 'Director of Operations', department: 'Leadership'}),
      row(4, {firstName: 'Sam', lastName: 'Seller', email: 'sams@plazacars.test', roles: 'Salesperson', stores: 'Acura of Brooklyn; Plaza Kia', department: 'Sales', active: 'No'}),
      row(5, {roles: 'Wizard'}),
      row(6, {email: 'not-an-email'}),
    ];
    const preview = (await admin.browser.post('/site-api/settings/people/preview', {rows})).json.rows as {line: number; action: string; errors: string[]; want: {storeIds: number[]}}[];
    expect(preview.map(r => r.action)).toEqual(['add', 'add', 'add', 'error', 'error']);
    expect(preview[3]!.errors).toEqual(['Unknown role "Wizard".']);
    expect(preview[2]!.want.storeIds.sort()).toEqual([plaza.stores.Acura, plaza.stores.Kia].sort());
    expect(await db.user.count()).toBe(1);

    // First pass: Saad's manager (Unice) is added in the same pass, after him.
    let applied = (await admin.browser.post('/site-api/settings/people/apply', {rows})).json.results as {status: string; roles: string[]; active: boolean; userId: number}[];
    expect(applied.map(r => r.status)).toEqual(['saved', 'saved', 'saved', 'skipped', 'skipped']);
    expect(applied[2]).toMatchObject({roles: ['salesperson'], active: false});
    const saad = await db.user.findUniqueOrThrow({where: {email: 'saadm@plazacars.test'}, select: {id: true, name: true}});
    expect(saad.name).toBe('Saad Miraz');
    expect((await db.staff.findUniqueOrThrow({where: {userId: saad.id}})).managerUserId).toBeNull();

    // Second pass: nothing new, Saad's manager linked.
    applied = (await admin.browser.post('/site-api/settings/people/apply', {rows})).json.results;
    const unice = await db.user.findUniqueOrThrow({where: {email: 'uniceb@plazacars.test'}, select: {id: true}});
    expect((await db.staff.findUniqueOrThrow({where: {userId: saad.id}})).managerUserId).toBe(unice.id);
    expect(await db.user.count()).toBe(4);

    // The browser then sets roles and active through the managed admin API, like this:
    for (const r of applied.filter(x => x.status === 'saved')) {
      expect((await admin.browser.request('PUT', `/site-api/admin/users/${r.userId}/roles`, {roles: r.roles})).status).toBe(200);
      if (!r.active) expect((await admin.browser.request('PATCH', `/site-api/admin/users/${r.userId}`, {status: 'suspended'})).status).toBe(200);
    }
    const again = (await admin.browser.post('/site-api/settings/people/preview', {rows: rows.slice(0, 3)})).json.rows as {action: string}[];
    expect(again.map(r => r.action)).toEqual(['same', 'same', 'same']);

    // Exported in the import's own columns.
    const exported = (await admin.browser.request('GET', '/site-api/settings/people/export')).json.people as {email: string; stores: string[]; active: boolean; managerEmail: string}[];
    expect(exported.find(p => p.email === 'sams@plazacars.test')).toMatchObject({active: false, stores: expect.arrayContaining(['Acura of Brooklyn', 'Plaza Kia'])});
    expect(exported.find(p => p.email === 'saadm@plazacars.test')!.managerEmail).toBe('uniceb@plazacars.test');
  });

  it('only hub admins may import; a rep cannot', async () => {
    const rep = await person('rep@example.test', ['sales-bdc-rep'], [], 'group');
    expect((await rep.browser.post('/site-api/settings/people/preview', {rows: [row(2, {})]})).status).toBe(403);
    expect((await rep.browser.post('/site-api/settings/people/apply', {rows: [row(2, {})]})).status).toBe(403);
    expect((await rep.browser.request('GET', '/site-api/settings/people/export')).status).toBe(403);
    expect((await rep.browser.post('/site-api/settings/export-log', {what: 'Cases', rows: 3})).status).toBe(403);
  });

  it('pick lists: a new reason can be picked; a switched-off one cannot, and old cases keep its label', async () => {
    const admin = await owner();
    const mgr = await person('honda.mgr@example.test', ['sales-manager'], ['Honda']);
    const rep = await person('rep@example.test', ['salesperson'], ['Honda']);
    const added = await admin.browser.post('/site-api/settings/lists', {list: 'reason', label: 'Rebate expired'});
    expect(added.status).toBe(201);
    const option = (added.json.lists.reason as {id: number; value: string; label: string}[]).find(o => o.label === 'Rebate expired')!;
    expect(option.value).toBe('rebate_expired');
    const created = await rep.browser.post('/site-api/cases/hot', hot(plaza.stores.Honda!, mgr.id, {reason: 'rebate_expired'}));
    expect(created.status).toBe(201);

    await admin.browser.request('PATCH', `/site-api/settings/lists/${option.id}`, {active: false});
    const refused = await rep.browser.post('/site-api/cases/hot', hot(plaza.stores.Honda!, mgr.id, {reason: 'rebate_expired', phone: '7185550177'}));
    expect(refused.json.fields).toEqual({reason: expect.any(String)});
    const lists = (await rep.browser.request('GET', '/site-api/settings/lists')).json.lists;
    expect(lists.reason.find((o: {value: string}) => o.value === 'rebate_expired')).toMatchObject({active: false, label: 'Rebate expired'});
    expect((await detail(rep.browser, created.json.case.id)).json.case.reason).toBe('rebate_expired');
    // A rep cannot change the lists.
    expect((await rep.browser.post('/site-api/settings/lists', {list: 'reason', label: 'Mine'})).status).toBe(403);
  });

  it('stores: a new store gets default hours; a renamed one shows its new name', async () => {
    const admin = await owner();
    const res = await admin.browser.post('/site-api/settings/stores', {name: 'Plaza Nissan', shortName: 'Nissan', manufacturer: 'Nissan', hasService: true});
    expect(res.status).toBe(201);
    try {
      expect(await db.businessHours.count({where: {storeId: res.json.id}})).toBe(13);
      expect((await admin.browser.request('PATCH', `/site-api/settings/stores/${res.json.id}`, {name: 'Nissan of Brooklyn', shortName: 'Nissan', manufacturer: 'Nissan', hasService: true})).status).toBe(200);
      expect((await db.store.findUniqueOrThrow({where: {id: res.json.id}})).name).toBe('Nissan of Brooklyn');
    } finally {
      await db.store.delete({where: {id: res.json.id}});
    }
  });

  it('a manager may log an export; it lands in the activity log', async () => {
    const mgr = await person('honda.mgr@example.test', ['sales-manager'], ['Honda']);
    expect((await mgr.browser.post('/site-api/settings/export-log', {what: 'Store Board', rows: 12})).status).toBe(201);
    const event = await db.auditEvent.findFirstOrThrow({where: {action: 'hub.csv_export'}});
    expect(event).toMatchObject({actorUserId: mgr.id, meta: {what: 'Store Board', rows: 12}});
  });
});
