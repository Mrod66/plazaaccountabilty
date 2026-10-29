import {DontRetry, defineBackground, JobRejected, sendJob} from '../platform/background';
import {config} from '../platform/config';
import {getDb} from '../platform/db';
import {flushEmails} from './hub/alerts';
import {fillBusinessMinutes, nextClockMoment, processClocks} from './hub/clocks';

/**
 * This site's BACKGROUND JOBS (docs/agent/background-jobs.md), all for the
 * Accountability Hub's clocks and alert emails:
 *
 *   case-clock      {caseId}  sent when a case starts, is handed off or reopened: turns
 *                             due clocks red, escalates, sends due alert emails, then
 *                             sends ITSELF again for the case's next deadline.
 *   hub-sweep       (every 5 minutes, background.json) the safety net: every due
 *                             clock and escalation in the site, and every email batch
 *                             that was waiting for its 15-minute window.
 *   alerts-summary  (8:00 AM and 4:00 PM Eastern) the batch for people who chose
 *                             a summary instead of alerts during the day.
 *
 * Every handler may run twice: each step is a conditional update and every
 * alert has a dedupe key, so a repeat does nothing new.
 */

/** Where platform calls go from a job (there is no visitor request). */
const SITE = () => config.siteUrl ?? 'http://localhost';

/** Sends `case-clock` for a case; a refused send is fine (the 5-minute sweep catches up). */
export async function kickCase(requestUrl: string, caseId: number, at?: Date): Promise<void> {
  try {
    await sendJob(requestUrl, 'case-clock', {caseId}, at ? {at, key: `clock-${caseId}-${Math.floor(at.getTime() / 60_000)}`} : {});
  } catch (error) {
    if (!(error instanceof JobRejected)) throw error;
    console.warn(`case-clock ${caseId}: not sent (${error.code}); the 5-minute sweep will pick it up.`);
  }
}

export const background = defineBackground({
  'case-clock': async (data: {caseId?: unknown}, job) => {
    const caseId = Number(data?.caseId);
    if (!Number.isSafeInteger(caseId) || caseId <= 0) throw new DontRetry('The job has no case id.');
    const db = getDb();
    if (!db) throw new Error('The Site Database is off.');
    const now = new Date();
    const alerted = await processClocks(db, now, caseId);
    // Fresh alerts on this case (a new case, a hand-off) go out now too, within the limits.
    const waiting = await db.notification.findMany({where: {caseId, emailState: 'pending'}, select: {userId: true}, take: 50});
    const people = [...new Set([...alerted, ...waiting.map(w => w.userId)])];
    if (people.length) await flushEmails(db, now, {userIds: people});
    // Locally (the Preview) a job sent "for later" runs at once: never chain there.
    if (!job.local) {
      const next = await nextClockMoment(db, caseId);
      if (next) await kickCase(SITE(), caseId, next);
    }
  },

  'hub-sweep': async () => {
    const db = getDb();
    if (!db) throw new Error('The Site Database is off.');
    const now = new Date();
    await processClocks(db, now);
    await flushEmails(db, now);
    await fillBusinessMinutes(db);
  },

  'alerts-summary': async () => {
    const db = getDb();
    if (!db) throw new Error('The Site Database is off.');
    await flushEmails(db, new Date(), {summary: true});
  },
});
