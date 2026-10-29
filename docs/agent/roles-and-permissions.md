---
title: Roles and permissions
read-when: before gating a feature on who may use it, adding an admin screen, a new permission or a role
---
Who may do what is decided by CODENAMES (`site:<resource>:<action>`) granted to ROLES, roles
given to USERS. Tables: `permissions` (catalogue), `roles`, `role_permissions`, `user_roles`.
ONE source of truth: the catalogue `CATALOGUE` in `src/server/permissions.ts` (yours; the core
entries come from `src/platform/auth/codenames.ts`, managed). From it come `PERMISSIONS.<KEY>`
(the codenames), the `/me` `abilities` and their `Abilities` type, and the `permissions` rows.

## Seeded
| Role | Grants | Notes |
| --- | --- | --- |
| `owner` | `*` | Cannot be edited or deleted. Claimed once (`auth_state`). The last owner keeps it. |
| `admin` | `site:user:*`, `site:role:read`, `site:audit:read`, `site:job:manage` | Editable by owners. |
| `member` | (nothing) | Every new account (`defaultRole`). |

Core codenames: `site:user:read`, `site:user:update`, `site:role:read`, `site:role:update`,
`site:audit:read`; the template's feature: `site:job:manage`. Wildcards: `site:user:*`, `site:*`, `*`.

## Rules
- Gate on a CODENAME, never on a role slug or a user id (`requireRole` exists; don't use it).
  Owners rename and edit roles; codenames never change. One codename per capability, the
  narrowest that fits.
- The route guard is the enforcement; `abilities` only hides UI. Every gated screen has both.
- Anti-escalation is built into the admin API (`canDelegate`): nobody grants, removes, edits or
  acts on access they do not hold themselves. Keep that rule in any role logic you add.
- Permissions are re-read from the database on every request (memoized per request), never put
  in the JWT: a role change applies on the next request.
- A codename is DECLARED in the catalogue, never written in a migration, never created from the
  browser. On the first signed-in request after a deploy, `syncPermissions`
  (`src/platform/permission-sync.ts`) inserts new entries and grants their `roles` ONCE, in one
  statement; it updates changed titles and never deletes. Never rename or reuse a shipped
  codename (roles hold it by name); to retire one, drop the entry and stop checking it.
- Own records: `<codename>_own` (`site:note:update_own`) means "only records whose owner is
  me". Enforce it with the helpers below, never with your own `if`. The owner id comes from
  the DATABASE row, never from the request body.
- Prerendered pages have no visitor: they cannot be gated per user. Gate in the portal
  (preferred) or in an on-demand page with `pagePermission`.

## Recipe: add a permission (ONE edit)
Add an entry to `CATALOGUE` in `src/server/permissions.ts`. That is all: no migration, no
`/me` change, no type change.
```ts
CRM_READ: {
  codename: 'site:crm:read',
  title: 'See contacts',                     // the roles screen, ≤ 120
  description: 'Open the CRM and read contacts.',
  group: 'CRM',
  ability: 'seeContacts',                    // optional: `abilities.seeContacts` for the UI
  roles: ['admin'],                          // optional: who gets it the first time (owners hold `*`)
},
```
A malformed entry (bad codename, duplicate codename or ability, empty title) throws at load:
the dev server and the build fail at once. `tests/permissions.test.ts` checks the catalogue.

## Recipe: gate an API route
`validator → withViewer → requireAuth → requirePermission(PERMISSIONS.CRM_READ) → withDb`.
A handler-level check: `if (!(await can(c, PERMISSIONS.CRM_READ))) return forbidden(c);`
(`src/platform/guards.ts`).

## Recipe: own records only
Declare both entries (`NOTE_UPDATE: 'site:note:update'`, `NOTE_UPDATE_OWN:
'site:note:update_own'`). Then:
```ts
.patch('/:id', body, withViewer, requireAuth, requirePermission(PERMISSIONS.NOTE_UPDATE, {orOwn: true}), withDb, async c => {
  const note = await c.var.db.note.findUnique({where: {id}, select: {id: true, ownerId: true}});
  if (!note) return c.json(problem('not_found', 'No such note.'), 404);
  if (!(await can(c, PERMISSIONS.NOTE_UPDATE, {ownerId: note.ownerId}))) return forbidden(c);
  …
})
```
Lists: `const scope = await permissionScope(c, PERMISSIONS.NOTE_UPDATE)` is `'all' | 'own' |
'none'`; for `'own'` add `where: {ownerId: c.var.viewer.id!}`. `{orOwn: true}` without `can` /
`permissionScope` in the handler is a hole. A wildcard (`site:note:*`) grants both.

## Recipe: gate a portal screen or nav item
Give the entry an `ability`; the portal reads `me.data?.abilities.<ability>`: a `NAV_GROUPS`
item takes `ability: '<ability>'`, a button `{abilities?.<ability> && …}`. The screen's API
routes are still guarded.

## Recipe: gate an on-demand (SSR) page
```astro
---
import NoAccess from '../../components/NoAccess.astro';
import Base from '../../layouts/Base.astro';
import {read} from '../../server/backend';
import {pagePermission} from '../../server/page-access';
import {PERMISSIONS} from '../../server/permissions';
export const prerender = false;
const page = await pagePermission(Astro, PERMISSIONS.REPORT_READ);
const report = page.allowed ? await read<Report>(page.api.reports.$get()) : null;
---
<Base site={page.site} viewer={page.viewer} title="Reports" noindex>
  {page.allowed ? <main>…</main> : <NoAccess site={page.site} denied={page.denied} />}
</Base>
```
`pagePermission` is `pageContext()` plus `allowed` / `denied` (`signed_out` 401, `refreshing`
401 — the layout refreshes and reloads, `forbidden` 403). It never redirects: the editor
Preview drops cookies, so a gated page there always shows the sign-in prompt; check it on the
live site, or build the screen in the portal. Never gate on `viewer.state` alone.

## Recipe: a new role with defaults
Prefer letting the owner create it in `/portal/roles`. If the site needs it from day one, a
migration: `INSERT INTO "roles" ("slug","name","description","is_system","updated_at") VALUES
('editor','Editor','Writes and edits posts.', false, CURRENT_TIMESTAMP) ON CONFLICT ("slug") DO NOTHING;`
in the SAME deploy as (or before) the catalogue entries that name it in `roles`: defaults are
granted only when the codename is first inserted, and a slug with no role is skipped. To give an
EXISTING codename to a new role, grant it in that migration (`INSERT INTO "role_permissions" …
SELECT … ON CONFLICT DO NOTHING`, matched by slug and codename). Never mark your own roles
`is_system`.

## Admin API (managed, `/site-api/admin/*`)
`GET /users?before=&email=&status=` (exact email match, keyset by id), `GET /users/:id`,
`PATCH /users/:id {status}`, `PUT /users/:id/roles {roles}`, `POST /users/:id/sessions/revoke`,
`GET /roles`, `GET /permissions`, `POST /roles`, `PATCH /roles/:slug`, `DELETE /roles/:slug`,
`GET /audit?before=`. Screens: `/portal/users`, `/portal/roles`, `/portal/activity`.
Every change writes `audit_events`. Show user emails only on these screens.
