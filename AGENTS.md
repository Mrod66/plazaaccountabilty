# Rules for AI agents working in this app

The single source of rules for EVERY coding agent (Claude Code, Codex, Gemini, Cursor…).
`CLAUDE.md` and `GEMINI.md` only import this file: edit here, never there.

This repo is ONE site: a website AND its own app, in one Astro project on ONE
Cloudflare Worker (`output: 'server'`, `@astrojs/cloudflare`). It stands alone: it owns its
users, sign-in, roles and data in its own Site Database. It already works end to end:
prerendered marketing pages, a blog, a job board, sign-up/sign-in/password reset, two-step
sign-in, change email, signed-in devices, delete account, one-click owner sign-in from the dashboard
("Open admin"), a dashboard with user and role admin, a backend and a database. Extend it; don't
rebuild what is here.

Placeholders written as double braces around an UPPER_CASE name are filled in by the platform.
The filled-in copy, which wins over this file when they differ, is what the editor
gives you (`/etc/claude-code/CLAUDE.md`, `{{DOCS_DIR}}/`); outside the editor,
`npm run platform -- docs` saves it to `.platform/docs/` (start with `core.md`).

## Topic docs: read the one that fits BEFORE that work
`docs/agent/<topic>.md` (live: `{{DOCS_URL}}/<topic>.md` on this site's address, which wins
when they differ):

| Doc | Read it before |
| --- | --- |
| `auth.md` | anything about who the visitor is, sign-in, sessions, passwords, account emails |
| `roles-and-permissions.md` | gating a feature, an admin screen, a new permission or role |
| `security.md` | any route, form, query, HTML, outbound call, secret, log line; before "done" |
| `performance.md` | any query, list, page, dependency, image, font, cache or loop |
| `database.md` | the schema, a migration, seed data, an index, a new model |
| `seo.md` | a new public page, titles and descriptions, URLs, social cards, sitemap, robots.txt, RSS |
| `site-api.md` | any server route or backend code |
| `background-jobs.md` | anything that happens later, on a schedule, with retries: reminders, follow-ups, summaries, cleanups |
| `files.md` | anything that stores a file a person picks (photos, documents, attachments, avatars, audio, video) or shows one back |
| `publishing.md` | git, scripts, dependencies, config, the Preview, going live |

## Architecture: one Worker, Hono is the backend
```
browser ──► Astro page (the view) ──in-process──► Hono /site-api ──► Site Database / platform API
browser ──► /portal (React SPA) ──── fetch ─────► Hono /site-api
```
- **Hono (`src/server/app.ts`, `src/server/routes/*`) is the ONLY backend.** Validation,
  guards, database and platform calls live in Site API routes. Pages only render.
- **Pages call it in-process** with `backend(Astro.request)` / `pageContext()` (`src/server/`).
- **`src/platform/` is the MANAGED core** (config, platform client, guards, the whole auth
  system in `src/platform/auth/`, browser helpers, sanitizer). Never edit it:
  `npm run platform -- upgrade` replaces it (that is how security fixes reach this site).
  `docs/agent/` is managed the same way. Your code: `src/server/`, `src/pages/`, `src/portal/`,
  `src/content/`, `src/lib/`, `src/styles/`, `prisma/`.
- **One Worker, one build, one deploy.** No second Worker, no KV/R2/D1/queues/Durable Objects.
  Later and scheduled work is the platform's background jobs (`background-jobs.md`): handlers in
  `src/server/background.ts`, schedules in `background.json`, `sendJob()` to send.

| Path | What | Code |
| --- | --- | --- |
| `/`, `/about/` | marketing (STATIC) | `src/pages/index.astro`, `about.astro` |
| `/blog/`, `/blog/<slug>/` | the blog: Markdown files, prerendered | `src/content/blog/*.md`, `src/pages/blog/`, `src/content.config.ts` |
| `/jobs/`, `/jobs/<slug>/` | job board (SSR, Site Database) | `src/pages/jobs/` |
| `/account/*` | login, register, forgot, reset, verify (STATIC + script) | `src/pages/account/` |
| `/portal/*` | signed-in dashboard: account, users, roles, activity, jobs (SPA) | `src/portal/` |
| `/site-api/*` | the backend | `src/server/`, `src/platform/auth/` |
| `/sitemap.xml` | public pages, posts, open jobs (SSR, cached 1 h) | `src/pages/sitemap.xml.ts` |
| `/robots.txt`, `/rss.xml` | crawler rules, the blog feed (STATIC) | `src/pages/robots.txt.ts`, `rss.xml.ts` |
| — | error pages: any miss (404), a page that failed on the server (500) | `src/pages/404.astro`, `500.astro` |
| — | `<head>` SEO (title, description, canonical, Open Graph, Twitter), header, footer | `src/layouts/Base.astro`, `src/lib/seo.ts` |

Public page URLs END WITH `/` (`/about/`, `/blog/<slug>/`, `/jobs/`): prerendered pages are
served there (`/about` costs a redirect), and the canonical URLs and sitemap use that form.
Link with the slash.

Never create pages under `{{API_PREFIX}}` (the platform's) and never add `/login`, `/register`, `/forgot`,
`/reset`, `/verify-email` at the root: sign-in pages live under `/account/`.

## Environment
Read ONLY through `config` (`src/platform/config.ts`), server code only. Names are the platform's
contract: you cannot rename or add them, and you cannot add secrets (never ask for one).

| `config.` | Platform name | What |
| --- | --- | --- |
| `siteUrl` | `{{SITE_URL_ENV}}` | the site's own address, where the platform answers `{{API_PREFIX}}/*` (`{{SITE_ORIGIN_PATTERN}}` or its custom domain; plain var) |
| `preview` | `SITE_PREVIEW` | `1` only in the editor Preview |
| `databaseUrl` | `DATABASE_URL` | the Site Database (Preview Database in the editor) — secret |
| `jwtSecret` | `JWT_SECRET` | signs access tokens, keys rate-limit hashes — secret |
| `siteKey` | `{{SITE_KEY_ENV}}` | the Site Key (`{{SITE_KEY_PREFIX}}…`) for `{{SITE_API_PREFIX}}/*` (relayed emails) — secret |

- No `DATABASE_URL` → routes answer 503 `site_database_disabled`; no `JWT_SECRET` → auth answers
  503 `auth_not_configured`. Tell the owner; don't work around it.
- Deployed server code reaches ONLY the platform host and the Site Database. No third-party APIs
  (no Stripe, mail, AI, webhooks out). No raw TCP. No native modules.
- Never send a secret to the browser, log it, write it to a file (`.env`, `.dev.vars`) or commit it.

## Auth in one paragraph (details: `auth.md`)
Site-owned: `users` + PBKDF2-SHA256 (600k) passwords, a 10-minute HS256 access JWT and a rotating
opaque refresh token in `__Host-` HttpOnly Secure SameSite=Lax cookies, CSRF double-submit,
rate limits in `login_attempts`, account emails relayed by the platform. In a route:
`validator → withViewer → requireAuth → requirePermission('site:x:y') → withDb`; the user is
`c.var.viewer.id`. In a page: `pageContext()` → `viewer.state === 'user'` (gated:
`pagePermission()`). In the browser: `siteFetch()` or the portal's `api`, never a plain
`fetch` (in the editor Preview the session travels only through them: `publishing.md`). Never
write login, token, cookie, password or two-step code yourself. The admin ALREADY EXISTS: the
platform makes the owner addresses' accounts (`SITE_OWNER_EMAILS`, live and Preview) with the
`owner` role and no password; never create, seed or change it. The admin signs in at `/portal`
with a 6-digit code emailed to them, or in one click from the dashboard ("Open live portal" on the
app's page, the shield in the Preview's bar); a password and two-step sign-in are optional, set
in the portal, and other admins are made in its Users screen. Say exactly that when they ask how
to reach the admin, and put the app's admin screens inside `/portal`.

## Which kind of page (decide FIRST, every time)
| The page is… | Build it as |
| --- | --- |
| Signed-in and interactive: dashboard, CRM, admin, settings, any form-driven screen | **SPA**: a screen in `/portal` (`src/portal/screens/`) |
| Public content indexed or shared per URL: a list, search results, a detail page | **SSR**: `src/pages/<name>/*.astro` |
| Public content that rarely changes: home, about, pricing; forms that only post to the API | **Static**: `export const prerender = true` |
- NEVER build a signed-in app as one `.astro` page per screen (full reloads, flashes, repeated
  session lookups). An app is ONE catch-all page hosting React; screens are client routes.
- NEVER move a public or SEO page into the portal. Public pages stay real pages with plain
  `<a href>`, navigated CLIENT-SIDE by `<ClientRouter />` (in `Base.astro`, keep it) and made
  instant by prefetch (`data-astro-prefetch` on links to PRERENDERED pages only). A `<script>`
  on a public page runs ONCE per visit: put its work in `document.addEventListener(
  'astro:page-load', () => { … })`, return early when the page's own element is missing, and
  keep `history.state` when you `replaceState` (`performance.md`).
- Inside the portal: TanStack Router `<Link>` (never a plain `<a href>` to a portal path: it
  reloads the app), `navigate()` after a save, invalidate the query.
- Never put visitor data in a static page's HTML: it is one file served to everyone. Fill it in
  the browser (`data-user-only`, `data-guest-only`, `data-live` sections built with `textContent`).

## A dashboard looks like a dashboard
The portal (`src/pages/portal/[...path].astro` + `src/portal/`) is the reference shell: copy it.
- `App.astro` layout (full height, no site header/footer, `noindex`); left sidebar with grouped
  nav, admin items hidden by `abilities`, "Back to the website"; top bar with the screen title
  (the only `<h1>`), the user and Sign out; collapses to a drawer on small screens. After each
  navigation the shell sets the tab title from the route's `staticData.title` and moves focus
  to that `<h1>` (screen readers read the new screen); keep both.
- Overview first: stat tiles (`<Stat>`, cheap numbers only: `pageCount` "25+", never `count()`),
  then recent activity with "View all".
- Every screen: `.app-page-head` (h2, description, ONE primary action), cards, tables, and all
  three states: loading, empty (with a call to action), error.
- Never in an app: hero sections, marketing copy, the website nav/footer, a centered narrow column.

## Buttons and forms (NON-NEGOTIABLE, every page, every time)
Reference: `src/portal/ui.tsx` (`Button`, `Field`, `useForm`), `src/lib/rules.ts` (shared rules),
`src/lib/form.ts` (`bindForm` for `.astro` pages, used by `/account/*`).

**Buttons**
- Pending while its action runs: spinner + present-tense label ("Saving…"), `aria-busy="true"`,
  `disabled` (a second click never sends twice). React: `<Button pending pendingLabel="Saving…">`.
- Disabled when it cannot act, visibly (`cursor: not-allowed`). Never a button that does nothing.
- Per row: only the acted-on row shows pending; its other buttons are disabled (`busyId`).
- Done: result in place (row updated, toast, message); failure: the error next to the action,
  in words, button usable again. Never stuck pending.
- Destructive actions: `danger` variant + confirmation. `type="button"` unless it submits.
  Visible focus ring; icon-only buttons have `aria-label`.

**Fields**
- `noValidate` / `novalidate` on every form; never browser bubbles (`required`, `pattern` popups).
- Every field has a visible `<label>`; placeholders are examples, never labels.
- Errors under the field, in words that say how to fix it, with `aria-invalid` +
  `aria-describedby`; border `--danger`. Shown on blur or submit, then live while typing.
- Submit validates all, shows all errors, focuses the first wrong field, sends nothing until
  valid; the submit button is pending, Cancel disabled.
- Client rules mirror the server's validation exactly; server field errors (`422 fields`) land on
  their fields; other errors in the form's status line. Never `alert()`, never clear input on error.
- Every password field (sign-in, sign-up, reset, current password, confirmations) has a show / hide
  button, hidden by default: `.pw-input` + `<button class="pw-reveal" data-reveal-password>` with
  `bindPasswordReveal()` on `.astro` pages, `PasswordInput` in the portal. Never a bare password input.

## Machine limits: never overload the editor (NON-NEGOTIABLE)
You share the editor sandbox with the Preview dev server the owner is watching; its CPU and
memory change. Read them (`nproc`, `free -m`, `cat /sys/fs/cgroup/memory.max`) at the start and
before heavy work; stop and clean up when available memory is under ~15% or load stays above the
CPU count. ONE dev server ever (the editor's; never start `astro dev`, `vite`, `npm run preview`).
Kill what you start; no watchers (`vitest run`, not watch). One heavy command at a time
(`npm install`, `npm run build`, `prisma generate`, tests). Bound every command (no `find /`, no
grep over `node_modules`). Every dependency is a cost: never a second UI kit, date or state library.

The deployed Worker has limits too (128 MB, short CPU): bounded queries, keyset paging, no
whole-table loops, nothing big in module memory (`performance.md`).

## Recipes (details in the topic docs)
- **A Site API route**: `site-api.md` (guards in order, validator, explicit select, keyset page).
- **A portal screen** (all of it, every time): its reads as `queryOptions` /
  `infiniteQueryOptions` in `src/portal/queries.ts` (`api.<route>`; `useInfiniteQuery` for
  lists); the component in `src/portal/screens/<name>.tsx` using them; in
  `src/portal/routes.tsx` a `createRoute` with a literal path, `staticData: {title}`, a
  `loader` warming those queries (`queryClient.ensureQueryData`) and the component lazy
  (`lazyRouteComponent(() => import('./screens/<name>'), 'Name')`), plus `routeTree` and a
  `NAV_GROUPS` item; gated: an `ability` on its
  catalogue entry (`/me` and `Abilities` follow).
- **An admin-only feature**: ONE entry in `CATALOGUE` (`src/server/permissions.ts`: codename,
  title, group, `ability`, default `roles`; no migration), routes behind
  `requirePermission(PERMISSIONS.X)` (own records: `can`), nav item `ability: '<ability>'`
  (`roles-and-permissions.md`). Never gate on a role slug.
- **A server-rendered list + detail** (data in the Site Database, like `/jobs`): data route
  first; `src/pages/<name>/index.astro` reads the query string and calls `api` through
  `pageContext`; search is a GET `<form>`; detail sets `Astro.response.status = 404` +
  `<NotFound>` when the route answered 404, and 503 + a "not available" message when the read
  failed (a database outage is never a 404), as `src/pages/jobs/[slug].astro` does; HTML from
  outside the repo only via `sanitizeHtml`.
- **A blog post: add a Markdown file** `src/content/blog/<slug>.md` (the file name is the URL;
  never rename a published one). Front matter, checked at build by `src/content.config.ts`:
  `title`, `description`, `publishedAt` (required); `author`, `cover` (PREFERRED a file in
  `src/assets/blog/`, `cover: ../../assets/blog/x.jpg`, optimised at build; or `/images/…` in
  `public/`, or https; 1200×630), `coverAlt`, `tags`, `updatedAt`, `draft: true` (dev only).
  Headings from `##`. It goes live with the next Publish, with the list, the RSS feed, the
  sitemap and the home page's "latest". There is no blog/CMS API: never fetch posts. Markdown is
  trusted repo content: never paste untrusted HTML.
- **A static page**: `src/pages/<name>.astro` with `prerender = true`, `staticContext()`,
  `<Base isStatic title description>`; words in `src/content/site.ts`; add it to `NAV`. It is in
  the sitemap automatically (`seo.md`).
- **A collection of content in the repo** (team, FAQ, services): a content collection in
  `src/content.config.ts` like `blog` (`glob()` for Markdown, `file()` for one JSON/YAML file)
  with a strict schema, read with `getCollection()` in a prerendered page. Create the data file
  FIRST, then the collection: one added while the Preview runs, before its file exists, stays
  empty there until the dev server restarts. Content the OWNER edits on the live site (without a
  Publish) is not a collection: it is a table (next item).
- **A new table (model)**: `database.md` (schema with `@@map`, lengths and an `@@index` per
  query shape, `migrate dev --create-only`, BEGIN/COMMIT, `migrate dev`, then
  `npx prisma generate`), then a Site API route (`site-api.md`), then the page or portal screen
  that calls it.
- **A file upload** (photos, documents, attachments): `files.md`. Your route asks
  `createUpload()` (`src/platform/files.ts`), the browser sends the bytes with `putFile()`, your
  route confirms with `completeUpload()` and keeps the file id in your own table. Private by
  default; show files through your route (it checks access, then redirects to a short link).
- **Something later or on a timetable** (a reminder before a booking, a daily email, a
  cleanup): `background-jobs.md`. A handler in `src/server/background.ts`, `sendJob()` from the
  route (with a `key`), a schedule in `background.json`, `npm run platform -- jobs` to check.
- **An image**: the file in `src/assets/`, rendered with `Cover` (`src/components/Cover.astro`)
  or `<Picture>` from `astro:assets` in a PRERENDERED page (optimised at build). Images in SSR
  pages and the portal are served as they are: commit them resized, or use the CDN's sizing.
- **A separate app at its own path** (`/crm`) only when asked: ONE host page
  `src/pages/crm/[...path].astro` copied from the portal's, its own router with
  `basepath: '/crm'`, the portal's shell.

## Production rules
- Visitor data only in the request scope; module memory only for small public caches.
- Every platform call has a timeout and every page a fallback for `null`.
- Keep `@astrojs/cloudflare` 14.x, npm + committed `package-lock.json`, no wrangler config,
  `imageService: 'compile'` (build-time only; never a runtime transform), `session: false`,
  `security.csp` on, `public/_headers` in step with `src/platform/headers.ts`.
- Before saying a task is done: `npm run build` and `npm test` pass (integration tests too when
  `TEST_DATABASE_URL` is available: `database.md`); the Preview shows it;
  `security.md`'s checklist holds.

## Never
- Edit `src/platform/**` or `docs/agent/**` (managed), weaken a guard, `sameOrigin`, `csrf`,
  the rate limits, the cookie flags or the CSP, or write auth, token, cookie or password code.
- Put a secret in code, a file, a log, the browser or git; read `env` outside `config`; ask for
  a secret or call a third-party API from the Worker.
- Trust input: every route validates type, length and format with `hono/validator`; no
  `data: body` spreads, no ids, roles or owners from the client.
- `$queryRawUnsafe`, string-built SQL, `set:html`/`innerHTML` with data, `style=""` attributes
  or inline handlers (the CSP blocks them), `target="_blank"` without `rel="noopener noreferrer"`.
- Unbounded or un-indexed queries, offset paging, `count()` per request, a query per row,
  awaiting independent reads one after the other.
- `Cache-Control: public` on anything that read the visitor (`pageContext`, `withViewer`).
- `setTimeout`/`setInterval` for later work, or a page someone must visit to run it: send a job.
- A signed-in app as one `.astro` page per screen, a second UI kit, a second lockfile.

## How changes go live
You edit a working copy; the OWNER publishes from the editor: Prepare → Build (`npm ci`,
`npm run build`) → Migrate → Deploy (`publishing.md`). Keep `npm run dev` working at `/`.
