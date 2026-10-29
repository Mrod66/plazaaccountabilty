import type {PrismaClient} from '../../generated/prisma/client';
import {HUB_NAME, labels} from '../../lib/hub';
import {SiteKeyMissing, siteKeyPost} from '../../platform/api';
import {config} from '../../platform/config';
import {SYSTEM_ACTOR} from './clocks';
import {labelIn, loadLists} from './lists';

/**
 * Alerts and their emails (build prompt section 8).
 *
 * The in-app alert (`notifications`) is the record of what waits on someone;
 * email is only a nudge, sent in BATCHES ("You have 3 new or overdue cases"):
 *   - at most one regular batch per person every 15 minutes, and at most
 *     PER_HOUR emails per person an hour (the platform allows 5 a recipient
 *     an hour, and sign-in codes count too, so the hub keeps one spare);
 *   - escalations travel in their own batch, are never dropped: when a limit
 *     holds them back they wait for the next window;
 *   - people on "summary" get regular alerts only at 8:00 AM and 4:00 PM;
 *   - an alert read in the app before its batch goes is not emailed;
 *   - the whole site stays under SITE_PER_HOUR (the platform's cap is 120);
 *   - when the platform refuses with its limit (429), the case history says
 *     "Email not sent (limit reached)" once, and the alert stays in the app.
 * Never a customer's phone number in an email: case number, store, reason,
 * first name and last initial, and a link.
 */
export const PER_HOUR = 4;
export const SPACING_MINUTES = 15;
export const SITE_PER_HOUR = 100;
const MAX_ITEMS_LISTED = 10;

export type NewAlert = {orgId: number; userId: number; caseId: number; kind: string; message: string; dedupeKey?: string; escalation?: boolean};

/** Adds alerts (an alert with a dedupe key that exists already is skipped). */
export function notify(db: PrismaClient, alerts: NewAlert[]) {
  return db.notification.createMany({data: alerts, skipDuplicates: true});
}

/**
 * Who may be emailed from here: everyone on the live site; ONLY the site's
 * owner addresses in the editor Preview, so test cases never email real staff.
 */
function mayEmail(address: string): boolean {
  if (!config.preview) return true;
  return config.ownerEmails.map(e => e.toLowerCase()).includes(address.toLowerCase());
}

const shortName = (name: string) => {
  const [first, ...rest] = name.trim().split(/\s+/);
  const last = rest.at(-1);
  return last ? `${first} ${last[0]!.toUpperCase()}.` : (first ?? '');
};

type Item = {id: bigint; caseId: number; message: string; escalation: boolean};

export type FlushResult = {sent: number; deferred: number; capped: number; skipped: number};

/**
 * Sends whatever alert emails are due now. `userIds`: only these people;
 * `summary`: the 8:00 / 4:00 run (summary people get their batch). Safe to run
 * anywhere and often: nothing is sent twice (an alert is marked when its batch
 * goes) and the limits are counted from `email_log`.
 */
export async function flushEmails(
  db: PrismaClient,
  now: Date,
  options: {userIds?: number[]; summary?: boolean} = {}
): Promise<FlushResult> {
  const result: FlushResult = {sent: 0, deferred: 0, capped: 0, skipped: 0};
  const pending = await db.notification.findMany({
    where: {emailState: 'pending', ...(options.userIds ? {userId: {in: options.userIds}} : {})},
    select: {id: true, orgId: true, userId: true, caseId: true, message: true, escalation: true, readAt: true, cappedAt: true},
    orderBy: {id: 'asc'},
    take: 500,
  });
  if (!pending.length) return result;

  // Already read in the app: no email needed.
  const read = pending.filter(p => p.readAt);
  if (read.length) await db.notification.updateMany({where: {id: {in: read.map(r => r.id)}}, data: {emailState: 'none'}});
  const open = pending.filter(p => !p.readAt);
  const byUser = new Map<number, typeof open>();
  for (const p of open) byUser.set(p.userId, [...(byUser.get(p.userId) ?? []), p]);
  const userIds = [...byUser.keys()].slice(0, 60);
  if (!userIds.length) return result;

  const hourAgo = new Date(now.getTime() - 3_600_000);
  const [users, staff, recent, siteRecent] = await Promise.all([
    db.user.findMany({where: {id: {in: userIds}}, select: {id: true, name: true, email: true, status: true}, take: userIds.length}),
    db.staff.findMany({where: {userId: {in: userIds}}, select: {userId: true, alertMode: true}, take: userIds.length}),
    db.emailLog.findMany({
      where: {userId: {in: userIds}, status: 'sent', createdAt: {gte: hourAgo}},
      select: {userId: true, createdAt: true},
      take: userIds.length * (PER_HOUR + 1),
    }),
    db.emailLog.findMany({where: {status: 'sent', createdAt: {gte: hourAgo}}, select: {id: true}, take: SITE_PER_HOUR + 1}),
  ]);
  let siteLeft = SITE_PER_HOUR - siteRecent.length;
  const userOf = new Map(users.map(u => [u.id, u]));
  const modeOf = new Map(staff.map(s => [s.userId, s.alertMode]));

  // The cases the batches mention, in one query.
  const caseIds = [...new Set(open.map(p => p.caseId))].slice(0, 500);
  const cases = await db.case.findMany({
    where: {id: {in: caseIds}},
    select: {id: true, orgId: true, number: true, type: true, reason: true, sentiment: true, department: true, customerName: true, storeId: true},
    take: caseIds.length,
  });
  const stores = await db.store.findMany({where: {id: {in: [...new Set(cases.map(c => c.storeId))]}}, select: {id: true, name: true}, take: 50});
  const storeName = new Map(stores.map(s => [s.id, s.name]));
  const caseOf = new Map(cases.map(c => [c.id, c]));
  // Each organization's own pick lists, for the reason labels.
  const orgIds = [...new Set(open.map(p => p.orgId))].slice(0, 20);
  const listsOf = new Map(await Promise.all(orgIds.map(async id => [id, await loadLists(db, id)] as const)));
  const line = (item: Item) => {
    const c = caseOf.get(item.caseId);
    if (!c) return `- ${item.message}`;
    const lists = listsOf.get(c.orgId);
    const why = c.type === 'hot' ? (lists ? labelIn(lists, 'reason', c.reason) : labels.reason(c.reason)) : `CSI, ${labels.department('csi', c.department).toLowerCase()}`;
    return `- ${c.number} · ${storeName.get(c.storeId) ?? ''} · ${why} · ${shortName(c.customerName)}: ${item.message}`;
  };

  const send = async (userId: number, items: Item[], escalation: boolean): Promise<'sent' | 'capped' | 'failed' | 'skipped'> => {
    const user = userOf.get(userId);
    if (!user || user.status !== 'active' || !mayEmail(user.email)) {
      await db.notification.updateMany({where: {id: {in: items.map(i => i.id)}}, data: {emailState: 'none'}});
      return 'skipped';
    }
    const cases = new Set(items.map(i => i.caseId)).size;
    const noun = cases === 1 ? 'case' : 'cases';
    const subject = escalation
      ? `${HUB_NAME}: ${cases} ${noun} escalated to you`
      : `${HUB_NAME}: you have ${cases} new or overdue ${noun}`;
    const shown = items.slice(0, MAX_ITEMS_LISTED).map(line);
    const more = items.length - shown.length;
    const text = [
      `Hi ${user.name.split(/\s+/)[0]},`,
      '',
      escalation
        ? `These cases are past their clock and still not done. You are hearing about them as the manager:`
        : `These are waiting on you in the ${HUB_NAME}:`,
      '',
      ...shown,
      ...(more > 0 ? [`- and ${more} more`] : []),
      '',
      `Open the ${HUB_NAME} to see them all and act on them.`,
    ].join('\n');
    let status = 0;
    try {
      status = await siteKeyPost(config.siteUrl ?? 'http://localhost', '/emails', {
        kind: 'notification',
        to: user.email,
        path: '/portal/alerts',
        subject,
        text,
      });
    } catch (error) {
      if (!(error instanceof SiteKeyMissing)) throw error;
    }
    if (status >= 200 && status < 300) {
      await db.$transaction([
        db.notification.updateMany({where: {id: {in: items.map(i => i.id)}}, data: {emailState: 'sent', emailedAt: now}}),
        db.emailLog.create({data: {userId, status: 'sent', items: items.length}, select: {id: true}}),
      ]);
      return 'sent';
    }
    if (status === 429) {
      // A sending limit: note it once per alert in its case's history; the alert stays in the app.
      const first = items.filter(i => !(pending.find(p => p.id === i.id)?.cappedAt));
      await db.$transaction([
        db.emailLog.create({data: {userId, status: 'capped', items: items.length}, select: {id: true}}),
        // Escalations are never dropped: they stay pending and go in a later window.
        db.notification.updateMany({where: {id: {in: items.map(i => i.id)}}, data: {cappedAt: now, ...(escalation ? {} : {emailState: 'capped'})}}),
        ...(first.length
          ? [
              db.caseEvent.createMany({
                data: [...new Set(first.map(i => i.caseId))].map(caseId => ({
                  caseId,
                  actorId: SYSTEM_ACTOR,
                  kind: 'email_capped',
                  toUserId: userId,
                  note: `Email to ${user.name} not sent (limit reached). The alert is still in the app.`,
                })),
              }),
            ]
          : []),
      ]);
      return 'capped';
    }
    // No answer or an error: left pending, tried again on the next run.
    await db.emailLog.create({data: {userId, status: 'failed', items: items.length}, select: {id: true}});
    return 'failed';
  };

  for (const userId of userIds) {
    const items = byUser.get(userId)!;
    const sentTimes = recent.filter(r => r.userId === userId).map(r => r.createdAt.getTime());
    let left = PER_HOUR - sentTimes.length;
    // Emailed in the last 15 minutes: regular alerts wait for the next batch.
    let spaced = !sentTimes.length || now.getTime() - Math.max(...sentTimes) >= SPACING_MINUTES * 60_000;
    const summaryPerson = modeOf.get(userId) === 'summary';
    const batches: [Item[], boolean][] = [
      [items.filter(i => i.escalation), true],
      [items.filter(i => !i.escalation), false],
    ];
    for (const [batch, isEscalation] of batches) {
      if (!batch.length) continue;
      const held =
        left <= 0 ||
        siteLeft <= 0 ||
        // Regular alerts only: summary people wait for the 8:00 / 4:00 run; everyone else 15 minutes between emails.
        (!isEscalation && (summaryPerson ? !options.summary : !spaced));
      if (held) {
        result.deferred += batch.length;
        continue;
      }
      const outcome = await send(userId, batch, isEscalation);
      if (outcome === 'sent') {
        result.sent++;
        left--;
        siteLeft--;
        spaced = false;
      } else if (outcome === 'capped') result.capped++;
      else if (outcome === 'skipped') result.skipped++;
      else result.deferred += batch.length;
    }
  }
  return result;
}
