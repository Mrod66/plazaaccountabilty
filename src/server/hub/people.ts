import type {Person} from '../../lib/hub';
import type {PrismaClient} from '../../generated/prisma/client';
import {PERMISSIONS} from '../permissions';

/**
 * People lookups for the hub. Names only, never emails: any signed-in hub
 * member may learn a coworker's name (to pick a manager), nothing more.
 */

const UNKNOWN = 'Former user';

/** `users.id` → name, in ONE bounded query. */
export async function namesOf(db: PrismaClient, ids: Iterable<number | null | undefined>): Promise<Map<number, string>> {
  const wanted = [...new Set([...ids].filter((id): id is number => typeof id === 'number'))].slice(0, 500);
  if (!wanted.length) return new Map();
  const rows = await db.user.findMany({where: {id: {in: wanted}}, select: {id: true, name: true}, take: wanted.length});
  return new Map(rows.map(row => [row.id, row.name]));
}

/** A person by id; id 0 is the hub itself (automatic events: missed clocks, escalations). */
export const personOf = (names: Map<number, string>, id: number): Person =>
  id === 0 ? {id: 0, name: 'Accountability Hub (automatic)'} : {id, name: names.get(id) ?? UNKNOWN};

/**
 * Who may be picked as the manager a case goes to: active members of the
 * organization whose roles grant `site:case:receive` exactly (or `site:case:*`;
 * the site owner's `*` does not count, so the consultant never lands in a
 * manager list). With `storeId`: people of that store first, then group-level
 * people (no store, e.g. the BDC Director).
 */
export async function receivers(
  db: PrismaClient,
  orgId: number,
  storeId: number | null
): Promise<{id: number; name: string; atStore: boolean}[]> {
  const roles = await db.role.findMany({
    where: {permissions: {some: {permission: {codename: {in: [PERMISSIONS.CASE_RECEIVE, 'site:case:*']}}}}},
    select: {id: true},
    take: 100,
  });
  if (!roles.length) return [];
  const holders = await db.userRole.findMany({
    where: {roleId: {in: roles.map(r => r.id)}},
    select: {userId: true},
    take: 1000,
  });
  const ids = [...new Set(holders.map(h => h.userId))];
  if (!ids.length) return [];
  const [staff, users] = await Promise.all([
    db.staff.findMany({
      where: {orgId, userId: {in: ids}},
      select: {userId: true, stores: {select: {storeId: true}, take: 50}},
      take: 1000,
    }),
    db.user.findMany({where: {id: {in: ids}, status: 'active'}, select: {id: true, name: true}, take: 1000}),
  ]);
  const active = new Map(users.map(u => [u.id, u.name]));
  const out: {id: number; name: string; atStore: boolean}[] = [];
  for (const person of staff) {
    const name = active.get(person.userId);
    if (!name) continue;
    const stores = person.stores.map(s => s.storeId);
    const atStore = storeId !== null && stores.includes(storeId);
    // A person tied to OTHER stores only is not offered for this one.
    if (storeId !== null && !atStore && stores.length) continue;
    out.push({id: person.userId, name, atStore});
  }
  return out.sort((a, b) => Number(b.atStore) - Number(a.atStore) || a.name.localeCompare(b.name));
}

/** Active members of the organization at a store (the salesperson or advisor involved in a CSI case). */
export async function storeStaff(db: PrismaClient, orgId: number, storeId: number): Promise<Person[]> {
  const rows = await db.staffStore.findMany({
    where: {storeId, staff: {orgId}},
    select: {userId: true},
    take: 500,
  });
  const users = await db.user.findMany({
    where: {id: {in: rows.map(r => r.userId)}, status: 'active'},
    select: {id: true, name: true},
    orderBy: {name: 'asc'},
    take: 500,
  });
  return users.map(u => ({id: u.id, name: u.name}));
}

/** Every active member of the organization (hand-off picker), people of `storeId` marked. */
export async function orgPeople(
  db: PrismaClient,
  orgId: number,
  storeId: number | null
): Promise<{id: number; name: string; atStore: boolean}[]> {
  const staff = await db.staff.findMany({
    where: {orgId},
    select: {userId: true, stores: {select: {storeId: true}, take: 50}},
    take: 1000,
  });
  const users = await db.user.findMany({
    where: {id: {in: staff.map(s => s.userId)}, status: 'active'},
    select: {id: true, name: true},
    take: 1000,
  });
  const names = new Map(users.map(u => [u.id, u.name]));
  return staff
    .filter(s => names.has(s.userId))
    .map(s => ({id: s.userId, name: names.get(s.userId)!, atStore: storeId !== null && s.stores.some(x => x.storeId === storeId)}))
    .sort((a, b) => Number(b.atStore) - Number(a.atStore) || a.name.localeCompare(b.name));
}

/** Role NAMES per user (the touch chain says "Sales Manager", not a slug). */
export async function roleNamesOf(db: PrismaClient, ids: number[]): Promise<Map<number, string[]>> {
  if (!ids.length) return new Map();
  const rows = await db.userRole.findMany({
    where: {userId: {in: ids.slice(0, 200)}},
    select: {userId: true, role: {select: {name: true, slug: true}}},
    take: 2000,
  });
  const out = new Map<number, string[]>();
  for (const row of rows) {
    if (row.role.slug === 'member') continue;
    out.set(row.userId, [...(out.get(row.userId) ?? []), row.role.name]);
  }
  return out;
}
