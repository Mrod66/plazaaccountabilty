import {Hono} from 'hono';

import {HUB_NAME} from '../../lib/hub';
import type {Site} from '../../lib/types';
import {publicGet} from '../../platform/api';

/**
 * `GET /site-api/site` — the site's brand: name, logo, favicon, read from the
 * platform's public API (`/api/public/site/v1/initial-data`, cached 60 s per
 * isolate). Re-projected field by field.
 *
 * The NAME is always "Plaza Accountability Hub" (`HUB_NAME`), whatever the
 * site is called in the dashboard: one name on every page, tab and screen.
 */
export const siteRoutes = new Hono().get('/', async c => {
  const raw = await publicGet<Record<string, unknown>>(c.req.url, '/site/v1/initial-data', {
    ttlSeconds: 60,
  }).catch(() => null);
  const site: Site = {
    id: raw ? Number(raw.id) : 0,
    name: HUB_NAME,
    favIcon: (raw?.favIcon as string | null) ?? null,
    logo: (raw?.logo as string | null) ?? null,
  };
  return c.json({site});
});
