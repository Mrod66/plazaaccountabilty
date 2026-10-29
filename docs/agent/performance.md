---
title: Performance: fast pages, cheap queries, Workers limits
read-when: before writing a query, a list, a page, adding a dependency, an image, a font, a cache, or anything that loops
---
The site runs on ONE Cloudflare Worker: 128 MB per isolate, a short CPU budget per request
(PBKDF2 alone is ~15 ms), no shared cache, no KV/Redis, no cron. The Site Database is Prisma
Postgres over HTTPS: every query is a network round trip. Design for few, small, indexed queries.

## Queries (non-negotiable)
- **Explicit `select`** on every query: only the columns the answer needs. Never return a whole row.
- **Bounded**: every `findMany` has `take` (≤ 100). No unbounded `findMany`, no `deleteMany`
  without a narrow `where`, no loading a table to filter in JS.
- **Keyset paging**, never offset: `where: {id: {lt: before}}`, `orderBy: {id: 'desc'}`,
  `take: PAGE + 1`, answer `nextBefore`. For time order use `(createdAt, id)` both in the index.
- **No `count()` / aggregates on growing tables per request.** Show "25+" from the first page
  (`pageCount` in `src/portal/shared.tsx`), or keep a counter column updated in the same write.
- **An index for every query shape**: the `where` columns first (equality, then range), then the
  `orderBy` column. Add it in `schema.prisma` (`@@index([ownerId, id])`) in the same migration as
  the query. Check with `EXPLAIN` in Prisma Studio/psql on the Preview Database when in doubt.
- **No N+1**: fetch related rows with one `include/select` or one `where: {id: {in: ids}}`
  (bounded), never a query inside a loop.
- **Parallel when independent**: `Promise.all([a, b])`. Sequential only when one needs the other.
  In a page, a read that does not depend on the visitor runs BESIDE `pageContext()`, never after
  it (`src/pages/jobs/index.astro`):
  ```ts
  const [{site, viewer}, page] = await Promise.all([
    pageContext(Astro.request, Astro.response),
    read<JobsPage>(backend(Astro.request).jobs.$get({query: {…}})),
  ]);
  ```
- **Search**: `contains` (ILIKE) scans; fine for hundreds of rows. Before thousands, add a
  `pg_trgm` GIN index or full-text (`tsvector`) column in a migration, or search exact values only.
- Writes that must be atomic: one conditional `updateMany` (`where: {id, status: 'open'}`, check
  `count`) or `$transaction([...])`. No read-modify-write races, no `SELECT … FOR UPDATE` loops.
- Long text/JSON columns: cap sizes in the validator and the column (`@db.VarChar(n)`).

## Per request
- The visitor, their access and the DB client are memoized per request (`request-scope.ts`):
  call `getViewer`/`getAccess` freely; never cache them yourself.
- Pages call the Site API IN-PROCESS (`backend()`), never `fetch()` their own host.
- Every platform call has a timeout and a fallback (`src/platform/api.ts`); a slow section
  disappears, the page still renders.
- Background work after the answer: `c.executionCtx.waitUntil(promise)` (bounded, guarded).

## Caching
- Prerendered pages are files: served before the Worker runs, revalidated by the edge (no
  `Cache-Control` of your own needed). Hashed `/_astro/*` files are cached for a year
  (`immutable`, added by the build). Prefer prerendering anything that is the same for everyone.
- Public platform data: per-isolate memo in `publicGet(..., {ttlSeconds})` (brand 60 s). Public data only; never anything a session gates.
- Anything shared or durable: the Site Database. Visitor answers: `Cache-Control: private,
  no-store` (`withViewer`, `pageContext` set it): an SSR page that calls `pageContext` is
  private, always.
- A response that never reads the visitor (no cookies, no `pageContext`, no `withViewer`) and
  is the same for everyone may send `Cache-Control: public, max-age=…`: `/sitemap.xml` (1 h),
  `GET /site-api/jobs/sitemap` (1 h). Never on anything personal.
- Module memory: only small, bounded, public maps with a size cap (like `PUBLIC_CACHE`).

## Pages
- Pick the page kind first (AGENTS.md): static (prerendered) for marketing, SSR for crawlable
  data, the portal SPA for signed-in screens. Static is the fastest: no Worker work at all.
- JavaScript: Astro ships none by default; keep it that way on public pages. A `<script>` is a
  small module; React islands only where there is real interactivity (`client:visible` over
  `client:load`). Never ship the portal's bundle to public pages. Budget: < 50 KB JS gzipped on a
  public page, < 250 KB for the portal's FIRST load (screens load lazily on top: each one small).
- Images: in PRERENDERED pages, the file in `src/assets/` through `astro:assets` (`Cover`,
  `<Picture formats={['avif', 'webp']} widths sizes>`): resized and converted at BUILD
  (`imageService: 'compile'`). `sizes` says how wide the slot is, so phones get the small file.
  In SSR pages and the portal images are passed through (no on-demand transforms): commit them
  resized, or use the CDN URL's own sizing. Always `width` and `height` (no layout shift),
  lazy below the fold (`Cover` default, `loading="lazy"` + `decoding="async"`), the ONE hero /
  LCP image eager with `fetchpriority="high"`.
- Fonts: system stack by default. A web font: self-host `woff2` in `public/fonts`, at most 2
  weights, `font-display: swap`, `<link rel="preload">` the one used above the fold.
- CSS: one stylesheet (`src/styles/global.css`); no CSS framework added on top unless the owner asks.

## Navigation: instant everywhere, SEO kept
- **Public pages stay a multi-page site**: each is real HTML at its own URL (prerendered or
  SSR), reached by a plain `<a href>`, and navigated client-side by Astro's `<ClientRouter />`
  (`Base.astro`): the next page is swapped in without a reload, focus moves and the new title is
  announced, history and scroll work. Never move a public or SEO page into the portal; `/portal`
  has no router, so a link to it is a normal page load (as it must be).
- **Scripts with the ClientRouter**: a bundled `<script>` runs ONCE per visit, so page code runs
  in `document.addEventListener('astro:page-load', () => { … })` and returns early when the page's
  own element is missing (the event fires on every page: first load, each navigation, back and
  forward). Listeners on `document`/`window` are added once, outside it. `history.replaceState`
  keeps `history.state` (the router's). After a sign-in or sign-out, a full load
  (`location.assign`): the header must be rendered again for the new session.
- **Prefetch is opt-in** (`prefetch: {prefetchAll: false, defaultStrategy: 'hover'}`): a link
  to a PRERENDERED page carries `data-astro-prefetch` (fetched on hover or focus); the header
  nav uses `data-astro-prefetch="viewport"` (`Base.astro`, phones have no hover). Never on a
  link to an SSR page (`/jobs/*`) or `/portal`: they answer `no-store`, so the prefetch is a
  wasted Worker request. A new SSR page in `NAV` gets `prefetch: false` (`src/content/site.ts`).
- **View transitions**: the ClientRouter animates page to page; the header holds still
  (`view-transition-name: site-header`, unique per page). The cross-document `@view-transition`
  in `global.css` covers full loads (`/portal`), inside `prefers-reduced-motion: no-preference`.
- **The portal** (`src/portal/`): one SPA, never a page load between screens. `PortalApp.tsx`
  sets `defaultPreload: 'intent'` (a hovered `<Link>` loads the screen's code and data),
  `defaultPreloadStaleTime: 0` (Query owns caching), `scrollRestoration`, the pending and error
  screens, and Query's `staleTime: 30_000` (going back to a screen is instant). Every screen,
  every time: its reads as `queryOptions` in `src/portal/queries.ts` (used by the screen AND
  its route's `loader` through `queryClient.ensureQueryData` / `ensureInfiniteQueryData`), a
  LAZY component (`lazyRouteComponent(() => import('./screens/x'), 'X')`) and a
  `staticData.title`. Never import a screen statically in `routes.tsx` (it lands in the first
  bundle), never `fetch` in a `useEffect`, never `staleTime: 0` by default.
- Lighthouse targets on a public page (mobile): Performance ≥ 95, Accessibility ≥ 95, Best
  Practices ≥ 95, SEO ≥ 95 (a `noindex` page scores low on SEO by design); LCP < 2.5 s,
  CLS < 0.1, INP < 200 ms. A console error (often a CSP block) costs Best Practices.

## Never
A loop over all rows, a query per row, `count()` per request, an un-indexed `where`, offset
paging, a whole-table cache in memory, a big npm package for a small helper, blocking scripts in
`<head>`, images without dimensions, or work after the response without `waitUntil`.
