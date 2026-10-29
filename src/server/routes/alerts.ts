import {Hono} from 'hono';
import {validator} from 'hono/validator';

import type {AlertRow} from '../../lib/hub';
import {problem, requireAuth, withDb, withViewer} from '../../platform/guards';
import {withHub} from '../hub/context';
import {asBody, Fields, idOf, invalidInput} from '../hub/input';

/**
 * My alerts (`/site-api/alerts`): the bell and the Alerts screen. Only ever
 * the signed-in person's own alerts.
 *
 *   GET  /count          unread alerts (the bell; "99+" past 99)
 *   GET  /?before=       my alerts, newest first, with what happened to their email
 *   POST /read           {caseId} or {all: true}: mark read
 *   GET  /prefs, PUT /prefs   {alertMode: 'batched' | 'summary'}
 */
const PAGE = 30;

export const alertRoutes = new Hono()
  .get('/count', withViewer, requireAuth, withDb, withHub, async c => {
    const {db, hub} = c.var;
    // Index: notifications(user_id, read_at). Counted up to 100, shown as "99+".
    const rows = await db.notification.findMany({where: {userId: hub.userId, readAt: null}, select: {id: true}, take: 100});
    return c.json({unread: rows.length});
  })

  .get(
    '/',
    validator('query', v => ({before: typeof v.before === 'string' ? v.before : ''})),
    withViewer,
    requireAuth,
    withDb,
    withHub,
    async c => {
      const {db, hub} = c.var;
      const before = c.req.valid('query').before;
      const cursor = /^\d{1,18}$/.test(before) ? BigInt(before) : undefined;
      const rows = await db.notification.findMany({
        where: {userId: hub.userId, ...(cursor ? {id: {lt: cursor}} : {})},
        select: {
          id: true,
          caseId: true,
          kind: true,
          message: true,
          escalation: true,
          readAt: true,
          emailState: true,
          emailedAt: true,
          cappedAt: true,
          createdAt: true,
        },
        orderBy: {id: 'desc'},
        take: PAGE + 1,
      });
      const page = rows.slice(0, PAGE);
      const cases = await db.case.findMany({
        where: {id: {in: [...new Set(page.map(r => r.caseId))]}},
        select: {id: true, number: true, status: true, customerName: true},
        take: PAGE,
      });
      const caseOf = new Map(cases.map(x => [x.id, x]));
      const items: AlertRow[] = page.map(r => ({
        id: r.id.toString(),
        caseId: r.caseId,
        caseNumber: caseOf.get(r.caseId)?.number ?? '',
        customerName: caseOf.get(r.caseId)?.customerName ?? '',
        caseClosed: caseOf.get(r.caseId)?.status === 'closed',
        kind: r.kind,
        message: r.message,
        escalation: r.escalation,
        read: r.readAt !== null,
        emailState: r.emailState,
        emailedAt: r.emailedAt?.toISOString() ?? null,
        capped: r.cappedAt !== null,
        createdAt: r.createdAt.toISOString(),
      }));
      return c.json({items, nextBefore: rows.length > PAGE ? page.at(-1)!.id.toString() : null});
    }
  )

  .post('/read', validator('json', v => asBody(v)), withViewer, requireAuth, withDb, withHub, async c => {
    const {db, hub} = c.var;
    const body = c.req.valid('json');
    const caseId = idOf(body.caseId);
    if (!caseId && body.all !== true) return c.json(problem('invalid_input', 'Say which alerts to mark read.'), 422);
    // Index: notifications(user_id, read_at); a narrow `where` (mine, unread).
    await db.notification.updateMany({
      where: {userId: hub.userId, readAt: null, ...(caseId ? {caseId} : {})},
      data: {readAt: new Date()},
    });
    return c.json({ok: true});
  })

  .get('/prefs', withViewer, requireAuth, withDb, withHub, async c => {
    const {db, hub} = c.var;
    const staff = await db.staff.findUnique({where: {userId: hub.userId}, select: {alertMode: true}});
    return c.json({alertMode: staff?.alertMode ?? 'batched'});
  })

  .put('/prefs', validator('json', v => asBody(v)), withViewer, requireAuth, withDb, withHub, async c => {
    const {db, hub} = c.var;
    const f = new Fields(c.req.valid('json'));
    const alertMode = f.pick('alertMode', ['batched', 'summary'] as const, 'Pick how you want your alert emails.');
    if (!f.ok || !alertMode) return c.json(invalidInput(f.errors), 422);
    await db.staff.update({where: {userId: hub.userId}, data: {alertMode}, select: {userId: true}});
    return c.json({alertMode});
  });
