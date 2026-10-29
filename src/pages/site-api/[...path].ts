import type {APIRoute} from 'astro';
import type {ExecutionContext} from 'hono';

import {handleJobDelivery, isJobDelivery} from '../../platform/background';
import {app} from '../../server/app';
import {background} from '../../server/background';

/**
 * The ONE route that mounts the Site API: every method on `/site-api/*` goes
 * to the Hono app in `src/server/app.ts`. Rendered on request, never at build.
 * No `env` is passed: only `src/platform/config.ts` reads it. The Worker's
 * execution context is handed on, so a route can finish work
 * after answering (`c.executionCtx.waitUntil`, used for relayed emails).
 *
 * `POST /site-api/_platform/jobs` is the platform delivering a background job: it is answered BEFORE the
 * Site API (its own authentication is a signature, not a cookie), by the managed
 * `src/platform/background.ts`, with the handlers in `src/server/background.ts`.
 */
export const prerender = false;

export const ALL: APIRoute = ({request, locals}) =>
  isJobDelivery(request.url)
    ? handleJobDelivery(request, background)
    : app.fetch(request, {}, (locals as {cfContext?: ExecutionContext}).cfContext);
