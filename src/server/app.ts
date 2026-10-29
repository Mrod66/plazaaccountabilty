import {Hono} from 'hono';
import {bodyLimit} from 'hono/body-limit';

import {isPreview} from '../platform/api';
import {adminRoutes, authRoutes, getAccess, getViewer, ownerClaimMode} from '../platform/auth';
import {config} from '../platform/config';
import {csrf, previewCookies, problem, sameOrigin} from '../platform/guards';
import {syncPermissions} from '../platform/permission-sync';
import {authSettings} from './auth-settings';
import {abilitiesFor, CATALOGUE} from './permissions';
import {alertRoutes} from './routes/alerts';
import {caseRoutes} from './routes/cases';
import {hubRoutes} from './routes/hub';
import {reportRoutes} from './routes/reports';
import {settingsRoutes} from './routes/settings';
import {jobRoutes} from './routes/jobs';
import {siteRoutes} from './routes/site';

/**
 * The Site API: this site's ONLY backend, one Hono app at `/site-api/*`.
 *
 * Everything reads and writes through it: the Astro pages call it IN-PROCESS
 * (`src/server/backend.ts`), the portal and the `/account` pages call it from
 * the browser (`siteFetch` / the typed `hc` client, `src/portal/api.ts`).
 * Mounted by ONE catch-all page, `src/pages/site-api/[...path].ts`.
 *
 *   GET  /health        what this site has been given (booleans only)
 *   GET  /me            the visitor + what the UI may show them
 *   *    /auth/...      sign-up, sign-in, sessions, passwords   platform/auth/routes.ts
 *   *    /admin/...     users, roles, audit log (admins)        platform/auth/admin.ts
 *   GET  /site          the site's brand                        routes/site.ts
 *   *    /jobs/...      the job board (Site Database)           routes/jobs.ts
 *   *    /hub/...       the Accountability Hub: me, people, routing  routes/hub.ts
 *   *    /cases/...     Hot Prospects and CSI cases             routes/cases.ts
 *   *    /alerts/...    my alerts (the bell), email preference  routes/alerts.ts
 *   GET  /reports/...   dashboard, drill-downs, scorecards, Store Board  routes/reports.ts
 *   *    /settings/...  pick lists, stores, people CSV, export log  routes/settings.ts
 *
 * ROOM FOR LATER: an incoming webhook that creates cases from call-tracking
 * alerts. It goes in its OWN Hono app, mounted before `sameOrigin`/`csrf`
 * (the caller is another site), and must authenticate every call: a per-
 * organization token the admin creates in the hub, stored only as a SHA-256
 * hash, or an HMAC signature (security.md A08). Cases it creates would carry
 * `source: 'webhook'` and go through the same routing and clocks as `POST /cases/hot`.
 *
 * Add a feature as a new `routes/<name>.ts` and one `.route()` line below,
 * CHAINED so `AppType` carries every route to the typed client. Errors are
 * JSON `{error, message}`. `sameOrigin` + `csrf` refuse every cross-site or
 * token-less write; keep them, with `previewCookies` before them (a webhook
 * that must accept a cross-site write gets its own app, mounted before them,
 * with its own authentication).
 */
export const app = new Hono()
  .basePath('/site-api')
  // The editor Preview only: auth cookies carried in headers (its gateway drops cookies).
  .use(previewCookies)
  .use(sameOrigin)
  .use(csrf)
  // No route here takes a big body; uploads never pass through the Worker.
  .use(bodyLimit({maxSize: 64 * 1024, onError: c => c.json(problem('too_large', 'That request is too large.'), 413)}))
  // New catalogue codenames reach the `permissions` table (once per isolate; no migration).
  .use(syncPermissions(CATALOGUE))

  .get('/health', c =>
    c.json({
      ok: true,
      preview: isPreview(),
      database: Boolean(config.databaseUrl),
      auth: Boolean(config.jwtSecret && config.databaseUrl),
      siteKey: Boolean(config.siteKey),
      // false = the live site has no owner email, so nobody can become owner.
      ownerSetup: !authSettings.firstUserBecomesOwner || ownerClaimMode(authSettings) !== 'off',
    })
  )

  // `abilities` only decides what the UI SHOWS; every guarded route checks again.
  .get('/me', async c => {
    const [viewer, access] = await Promise.all([getViewer(c.req.raw), getAccess(c.req.raw)]);
    c.header('Cache-Control', 'private, no-store');
    // One flag per catalogue entry with an `ability` (src/server/permissions.ts).
    const abilities = abilitiesFor(new Set(access.permissions));
    return c.json({viewer, roles: access.roles, abilities});
  })

  .route('/auth', authRoutes(authSettings))
  .route('/admin', adminRoutes)
  .route('/site', siteRoutes)
  .route('/jobs', jobRoutes)
  .route('/hub', hubRoutes)
  .route('/cases', caseRoutes)
  .route('/alerts', alertRoutes)
  .route('/reports', reportRoutes)
  .route('/settings', settingsRoutes)

  .notFound(c => c.json(problem('not_found', 'No such Site API route.'), 404))
  .onError((err, c) => {
    // The message only: an error object can carry request details.
    console.error(`site-api ${c.req.method} ${c.req.path}: ${err.message}`);
    return c.json(problem('internal_error', 'Something went wrong.'), 500);
  });

export type AppType = typeof app;
