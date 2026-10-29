import {Hono} from 'hono';
import {validator} from 'hono/validator';

import type {PrismaClient} from '../../generated/prisma/client';
import {splitList} from '../../lib/csv';
import {audit, normalizeEmail, SYSTEM_ROLES} from '../../platform/auth';
import {NO_PASSWORD} from '../../platform/auth/kit';
import {can, problem, requireAuth, requirePermission, withDb, withViewer} from '../../platform/guards';
import {withHub} from '../hub/context';
import {asBody, Fields, idOf, invalidInput} from '../hub/input';
import {codeFor, loadLists, PICK_LISTS, type PickList} from '../hub/lists';
import {PERMISSIONS} from '../permissions';

/**
 * Admin settings (`/site-api/settings`), build prompt sections 9 H and 12:
 *
 *   GET   /lists                  the pick lists (every hub member: the forms use them)
 *   POST  /lists, PATCH /lists/:id   add an option; rename, reorder, switch off/on (site:hub:manage)
 *   GET   /stores, POST /stores, PATCH /stores/:id   the store list (site:hub:manage)
 *   POST  /people/preview         check a people CSV, row by row; nothing is saved
 *   POST  /people/apply           save up to 50 checked rows (accounts, names, stores, department, manager)
 *   GET   /people/export          everyone, in the import's own columns (with emails: site:user:read)
 *   POST  /export-log             an audit line for a CSV export (site:hub:export)
 *
 * Roles and active/inactive from an import are applied by the browser through
 * the MANAGED, audited admin API (`PUT /admin/users/:id/roles`,
 * `PATCH /admin/users/:id`): the same anti-escalation rule and session
 * sign-out as the People screen. The preview says what each row will change.
 */

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Every option of every list, as rows (an organization without rows gets the built-in ones first). */
async function ensureLists(db: PrismaClient, orgId: number) {
  const existing = await db.pickOption.findFirst({where: {orgId}, select: {id: true}});
  if (existing) return;
  const lists = await loadLists(db, orgId);
  await db.pickOption.createMany({
    data: PICK_LISTS.flatMap(list => lists[list].map((o, i) => ({orgId, list, code: o.value, label: o.label, sortOrder: o.value === 'other' ? 99 : i + 1}))),
    skipDuplicates: true,
  });
}

const DEFAULT_HOURS: Record<string, [number, number, number][]> = {
  sales: [
    [1, 540, 1260],
    [2, 540, 1260],
    [3, 540, 1260],
    [4, 540, 1260],
    [5, 540, 1260],
    [6, 540, 1140],
    [0, 660, 1020],
  ],
  service: [
    [1, 450, 1080],
    [2, 450, 1080],
    [3, 450, 1080],
    [4, 450, 1080],
    [5, 450, 1080],
    [6, 480, 960],
  ],
};

const storeBody = (creating: boolean) =>
  validator('json', (value, c) => {
    const body = asBody(value);
    const f = new Fields(body);
    const out = {
      name: f.text('name', 80, 'Enter the store name, like Plaza Honda.'),
      shortName: f.text('shortName', 32, 'Enter a short label, like Honda.'),
      manufacturer: f.text('manufacturer', 32, 'Enter the manufacturer, like Honda (or Used).'),
      hasService: f.bool('hasService'),
      address: f.text('address', 200),
      active: creating ? true : body.active !== false,
    };
    return f.ok ? out : c.json(invalidInput(f.errors), 422);
  });

type CsvRow = {
  line: number;
  firstName: string;
  lastName: string;
  email: string;
  roles: string;
  stores: string;
  department: string;
  managerEmail: string;
  active: string;
};

const rowsBody = (max: number) =>
  validator('json', (value, c) => {
    const rows = asBody(value).rows;
    if (!Array.isArray(rows) || rows.length === 0 || rows.length > max) {
      return c.json(problem('invalid_input', `Send 1 to ${max} rows at a time.`), 422);
    }
    const text = (v: unknown, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
    return {
      rows: rows.map((r, i): CsvRow => {
        const o = asBody(r);
        return {
          line: Number.isSafeInteger(o.line) ? (o.line as number) : i + 2,
          firstName: text(o.firstName, 60),
          lastName: text(o.lastName, 60),
          email: text(o.email, 254).toLowerCase(),
          roles: text(o.roles, 300),
          stores: text(o.stores, 300),
          department: text(o.department, 40),
          managerEmail: text(o.managerEmail, 254).toLowerCase(),
          active: text(o.active, 20),
        };
      }),
    };
  });

export type ImportCheck = {
  line: number;
  email: string;
  name: string;
  /** add (a new account), update, same (nothing to change), error (skipped). */
  action: 'add' | 'update' | 'same' | 'error';
  errors: string[];
  notes: string[];
  changes: string[];
  /** What the row wants, for the apply step. */
  want: {firstName: string; lastName: string; department: string; storeIds: number[]; roles: string[]; active: boolean; managerEmail: string | null};
  /** The account, when it exists. */
  userId: number | null;
  /** Roles (slugs) the account has now, and whether it is active now. */
  currentRoles: string[];
  currentActive: boolean | null;
};

/** Reads and checks people rows against the organization: nothing is saved. */
async function checkRows(db: PrismaClient, orgId: number, viewerId: number, rows: CsvRow[]): Promise<ImportCheck[]> {
  const emails = [...new Set(rows.map(r => r.email).filter(Boolean))];
  const managerEmails = [...new Set(rows.map(r => r.managerEmail).filter(Boolean))];
  const [stores, roles, users] = await Promise.all([
    db.store.findMany({where: {orgId}, select: {id: true, name: true, shortName: true}, take: 100}),
    db.role.findMany({select: {slug: true, name: true}, take: 100}),
    db.user.findMany({
      where: {email: {in: [...new Set([...emails, ...managerEmails])]}},
      select: {
        id: true,
        email: true,
        status: true,
        roles: {select: {role: {select: {slug: true}}}},
      },
      take: 1000,
    }),
  ]);
  const staff = await db.staff.findMany({
    where: {userId: {in: users.map(u => u.id)}},
    select: {userId: true, orgId: true, firstName: true, lastName: true, department: true, managerUserId: true, stores: {select: {storeId: true}}},
    take: 1000,
  });
  const userOf = new Map(users.map(u => [u.email, u]));
  const staffOf = new Map(staff.map(s => [s.userId, s]));
  const inCsv = new Set(emails);
  const roleOf = (word: string) => {
    const w = norm(word);
    return roles.find(
      r =>
        r.slug !== SYSTEM_ROLES.OWNER &&
        r.slug !== 'member' &&
        (norm(r.slug) === w || norm(r.name) === w || r.name.split('/').some(part => norm(part) === w))
    );
  };
  const storeOf = (word: string) => {
    const w = norm(word).replace(/^plaza/, '');
    return stores.find(s => [s.name, s.shortName].some(x => norm(x) === norm(word) || norm(x).replace(/^plaza/, '') === w));
  };
  const seen = new Set<string>();

  return rows.map(row => {
    const errors: string[] = [];
    const notes: string[] = [];
    if (!row.firstName) errors.push('First name is empty.');
    else if (row.firstName.length > 40) errors.push('First name: use at most 40 characters.');
    if (row.lastName.length > 40) errors.push('Last name: use at most 40 characters.');
    const email = normalizeEmail(row.email);
    if (!email) errors.push('Email is not a valid address.');
    else if (seen.has(email)) errors.push('This email is on an earlier row too.');
    if (email) seen.add(email);

    const roleSlugs: string[] = [];
    const roleWords = splitList(row.roles);
    if (!roleWords.length) errors.push('Role(s) is empty: give at least one role, like "Sales Manager".');
    for (const word of roleWords) {
      const role = roleOf(word);
      if (role) roleSlugs.push(role.slug);
      else errors.push(`Unknown role "${word}".`);
    }
    const storeIds: number[] = [];
    for (const word of splitList(row.stores)) {
      const store = storeOf(word);
      if (store) storeIds.push(store.id);
      else errors.push(`Unknown store "${word}".`);
    }
    const d = norm(row.department);
    const department = ['sales'].includes(d)
      ? 'sales'
      : ['service', 'parts'].includes(d)
        ? 'service'
        : ['group', 'bdc', 'csi', 'leadership', 'admin', 'management', ''].includes(d)
          ? d === '' && storeIds.length
            ? 'sales'
            : 'group'
          : null;
    if (!department) errors.push(`Unknown department "${row.department}": use Sales, Service or Group.`);
    const a = norm(row.active);
    const active = ['', 'yes', 'y', 'true', '1', 'active'].includes(a) ? true : ['no', 'n', 'false', '0', 'inactive', 'deactivated'].includes(a) ? false : null;
    if (active === null) errors.push(`Active must be Yes or No (not "${row.active}").`);
    let managerEmail: string | null = null;
    if (row.managerEmail) {
      if (row.managerEmail === email) errors.push('Someone cannot be their own manager.');
      else if (!inCsv.has(row.managerEmail) && !(userOf.get(row.managerEmail) && staffOf.get(userOf.get(row.managerEmail)!.id)?.orgId === orgId)) {
        notes.push(`Manager ${row.managerEmail} is not in this file or the hub: left empty.`);
      } else managerEmail = row.managerEmail;
    }

    const user = email ? userOf.get(email) : undefined;
    const profile = user ? staffOf.get(user.id) : undefined;
    if (profile && profile.orgId !== orgId) errors.push('This email belongs to another organization.');
    const currentRoles = user ? user.roles.map(r => r.role.slug) : [];
    const wantRoles = [...new Set(roleSlugs)];
    const name = `${row.firstName} ${row.lastName}`.trim();
    const want = {
      firstName: row.firstName,
      lastName: row.lastName,
      department: department ?? 'group',
      storeIds: [...new Set(storeIds)],
      roles: wantRoles,
      active: active ?? true,
      managerEmail,
    };
    if (user?.id === viewerId) {
      notes.push('This is you: your own roles and active state are left as they are.');
      want.roles = currentRoles;
      want.active = true;
    }
    if (errors.length) {
      return {line: row.line, email: email ?? row.email, name, action: 'error', errors, notes, changes: [], want, userId: user?.id ?? null, currentRoles, currentActive: user ? user.status === 'active' : null};
    }

    const changes: string[] = [];
    if (!user) changes.push('New account (signs in with a code emailed to this address)');
    if (!profile) changes.push('Added to the hub');
    else {
      if (profile.firstName !== want.firstName || profile.lastName !== want.lastName) changes.push(`Name → ${name}`);
      if (profile.department !== want.department) changes.push(`Department → ${want.department}`);
      const now = profile.stores.map(s => s.storeId).sort().join(',');
      if (now !== [...want.storeIds].sort().join(',')) changes.push('Stores changed');
    }
    // The import sets the Plaza roles; it never takes away Owner, Admin or the basic account role.
    if (user?.id !== viewerId) {
      const kept = currentRoles.filter(r => r === SYSTEM_ROLES.OWNER || r === 'admin' || r === 'member');
      want.roles = [...new Set([...kept, ...wantRoles])];
    }
    const same = (a: string[], b: string[]) => [...a].sort().join(',') === [...b].sort().join(',');
    if (user && !same(currentRoles, want.roles)) changes.push('Roles changed');
    if (!user) changes.push(`Roles: ${want.roles.join(', ')}`);
    const currentActive = user ? user.status === 'active' : null;
    if (user && currentActive !== want.active) changes.push(want.active ? 'Reactivated' : 'Deactivated (keeps their history)');
    if (!user && !want.active) changes.push('Starts deactivated');
    if (profile && managerEmail && profile.managerUserId !== (userOf.get(managerEmail)?.id ?? -1)) changes.push(`Manager → ${managerEmail}`);
    if (profile && !managerEmail && profile.managerUserId) changes.push('Manager cleared');
    return {
      line: row.line,
      email: email!,
      name,
      action: !user || !profile ? 'add' : changes.length ? 'update' : 'same',
      errors,
      notes,
      changes,
      want,
      userId: user?.id ?? null,
      currentRoles,
      currentActive,
    };
  });
}

export const settingsRoutes = new Hono()
  // ---------------------------------------------------------------- pick lists

  .get('/lists', withViewer, requireAuth, withDb, withHub, async c => {
    const {db, hub} = c.var;
    return c.json({lists: await loadLists(db, hub.orgId)});
  })

  .post(
    '/lists',
    validator('json', (value, c) => {
      const f = new Fields(asBody(value));
      const out = {list: f.pick('list', PICK_LISTS, 'Pick a list.'), label: f.text('label', 60, 'Enter the option, like "Rebate expired".')};
      return f.ok ? out : c.json(invalidInput(f.errors), 422);
    }),
    withViewer,
    requireAuth,
    requirePermission(PERMISSIONS.HUB_MANAGE),
    withDb,
    withHub,
    async c => {
      const {db, hub} = c.var;
      const {list, label} = c.req.valid('json') as {list: PickList; label: string};
      await ensureLists(db, hub.orgId);
      const rows = await db.pickOption.findMany({where: {orgId: hub.orgId, list}, select: {code: true, label: true, sortOrder: true}, take: 200});
      if (rows.some(r => r.label.toLowerCase() === label.toLowerCase())) return c.json(invalidInput({label: 'That option is already in the list.'}), 422);
      const last = Math.max(0, ...rows.filter(r => r.sortOrder < 99).map(r => r.sortOrder));
      await db.pickOption.create({
        data: {orgId: hub.orgId, list, label, code: codeFor(label, new Set(rows.map(r => r.code))), sortOrder: last + 1},
        select: {id: true},
      });
      await audit(db, {actorUserId: hub.userId, action: 'hub.list_option_added', meta: {list}});
      return c.json({lists: await loadLists(db, hub.orgId)}, 201);
    }
  )

  .patch(
    '/lists/:id',
    validator('json', (value, c) => {
      const body = asBody(value);
      const f = new Fields(body);
      const out = {
        label: body.label === undefined ? null : f.text('label', 60, 'Enter the option text.'),
        active: typeof body.active === 'boolean' ? body.active : null,
        move: f.pick('move', ['up', 'down'] as const, false),
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
      const {label, active, move} = c.req.valid('json');
      await ensureLists(db, hub.orgId);
      const id = idOf(c.req.param('id'));
      const row = id ? await db.pickOption.findFirst({where: {id, orgId: hub.orgId}, select: {id: true, list: true, active: true}}) : null;
      if (!row) return c.json(problem('not_found', 'No such option.'), 404);
      if (active === false) {
        const others = await db.pickOption.findMany({where: {orgId: hub.orgId, list: row.list, active: true, id: {not: row.id}}, select: {id: true}, take: 1});
        if (!others.length) return c.json(problem('last_option', 'Keep at least one option switched on.'), 409);
      }
      if (move) {
        // Swap places with the neighbour; then number the list 1, 2, 3… again.
        const rows = await db.pickOption.findMany({
          where: {orgId: hub.orgId, list: row.list},
          select: {id: true},
          orderBy: [{sortOrder: 'asc'}, {id: 'asc'}],
          take: 200,
        });
        const at = rows.findIndex(r => r.id === row.id);
        const to = move === 'up' ? at - 1 : at + 1;
        if (to >= 0 && to < rows.length) [rows[at], rows[to]] = [rows[to]!, rows[at]!];
        await db.$transaction(rows.map((r, i) => db.pickOption.update({where: {id: r.id}, data: {sortOrder: i + 1}, select: {id: true}})));
      }
      if (label !== null || active !== null) {
        await db.pickOption.update({
          where: {id: row.id},
          data: {...(label !== null ? {label} : {}), ...(active !== null ? {active} : {})},
          select: {id: true},
        });
      }
      await audit(db, {actorUserId: hub.userId, action: 'hub.list_option_changed', target: ['pick_option', row.id]});
      return c.json({lists: await loadLists(db, hub.orgId)});
    }
  )

  // ---------------------------------------------------------------- stores

  .get('/stores', withViewer, requireAuth, requirePermission(PERMISSIONS.HUB_MANAGE), withDb, withHub, async c => {
    const {db, hub} = c.var;
    const stores = await db.store.findMany({
      where: {orgId: hub.orgId},
      select: {id: true, name: true, shortName: true, manufacturer: true, hasService: true, address: true, active: true, sortOrder: true},
      orderBy: {sortOrder: 'asc'},
      take: 100,
    });
    return c.json({stores});
  })

  .post('/stores', storeBody(true), withViewer, requireAuth, requirePermission(PERMISSIONS.HUB_MANAGE), withDb, withHub, async c => {
    const {db, hub} = c.var;
    const input = c.req.valid('json');
    const last = await db.store.findFirst({where: {orgId: hub.orgId}, select: {sortOrder: true}, orderBy: {sortOrder: 'desc'}});
    const store = await db.store.create({
      data: {
        orgId: hub.orgId,
        name: input.name!,
        shortName: input.shortName!,
        manufacturer: input.manufacturer!,
        hasService: input.hasService,
        address: input.address,
        sortOrder: (last?.sortOrder ?? 0) + 1,
        // Default hours (edit them in Clocks and hours).
        hours: {
          create: (input.hasService ? ['sales', 'service'] : ['sales']).flatMap(department =>
            DEFAULT_HOURS[department]!.map(([weekday, openMin, closeMin]) => ({department, weekday, openMin, closeMin}))
          ),
        },
      },
      select: {id: true},
    });
    await audit(db, {actorUserId: hub.userId, action: 'hub.store_added', target: ['store', store.id]});
    return c.json({id: store.id}, 201);
  })

  .patch('/stores/:id', storeBody(false), withViewer, requireAuth, requirePermission(PERMISSIONS.HUB_MANAGE), withDb, withHub, async c => {
    const {db, hub} = c.var;
    const input = c.req.valid('json');
    const id = idOf(c.req.param('id'));
    const store = id ? await db.store.findFirst({where: {id, orgId: hub.orgId}, select: {id: true, hasService: true}}) : null;
    if (!store) return c.json(problem('not_found', 'No such store.'), 404);
    await db.$transaction([
      db.store.update({
        where: {id: store.id},
        data: {
          name: input.name!,
          shortName: input.shortName!,
          manufacturer: input.manufacturer!,
          hasService: input.hasService,
          address: input.address,
          active: input.active,
        },
        select: {id: true},
      }),
      // A store that now has a service department gets default service hours.
      ...(input.hasService && !store.hasService
        ? [
            db.businessHours.createMany({
              data: DEFAULT_HOURS.service!.map(([weekday, openMin, closeMin]) => ({storeId: store.id, department: 'service', weekday, openMin, closeMin})),
              skipDuplicates: true,
            }),
          ]
        : []),
    ]);
    await audit(db, {actorUserId: hub.userId, action: 'hub.store_changed', target: ['store', store.id]});
    return c.json({ok: true});
  })

  // ---------------------------------------------------------------- people CSV

  .post('/people/preview', rowsBody(1000), withViewer, requireAuth, requirePermission(PERMISSIONS.HUB_MANAGE), withDb, withHub, async c => {
    const {db, hub} = c.var;
    return c.json({rows: await checkRows(db, hub.orgId, hub.userId, c.req.valid('json').rows)});
  })

  /**
   * Saves up to 50 rows: new accounts (no password, no roles yet), the hub
   * profile, stores, department and (when the manager is in the hub) manager.
   * Rows with errors are skipped. Run twice, managers who were added later
   * in the same file get linked on the second pass. Answers, per row, the
   * roles and active state the browser still has to set through the managed API.
   */
  .post('/people/apply', rowsBody(50), withViewer, requireAuth, requirePermission(PERMISSIONS.HUB_MANAGE), withDb, withHub, async c => {
    const {db, hub} = c.var;
    const checks = await checkRows(db, hub.orgId, hub.userId, c.req.valid('json').rows);
    const managerEmails = [...new Set(checks.map(r => r.want.managerEmail).filter((e): e is string => !!e))];
    const managers = await db.user.findMany({where: {email: {in: managerEmails}}, select: {id: true, email: true}, take: 100});
    const managerOf = new Map(managers.map(m => [m.email, m.id]));
    const results: {line: number; email: string; userId: number | null; status: 'saved' | 'skipped' | 'error'; message?: string; roles: string[]; active: boolean}[] = [];
    for (const row of checks) {
      if (row.action === 'error') {
        results.push({line: row.line, email: row.email, userId: null, status: 'skipped', message: row.errors.join(' '), roles: [], active: true});
        continue;
      }
      try {
        const name = row.name.slice(0, 80);
        const userId = row.userId ?? (await db.user.create({data: {email: row.email, name, passwordHash: NO_PASSWORD}, select: {id: true}})).id;
        const managerUserId = row.want.managerEmail ? (managerOf.get(row.want.managerEmail) ?? null) : null;
        const profile = {
          firstName: row.want.firstName.slice(0, 40),
          lastName: row.want.lastName.slice(0, 40),
          department: row.want.department,
          ...(managerUserId !== userId ? {managerUserId} : {}),
        };
        await db.$transaction([
          db.staff.upsert({where: {userId}, create: {userId, orgId: hub.orgId, ...profile}, update: profile, select: {userId: true}}),
          db.staffStore.deleteMany({where: {userId}}),
          db.staffStore.createMany({data: row.want.storeIds.map(storeId => ({userId, storeId}))}),
          db.user.update({where: {id: userId}, data: {name}, select: {id: true}}),
        ]);
        results.push({line: row.line, email: row.email, userId, status: 'saved', roles: row.want.roles, active: row.want.active});
      } catch (error) {
        console.error(`people import line ${row.line}: ${(error as Error).message}`);
        results.push({line: row.line, email: row.email, userId: row.userId, status: 'error', message: 'Could not save this row.', roles: [], active: true});
      }
    }
    await audit(db, {actorUserId: hub.userId, action: 'hub.people_imported', meta: {rows: checks.length, saved: results.filter(r => r.status === 'saved').length}});
    return c.json({results});
  })

  /** Everyone in the organization, in the import's columns (a file you can edit and import again). */
  .get('/people/export', withViewer, requireAuth, requirePermission(PERMISSIONS.HUB_MANAGE), withDb, withHub, async c => {
    const {db, hub} = c.var;
    const showEmail = await can(c as never, PERMISSIONS.USER_READ);
    const staff = await db.staff.findMany({
      where: {orgId: hub.orgId},
      select: {userId: true, firstName: true, lastName: true, department: true, managerUserId: true, stores: {select: {store: {select: {name: true}}}}},
      orderBy: [{lastName: 'asc'}, {firstName: 'asc'}],
      take: 2000,
    });
    const ids = [...new Set([...staff.map(s => s.userId), ...staff.map(s => s.managerUserId).filter((x): x is number => x !== null)])];
    const users = await db.user.findMany({
      where: {id: {in: ids}},
      select: {id: true, email: true, status: true, roles: {select: {role: {select: {slug: true, name: true}}}}},
      take: ids.length,
    });
    const userOf = new Map(users.map(u => [u.id, u]));
    const people = staff.map(s => {
      const u = userOf.get(s.userId);
      return {
        firstName: s.firstName,
        lastName: s.lastName,
        email: showEmail ? (u?.email ?? '') : '',
        roles: (u?.roles ?? []).filter(r => r.role.slug !== 'member').map(r => r.role.name),
        stores: s.stores.map(x => x.store.name),
        department: s.department,
        managerEmail: showEmail && s.managerUserId ? (userOf.get(s.managerUserId)?.email ?? '') : '',
        active: u?.status === 'active',
      };
    });
    await audit(db, {actorUserId: hub.userId, action: 'hub.people_exported', meta: {rows: people.length}});
    return c.json({people});
  })

  /** One audit line per CSV export (who exported what, how many rows). */
  .post(
    '/export-log',
    validator('json', (value, c) => {
      const f = new Fields(asBody(value));
      const out = {what: f.text('what', 60, 'Say what was exported.'), rows: f.int('rows', 0, 100000, 'A row count.') ?? 0};
      return f.ok ? out : c.json(invalidInput(f.errors), 422);
    }),
    withViewer,
    requireAuth,
    requirePermission(PERMISSIONS.EXPORT),
    withDb,
    withHub,
    async c => {
      const {db, hub} = c.var;
      const {what, rows} = c.req.valid('json');
      await audit(db, {actorUserId: hub.userId, action: 'hub.csv_export', meta: {what: what!, rows}});
      return c.json({ok: true}, 201);
    }
  );
