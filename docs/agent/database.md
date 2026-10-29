---
title: Site Database: Prisma Postgres, migrations, indexes
read-when: before touching Prisma, the schema, a migration, seed data or any table
---
The Site Database is Prisma Postgres, one per site (live) plus a separate Preview Database in the
editor. Prisma ORM 7 ONLY (`prisma`, `@prisma/client`, `@prisma/adapter-ppg`, `@prisma/adapter-pg`
pinned to 7.x). Generator `prisma-client`, `runtime = "workerd"`, output `src/generated/prisma`
(git-ignored; `npm run build` runs `prisma generate`); a second, test-only generator writes a Node
build to `src/generated/prisma-node` (never import it). `getDb()` returns the request's client, or
`null` without `DATABASE_URL`. The driver follows the URL's host: `*.prisma.io` (live, Preview) →
`adapter-ppg` over HTTPS; any other host (a local Postgres, tests) →
`adapter-pg` over TCP. Deployed sites only ever get Prisma Postgres (raw TCP is blocked there).

## Connections (serverless)
- ONE client per request from `getDb()` (`c.var.db` in routes): never `new PrismaClient()`,
  never a client in module scope, never one shared across requests.
- Live and Preview (`*.prisma.io`): `adapter-ppg`, Prisma Postgres's serverless driver over
  HTTPS. There is no TCP pool to size or exhaust: Prisma Postgres pools on its side, and every
  query is one HTTPS round trip, so fewer, bounded queries matter more than anything else.
- Locally and in tests (plain Postgres): `adapter-pg` with `max: 1` and a 1 s idle timeout, a
  short-lived connection per request.
- `DATABASE_URL` is the only URL: the same direct Prisma Postgres connection string serves the
  driver and the Prisma CLI (`migrate dev`, `studio` in the editor). There is no separate
  pooled/Accelerate URL and no `directUrl`; never add one or point it anywhere else. Deploy-time
  migrations are run by the platform with its own credentials.
- Atomic multi-step writes: the batch form `db.$transaction([a, b])` (as the admin routes do) or
  one conditional `updateMany`; keep transactions short, never a network call inside one.

## Tables
- MANAGED (auth core, change only through a template upgrade): `users`, `roles`, `permissions`,
  `role_permissions`, `user_roles`, `refresh_tokens`, `password_resets`, `email_verifications`,
  `login_attempts`, `audit_events`, `auth_state`, `job_deliveries` (background job replay guard). Read them through `src/platform/auth`; you may
  INSERT permission and role rows by migration (`roles-and-permissions.md`).
- Yours: `jobs`, and every table you add.

## Migrations: forward-only
1. Edit `prisma/schema.prisma`.
2. `npx prisma migrate dev --create-only --name <what_changed>` (snake_case).
3. Open the new `prisma/migrations/<ts>_<name>/migration.sql`, wrap it in `BEGIN;` … `COMMIT;`
   (unless it uses `CREATE INDEX CONCURRENTLY`, which cannot run in a transaction: then ONE
   statement per migration, no BEGIN).
4. `npx prisma migrate dev` applies it to the Preview Database.
5. `npx prisma generate`: Prisma 7's `migrate dev` no longer regenerates the client, and until
   you do, `db.<newModel>` is `undefined` in the running Preview ("Cannot read properties of
   undefined (reading 'findMany')"). The dev server reloads by itself after it. Run the app,
   then commit the schema and the migration.
- `migrate dev --create-only` first APPLIES any migration that is still pending (a second
  `--create-only` applies the first): write and check one migration at a time.
- On your own machine the Prisma CLI reads `DATABASE_URL` (and `SHADOW_DATABASE_URL`) from
  `.env` (`prisma.config.ts`); in the editor they are already in the environment.
- Never edit, rename or delete a migration that exists in git: it may already be applied live.
- Publish applies pending migrations BEFORE the new code goes live; a failure keeps the old
  version serving. A migration that drops, truncates or changes a type waits for the owner's
  approval at Publish.
- The OLD code keeps running for a while on the NEW schema (and a redeploy can roll code back):
  every migration must be safe for the previous version too.

## Expand, then contract
Renaming `title` → `name`, or making a column required, is several Publishes:
1. EXPAND: add the new column nullable (or with a default); code writes both, reads the old.
2. BACKFILL: a migration `UPDATE "t" SET "name" = "title" WHERE "name" IS NULL;` (in batches for
   big tables: `WHERE id IN (SELECT id … LIMIT 5000)` across several migrations, or a bounded
   background job).
3. SWITCH: code reads the new column.
4. CONTRACT (later, owner approves): drop the old column, then `SET NOT NULL`.
Never in one step: rename a column/table, drop a column the running code reads, add a `NOT NULL`
column without a default to a table with rows, change a column's type in place.

## Indexes
- Every query shape has an index (`performance.md`): `@@index([ownerId, id])` for
  "my rows, newest first"; `@@index([status, id])` for "open rows" (`jobs` has it); `@unique`
  where it must be unique. Every `@relation` foreign-key column is the FIRST column of some
  index (Postgres does not index FKs for you; a cascade delete would scan the child table).
- A new model, end to end: the model with `@@map("snake_table")`, `@map` columns, string
  lengths, `createdAt`/`updatedAt`, its `@@index`es → migration → `npx prisma generate` → a
  route with an explicit `select` and keyset paging → an integration test of who may and may
  not (add its table to the `TRUNCATE` in `tests/integration/support/harness.ts`).
- Equality columns first, then the range/order column. Do not index every column; each index
  costs on every write.
- On a big live table create indexes with `CONCURRENTLY` (raw migration, one statement, no
  transaction) to avoid locking writes.
- Foreign keys: on child tables of your own data (`onDelete: Cascade` only when the child
  means nothing without the parent). Append-heavy log tables: no FK, `BigInt` ids.

## Conventions
- `id Int @id @default(autoincrement())` (`BigInt` for append-heavy tables; serialize it as a string).
- snake_case in the database (`@map`, `@@map`), camelCase in code. `createdAt`, `updatedAt`.
- Owner columns are `users.id` (`ownerId Int @map("owner_id")`) from `c.var.viewer.id`.
- Strings have a length (`@db.VarChar(n)`) matching the validator; money as integer cents.
- JSON columns only for opaque snapshots, never for anything you filter, join or sort on.
- Store the minimum personal data; never copy a user's email into your own tables.

## Tests against a real database
`TEST_DATABASE_URL=postgresql://…/<throwaway db> npm test` runs `tests/integration/*` (the real
Site API, cookies, CSRF) after `npx prisma migrate deploy` on that database. The tests EMPTY its
tables: never point it at a database you care about. Without the variable they are skipped.
Add an integration test for every new route that guards data (who may, who may not).

## Seed and tools
- `prisma/seed.sql`: fake rows for the Preview Database only (example.com addresses, no users or
  passwords), idempotent (`WHERE NOT EXISTS`). `npx prisma db seed` runs it.
- `npm run studio` opens Prisma Studio on port 5555 (Preview Database). Resetting the Preview
  Database (`prisma migrate reset`) is the owner's call: ask first.
- No `DATABASE_URL` = the Site Database is not enabled: routes answer 503. Ask the owner to enable
  it in the site's Database tab; never point it anywhere else.
