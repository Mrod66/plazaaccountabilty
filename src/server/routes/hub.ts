import {Hono} from 'hono';
import {validator} from 'hono/validator';

import type {PrismaClient} from '../../generated/prisma/client';
import {
  CLOCK_SETTING_KINDS,
  CLOCK_UNITS,
  type ClockSettingRow,
  DEPARTMENTS,
  type HoursRow,
  type HubMe,
  minutesToTime,
  ROUTE_KINDS,
  timeToMinutes,
  valuesOf,
} from '../../lib/hub';
import {audit, canDelegate, getAccess, normalizeEmail, SYSTEM_ROLES} from '../../platform/auth';
import {NO_PASSWORD} from '../../platform/auth/kit';
import {can, problem, requireAuth, requirePermission, withDb, withViewer} from '../../platform/guards';
import {flushEmails} from '../hub/alerts';
import {fillBusinessMinutes, loadSettings, processClocks} from '../hub/clocks';
import {loadHub, withHub} from '../hub/context';
import {asBody, Fields, idOf, invalidInput} from '../hub/input';
import {receivers} from '../hub/people';
import {STARTER_PEOPLE, STARTER_ROUTES, starterEmail} from '../hub/starter';
import {PERMISSIONS} from '../permissions';

/**
 * The hub itself (`/site-api/hub`):
 *
 *   GET  /me                    my organization, stores, department, what I may do
 *
 * Admin (`site:hub:manage`):
 *   GET   /admin/people?q=&before=   everyone in the organization
 *   POST  /admin/people              add a person (makes their account; they sign in with an emailed code)
 *   PATCH /admin/people/:id          name, department, stores, manager
 *   GET   /admin/routing             who each store's new cases go to
 *   PUT   /admin/routing             set one store + kind
 *   POST  /admin/starter             load the starter list (idempotent)
 *
 * Roles of EXISTING people change through the managed `PUT /admin/users/:id/roles`
 * and deactivation through `PATCH /admin/users/:id` (both audited, both
 * anti-escalation). Adding a person gives roles with the same rule
 * (`canDelegate`): nobody hands out access they do not hold.
 */

const PEOPLE_PAGE = 100;

/** Gives a NEW member these roles, if the actor may hand every one of them out. */
async function giveRoles(
  db: PrismaClient,
  held: ReadonlySet<string>,
  actorId: number,
  userId: number,
  slugs: string[]
): Promise<string | null> {
  if (!slugs.length) return null;
  if (slugs.includes(SYSTEM_ROLES.OWNER)) return 'The owner role is not given here.';
  const roles = await db.role.findMany({
    where: {slug: {in: slugs}},
    select: {id: true, name: true, permissions: {select: {permission: {select: {codename: true}}}, take: 200}},
    take: 20,
  });
  if (roles.length !== slugs.length) return 'One of those roles does not exist.';
  for (const role of roles) {
    if (!canDelegate(held, role.permissions.map(p => p.permission.codename))) return `You cannot give the “${role.name}” role.`;
  }
  await db.userRole.createMany({
    data: roles.map(role => ({userId, roleId: role.id, grantedBy: actorId})),
    skipDuplicates: true,
  });
  return null;
}

/** Stores of the organization by id, to check ids sent by the browser. */
async function orgStoreIds(db: PrismaClient, orgId: number) {
  const rows = await db.store.findMany({where: {orgId}, select: {id: true, shortName: true}, take: 100});
  return rows;
}

const personBody = (creating: boolean) =>
  validator('json', (value, c) => {
    const body = asBody(value);
    const f = new Fields(body);
    const input = {
      firstName: f.text('firstName', 40, 'Enter the first name.'),
      lastName: f.text('lastName', 40) ?? '',
      email: creating ? f.email('email') : null,
      department: f.pick('department', valuesOf(DEPARTMENTS), 'Pick a department.'),
      storeIds: f.ids('storeIds', 20),
      managerUserId: f.id('managerUserId', false),
      roles: [] as string[],
    };
    if (creating) {
      if (!input.email && !f.errors.email) f.fail('email', 'Enter their work email, like name@plazacars.com.');
      const raw = body.roles;
      if (Array.isArray(raw) && raw.length <= 10 && raw.every(r => typeof r === 'string' && /^[a-z][a-z0-9-]{0,47}$/.test(r))) {
        input.roles = [...new Set(raw as string[])];
      }
      if (!input.roles.length) f.fail('roles', 'Pick at least one role.');
    }
    return f.ok ? input : c.json(invalidInput(f.errors), 422);
  });

export const hubRoutes = new Hono()
  .get('/me', withViewer, requireAuth, withDb, async c => {
    const db = c.var.db;
    const hub = await loadHub(c as never);
    if (!hub) {
      const none: HubMe & {can: null} = {member: false, org: null, storeIds: [], department: null, stores: [], can: null};
      return c.json(none);
    }
    const [org, stores] = await Promise.all([
      db.organization.findUnique({where: {id: hub.orgId}, select: {id: true, name: true}}),
      db.store.findMany({
        where: {orgId: hub.orgId, active: true},
        select: {id: true, name: true, shortName: true, manufacturer: true, hasService: true},
        orderBy: {sortOrder: 'asc'},
        take: 50,
      }),
    ]);
    const me: HubMe & {can: typeof hub.can} = {
      member: true,
      org,
      storeIds: hub.storeIds,
      department: hub.department,
      stores,
      can: hub.can,
    };
    return c.json(me);
  })

  // ---------------------------------------------------------------- admin

  .get(
    '/admin/people',
    validator('query', v => ({q: typeof v.q === 'string' ? v.q.trim().slice(0, 60) : '', before: typeof v.before === 'string' ? v.before : ''})),
    withViewer,
    requireAuth,
    requirePermission(PERMISSIONS.HUB_MANAGE),
    withDb,
    withHub,
    async c => {
      const {db, hub} = c.var;
      const {q} = c.req.valid('query');
      const before = idOf(c.req.valid('query').before);
      const rows = await db.staff.findMany({
        where: {
          orgId: hub.orgId,
          ...(before ? {userId: {lt: before}} : {}),
          ...(q
            ? {OR: [{firstName: {contains: q, mode: 'insensitive'}}, {lastName: {contains: q, mode: 'insensitive'}}]}
            : {}),
        },
        select: {
          userId: true,
          firstName: true,
          lastName: true,
          department: true,
          managerUserId: true,
          stores: {select: {storeId: true}, take: 50},
        },
        orderBy: {userId: 'desc'},
        take: PEOPLE_PAGE + 1,
      });
      const page = rows.slice(0, PEOPLE_PAGE);
      const ids = page.map(r => r.userId);
      // Emails only for those allowed to see users' emails (site:user:read).
      const showEmail = await can(c as never, PERMISSIONS.USER_READ);
      const [users, roles, managers] = await Promise.all([
        db.user.findMany({
          where: {id: {in: ids}},
          select: {id: true, name: true, email: showEmail, status: true, lastLoginAt: true},
          take: PEOPLE_PAGE,
        }),
        db.userRole.findMany({
          where: {userId: {in: ids}},
          select: {userId: true, role: {select: {slug: true, name: true}}},
          take: 2000,
        }),
        db.user.findMany({
          where: {id: {in: page.map(r => r.managerUserId).filter((x): x is number => x !== null)}},
          select: {id: true, name: true},
          take: PEOPLE_PAGE,
        }),
      ]);
      const byId = new Map(users.map(u => [u.id, u]));
      const managerName = new Map(managers.map(m => [m.id, m.name]));
      const people = page.map(r => {
        const u = byId.get(r.userId);
        return {
          id: r.userId,
          firstName: r.firstName,
          lastName: r.lastName,
          name: u?.name ?? `${r.firstName} ${r.lastName}`.trim(),
          email: showEmail ? ((u as {email?: string} | undefined)?.email ?? null) : null,
          status: u?.status ?? 'suspended',
          lastLoginAt: u?.lastLoginAt?.toISOString() ?? null,
          department: r.department,
          storeIds: r.stores.map(s => s.storeId),
          manager: r.managerUserId ? {id: r.managerUserId, name: managerName.get(r.managerUserId) ?? 'Former user'} : null,
          roles: roles.filter(x => x.userId === r.userId && x.role.slug !== 'member').map(x => x.role),
        };
      });
      return c.json({people, nextBefore: rows.length > PEOPLE_PAGE ? page.at(-1)!.userId : null});
    }
  )

  .post('/admin/people', personBody(true), withViewer, requireAuth, requirePermission(PERMISSIONS.HUB_MANAGE), withDb, withHub, async c => {
    const {db, hub} = c.var;
    const input = c.req.valid('json');
    const email = normalizeEmail(input.email);
    if (!email) return c.json(invalidInput({email: 'Enter their work email, like name@plazacars.com.'}), 422);
    const stores = await orgStoreIds(db, hub.orgId);
    if (!input.storeIds.every(id => stores.some(s => s.id === id))) return c.json(invalidInput({storeIds: 'Pick stores from the list.'}), 422);
    if (input.managerUserId) {
      const manager = await db.staff.findFirst({where: {userId: input.managerUserId, orgId: hub.orgId}, select: {userId: true}});
      if (!manager) return c.json(invalidInput({managerUserId: 'Pick their manager from the list.'}), 422);
    }
    const name = `${input.firstName} ${input.lastName}`.trim().slice(0, 80);
    let user = await db.user.findUnique({where: {email}, select: {id: true}});
    if (user && (await db.staff.findUnique({where: {userId: user.id}, select: {userId: true}}))) {
      return c.json(invalidInput({email: 'This person is already in the hub. Find them in the list to change them.'}), 422);
    }
    // A new account with NO password: they sign in with a 6-digit code emailed
    // to this address (/account/login/), and may set a password in Your account.
    user ??= await db.user.create({data: {email, name, passwordHash: NO_PASSWORD}, select: {id: true}});
    await db.staff.create({
      data: {
        userId: user.id,
        orgId: hub.orgId,
        firstName: input.firstName!,
        lastName: input.lastName,
        department: input.department!,
        managerUserId: input.managerUserId,
        stores: {create: input.storeIds.map(storeId => ({storeId}))},
      },
      select: {userId: true},
    });
    const {permissions} = await getAccess(c.req.raw);
    const refused = await giveRoles(db, new Set(permissions), hub.userId, user.id, input.roles);
    await audit(db, {actorUserId: hub.userId, action: 'hub.person_added', target: ['user', user.id], meta: {roles: input.roles}});
    return c.json({id: user.id, rolesRefused: refused}, 201);
  })

  .patch('/admin/people/:id', personBody(false), withViewer, requireAuth, requirePermission(PERMISSIONS.HUB_MANAGE), withDb, withHub, async c => {
    const {db, hub} = c.var;
    const input = c.req.valid('json');
    const userId = idOf(c.req.param('id'));
    const person = userId ? await db.staff.findFirst({where: {userId, orgId: hub.orgId}, select: {userId: true}}) : null;
    if (!person) return c.json(problem('not_found', 'No such person in your organization.'), 404);
    const stores = await orgStoreIds(db, hub.orgId);
    if (!input.storeIds.every(id => stores.some(s => s.id === id))) return c.json(invalidInput({storeIds: 'Pick stores from the list.'}), 422);
    if (input.managerUserId === person.userId) return c.json(invalidInput({managerUserId: 'Someone cannot be their own manager.'}), 422);
    if (input.managerUserId) {
      const manager = await db.staff.findFirst({where: {userId: input.managerUserId, orgId: hub.orgId}, select: {userId: true}});
      if (!manager) return c.json(invalidInput({managerUserId: 'Pick their manager from the list.'}), 422);
    }
    await db.$transaction([
      db.staff.update({
        where: {userId: person.userId},
        data: {firstName: input.firstName!, lastName: input.lastName, department: input.department!, managerUserId: input.managerUserId},
        select: {userId: true},
      }),
      db.staffStore.deleteMany({where: {userId: person.userId}}),
      db.staffStore.createMany({data: input.storeIds.map(storeId => ({userId: person.userId, storeId}))}),
      db.user.update({
        where: {id: person.userId},
        data: {name: `${input.firstName} ${input.lastName}`.trim().slice(0, 80)},
        select: {id: true},
      }),
    ]);
    await audit(db, {actorUserId: hub.userId, action: 'hub.person_changed', target: ['user', person.userId]});
    return c.json({ok: true});
  })

  .get('/admin/routing', withViewer, requireAuth, requirePermission(PERMISSIONS.HUB_MANAGE), withDb, withHub, async c => {
    const {db, hub} = c.var;
    const stores = await db.store.findMany({
      where: {orgId: hub.orgId, active: true},
      select: {id: true, name: true, shortName: true, hasService: true, routes: {select: {kind: true, userId: true}}},
      orderBy: {sortOrder: 'asc'},
      take: 50,
    });
    const candidates = await Promise.all(stores.map(store => receivers(db, hub.orgId, store.id)));
    return c.json({
      stores: stores.map((store, i) => ({
        id: store.id,
        name: store.name,
        hasService: store.hasService,
        routes: Object.fromEntries(store.routes.map(r => [r.kind, r.userId])),
        candidates: candidates[i],
      })),
    });
  })

  .put(
    '/admin/routing',
    validator('json', (value, c) => {
      const f = new Fields(asBody(value));
      const out = {
        storeId: f.id('storeId', 'Pick a store.'),
        kind: f.pick('kind', valuesOf(ROUTE_KINDS), 'Pick a kind of case.'),
        userId: f.id('userId', false),
      };
      return f.ok ? out : c.json(invalidInput(f.errors), 422);
    }),
    withViewer,
    requireAuth,
    requirePermission(PERMISSIONS.HUB_MANAGE),
    withDb,
    withHub,
    async c => {
      const {db, hub} = c.var;
      const {storeId, kind, userId} = c.req.valid('json');
      const store = await db.store.findFirst({where: {id: storeId!, orgId: hub.orgId}, select: {id: true}});
      if (!store) return c.json(problem('not_found', 'No such store.'), 404);
      if (!userId) {
        await db.storeRoute.deleteMany({where: {storeId: store.id, kind: kind!}});
        return c.json({ok: true});
      }
      const allowed = await receivers(db, hub.orgId, store.id);
      if (!allowed.some(p => p.id === userId)) {
        return c.json(invalidInput({userId: 'Pick a manager of this store (someone whose role receives cases).'}), 422);
      }
      await db.storeRoute.upsert({
        where: {storeId_kind: {storeId: store.id, kind: kind!}},
        create: {storeId: store.id, kind: kind!, userId},
        update: {userId},
      });
      return c.json({ok: true});
    }
  )

  /** The starter list: adds whoever is missing, fills empty routes. Safe to run again. */
  .post('/admin/starter', withViewer, requireAuth, requirePermission(PERMISSIONS.HUB_MANAGE), withDb, withHub, async c => {
    const {db, hub} = c.var;
    const stores = await orgStoreIds(db, hub.orgId);
    const storeId = new Map(stores.map(s => [s.shortName, s.id]));
    const {permissions} = await getAccess(c.req.raw);
    const held = new Set(permissions);
    const emails = STARTER_PEOPLE.map(starterEmail);
    const existing = await db.user.findMany({where: {email: {in: emails}}, select: {id: true, email: true}, take: 100});
    const idOfEmail = new Map(existing.map(u => [u.email, u.id]));
    const added: string[] = [];
    const skipped: string[] = [];
    const problems: string[] = [];
    // Bounded: the list is ~35 people, each a handful of small writes.
    for (const person of STARTER_PEOPLE) {
      const email = starterEmail(person);
      const name = `${person.firstName} ${person.lastName}`.trim();
      let id = idOfEmail.get(email);
      if (id && (await db.staff.findUnique({where: {userId: id}, select: {userId: true}}))) {
        skipped.push(name);
        continue;
      }
      id ??= (await db.user.create({data: {email, name, passwordHash: NO_PASSWORD}, select: {id: true}})).id;
      idOfEmail.set(email, id);
      await db.staff.create({
        data: {
          userId: id,
          orgId: hub.orgId,
          firstName: person.firstName,
          lastName: person.lastName,
          department: person.department,
          stores: {create: person.stores.map(s => storeId.get(s)).filter((x): x is number => x !== undefined).map(sid => ({storeId: sid}))},
        },
        select: {userId: true},
      });
      const refused = await giveRoles(db, held, hub.userId, id, person.roles);
      if (refused) problems.push(`${name}: ${refused}`);
      added.push(name);
    }
    // Managers (BDC managers report to the BDC Director).
    const byName = new Map(STARTER_PEOPLE.map(p => [`${p.firstName} ${p.lastName}`.trim(), idOfEmail.get(starterEmail(p))]));
    for (const person of STARTER_PEOPLE) {
      const manager = person.manager ? byName.get(person.manager) : undefined;
      const id = byName.get(`${person.firstName} ${person.lastName}`.trim());
      if (manager && id) await db.staff.updateMany({where: {userId: id, managerUserId: null}, data: {managerUserId: manager}});
    }
    // Routing: only the routes still empty.
    const taken = await db.storeRoute.findMany({where: {storeId: {in: stores.map(s => s.id)}}, select: {storeId: true, kind: true}, take: 200});
    const has = new Set(taken.map(t => `${t.storeId}:${t.kind}`));
    const routes = STARTER_ROUTES.map(r => ({storeId: storeId.get(r.store), kind: r.kind, userId: byName.get(r.person)})).filter(
      (r): r is {storeId: number; kind: string; userId: number} => !!r.storeId && !!r.userId && !has.has(`${r.storeId}:${r.kind}`)
    );
    if (routes.length) await db.storeRoute.createMany({data: routes, skipDuplicates: true});
    await audit(db, {actorUserId: hub.userId, action: 'hub.starter_loaded', meta: {added: added.length}});
    return c.json({added, skipped, problems, routesSet: routes.length});
  })

  // ---------------------------------------------------------------- clocks and hours

  .get('/admin/clocks', withViewer, requireAuth, requirePermission(PERMISSIONS.HUB_MANAGE), withDb, withHub, async c => {
    const {db, hub} = c.var;
    const [settings, stores, hours] = await Promise.all([
      loadSettings(db, hub.orgId),
      db.store.findMany({where: {orgId: hub.orgId, active: true}, select: {id: true, name: true, hasService: true}, orderBy: {sortOrder: 'asc'}, take: 50}),
      db.businessHours.findMany({
        where: {store: {orgId: hub.orgId}},
        select: {storeId: true, department: true, weekday: true, openMin: true, closeMin: true},
        take: 1000,
      }),
    ]);
    const rows: ClockSettingRow[] = Object.entries(settings).flatMap(([caseType, kinds]) =>
      Object.entries(kinds).map(([kind, v]) => ({caseType, kind, amount: v.amount, unit: v.unit}))
    );
    const table: HoursRow[] = stores.flatMap(store =>
      (store.hasService ? ['sales', 'service'] : ['sales']).map(department => ({
        storeId: store.id,
        storeName: store.name,
        department,
        days: [0, 1, 2, 3, 4, 5, 6].map(weekday => {
          const h = hours.find(x => x.storeId === store.id && x.department === department && x.weekday === weekday);
          return h ? {open: minutesToTime(h.openMin), close: minutesToTime(h.closeMin)} : null;
        }),
      }))
    );
    return c.json({settings: rows, hours: table});
  })

  /** One clock setting. New clocks use it; clocks already running keep their deadline. */
  .put(
    '/admin/clocks',
    validator('json', (value, c) => {
      const f = new Fields(asBody(value));
      const out = {
        caseType: f.pick('caseType', ['hot', 'csi'] as const, 'Pick the case type.'),
        kind: f.pick('kind', valuesOf(CLOCK_SETTING_KINDS), 'Pick the clock.'),
        amount: f.int('amount', 1, 999, 'Enter a whole number from 1 to 999.'),
        unit: f.pick('unit', valuesOf(CLOCK_UNITS), 'Pick minutes, hours or days.'),
      };
      if (out.amount === null && !f.errors.amount) f.fail('amount', 'Enter a whole number from 1 to 999.');
      return f.ok ? out : c.json(invalidInput(f.errors), 422);
    }),
    withViewer,
    requireAuth,
    requirePermission(PERMISSIONS.HUB_MANAGE),
    withDb,
    withHub,
    async c => {
      const {db, hub} = c.var;
      const {caseType, kind, amount, unit} = c.req.valid('json');
      await db.clockSetting.upsert({
        where: {orgId_caseType_kind: {orgId: hub.orgId, caseType: caseType!, kind: kind!}},
        create: {orgId: hub.orgId, caseType: caseType!, kind: kind!, amount: amount!, unit: unit!},
        update: {amount: amount!, unit: unit!},
      });
      await audit(db, {actorUserId: hub.userId, action: 'hub.clock_changed', meta: {caseType: caseType!, kind: kind!, amount: amount!, unit: unit!}});
      return c.json({ok: true});
    }
  )

  /** One store department's week: 7 days, Sunday first, each `{open, close}` ('HH:MM') or null = closed. */
  .put(
    '/admin/hours',
    validator('json', (value, c) => {
      const body = asBody(value);
      const f = new Fields(body);
      const storeId = f.id('storeId', 'Pick a store.');
      const department = f.pick('department', ['sales', 'service'] as const, 'Pick sales or service.');
      const days = Array.isArray(body.days) && body.days.length === 7 ? body.days : null;
      const out: {weekday: number; openMin: number; closeMin: number}[] = [];
      if (!days) f.fail('days', 'Send all seven days.');
      else
        days.forEach((day, weekday) => {
          if (day === null) return;
          const d = asBody(day);
          const open = typeof d.open === 'string' ? timeToMinutes(d.open) : null;
          const close = typeof d.close === 'string' ? timeToMinutes(d.close) : null;
          if (open === null || close === null || close <= open) {
            f.fail(`day${weekday}`, 'Opening must be before closing, like 09:00 to 21:00.');
          } else out.push({weekday, openMin: open, closeMin: close});
        });
      return f.ok ? {storeId: storeId!, department: department!, days: out} : c.json(invalidInput(f.errors), 422);
    }),
    withViewer,
    requireAuth,
    requirePermission(PERMISSIONS.HUB_MANAGE),
    withDb,
    withHub,
    async c => {
      const {db, hub} = c.var;
      const {storeId, department, days} = c.req.valid('json');
      const store = await db.store.findFirst({where: {id: storeId, orgId: hub.orgId}, select: {id: true, hasService: true}});
      if (!store) return c.json(problem('not_found', 'No such store.'), 404);
      if (department === 'service' && !store.hasService) return c.json(problem('invalid_input', 'This store has no service department.'), 422);
      await db.$transaction([
        db.businessHours.deleteMany({where: {storeId: store.id, department}}),
        db.businessHours.createMany({data: days.map(d => ({...d, storeId: store.id, department}))}),
      ]);
      await audit(db, {actorUserId: hub.userId, action: 'hub.hours_changed', target: ['store', store.id], meta: {department}});
      return c.json({ok: true});
    }
  )

  /**
   * Runs the clock check and the email batches now (the 5-minute sweep does
   * this on its own on the live site; schedules do not tick in the Preview).
   */
  .post('/admin/run-checks', withViewer, requireAuth, requirePermission(PERMISSIONS.HUB_MANAGE), withDb, withHub, async c => {
    const {db} = c.var;
    const now = new Date();
    const alerted = await processClocks(db, now);
    const emails = await flushEmails(db, now);
    await fillBusinessMinutes(db);
    return c.json({alerted: alerted.size, emails});
  });
