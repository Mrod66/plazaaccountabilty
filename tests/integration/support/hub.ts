import {app} from '../../../src/server/app';
import {CATALOGUE} from '../../../src/server/permissions';
import {Browser, db, signedIn, userId} from './harness';

/** Helpers for the Accountability Hub's integration tests (hub*.test.ts). */

const ROLES = [
  'executive',
  'director-ops',
  'bdc-director',
  'bdc-manager',
  'sales-manager',
  'salesperson',
  'sales-bdc-rep',
  'csi-rep',
  'service-manager',
  'service-advisor',
  'service-bdc-rep',
  'service-bdc-manager',
];

/** The roles' names, as the migration creates them. */
const ROLE_NAMES: Record<string, string> = {
  executive: 'Owner / Executive',
  'director-ops': 'Director of Operations',
  'bdc-director': 'BDC Director',
  'bdc-manager': 'BDC Manager',
  'sales-manager': 'Sales Manager',
  salesperson: 'Salesperson',
  'sales-bdc-rep': 'Sales BDC Rep',
  'csi-rep': 'CSI Rep',
  'service-manager': 'Service Manager',
  'service-advisor': 'Service Advisor',
  'service-bdc-rep': 'Service BDC Rep',
  'service-bdc-manager': 'Service BDC Manager',
};

/** The roles and their catalogue grants (other test files wipe non-system roles). */
export async function seedRoles() {
  for (const slug of ROLES) {
    await db.role.upsert({where: {slug}, create: {slug, name: ROLE_NAMES[slug] ?? slug}, update: {name: ROLE_NAMES[slug] ?? slug}});
  }
  for (const def of Object.values(CATALOGUE)) {
    const slugs = (def as {roles?: readonly string[]}).roles ?? [];
    if (!slugs.length) continue;
    const permission = await db.permission.upsert({
      where: {codename: def.codename},
      create: {codename: def.codename, title: def.title, groupName: def.group},
      update: {},
    });
    const roles = await db.role.findMany({where: {slug: {in: [...slugs]}}, select: {id: true}});
    await db.rolePermission.createMany({
      data: roles.map(r => ({roleId: r.id, permissionId: permission.id})),
      skipDuplicates: true,
    });
  }
}

/** Plaza's organization and stores, as the migration made them (`loadPlaza()` first). */
export const plaza = {orgId: 0, stores: {} as Record<string, number>};
export async function loadPlaza() {
  const org = await db.organization.findUniqueOrThrow({where: {slug: 'plaza'}, select: {id: true}});
  plaza.orgId = org.id;
  const rows = await db.store.findMany({where: {orgId: org.id}, select: {id: true, shortName: true}});
  plaza.stores = Object.fromEntries(rows.map(r => [r.shortName, r.id]));
}
// Sign-up is rate-limited per IP: each test person comes from their own address.
let ip = 0;

/** A signed-in person with these roles, in these stores. */
export async function person(email: string, roles: string[], storeNames: string[] = [], department = 'sales', org = plaza.orgId) {
  const browser = await signedIn(app, email, undefined, `198.51.100.${(ip = (ip % 250) + 1)}`);
  const id = await userId(email);
  const roleRows = await db.role.findMany({where: {slug: {in: roles}}, select: {id: true}});
  await db.userRole.deleteMany({where: {userId: id}});
  await db.userRole.createMany({data: roleRows.map(r => ({userId: id, roleId: r.id}))});
  await db.staff.create({
    data: {
      userId: id,
      orgId: org,
      firstName: email.split('@')[0]!,
      lastName: 'Test',
      department,
      stores: {create: storeNames.map(s => ({storeId: plaza.stores[s]!}))},
    },
  });
  return {browser: loose(browser), id};
}

export const hot = (storeId: number, assigneeId: number, extra: Record<string, unknown> = {}) => ({
  storeId,
  source: 'phone',
  customerName: 'Pat Customer',
  phone: '(718) 555-0101',
  reason: 'discount',
  customerWords: 'Wants $500 off the sticker.',
  urgency: 'now',
  assigneeId,
  ...extra,
});

export const csi = (storeId: number, department: string, assigneeId: number, extra: Record<string, unknown> = {}) => ({
  storeId,
  department,
  customerName: 'Chris Driver',
  phone: '7185550202',
  stage: 'pre_survey',
  sentiment: 'unhappy',
  problems: ['wait_time'],
  customerWords: 'Waited three hours for an oil change.',
  assigneeId,
  ...extra,
});

/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are read loosely in these tests */
export type Res = {status: number; json: any};
/** A test browser whose answers are read loosely. */
export const loose = (b: Browser) => ({
  post: (path: string, body: unknown) => b.post(path, body) as Promise<Res>,
  request: (method: string, path: string, body?: unknown) => b.request(method, path, body) as Promise<Res>,
});
export type Loose = ReturnType<typeof loose>;
export async function detail(browser: Loose, id: number): Promise<Res> {
  return browser.request('GET', `/site-api/cases/${id}`);
}
