import type {Context} from 'hono';
import {createMiddleware} from 'hono/factory';

import type {Prisma, PrismaClient} from '../../generated/prisma/client';
import {getAccess} from '../../platform/auth';
import {scopeOf} from '../../platform/auth/codenames';
import {problem} from '../../platform/guards';
import type {Viewer} from '../../platform/types';
import {PERMISSIONS} from '../permissions';

/**
 * Who the signed-in person is IN THE HUB: their organization, stores,
 * department, and which cases they may see. Built once per request
 * (`withHub`, after `withDb`), from the Site Database, never from the request.
 *
 * THE HARD RULE ("a rep never sees another rep's customer") lives in
 * `visibleCases()`: every query that reads a case, a list, a search, a phone
 * match or a direct link ANDs it in. A rep holds none of the read scopes, so
 * all they get is the cases they created or held (`case_participants`).
 */
export interface Hub {
  userId: number;
  orgId: number;
  department: string;
  storeIds: number[];
  /** The role slugs held (for the creator's team on a new case). */
  roles: string[];
  scopes: {
    all: boolean;
    hot: boolean;
    hotBdc: boolean;
    storeSales: boolean;
    csi: boolean;
    storeService: boolean;
    serviceBdc: boolean;
  };
  can: {
    createHot: boolean;
    createCsi: boolean;
    receive: boolean;
    reassign: boolean;
    reopen: boolean;
    manage: boolean;
  };
}

type HubEnv = {Variables: {viewer: Viewer; db: PrismaClient; hub: Hub}};

const holds = (held: Set<string>, codename: string) => scopeOf(held, codename) === 'all';

/** The hub's view of the viewer, or null when their account has no Staff profile. */
export async function loadHub(c: Context<HubEnv>): Promise<Hub | null> {
  const userId = c.var.viewer.id!;
  const db = c.var.db;
  const [access, staff] = await Promise.all([
    getAccess(c.req.raw),
    db.staff.findUnique({
      where: {userId},
      select: {orgId: true, department: true, stores: {select: {storeId: true}, take: 50}},
    }),
  ]);
  const held = new Set(access.permissions);
  let profile = staff;
  // The site's admins (the owner, `site:hub:manage`) join the organization on
  // their first visit when there is exactly one, so the admin can start at once.
  if (!profile && holds(held, PERMISSIONS.HUB_MANAGE)) {
    const orgs = await db.organization.findMany({select: {id: true}, take: 2});
    if (orgs.length === 1) {
      const name = (c.var.viewer.name ?? '').trim().split(/\s+/);
      profile = await db.staff.upsert({
        where: {userId},
        create: {
          userId,
          orgId: orgs[0]!.id,
          firstName: (name[0] ?? 'Admin').slice(0, 40),
          lastName: name.slice(1).join(' ').slice(0, 40),
          department: 'group',
        },
        update: {},
        select: {orgId: true, department: true, stores: {select: {storeId: true}, take: 50}},
      });
    }
  }
  if (!profile) return null;
  return {
    userId,
    orgId: profile.orgId,
    department: profile.department,
    storeIds: profile.stores.map(s => s.storeId),
    roles: access.roles,
    scopes: {
      all: holds(held, PERMISSIONS.CASE_READ_ALL),
      hot: holds(held, PERMISSIONS.CASE_READ_HOT),
      hotBdc: holds(held, PERMISSIONS.CASE_READ_HOT_BDC),
      storeSales: holds(held, PERMISSIONS.CASE_READ_STORE_SALES),
      csi: holds(held, PERMISSIONS.CASE_READ_CSI),
      storeService: holds(held, PERMISSIONS.CASE_READ_STORE_SERVICE),
      serviceBdc: holds(held, PERMISSIONS.CASE_READ_SERVICE_BDC),
    },
    can: {
      createHot: holds(held, PERMISSIONS.CASE_CREATE_HOT),
      createCsi: holds(held, PERMISSIONS.CASE_CREATE_CSI),
      receive: holds(held, PERMISSIONS.CASE_RECEIVE),
      reassign: holds(held, PERMISSIONS.CASE_REASSIGN),
      reopen: holds(held, PERMISSIONS.CASE_REOPEN),
      manage: holds(held, PERMISSIONS.HUB_MANAGE),
    },
  };
}

/** `c.var.hub`, or 403 `not_member` when the account is not set up in the hub yet. */
export const withHub = createMiddleware<HubEnv>(async (c, next) => {
  const hub = await loadHub(c);
  if (!hub) {
    return c.json(
      problem('not_member', 'Your account is not set up in the Accountability Hub yet. Ask your admin to add you.'),
      403
    );
  }
  c.set('hub', hub);
  await next();
});

/**
 * The cases this person may see, as a Prisma filter. ALWAYS scoped to their
 * organization; then their own cases (created or held), OR whatever their
 * read scopes add. Pure: unit-tested in tests/hub-visibility.test.ts.
 */
export function visibleCases(hub: Pick<Hub, 'userId' | 'orgId' | 'storeIds' | 'scopes'>): Prisma.CaseWhereInput {
  if (hub.scopes.all) return {orgId: hub.orgId};
  const any: Prisma.CaseWhereInput[] = [{participants: {some: {userId: hub.userId}}}];
  const {scopes, storeIds} = hub;
  if (scopes.hot) any.push({type: 'hot'});
  if (scopes.hotBdc) any.push({type: 'hot', createdTeam: 'sales_bdc'});
  if (scopes.storeSales && storeIds.length) {
    any.push({type: 'hot', storeId: {in: storeIds}});
    any.push({type: 'csi', department: 'sales', storeId: {in: storeIds}});
  }
  if (scopes.csi) any.push({type: 'csi'});
  if (scopes.storeService && storeIds.length) any.push({type: 'csi', department: 'service', storeId: {in: storeIds}});
  if (scopes.serviceBdc) any.push({createdTeam: 'service_bdc'});
  return {orgId: hub.orgId, OR: any};
}

/**
 * The team a case's creator was on when they created it, from their roles.
 * Data, not access: the BDC Manager's scope reads it later ("cases created by
 * BDC reps"). Front-line roles win over manager roles (a rep who is also a
 * manager files as a rep).
 */
export function teamOf(roles: string[]): string {
  if (roles.includes('sales-bdc-rep')) return 'sales_bdc';
  if (roles.includes('service-bdc-rep')) return 'service_bdc';
  if (roles.includes('salesperson')) return 'sales';
  if (roles.includes('csi-rep')) return 'csi';
  if (roles.includes('service-advisor')) return 'service';
  return 'manager';
}
