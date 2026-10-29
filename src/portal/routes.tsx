import type {QueryClient} from '@tanstack/react-query';
import {
  createRootRouteWithContext,
  createRoute,
  type ErrorComponentProps,
  Link,
  lazyRouteComponent,
  Outlet,
  useMatches,
  useRouter,
  useRouterState,
} from '@tanstack/react-router';
import {useEffect, useRef, useState, useSyncExternalStore} from 'react';

import type {Abilities} from '../lib/types';
import {logout} from '../platform/browser';
import {Bell, HubFooter} from './hub';
import {rangeOf, type ReportSearch} from './report-ui';
import type {BoardSearch} from './screens/board';
import type {ScoreSearch} from './screens/scorecard-parts';
import {
  alertPrefsQuery,
  alertsQuery,
  auditQuery,
  boardQuery,
  dashboardQuery,
  drillQuery,
  type DrillParams,
  myScorecardQuery,
  scoreDrillQuery,
  scorecardsQuery,
  adminStoresQuery,
  clockAdminQuery,
  listsQuery,
  overdueQuery,
  caseQuery,
  casesQuery,
  hubMeQuery,
  hubPeopleQuery,
  manageJobsQuery,
  meQuery,
  myCasesQuery,
  permissionsQuery,
  rolesQuery,
  routingQuery,
  sessionsQuery,
  twoFactorQuery,
  usersQuery,
} from './queries';
import {Avatar, ErrorNote, useMe} from './shared';
import {Button} from './ui';

/**
 * The portal's screens: a TanStack Router app under `/portal` (basepath),
 * served by `src/pages/portal/[...path].astro` (signed-in users only), with
 * data from the Site API through TanStack Query. Links INSIDE the portal use
 * `<Link>`; links to the website (`/`, `/blog/`, `/account/…`) are plain
 * `<a href>`.
 *
 * Add a screen (all five, every time):
 *   1. its reads as `queryOptions` in `queries.ts`, used by the screen with `useQuery(x)`;
 *   2. the component in `screens/<name>.tsx` (a named export);
 *   3. a `createRoute` below: literal `path`, `staticData.title` (the top bar
 *      and the tab), a `loader` that warms its queries, and the component
 *      LAZY (`lazyRouteComponent(() => import('./screens/<name>'), 'Name')`)
 *      so its code loads on first use (or on hover), never in the first bundle;
 *   4. its route in `routeTree`;
 *   5. one item in `NAV_GROUPS` if it belongs in the sidebar.
 * Never a plain `<a href>` to a portal path: it reloads the whole app.
 */

declare module '@tanstack/react-router' {
  interface StaticDataRouteOption {
    /** The screen's name: the top bar's `<h1>` and the tab's title. */
    title?: string;
  }
}

/**
 * Warm a screen's queries before it renders (on navigation, and on hover via
 * `defaultPreload: 'intent'`). A failed read is NOT thrown: the screen shows
 * the error in place from the same query, as it always has.
 */
const warm = (...reads: Promise<unknown>[]) => Promise.all(reads.map(read => read.catch(() => undefined))).then(() => undefined);

/** While a slow screen loads (after `defaultPendingMs`). */
export function RoutePending() {
  return (
    <div className="app-page" role="status">
      <p className="muted">Loading…</p>
    </div>
  );
}

/** A screen that failed to render or to load its code (an old tab after a Publish: reload). */
export function RouteError({error}: ErrorComponentProps) {
  const router = useRouter();
  const failure = error instanceof Error ? error : new Error('Something went wrong.');
  const stale = /dynamically imported module|module script|Importing a module/i.test(failure.message);
  return (
    <div className="app-page">
      <ErrorNote error={stale ? new Error('This dashboard was updated. Reload to get the new version.') : failure} />
      <div className="actions">
        <Button variant="ghost" onClick={() => (stale ? window.location.reload() : void router.invalidate())}>
          {stale ? 'Reload' : 'Try again'}
        </Button>
      </div>
    </div>
  );
}


/**
 * The sidebar, in groups. `ability` hides an item the visitor may not use;
 * that only HIDES it, the route's guard is the enforcement.
 */
const NAV_GROUPS: {
  label: string;
  items: {to: string; label: string; exact?: boolean; ability?: keyof Abilities}[];
}[] = [
  {
    label: 'Cases',
    items: [
      {to: '/', label: 'My Cases', exact: true},
      {to: '/new/hot', label: 'New Hot Prospect', ability: 'createHot'},
      {to: '/new/csi', label: 'New CSI Call', ability: 'createCsi'},
      {to: '/cases', label: 'Cases you can see'},
      {to: '/alerts', label: 'Alerts'},
      {to: '/overdue', label: 'Overdue', ability: 'seeAllCases'},
    ],
  },
  {
    label: 'Reports',
    items: [
      {to: '/dashboard', label: 'Leadership Dashboard', ability: 'seeDashboard'},
      {to: '/board', label: 'Store Board', ability: 'seeStoreBoard'},
      {to: '/scorecards', label: 'People Scorecards', ability: 'seeScorecards'},
      {to: '/my-scorecard', label: 'My Scorecard'},
    ],
  },
  {
    label: 'Admin',
    items: [
      {to: '/people', label: 'People', ability: 'manageHub'},
      {to: '/import', label: 'Import people (CSV)', ability: 'manageHub'},
      {to: '/stores', label: 'Stores', ability: 'manageHub'},
      {to: '/routing', label: 'Routing', ability: 'manageHub'},
      {to: '/lists', label: 'Pick lists', ability: 'manageHub'},
      {to: '/clocks', label: 'Clocks and hours', ability: 'manageHub'},
      {to: '/users', label: 'Accounts', ability: 'manageUsers'},
      {to: '/roles', label: 'Roles', ability: 'manageRoles'},
      {to: '/activity', label: 'Activity log', ability: 'readAudit'},
    ],
  },
  {
    label: 'You',
    items: [{to: '/account', label: 'Your account'}],
  },
];

/**
 * When the data on screen was last read from the server: the newest
 * `dataUpdatedAt` among the queries in the cache (the footer's "data as of").
 */
function useDataAsOf(queryClient: QueryClient): number {
  return useSyncExternalStore(
    listener => queryClient.getQueryCache().subscribe(listener),
    () => Math.max(0, ...queryClient.getQueryCache().getAll().map(query => query.state.dataUpdatedAt))
  );
}

/** The screen's title for the top bar and the tab: the deepest route's `staticData.title`. */
function useScreenTitle() {
  const matches = useMatches();
  return [...matches].reverse().find(match => match.staticData.title)?.staticData.title ?? 'Dashboard';
}

/**
 * After every in-app navigation (never the first load): the tab title says
 * where you are, and focus moves to the screen's `<h1>` so keyboard and
 * screen reader users start at the new screen (it is read out), as after a
 * page load.
 */
function useNavigationFocus(title: string, siteName: string | undefined) {
  const heading = useRef<HTMLHeadingElement>(null);
  const resolved = useRouterState({select: s => s.resolvedLocation?.pathname});
  const first = useRef(true);
  // "<title> · <site>", as App.astro writes it on the first load.
  const [fallbackName] = useState(() => document.title.split(' · ').slice(1).join(' · ') || 'My site');
  useEffect(() => {
    document.title = `${title} · ${siteName ?? fallbackName}`;
  }, [title, siteName, fallbackName]);
  useEffect(() => {
    if (!resolved) return;
    if (first.current) {
      first.current = false;
      return;
    }
    heading.current?.focus({preventScroll: true});
  }, [resolved]);
  return heading;
}

/**
 * The app shell: a full-height sidebar (brand, grouped nav, way back to the
 * website) and a top bar (screen title, user, sign out), the screen in
 * between. Every screen renders inside it; nothing here reloads the page.
 */
const rootRoute = createRootRouteWithContext<{queryClient: QueryClient}>()({
  component: function Shell() {
    const me = useMe();
    const title = useScreenTitle();
    const heading = useNavigationFocus(title, 'Plaza Accountability Hub');
    const {queryClient} = rootRoute.useRouteContext();
    const asOf = useDataAsOf(queryClient);
    const [open, setOpen] = useState(false);
    // `logout()` reloads the page when it is done, so pending never needs resetting.
    const [signingOut, setSigningOut] = useState(false);
    const viewer = me.data?.viewer;
    const abilities = me.data?.abilities;
    // Signed out meanwhile (or never signed in, in the editor Preview, where
    // the host page cannot see the session): go and sign in, then come back.
    const signedOut = viewer !== undefined && viewer.state !== 'user';
    useEffect(() => {
      if (!signedOut) return;
      const back = encodeURIComponent(`${window.location.pathname}${window.location.search}`);
      window.location.replace(`/account/login/?next=${back}`);
    }, [signedOut]);
    if (signedOut) return null;
    return (
      <>
        <header className="hub-header">
          <button
            type="button"
            className="app-menu-button"
            aria-label="Menu"
            aria-expanded={open}
            onClick={() => setOpen(value => !value)}>
            ☰
          </button>
          <Link className="hub-wordmark" to="/" aria-label="Plaza Auto Mall, Accountability Hub: My Cases">
            <b>Plaza</b>
            <small>AUTO MALL</small>
          </Link>
          <span className="hub-appname">Accountability Hub</span>
          <span className="spacer" />
          <Bell />
          {viewer && (
            <div className="app-viewer">
              <Avatar name={viewer.name ?? ''} />
              <span className="app-viewer-name">{viewer.name}</span>
              <Button
                variant="link"
                size="sm"
                pending={signingOut}
                pendingLabel="Signing out…"
                onClick={() => {
                  setSigningOut(true);
                  void logout();
                }}>
                Sign out
              </Button>
            </div>
          )}
        </header>
        <div className="app-shell" data-nav-open={open ? '' : undefined}>
          <aside className="app-sidebar">
            <nav aria-label="Hub" onClick={() => setOpen(false)}>
              {NAV_GROUPS.map(group => {
                const items = group.items.filter(item => !item.ability || abilities?.[item.ability]);
                if (!items.length) return null;
                return (
                  <div className="app-nav-group" key={group.label}>
                    <p className="app-nav-label">{group.label}</p>
                    {items.map(item => (
                      <Link
                        key={item.to}
                        to={item.to}
                        className="app-nav-link"
                        activeOptions={{exact: item.exact ?? false}}>
                        {item.label}
                      </Link>
                    ))}
                  </div>
                );
              })}
            </nav>
          </aside>

          <div className="app-main">
            <div className="app-topbar">
              <h1 className="app-title" ref={heading} tabIndex={-1}>
                {title}
              </h1>
            </div>
            <main className="app-content">
              <Outlet />
            </main>
            <HubFooter asOf={asOf} />
          </div>
        </div>
      </>
    );
  },
  notFoundComponent: () => (
    <div className="app-empty">
      <h2>Not found</h2>
      <p className="muted">This page does not exist.</p>
      <Link className="button" to="/">
        Back to My Cases
      </Link>
    </div>
  ),
});

// One `createRoute` per screen, with a LITERAL path (`<Link to>` is typed from
// them), a title, a loader over the screen's own queryOptions, a lazy screen.
const myCasesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  staticData: {title: 'My Cases'},
  loader: ({context: {queryClient}}) => warm(queryClient.ensureQueryData(hubMeQuery), queryClient.ensureQueryData(myCasesQuery)),
  component: lazyRouteComponent(() => import('./screens/my-cases'), 'MyCases'),
});
const casesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/cases',
  staticData: {title: 'Cases'},
  validateSearch: (search: Record<string, unknown>): {q?: string; state?: string; type?: string} => ({
    q: typeof search.q === 'string' ? search.q.slice(0, 80) : undefined,
    state: search.state === 'closed' || search.state === 'all' ? search.state : undefined,
    type: search.type === 'hot' || search.type === 'csi' ? search.type : undefined,
  }),
  loaderDeps: ({search}) => search,
  loader: ({context: {queryClient}, deps}) =>
    warm(
      queryClient.ensureQueryData(hubMeQuery),
      queryClient.ensureInfiniteQueryData(casesQuery({q: deps.q ?? '', state: deps.state ?? 'open', type: deps.type ?? ''}))
    ),
  component: lazyRouteComponent(() => import('./screens/cases'), 'Cases'),
});
const caseRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/cases/$caseId',
  staticData: {title: 'Case'},
  validateSearch: (search: Record<string, unknown>): {created?: number} => ({created: search.created ? 1 : undefined}),
  loader: ({context: {queryClient}, params}) =>
    warm(queryClient.ensureQueryData(hubMeQuery), queryClient.ensureQueryData(caseQuery(params.caseId))),
  component: lazyRouteComponent(() => import('./screens/case'), 'Case'),
});
const newHotRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/new/hot',
  staticData: {title: 'New Hot Prospect'},
  loader: ({context: {queryClient}}) => warm(queryClient.ensureQueryData(hubMeQuery)),
  component: lazyRouteComponent(() => import('./screens/new-hot'), 'NewHot'),
});
const newCsiRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/new/csi',
  staticData: {title: 'New CSI Call'},
  loader: ({context: {queryClient}}) => warm(queryClient.ensureQueryData(hubMeQuery)),
  component: lazyRouteComponent(() => import('./screens/new-csi'), 'NewCsi'),
});
const peopleRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/people',
  staticData: {title: 'People'},
  loader: ({context: {queryClient}}) =>
    warm(queryClient.ensureQueryData(hubMeQuery), queryClient.ensureInfiniteQueryData(hubPeopleQuery('')), queryClient.ensureQueryData(rolesQuery)),
  component: lazyRouteComponent(() => import('./screens/people'), 'People'),
});
const text = (v: unknown, max = 40) => (typeof v === 'string' ? v.slice(0, max) : undefined);
const reportSearch = (s: Record<string, unknown>): ReportSearch => ({
  preset: text(s.preset),
  from: text(s.from, 10),
  to: text(s.to, 10),
  store: text(s.store),
  department: text(s.department),
  type: text(s.type),
});
const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/dashboard',
  staticData: {title: 'Leadership Dashboard'},
  validateSearch: reportSearch,
  loaderDeps: ({search}) => search,
  loader: ({context: {queryClient}, deps}) => {
    const {from, to} = rangeOf(deps);
    return warm(
      queryClient.ensureQueryData(hubMeQuery),
      queryClient.ensureQueryData(dashboardQuery({from, to, store: deps.store ?? '', department: deps.department ?? '', type: deps.type ?? ''}))
    );
  },
  component: lazyRouteComponent(() => import('./screens/dashboard'), 'Dashboard'),
});
const drillRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/dashboard/cases',
  staticData: {title: 'Cases behind a number'},
  validateSearch: (s: Record<string, unknown>): DrillParams => ({
    type: text(s.type) ?? 'hot',
    measure: text(s.measure) ?? 'opened',
    from: text(s.from, 10) ?? '',
    to: text(s.to, 10) ?? '',
    store: text(s.store) ?? '',
    department: text(s.department) ?? '',
    ...(text(s.dim) ? {dim: text(s.dim), key: text(s.key) ?? 'null'} : {}),
  }),
  loaderDeps: ({search}) => search,
  loader: ({context: {queryClient}, deps}) => warm(queryClient.ensureQueryData(hubMeQuery), queryClient.ensureQueryData(drillQuery(deps))),
  component: lazyRouteComponent(() => import('./screens/drill'), 'DrillCases'),
});
const scorecardsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/scorecards',
  staticData: {title: 'People Scorecards'},
  validateSearch: reportSearch,
  loaderDeps: ({search}) => search,
  loader: ({context: {queryClient}, deps}) => {
    const {from, to} = rangeOf(deps);
    return warm(queryClient.ensureQueryData(hubMeQuery), queryClient.ensureQueryData(scorecardsQuery({from, to, store: deps.store ?? ''})));
  },
  component: lazyRouteComponent(() => import('./screens/scorecards'), 'PeopleScorecards'),
});
const scoreDrillRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/scorecards/cases',
  staticData: {title: 'Cases behind a number'},
  validateSearch: (s: Record<string, unknown>): ScoreSearch => ({
    from: text(s.from, 10) ?? '',
    to: text(s.to, 10) ?? '',
    store: text(s.store) ?? '',
    group: (text(s.group) ?? 'frontLine') as ScoreSearch['group'],
    metric: text(s.metric) ?? '',
    person: text(s.person) ?? '',
  }),
  loaderDeps: ({search}) => search,
  loader: ({context: {queryClient}, deps}) => warm(queryClient.ensureQueryData(hubMeQuery), queryClient.ensureQueryData(scoreDrillQuery(deps))),
  component: lazyRouteComponent(() => import('./screens/score-drill'), 'ScoreDrill'),
});
const myScorecardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/my-scorecard',
  staticData: {title: 'My Scorecard'},
  loader: ({context: {queryClient}}) => warm(queryClient.ensureQueryData(myScorecardQuery)),
  component: lazyRouteComponent(() => import('./screens/my-scorecard'), 'MyScorecard'),
});
const boardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/board',
  staticData: {title: 'Store Board'},
  validateSearch: (s: Record<string, unknown>): BoardSearch => ({
    store: text(s.store),
    status: text(s.status),
    clock: text(s.clock),
    owner: text(s.owner),
    reason: text(s.reason, 80),
  }),
  loaderDeps: ({search}) => ({store: search.store ?? ''}),
  loader: ({context: {queryClient}, deps}) => warm(queryClient.ensureQueryData(hubMeQuery), queryClient.ensureQueryData(boardQuery(deps.store))),
  component: lazyRouteComponent(() => import('./screens/board'), 'StoreBoard'),
});
const importRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/import',
  staticData: {title: 'Import people'},
  component: lazyRouteComponent(() => import('./screens/import-people'), 'ImportPeople'),
});
const storesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/stores',
  staticData: {title: 'Stores'},
  loader: ({context: {queryClient}}) => warm(queryClient.ensureQueryData(adminStoresQuery)),
  component: lazyRouteComponent(() => import('./screens/stores-admin'), 'StoresAdmin'),
});
const listsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/lists',
  staticData: {title: 'Pick lists'},
  loader: ({context: {queryClient}}) => warm(queryClient.ensureQueryData(listsQuery)),
  component: lazyRouteComponent(() => import('./screens/lists-admin'), 'ListsAdmin'),
});
const alertsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/alerts',
  staticData: {title: 'Alerts'},
  loader: ({context: {queryClient}}) => warm(queryClient.ensureInfiniteQueryData(alertsQuery), queryClient.ensureQueryData(alertPrefsQuery)),
  component: lazyRouteComponent(() => import('./screens/alerts'), 'Alerts'),
});
const overdueRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/overdue',
  staticData: {title: 'Overdue'},
  loader: ({context: {queryClient}}) => warm(queryClient.ensureQueryData(hubMeQuery), queryClient.ensureQueryData(overdueQuery)),
  component: lazyRouteComponent(() => import('./screens/overdue'), 'Overdue'),
});
const clocksRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/clocks',
  staticData: {title: 'Clocks and hours'},
  loader: ({context: {queryClient}}) => warm(queryClient.ensureQueryData(clockAdminQuery)),
  component: lazyRouteComponent(() => import('./screens/clocks-admin'), 'ClocksAdmin'),
});
const routingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/routing',
  staticData: {title: 'Routing'},
  loader: ({context: {queryClient}}) => warm(queryClient.ensureQueryData(routingQuery)),
  component: lazyRouteComponent(() => import('./screens/routing'), 'Routing'),
});
const accountRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/account',
  staticData: {title: 'Your account'},
  loader: ({context: {queryClient}}) =>
    warm(
      queryClient.ensureQueryData(meQuery),
      queryClient.ensureQueryData(twoFactorQuery),
      queryClient.ensureQueryData(sessionsQuery)
    ),
  component: lazyRouteComponent(() => import('./screens/account'), 'Account'),
});
const jobsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/jobs',
  staticData: {title: 'Jobs'},
  loader: ({context: {queryClient}}) => warm(queryClient.ensureInfiniteQueryData(manageJobsQuery)),
  component: lazyRouteComponent(() => import('./screens/jobs'), 'Jobs'),
});
const usersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/users',
  staticData: {title: 'Accounts'},
  loader: ({context: {queryClient}}) => warm(queryClient.ensureInfiniteQueryData(usersQuery({email: '', status: ''}))),
  component: lazyRouteComponent(() => import('./screens/users'), 'Users'),
});
const rolesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/roles',
  staticData: {title: 'Roles'},
  loader: ({context: {queryClient}}) =>
    warm(queryClient.ensureQueryData(rolesQuery), queryClient.ensureQueryData(permissionsQuery)),
  component: lazyRouteComponent(() => import('./screens/roles'), 'Roles'),
});
const activityRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/activity',
  staticData: {title: 'Activity'},
  loader: ({context: {queryClient}}) => warm(queryClient.ensureInfiniteQueryData(auditQuery)),
  component: lazyRouteComponent(() => import('./screens/activity'), 'Activity'),
});

export const routeTree = rootRoute.addChildren([
  myCasesRoute,
  casesRoute,
  caseRoute,
  newHotRoute,
  newCsiRoute,
  peopleRoute,
  routingRoute,
  alertsRoute,
  importRoute,
  storesRoute,
  listsRoute,
  overdueRoute,
  clocksRoute,
  dashboardRoute,
  drillRoute,
  scorecardsRoute,
  scoreDrillRoute,
  myScorecardRoute,
  boardRoute,
  accountRoute,
  jobsRoute,
  usersRoute,
  rolesRoute,
  activityRoute,
]);
