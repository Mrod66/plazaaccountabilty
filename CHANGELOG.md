# Changelog

Template releases. `npm run platform -- check` says when a newer one is out;
`npm run platform -- upgrade` applies it (see `scripts/platform.mjs`).
Managed by the template: replaced on upgrade.

## 0.8.0

- **File storage.** Photos, documents, audio and video people upload, kept by the platform
  (`docs/agent/files.md`). Server helpers in `src/platform/files.ts` (`createUpload`,
  `completeUpload`, `fileUrl`, `deleteFile`, `listFiles`, `storageUsage`, `publicFileUrl`), the
  browser's `putFile` in `src/platform/files-browser.ts`. Uploads go to a one-time path on the
  site's own address, so the CSP is unchanged for them; the owner adds a storage pack and turns it on in the
  dashboard. In the editor Preview and on your machine the middleware hands `/__platform/files/*`
  to the platform.
- **Audio and video from https.** The CSP now has `media-src 'self' https: blob:` (stored files
  play from their signed links), like `img-src`.

## 0.7.0

- **Client navigation on public pages.** `<ClientRouter />` (Astro) in `Base.astro`: a click
  swaps the next page in without a reload (prefetched first), focus moves and the new title is
  announced; every page is still real server-rendered HTML. `/portal` has no router, so a link to
  it stays a full load. Page scripts now run on `astro:page-load` and return early on other
  pages: if you added a `<script>` of your own, do the same (`docs/agent/performance.md`
  "Scripts with the ClientRouter"), and keep `history.state` when you call `replaceState`.
- **Background jobs: times are to the minute.** A job due less than 60 s ahead runs now; the first
  retry waits 1 minute (then 2 min, 10 min, 1 h). A site may add 10 jobs a minute by default
  (`E_JOBS_RATE_LIMITED`, 429); a paused site's sends get `E_JOBS_PAUSED` (423)
  (`docs/agent/background-jobs.md`).


## 0.6.0

- **The admin signs in with an emailed code.** `/account/login/` now sends a 6-digit code first
  (10 minutes, one use); "Use a password instead" stays for accounts that set one. The site's
  owner addresses (`SITE_OWNER_EMAILS`) get their admin accounts made for them, with no password,
  before their first code: nobody needs to sign up. New table `sign_in_codes` (migration
  `20261026120000_sign_in_codes`, additive).
- **One click still asks for two-step sign-in.** "Open live portal" from the dashboard now goes to
  the authenticator code step when the admin turned two-step sign-in on (it used to skip it).
- **The portal opens signed in from the editor Preview.** `/portal/?owner_ticket=…` (the Preview's
  shield) signs the owner in with a fetch, since the Preview can't keep a page-load session.
- **Neutral platform names.** Nothing in the site's code, variables, headers or paths names the
  company that hosts it. Rename these in your own `.env` and code:
  `SITE_KEY` (was `EZYSTUDIO_SITE_KEY`), `SITE_URL`, `SITE_PREVIEW`, `SITE_OWNER_EMAILS`,
  `SITE_JOBS_SECRET` (each was `EZYSTUDIO_…`), `SITE_DIR` for `npm run platform`.
  Background jobs arrive at `POST /site-api/_platform/jobs`, signed in `x-site-signature`.
  Site Keys start `stk_`. Installed apps keep their records in `.platform/apps/`.

## 0.5.0

- **Sign-in works on the live site.** The session and CSRF cookies are now `__Host-site_at`,
  `__Host-site_rt` and `__Host-site_csrf` (`site_at`… on your machine). The old names were the
  platform's own, which the platform edge removes before a request reaches a site, so a deployed
  site saw every signed-in visitor as signed out.
- **Background jobs reach the live site.** Deliveries come to `POST /site-api/_platform/jobs`,
  signed in `x-site-signature` (was `/_ezy/jobs` and `x-platform-*`, which the edge also removed).
- Platform variables are the platform-only names: `SITE_URL`, `SITE_PREVIEW`,
  `SITE_OWNER_EMAILS` (were `EZY_*`). Rename them in your own `.env`.
- **One-click owner sign-in.** "Open admin" in the dashboard signs an owner address
  straight into `/portal` as owner, with no sign-up and no email (`GET /site-api/auth/owner`,
  `src/platform/auth/owner.ts`). The owner role now follows the owner list: when the account
  holding it is no longer an owner address, the next owner address to sign in takes it over and
  the old holder loses `owner`.
- **Two-step sign-in**: an authenticator app (TOTP, QR code) with 10 one-use recovery codes, set
  up in `/portal/account`. With it on, sign-in asks for the code after the password. Admins can
  switch it off for someone who lost their phone (Users).
- **Account**: change the email address (a link to the new address; the old one is told),
  signed-in devices (sign one out), and delete the account (not the last owner).
- **Roles**: a permission is ONE entry in `CATALOGUE` (`src/server/permissions.ts`): its row,
  default roles, `/me` ability and the `Abilities` type follow. `requirePermission(code, {orOwn})`
  and `can(c, code, {ownerId})` enforce "own records only"; `pagePermission()` gates an SSR page.
- **Instant navigation**: public pages prefetch on hover (nav links when visible) and use
  cross-document view transitions; the portal preloads a screen and its data on hover, caches
  reads for 30 s, code-splits every screen, restores scroll, and sets the tab title and focus
  per screen. JSON-LD: `WebSite`/`Organization`, `BlogPosting`, `JobPosting`.
- robots.txt only disallows `/site-api/`, so crawlers can read the `noindex` on account and
  portal pages.
- New migration `20261026090000_account_security` (additive: two-step columns, `email_changes`,
  `recovery_codes`). New dependency `uqr` (QR codes, no dependencies of its own).

## 0.4.2

- Sign-in, owner role: owner now goes only with a password chosen through an emailed link.
  Before, someone who registered the owner's address first (with their own password) became
  owner the moment the real owner clicked the confirmation mail. Now confirming an owner address
  drops the registered password, ends its sessions and emails a link to choose one; that link
  (or Forgot password) claims owner, so a squatter can no longer lock the owner out either. With
  `requireEmailVerification: false`, registering an owner address no longer makes anyone owner
  without proof. Signing up again on an unconfirmed address keeps neither sign-up's password and
  kills its older confirmation links; confirming the new link emails a link to choose the
  password, so whoever holds the inbox sets it (a late sign-up can no longer replace the real
  person's password, nor an early one keep the squatter's). Two sign-ups at the very same moment
  are handled the same way (the one that lost the race used to leave the other's password in place).
- Rate limits: each attempt takes a per-scope advisory lock, is recorded and then checked, so a
  burst of parallel requests gets exactly the allowance through (`takeAttempt()`; the
  `AttemptStore` interface gained `settle`, `discard` and an optional `exclusive`, and `record`
  answers the row id). A busy lock is tried, not waited on: a waiter gives its database connection
  back, retries for up to 2 seconds and is then refused like any rate-limited attempt, so a burst
  on one IP can't use up the Site Database's connections.
- Confirm email: when an owner address must choose its password first, the page points to the
  inbox instead of showing a Sign in link that could not work.
- Passwords: PBKDF2 at 600,000 iterations (was 210,000); older hashes re-hash at the next login.
- Sessions: "Sign out" on one device ends that device's access token at once (the session
  lookup also checks the sign-in is not revoked), not up to 10 minutes later.
- Forgot password and resend answer before looking the account up (no timing difference); a
  suspended account cannot confirm its email; two owners removing each other at once can no
  longer leave a site with no owner; a signed but malformed job delivery is a 400, not a 500.
- Background jobs, replay guard: with a Site Database, a delivery already taken (same job and
  try) is remembered in the new managed `job_deliveries` table, so a replayed copy runs nothing
  on any Worker instance, not only the one that took it (migration
  `20261023080001_job_deliveries`). Without a Site Database, or before the migration ran, it is
  still per instance. The guard uses raw SQL, so it works whether or not your client has the
  model.
- Upgrading: `prisma/schema.prisma` is yours. If `upgrade` lists it as differing, copy the
  `model JobDelivery { … @@map("job_deliveries") }` block from this release into it (next to
  the other managed models) BEFORE `npx prisma migrate dev`, then `npx prisma generate`.
  Without the model, `migrate dev` sees a table the schema does not have and proposes a
  migration that drops `job_deliveries`: never apply that one (delete it and add the model).

## 0.4.1

- Background jobs, safer delivery: a list named like a built-in (`constructor`, `tostring`) no
  longer finds a handler it never had; a delivery body over 64 KB is refused even without a
  `Content-Length`; on your machine and in the Preview a failed job says how many tries its
  list really has (`background.json` `retries`).
- Background jobs, secret replacement: a delivery may carry two signatures (`v1=…,v1=…`) while an
  owner's replaced jobs secret waits for the next publish; either one verifies. A copy of a
  delivery this Worker already took (same job and try) runs nothing.
- Docs (`docs/agent/background-jobs.md`): a `key` stays with a waiting job however far ahead it
  was sent (so `cancelJob` by key always reaches it); jobs at once per site by plan; at most 100
  lists per site (`E_JOBS_TOO_MANY_LISTS`); a later job does not hold its ordered group.

## 0.4.0

- Background jobs: do something later, on a schedule, with retries, run and watched by
  the platform (`docs/agent/background-jobs.md`). New managed `src/platform/background.ts`
  (`sendJob`, `sendJobs`, `cancelJob`, `defineBackground`, `DontRetry`); your handlers in
  `src/server/background.ts`; schedules and list settings in `background.json`;
  `npm run platform -- jobs` checks both. The platform delivers each job to
  `POST /site-api/_platform/jobs`, signed with the new platform secret `SITE_JOBS_SECRET`
  (`config.jobsSecret`); `src/pages/site-api/[...path].ts` answers it before the Site API. In the
  editor Preview and on your machine, jobs run locally, right away, with a log line.
- Ordered lists: `"ordered": true` in `background.json` + `sendJob(…, {group})` run one job at a
  time per group, in send order (`job.group` in the handler).
- Upgrading: `src/pages/site-api/[...path].ts`, `src/server/background.ts` and `background.json`
  are yours: add them as in this release if `upgrade` lists a conflict.

## 0.3.1

- Preview: sign-in works in the editor Preview. Its gateway drops every `Cookie` and
  `Set-Cookie` header, so every form there failed with "This form has expired". Now, in the
  Preview only (`SITE_PREVIEW=1`), the new `previewCookies` middleware (mounted first in
  `src/server/app.ts`; `src/platform/auth/preview-cookies.ts`) mirrors the auth cookies into
  `x-ezs-preview-set-cookie` and reads them back from `x-ezs-preview-cookie`.
  `src/platform/browser.ts` keeps them for the tab in `sessionStorage` and sends them on every
  `siteFetch`. CSRF, refresh rotation and sign-out work unchanged. The live site never sends or
  reads those headers: its cookies stay `__Host-`, HttpOnly and Secure.
- Preview: `/portal` starts the app even when the server sees no session (Preview only), and
  the portal shell sends a signed-out visitor to `/account/login/?next=…` (everywhere). On
  every page, `<Base>` fills the visitor in in the browser when the server could not see them.
  `useMe()` refreshes an expired session once instead of showing the portal signed out.
- Preview: `npm run build` no longer breaks the running Preview. The build rewrote the dev
  server's Vite dependency cache (`node_modules/.vite/deps_ssr`) under it and every page
  answered 500 until the dev server restarted. Builds now use their own cache
  (`node_modules/.vite-build`, a small integration in `astro.config.mjs`).
- Error pages: new `src/pages/500.astro`. A page that throws on the live site now shows a
  page (500, `noindex`, security headers) instead of an empty answer. It is left out of the
  sitemap.
- Jobs: a database outage is a 503 (`Retry-After: 60`, "not available right now"), no longer a
  404 that search engines drop: `/jobs/<slug>/` tells "missing" (404) from "could not read"
  (503), and `/jobs/` answers 503 with its notice. `/sitemap.xml` is cached 5 minutes instead of
  an hour when the jobs could not be read.
- Account emails link to the trailing-slash pages (`/account/verify/?token=`,
  `/account/reset/?token=`, `/account/login/`): no redirect. Old links still work.
- Local dev: `prisma.config.ts` reads `.env` when there is one (the Prisma CLI does not by
  itself), so `npx prisma migrate dev` works on your machine as the README says. Variables
  already set (the editor, the Build) win over the file.
- Agent docs: `database.md` adds `npx prisma generate` after `migrate dev` (Prisma 7 no longer
  runs it; the new model is `undefined` until then) and notes that `--create-only` applies
  pending migrations; `site-api.md` says what the notes recipe needs; `publishing.md` explains
  the Preview's header-carried cookies and that relayed email links open the LIVE site;
  `AGENTS.md` lists the error pages, the 503 rule for detail pages, the data-file-first rule for
  collections and `siteFetch()` over plain `fetch`.
- Tests: `tests/preview-cookies.test.ts` (unit) and `tests/integration/preview.test.ts`
  (register → verify → login → refresh → logout behind a cookie-dropping gateway; CSRF still
  enforced; the header ignored off the Preview). The harness's `Browser` takes
  `gateway: 'preview'`.

## 0.3.0

- Security: on the live site the owner role is claimed ONLY by an owner address: `ownerEmails`
  plus the new platform var `SITE_OWNER_EMAILS` (the account owner's email, set at each
  Publish; `config.ownerEmails`). With no owner address, nobody becomes owner (no first-sign-up
  claim): a warning is logged, `/site-api/health` answers `ownerSetup: false` and the portal
  overview shows a setup notice. Local dev and the editor Preview keep the first-account claim.
  New `ownerClaimMode()` / `ownerEmailsFor()` in the auth core; `config.production`.
- Security: `BrandMark` no longer uses `style=""` attributes, which the CSP blocked (a console
  error on every page and unsized marks); sizes are classes (`.brand-size-<n>`).
- SEO: `<Base>` writes a meta description on every page (default `SITE.description`, new in
  `src/content/site.ts` with `lang` and `url`), a canonical URL, `og:site_name`, `og:type`,
  `og:description`, `og:url`, absolute `og:image` (+ alt), Twitter card tags and, on posts,
  `article:*` times. The address comes from the new `src/lib/seo.ts` (`SITE.url`, else
  `config.siteUrl`). The 404 renders are `noindex`.
- New routes: `/sitemap.xml` (on request, `Cache-Control: public, max-age=3600`: public pages
  found automatically, posts, the newest 1000 open jobs via the new indexed
  `GET /site-api/jobs/sitemap`), `/robots.txt` (prerendered; disallows `/account/`, `/portal`,
  `/site-api/`) and `/rss.xml` (prerendered, 20 newest posts). `<head>` links the feed and the
  sitemap; the footer links the feed.
- URLs: public links end with `/` (`/about/`, `/blog/<slug>/`, `/jobs/`, `/account/login/`…),
  where prerendered pages are served, so a click no longer costs a 307 redirect; the
  `/account` redirect targets `/account/login/`.
- Performance: `/jobs` and `/jobs/<slug>` read the jobs in parallel with `pageContext()` (no
  waterfall). Blog covers may be files in `src/assets/` (now preferred), rendered by
  `src/components/Cover.astro` through `astro:assets` `<Picture>`; `imageService` is now
  `'compile'` (optimised at build for prerendered pages, passed through at runtime).
- Jobs: a slug taken meanwhile (unique violation) retries with a random suffix instead of
  failing; `manage` and `sitemap` are never job slugs.
- Accessibility: a "Skip to content" link and `<main id="main">` on every page, a focus ring on
  links, job titles are `<h2>` under the page's `<h1>`, a default `/favicon.svg`.
- Agent docs: new `seo.md`; `database.md` gains "Connections (serverless)" and FK-index rules;
  `performance.md` covers parallel page reads, caching headers and build-time images (Lighthouse
  target 95); `security.md` forbids `style=""`; `AGENTS.md` adds collection, model and image
  recipes and a "Never" list.

## 0.2.0

- Template source: `template.json` `repo` is now `file:templates/astro-app` (a folder in an
  the platform checkout; no published repository yet). `npm run platform -- check|upgrade` read it
  (`$SITE_DIR`, `--from DIR`; `--base DIR` for a 3-way merge), `owner/name` GitHub repos
  still work. `.wrangler/` and `.platform/` are never part of an upgrade.
- Agent docs: platform facts (the Site API and email endpoints, the Site Key's env name and
  prefix, the site's free address, email kinds and relay limits) are platform-filled
  placeholders, so they always match the platform that renders them. `auth.md` states the email
  relay limits.
- `.env.example`, `src/env.d.ts`, `src/platform/config.ts`: `SITE_URL` is the site's own
  address (no hard-coded host). Example job data is neutral.

## 0.1.0

First the platform release.

- A site stands alone: it owns its users, sign-in and data. Platform secrets `JWT_SECRET` and
  `SITE_KEY` (the Site Key); platform calls go to `SITE_URL`.
- Site-owned auth in the managed core (`src/platform/auth/`): users, roles, permissions,
  refresh-token families, password resets, email verifications, rate-limit ledger, audit log
  (migrations `20261019090100_site_auth`, `20261019090200_seed_roles`).
  - PBKDF2-SHA256 210k passwords (versioned hash strings, rehash on login), HS256 access tokens
    (10 min), opaque rotating refresh tokens with reuse detection, `session_version` revocation.
  - `__Host-` HttpOnly Secure SameSite=Lax cookies, same-origin guard + double-submit CSRF.
  - Rate limits with exponential backoff per email+IP, email and IP.
  - Account emails relayed by the platform (`POST /api/site/v1/emails`).
  - Seeded roles `owner`, `admin`, `member`; first confirmed account becomes owner
    (`ownerEmails` to restrict); anti-escalation in the admin API.
- Blog as an Astro content collection: Markdown in `src/content/blog/` (schema in
  `src/content.config.ts`), prerendered `/blog` and `/blog/<slug>`; the platform blog API and
  `/site-api/posts` are gone (the platform has no blog/CMS API).
- Pages `/account/login`, `/register`, `/forgot`, `/reset`, `/verify`; portal screens Account,
  Users, Roles, Activity (plus Jobs).
- No borrowed sessions, no members directory, no uploads (no site storage yet), no `notes`
  example table.
- Security headers on every response, Astro CSP with hashes, `public/_headers`, 64 KB body limit.
- `docs/agent/*.md`: auth, roles and permissions, security (OWASP Top 10), performance, database,
  Site API, publishing. Managed like `src/platform/`.
- Unit tests (`npm test`): password hashing, JWT, refresh rotation and reuse, rate limits,
  codenames, cookies, input. Integration tests (`TEST_DATABASE_URL=… npm test`): the real Site
  API on Postgres — register/verify/login, owner claim, enumeration, refresh rotation and reuse,
  logout/logout-all, forgot/reset, change password, rate limits, CSRF, admin anti-escalation.
- `getDb()` picks the driver by host: Prisma Postgres (`adapter-ppg`) or plain Postgres
  (`adapter-pg`, local stand-in and tests). Test-only Node client generator.
