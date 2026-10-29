import {abilitiesOf, type AbilitiesOf, codenamesOf, CORE_PERMISSIONS, definePermissions} from '../platform/auth/codenames';

/**
 * THE permission catalogue: every codename this site checks, declared ONCE.
 * Adding an entry here is the whole job (docs/agent/roles-and-permissions.md):
 *
 *   - `PERMISSIONS.<KEY>` is its codename, for `requirePermission` / `can`;
 *   - `ability` adds a flag to `/me` `abilities` (and to the `Abilities` type)
 *     for the UI: portal nav items, buttons, `pageContext()` pages;
 *   - the row reaches the `permissions` table (the roles screen) on the next
 *     signed-in request after deploy, and `roles` get it that first time only
 *     (`src/platform/permission-sync.ts`). No migration.
 *
 * Never rename or reuse a shipped codename: roles hold it by name. Browser-safe
 * (no server imports): the portal reads the `Abilities` type from here.
 */
export const CATALOGUE = definePermissions({
  ...CORE_PERMISSIONS,
  /** Post, edit, close and delete jobs (`/portal/jobs`). */
  JOB_MANAGE: {
    codename: 'site:job:manage',
    title: 'Manage jobs',
    description: 'Post, edit, close and delete jobs on the job board.',
    group: 'Jobs',
    ability: 'manageJobs',
    roles: ['admin'],
  },

  // ---- Plaza Accountability Hub: who SEES which cases --------------------
  // Everyone always sees the cases they created or held (case_participants).
  // These add more, and are enforced in every case query (src/server/hub/context.ts).
  CASE_READ_ALL: {
    codename: 'site:case:read_all',
    title: 'See every case',
    description: 'Every Hot Prospect and CSI case, every store.',
    group: 'Cases',
    ability: 'seeAllCases',
    roles: ['admin', 'executive', 'director-ops'],
  },
  CASE_READ_HOT: {
    codename: 'site:case:read_hot',
    title: 'See every Hot Prospect',
    description: 'Every Hot Prospect, every store (BDC Director).',
    group: 'Cases',
    roles: ['bdc-director'],
  },
  CASE_READ_HOT_BDC: {
    codename: 'site:case:read_hot_bdc',
    title: 'See Hot Prospects from BDC reps',
    description: 'Every Hot Prospect a Sales BDC rep created, every store (BDC Manager).',
    group: 'Cases',
    roles: ['bdc-manager'],
  },
  CASE_READ_STORE_SALES: {
    codename: 'site:case:read_store_sales',
    title: 'See sales cases of my stores',
    description: 'Hot Prospects and sales-delivery CSI cases of the stores I belong to (Sales Manager).',
    group: 'Cases',
    roles: ['sales-manager'],
  },
  CASE_READ_CSI: {
    codename: 'site:case:read_csi',
    title: 'See every CSI case',
    description: 'Every CSI case, every store. Never Hot Prospects (CSI Rep).',
    group: 'Cases',
    roles: ['csi-rep'],
  },
  CASE_READ_STORE_SERVICE: {
    codename: 'site:case:read_store_service',
    title: 'See service CSI cases of my stores',
    description: 'Service-visit CSI cases of the stores I belong to (Service Manager).',
    group: 'Cases',
    roles: ['service-manager'],
  },
  CASE_READ_SERVICE_BDC: {
    codename: 'site:case:read_service_bdc',
    title: 'See cases from Service BDC reps',
    description: 'Every case a Service BDC rep created (Service BDC Manager).',
    group: 'Cases',
    roles: ['service-bdc-manager'],
  },

  // ---- what people may DO -------------------------------------------------
  CASE_CREATE_HOT: {
    codename: 'site:case:create_hot',
    title: 'Create Hot Prospects',
    description: 'Send a customer to a manager.',
    group: 'Cases',
    ability: 'createHot',
    roles: ['admin', 'executive', 'director-ops', 'bdc-director', 'bdc-manager', 'sales-manager', 'salesperson', 'sales-bdc-rep', 'service-bdc-rep'],
  },
  CASE_CREATE_CSI: {
    codename: 'site:case:create_csi',
    title: 'Create CSI cases',
    description: 'Log a check-in call or an unhappy customer.',
    group: 'Cases',
    ability: 'createCsi',
    roles: ['admin', 'director-ops', 'csi-rep', 'service-manager', 'service-bdc-rep', 'service-bdc-manager'],
  },
  CASE_RECEIVE: {
    codename: 'site:case:receive',
    title: 'Receive cases',
    description: 'Can be picked as the manager a case goes to.',
    group: 'Cases',
    roles: ['director-ops', 'bdc-director', 'bdc-manager', 'sales-manager', 'service-manager', 'service-bdc-manager'],
  },
  CASE_REASSIGN: {
    codename: 'site:case:reassign',
    title: 'Reassign any case',
    description: 'Hand off a case they do not own.',
    group: 'Cases',
    ability: 'reassignCases',
    roles: ['admin', 'director-ops'],
  },
  CASE_REOPEN: {
    codename: 'site:case:reopen',
    title: 'Reopen closed cases',
    description: 'Only the Director of Operations and Admin.',
    group: 'Cases',
    ability: 'reopenCases',
    roles: ['admin', 'director-ops'],
  },
  DASHBOARD_READ: {
    codename: 'site:hub:dashboard',
    title: 'See the Leadership Dashboard',
    description: 'Owner, Director of Operations, BDC Director and Admin. Numbers only count cases they may see.',
    group: 'Reports',
    ability: 'seeDashboard',
    roles: ['admin', 'executive', 'director-ops', 'bdc-director'],
  },
  SCORECARDS_READ: {
    codename: 'site:hub:scorecards',
    title: 'See People Scorecards',
    description: 'Managers and up. Store managers see the people of their own stores.',
    group: 'Reports',
    ability: 'seeScorecards',
    roles: ['admin', 'executive', 'director-ops', 'bdc-director', 'bdc-manager', 'sales-manager', 'service-manager', 'service-bdc-manager'],
  },
  STORE_BOARD: {
    codename: 'site:hub:store_board',
    title: 'See the Store Board',
    description: 'Every open case of their stores that they may see, sortable and filtered.',
    group: 'Reports',
    ability: 'seeStoreBoard',
    roles: ['admin', 'executive', 'director-ops', 'bdc-director', 'bdc-manager', 'sales-manager', 'service-manager', 'service-bdc-manager'],
  },
  EXPORT: {
    codename: 'site:hub:export',
    title: 'Export to CSV',
    description: 'Download any list or report table they can see as a CSV file (each export is logged).',
    group: 'Reports',
    ability: 'exportData',
    roles: ['admin', 'executive', 'director-ops', 'bdc-director', 'bdc-manager', 'sales-manager', 'service-manager', 'service-bdc-manager'],
  },
  HUB_MANAGE: {
    codename: 'site:hub:manage',
    title: 'Manage people, stores and routing',
    description: 'Add people, set their stores and manager, edit who cases go to.',
    group: 'Hub admin',
    ability: 'manageHub',
    roles: ['admin'],
  },
});

/** Codenames by key: `PERMISSIONS.JOB_MANAGE` is `'site:job:manage'`. */
export const PERMISSIONS = codenamesOf(CATALOGUE);

export type Codename = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/** What the UI may SHOW the visitor (`/me`); every route checks again. */
export type Abilities = AbilitiesOf<typeof CATALOGUE>;

/** The abilities a set of granted codenames gives (`/me`). */
export const abilitiesFor = (permissions: ReadonlySet<string>): Abilities => abilitiesOf(CATALOGUE, permissions);

/** A guest's abilities: every flag false. */
export const NO_ABILITIES: Abilities = abilitiesFor(new Set());
