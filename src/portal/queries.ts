import {infiniteQueryOptions, queryOptions} from '@tanstack/react-query';

import type {
  AlertRow,
  CaseDetail,
  CasesPage,
  CaseSummary,
  ClockSettingRow,
  DashboardData,
  DrillDown,
  HoursRow,
  HubMe,
  MyCases,
  Person,
  PhoneMatch,
} from '../lib/hub';
import type {Scorecards} from '../server/hub/scorecards';
import type {AdminUser, AuditRow, JobsPage, PermissionRow, RoleRow} from '../lib/types';
import {refreshSession} from '../platform/browser';
import {api, read} from './api';
import type {Me} from './shared';

/**
 * Every portal read, ONCE: the screen (`useQuery(x)`) and its route's loader
 * (`queryClient.ensureQueryData(x)`, src/portal/routes.tsx) use the same
 * options, so a hover on a link fetches what the screen will show and the
 * screen renders from the cache. Kept apart from the screens so the routes can
 * import them without pulling the (lazy) screen code into the first bundle.
 *
 * A save invalidates by key prefix (`['users']`, `['jobs']`, `['roles']`).
 */

/** Who is signed in, and what the portal may SHOW them. Shared by every screen. */
export const meQuery = queryOptions({
  queryKey: ['me'],
  queryFn: async () => {
    const me = await read<Me>(api.me.$get());
    // The access token ran out but the refresh token is still there: refresh ONCE.
    if (me.viewer.state === 'returning' && (await refreshSession())) return read<Me>(api.me.$get());
    return me;
  },
  staleTime: 60_000,
});

/** The brand, for the sidebar. Public and cached on the server. */
export const siteQuery = queryOptions({
  queryKey: ['site'],
  queryFn: () => read<{site: {name: string} | null}>(api.site.$get()),
  staleTime: 5 * 60_000,
});

export const healthQuery = queryOptions({
  queryKey: ['health'],
  queryFn: () => read<{database: boolean; auth: boolean; siteKey: boolean; ownerSetup: boolean}>(api.health.$get()),
});

export type UsersPage = {users: AdminUser[]; nextBefore: number | null};
export type AuditPage = {events: AuditRow[]; nextBefore: string | null};

/** The overview's tiles: the FIRST page of each list, under the lists' own key prefixes. */
export const firstUsersQuery = queryOptions({
  queryKey: ['users', 'first'],
  queryFn: () => read<UsersPage>(api.admin.users.$get({query: {before: '', email: '', status: ''}})),
});
export const firstJobsQuery = queryOptions({
  queryKey: ['jobs', 'manage', 'first'],
  queryFn: () => read<JobsPage>(api.jobs.manage.$get({query: {before: ''}})),
});
export const firstAuditQuery = queryOptions({
  queryKey: ['audit', 'first'],
  queryFn: () => read<AuditPage>(api.admin.audit.$get({query: {before: ''}})),
});

/** `/portal/users`: every account, newest first, filtered by exact email and status. */
export const usersQuery = (filter: {email: string; status: string}) =>
  infiniteQueryOptions({
    queryKey: ['users', filter],
    initialPageParam: undefined as string | undefined,
    queryFn: ({pageParam}) =>
      read<UsersPage>(api.admin.users.$get({query: {before: pageParam ?? '', email: filter.email, status: filter.status}})),
    getNextPageParam: last => (last.nextBefore ? String(last.nextBefore) : undefined),
  });

/** `/portal/jobs`: every job, open and closed. */
export const manageJobsQuery = infiniteQueryOptions({
  queryKey: ['jobs', 'manage'],
  initialPageParam: undefined as string | undefined,
  queryFn: ({pageParam}) => read<JobsPage>(api.jobs.manage.$get({query: {before: pageParam ?? ''}})),
  getNextPageParam: last => (last.nextBefore ? String(last.nextBefore) : undefined),
});

/** `/portal/activity`: the audit log, newest first. */
export const auditQuery = infiniteQueryOptions({
  queryKey: ['audit'],
  initialPageParam: undefined as string | undefined,
  queryFn: ({pageParam}) => read<AuditPage>(api.admin.audit.$get({query: {before: pageParam ?? ''}})),
  getNextPageParam: last => last.nextBefore ?? undefined,
});

export const rolesQuery = queryOptions({
  queryKey: ['roles'],
  queryFn: () => read<{roles: RoleRow[]}>(api.admin.roles.$get()),
});

/** The permission catalogue: changes only with a migration. */
export const permissionsQuery = queryOptions({
  queryKey: ['permissions'],
  queryFn: () => read<{permissions: PermissionRow[]}>(api.admin.permissions.$get()),
  staleTime: 5 * 60_000,
});

/** Two-step sign-in, for the account screen. */
export type TwoFactorStatus = {enabled: boolean; recoveryCodesLeft: number; hasPassword: boolean};
export const twoFactorQuery = queryOptions({
  queryKey: ['account', 'two-factor'],
  queryFn: () => read<TwoFactorStatus>(api.auth['two-factor'].$get()),
});

/** The devices signed in to this account (this one marked `current`). */
export type DeviceSession = {id: string; device: string; lastActiveAt: string; current: boolean};
export const sessionsQuery = queryOptions({
  queryKey: ['account', 'sessions'],
  queryFn: () => read<{sessions: DeviceSession[]}>(api.auth.sessions.$get()),
});

// ---------------------------------------------------------------- Accountability Hub

/** The signed-in person's place in the hub: organization, stores, what they may do. */
export type HubCan = {createHot: boolean; createCsi: boolean; receive: boolean; reassign: boolean; reopen: boolean; manage: boolean};
export type HubMeAnswer = HubMe & {can: HubCan | null};
export const hubMeQuery = queryOptions({
  queryKey: ['hub', 'me'],
  queryFn: () => read<HubMeAnswer>(api.hub.me.$get()),
  staleTime: 5 * 60_000,
});

/** My Cases: waiting on me, then what I created. Refreshes every minute while open. */
export const myCasesQuery = queryOptions({
  queryKey: ['cases', 'mine'],
  queryFn: () => read<MyCases>(api.cases.mine.$get()),
  refetchInterval: 60_000,
});

export type CaseFilter = {q: string; state: string; type: string};
/** Every case I may see (the server decides which), newest first. */
export const casesQuery = (filter: CaseFilter) =>
  infiniteQueryOptions({
    queryKey: ['cases', 'list', filter],
    initialPageParam: undefined as string | undefined,
    queryFn: ({pageParam}) => read<CasesPage>(api.cases.$get({query: {...filter, before: pageParam ?? ''}})),
    getNextPageParam: last => (last.nextBefore ? String(last.nextBefore) : undefined),
  });

export const caseQuery = (id: string) =>
  queryOptions({
    queryKey: ['cases', 'one', id],
    queryFn: () => read<{case: CaseDetail}>(api.cases[':id'].$get({param: {id}})),
  });

export type Picker = {id: number; name: string; atStore: boolean};
export type CaseOptions = {managers: Picker[]; defaultId: number | null; staff: Person[]};
export const caseOptionsQuery = (storeId: string, type: 'hot' | 'csi', department: string) =>
  queryOptions({
    queryKey: ['cases', 'options', storeId, type, department],
    queryFn: () => read<CaseOptions>(api.cases.options.$get({query: {storeId, type, department}})),
    enabled: Boolean(storeId),
    staleTime: 5 * 60_000,
  });

export const handoffPeopleQuery = (id: string) =>
  queryOptions({
    queryKey: ['cases', 'people', id],
    queryFn: () => read<{people: Picker[]}>(api.cases[':id'].people.$get({param: {id}})),
    staleTime: 5 * 60_000,
  });

export const phoneCheckQuery = (phone: string, except = '') =>
  queryOptions({
    queryKey: ['cases', 'phone', phone, except],
    queryFn: () => read<PhoneMatch>(api.cases['phone-check'].$get({query: {phone, except}})),
    enabled: phone.length === 10,
    staleTime: 60_000,
  });

export type HubPerson = {
  id: number;
  firstName: string;
  lastName: string;
  name: string;
  email: string | null;
  status: string;
  lastLoginAt: string | null;
  department: string;
  storeIds: number[];
  manager: Person | null;
  roles: {slug: string; name: string}[];
};
export const hubPeopleQuery = (q: string) =>
  infiniteQueryOptions({
    queryKey: ['hub', 'people', q],
    initialPageParam: undefined as string | undefined,
    queryFn: ({pageParam}) =>
      read<{people: HubPerson[]; nextBefore: number | null}>(api.hub.admin.people.$get({query: {q, before: pageParam ?? ''}})),
    getNextPageParam: last => (last.nextBefore ? String(last.nextBefore) : undefined),
  });

export type RoutingStore = {
  id: number;
  name: string;
  hasService: boolean;
  routes: Record<string, number>;
  candidates: Picker[];
};
export const routingQuery = queryOptions({
  queryKey: ['hub', 'routing'],
  queryFn: () => read<{stores: RoutingStore[]}>(api.hub.admin.routing.$get()),
});

/** The bell: unread alerts, checked every minute. */
export const alertCountQuery = queryOptions({
  queryKey: ['alerts', 'count'],
  queryFn: () => read<{unread: number}>(api.alerts.count.$get()),
  refetchInterval: 60_000,
  staleTime: 30_000,
});

export const alertsQuery = infiniteQueryOptions({
  queryKey: ['alerts', 'list'],
  initialPageParam: undefined as string | undefined,
  queryFn: ({pageParam}) => read<{items: AlertRow[]; nextBefore: string | null}>(api.alerts.$get({query: {before: pageParam ?? ''}})),
  getNextPageParam: last => last.nextBefore ?? undefined,
  refetchInterval: 60_000,
});

export const alertPrefsQuery = queryOptions({
  queryKey: ['alerts', 'prefs'],
  queryFn: () => read<{alertMode: string}>(api.alerts.prefs.$get()),
});

/** The Director of Operations' Overdue panel. */
export const overdueQuery = queryOptions({
  queryKey: ['cases', 'overdue'],
  queryFn: () => read<{items: CaseSummary[]}>(api.cases.overdue.$get()),
  refetchInterval: 60_000,
});

export const clockAdminQuery = queryOptions({
  queryKey: ['hub', 'clocks'],
  queryFn: () => read<{settings: ClockSettingRow[]; hours: HoursRow[]}>(api.hub.admin.clocks.$get()),
});

// ---------------------------------------------------------------- reports (Phase 3)

export type DashboardParams = {from: string; to: string; store: string; department: string; type: string};
export const dashboardQuery = (p: DashboardParams) =>
  queryOptions({
    queryKey: ['reports', 'dashboard', p],
    queryFn: () => read<DashboardData>(api.reports.$get({query: p})),
    staleTime: 60_000,
  });

export type DrillParams = DashboardParams & {measure: string; dim?: string; key?: string};
export const drillQuery = (p: DrillParams) =>
  queryOptions({
    queryKey: ['reports', 'drill', p],
    queryFn: () => read<DrillDown>(api.reports.cases.$get({query: p as Record<string, string>})),
  });

export type ScorecardData = Scorecards & {filter: {from: string; to: string; store: string}; generatedAt: string};
export const scorecardsQuery = (p: {from: string; to: string; store: string}) =>
  queryOptions({
    queryKey: ['reports', 'scorecards', p],
    queryFn: () => read<ScorecardData>(api.reports.scorecards.$get({query: p})),
    staleTime: 60_000,
  });

export type MyScorecardData = {thisMonth: Scorecards & {from: string; to: string}; lastMonth: Scorecards & {from: string; to: string}; generatedAt: string};

export const scoreDrillQuery = (p: {from: string; to: string; store: string; group: string; metric: string; person: string}) =>
  queryOptions({
    queryKey: ['reports', 'score-drill', p],
    queryFn: () => read<DrillDown & {person: string}>(api.reports.scorecards.cases.$get({query: p})),
  });
export const myScorecardQuery = queryOptions({
  queryKey: ['reports', 'me'],
  queryFn: () => read<MyScorecardData>(api.reports.scorecards.me.$get()),
  staleTime: 60_000,
});

export const boardQuery = (store: string) =>
  queryOptions({
    queryKey: ['cases', 'board', store],
    queryFn: () => read<{items: CaseSummary[]; more: boolean}>(api.reports.board.$get({query: {store}})),
    refetchInterval: 60_000,
  });

// ---------------------------------------------------------------- settings (Phase 4)

export type PickItem = {id: number; value: string; label: string; active: boolean};
export type PickLists = {reason: PickItem[]; lost_reason: PickItem[]; problem: PickItem[]};
/** The editable pick lists (Admin → Pick lists); the forms offer only the switched-on options. */
export const listsQuery = queryOptions({
  queryKey: ['settings', 'lists'],
  queryFn: () => read<{lists: PickLists}>(api.settings.lists.$get()),
  staleTime: 5 * 60_000,
});

export type AdminStore = {id: number; name: string; shortName: string; manufacturer: string; hasService: boolean; address: string | null; active: boolean};
export const adminStoresQuery = queryOptions({
  queryKey: ['settings', 'stores'],
  queryFn: () => read<{stores: AdminStore[]}>(api.settings.stores.$get()),
});
