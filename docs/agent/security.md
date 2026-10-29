---
title: Security: OWASP Top 10 on this stack
read-when: before any route, form, query, upload, HTML rendering, outbound call, secret, header or log line; and before telling the owner a feature is done
---
Defaults are secure; keep them. Each rule names the code that already does it.

## A01 Broken access control
- Every non-public route: `withViewer → requireAuth → requirePermission(codename)` (`auth.md`,
  `roles-and-permissions.md`). Hiding a button is not access control.
- Scope every row query to the caller: `where: {id, ownerId: c.var.viewer.id}`. Load-then-check
  is fine; never trust an id from the body to mean "mine". 404 (not 403) for rows that are not theirs.
- Never accept `userId`, `role`, `status`, `ownerId`, `createdBy` from the client. Build `data`
  field by field from validated input (no `data: body` spread: mass assignment).
- Redirects: same-site paths only (`safeNext`). CORS: none; the browser talks only to its own origin.

## A02 Cryptographic failures
- Passwords, tokens, signatures: only `src/platform/auth/` (PBKDF2 600k, HS256, SHA-256 at rest,
  `constantTimeEqual`). Never `Math.random()` for anything secret: `crypto.getRandomValues`.
- Store secrets of your own feature (an invite code, an API token you issue) as a SHA-256 hash
  plus a short display hint; show the raw value once.
- HTTPS only; HSTS is sent. Cookies are `__Host-`, Secure, HttpOnly.

## A03 Injection
- SQL: Prisma query API only. Raw SQL only as tagged templates `` db.$queryRaw`… ${value}` ``
  (parameterized). NEVER `$queryRawUnsafe`/`$executeRawUnsafe`, never string-built SQL, never a
  column or table name from input (map input to a fixed allow-list).
- HTML: Astro escapes `{value}`. `set:html` / `dangerouslySetInnerHTML` only with
  `sanitizeHtml()` output (`src/platform/sanitize.ts`). Browser DOM: `textContent`, never
  `innerHTML` with data.
- URLs from users: allow `https:` (and `mailto:` where it makes sense) only, parsed with `new URL`
  (see `safeApplyUrl` in `src/server/routes/jobs.ts`). Never `javascript:`, `data:`.
- Validate every input with `hono/validator`: type, trimmed length, enum, format. Reject, don't fix.

## A04 Insecure design
- Rate-limit anything that costs CPU, sends email or can be guessed (`checkRateLimit`, add a kind
  in `rate-limit.ts` via upgrade request, or a bounded per-user check of your own in a table).
- No enumeration: same answer for "exists" and "does not exist" on anything public.
- Single-use, short-lived, hashed tokens for any emailed link.

## A05 Security misconfiguration
- Headers on every response: `src/platform/headers.ts` (SSR) and `public/_headers` (static):
  nosniff, Referrer-Policy, Permissions-Policy, COOP, X-Frame-Options DENY, HSTS.
- CSP: `security.csp` in `astro.config.mjs` (hashes for Astro's own scripts). Never add
  `'unsafe-inline'` or `'unsafe-eval'`; never inline event handlers (`onclick=`) or `style=""`
  attributes in `.astro` markup (the browser blocks them: use a class; React's `style={{…}}`
  prop is fine); a new embed host goes in `frame-src`/`img-src` explicitly. `connect-src 'self'`
  stays.
- Errors: JSON `{error, message}` with words for people; never a stack, SQL or env value.

## A06 Vulnerable components
- Add a dependency only when needed; pin it (exact or caret), commit `package-lock.json`. No
  packages with native modules (they cannot run on Workers). Prefer WebCrypto over crypto libs.

## A07 Identification and authentication failures
- Only the built-in auth (`auth.md`). Generic login errors, backoff, session rotation, reuse
  detection, `session_version` revocation, re-auth (current password) for password change.
- For a dangerous action of your own (delete account, change email, transfer ownership):
  require the current password in the request and `requireVerified`.

## A08 Software and data integrity failures
- Never `eval`, `new Function`, or load scripts from a CDN at runtime. Webhooks (if any) verify
  an HMAC signature with a constant-time compare before parsing, in their own Hono app.
- Migrations are reviewed SQL in `prisma/migrations/`; nothing alters the schema at runtime.

## A09 Logging and monitoring failures
- `audit()` for security events (role changes, deletes, exports): who (user id), what, on what,
  keyed IP hash. NEVER log or audit: passwords, tokens, cookies, `Authorization`, emails, full
  request bodies, raw IPs, `env` values. `console.error` the message only, never the error object.

## A10 SSRF
- Deployed server code reaches only the platform host (`{{SITE_URL_ENV}}`) and the Site Database;
  everything else is blocked. Never fetch a URL the user supplied, never proxy one. Platform calls
  go through `src/platform/api.ts` (timeout, fixed origin).

## Also
- **CSRF**: `sameOrigin` + double-submit `csrf` on the whole Site API. Keep both. Browser writes
  go through `siteFetch` / the portal `api` client. A cross-site endpoint (webhook) is a separate
  Hono app mounted before them, with its own signature check.
- **Uploads**: the Worker takes no file bodies (64 KB body limit). There is no upload storage for
  sites yet: ask the owner before designing one; never accept base64 files into the database.
- **Secrets**: only `DATABASE_URL`, `JWT_SECRET`, `{{SITE_KEY_ENV}}` exist, set by the platform,
  read only in `src/platform/config.ts`. Never send one to the browser, a log, a file, git. You
  cannot add secrets; say what the feature needs instead.
- **PII**: store the minimum. Only the user and `site:user:read` holders see an email. Exports of
  personal data need a codename and an audit event.
- **Client code**: everything in a page or the portal is public. No secrets, no hidden admin
  routes, no "security by obscurity" flags.

## Before you say "done"
Guards in order on every new route · inputs validated with limits · rows scoped to the user ·
no raw SQL from strings · no `set:html` without `sanitizeHtml` · writes via `siteFetch`/`api` ·
no secrets or PII in logs · bounded queries (`performance.md`) · the form rules (AGENTS.md).
