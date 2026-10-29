import type {Prisma, PrismaClient} from '../../generated/prisma/client';
import {type ClockView, clockLabel} from '../../lib/hub';
import {PERMISSIONS} from '../permissions';
import {addSetting, businessMinutesBetween, type ClockSetting, clockState, endOfBusinessDay, type Schedule} from './business-time';
import {personOf} from './people';

/**
 * Case clocks (build prompt section 7). Each case gets three: accept (one per
 * owner who must accept), contact, close; and a follow_up clock each time a
 * Hot Prospect is set to "Still working, follow-up set". Their deadlines are fixed when they
 * start, in business time of the case's store and department. A clock ends
 * `met` (done in time) or `missed` (and `doneAt` says when it was done late):
 * kept forever, for the scorecards.
 *
 * What happens after a miss (`processClocks`, from the background jobs):
 *   1. the clock turns red and the owner gets an alert (emailed in a batch);
 *   2. still not done `escalate` later (30 min Hot, 2 business hours CSI): the
 *      owner's manager gets an escalation alert, once;
 *   3. still not done `overdue` later (2 business days): the case is on the
 *      Director of Operations' Overdue panel.
 */

export const SYSTEM_ACTOR = 0;

export const DEFAULT_SETTINGS: Record<string, Record<string, ClockSetting>> = {
  hot: {
    accept: {amount: 15, unit: 'minutes'},
    contact: {amount: 1, unit: 'hours'},
    close: {amount: 2, unit: 'days'},
    escalate: {amount: 30, unit: 'minutes'},
    overdue: {amount: 2, unit: 'days'},
  },
  csi: {
    accept: {amount: 1, unit: 'hours'},
    contact: {amount: 4, unit: 'hours'},
    close: {amount: 2, unit: 'days'},
    escalate: {amount: 2, unit: 'hours'},
    overdue: {amount: 2, unit: 'days'},
  },
};

export type Rules = {settings: Record<string, ClockSetting>; schedule: Schedule};

/** Every store's hours in the organization, by `storeId:department` (one bounded query). */
export async function loadSchedules(db: PrismaClient, orgId: number): Promise<Map<string, Schedule>> {
  const rows = await db.businessHours.findMany({
    where: {store: {orgId}},
    select: {storeId: true, department: true, weekday: true, openMin: true, closeMin: true},
    take: 1000,
  });
  const out = new Map<string, Schedule>();
  for (const row of rows) {
    const key = `${row.storeId}:${row.department}`;
    if (!out.has(key)) out.set(key, new Map());
    out.get(key)!.set(row.weekday, {open: row.openMin, close: row.closeMin});
  }
  return out;
}

export const scheduleOf = (schedules: Map<string, Schedule>, storeId: number, department: string): Schedule =>
  schedules.get(`${storeId}:${department}`) ?? new Map();

export async function loadSettings(db: PrismaClient, orgId: number): Promise<Record<string, Record<string, ClockSetting>>> {
  const rows = await db.clockSetting.findMany({where: {orgId}, select: {caseType: true, kind: true, amount: true, unit: true}, take: 50});
  const out = {hot: {...DEFAULT_SETTINGS.hot!}, csi: {...DEFAULT_SETTINGS.csi!}} as Record<string, Record<string, ClockSetting>>;
  for (const row of rows) if (out[row.caseType]) out[row.caseType]![row.kind] = {amount: row.amount, unit: row.unit};
  return out;
}

/** The settings and hours a case's clocks run on. */
export async function rulesFor(db: PrismaClient, orgId: number, storeId: number, department: string, type: string): Promise<Rules> {
  const [settings, hours] = await Promise.all([
    loadSettings(db, orgId),
    db.businessHours.findMany({
      where: {storeId, department},
      select: {weekday: true, openMin: true, closeMin: true},
      take: 7,
    }),
  ]);
  return {settings: settings[type] ?? DEFAULT_SETTINGS.hot!, schedule: new Map(hours.map(h => [h.weekday, {open: h.openMin, close: h.closeMin}]))};
}

type NewClock = Omit<Prisma.CaseClockCreateManyInput, 'caseId'>;

/** A new case's three clocks. A Hot Prospect with a set callback time must be contacted by then. */
export function planClocks(rules: Rules, start: Date, ownerId: number, callbackAt: Date | null): NewClock[] {
  const clock = (kind: string, dueAt: Date): NewClock => ({kind, ownerId, startedAt: start, dueAt});
  return [
    clock('accept', addSetting(start, rules.settings.accept!, rules.schedule)),
    clock('contact', callbackAt && callbackAt > start ? callbackAt : addSetting(start, rules.settings.contact!, rules.schedule)),
    clock('close', addSetting(start, rules.settings.close!, rules.schedule)),
  ];
}

export const newClock = (rules: Rules, kind: 'accept' | 'close', start: Date, ownerId: number): NewClock => ({
  kind,
  ownerId,
  startedAt: start,
  dueAt: addSetting(start, rules.settings[kind]!, rules.schedule),
});

/**
 * "Still working, follow-up set": from the follow-up time, the owner must log a
 * contact or close the case by the end of that business day.
 */
export const followUpClock = (rules: Rules, followUpAt: Date, ownerId: number): NewClock => ({
  kind: 'follow_up',
  ownerId,
  startedAt: followUpAt,
  dueAt: endOfBusinessDay(followUpAt, rules.schedule),
});

/**
 * Stops the clocks of `kinds` because what they waited for happened `now`:
 * running and in time → met; running but late → missed (done late); already
 * missed → done (no escalation from here on). Batch-transaction operations.
 */
export function settleClocks(db: PrismaClient, caseId: number, kinds: string[], now: Date, ownerId?: number) {
  const scope = {caseId, kind: {in: kinds}, ...(ownerId ? {ownerId} : {})};
  return [
    db.caseClock.updateMany({where: {...scope, status: 'running', dueAt: {gte: now}}, data: {status: 'met', doneAt: now}}),
    db.caseClock.updateMany({where: {...scope, status: 'running', dueAt: {lt: now}}, data: {status: 'missed', missedAt: now, doneAt: now}}),
    db.caseClock.updateMany({where: {...scope, status: 'missed', doneAt: null}, data: {doneAt: now}}),
  ];
}

/** On a hand-off, the case's contact, close and follow-up clocks now wait on the new owner. */
export function moveClocks(db: PrismaClient, caseId: number, toUserId: number) {
  return [
    db.caseClock.updateMany({where: {caseId, kind: {in: ['contact', 'close', 'follow_up']}, status: 'running'}, data: {ownerId: toUserId}}),
    db.caseClock.updateMany({
      where: {caseId, kind: {in: ['contact', 'close', 'follow_up']}, status: 'missed', doneAt: null, escalatedAt: null},
      data: {ownerId: toUserId},
    }),
  ];
}

export const clockSelect = {
  id: true,
  caseId: true,
  kind: true,
  ownerId: true,
  startedAt: true,
  dueAt: true,
  status: true,
  doneAt: true,
  missedAt: true,
  escalatedAt: true,
  escalatedTo: true,
  overdueAt: true,
} as const satisfies Prisma.CaseClockSelect;
export type ClockRow = Prisma.CaseClockGetPayload<{select: typeof clockSelect}>;

export function toClockView(clock: ClockRow, schedule: Schedule, now: Date, names: Map<number, string>): ClockView {
  return {
    id: clock.id,
    kind: clock.kind,
    owner: personOf(names, clock.ownerId),
    state: clockState(clock, schedule, now),
    startedAt: clock.startedAt.toISOString(),
    dueAt: clock.dueAt.toISOString(),
    doneAt: clock.doneAt?.toISOString() ?? null,
    missedAt: clock.missedAt?.toISOString() ?? null,
    escalatedAt: clock.escalatedAt?.toISOString() ?? null,
    escalatedTo: clock.escalatedTo ? personOf(names, clock.escalatedTo) : null,
    overdue: clock.status === 'missed' && !clock.doneAt && !!clock.overdueAt && clock.overdueAt <= now,
  };
}

const URGENCY = {missed: 0, warning: 1, on_time: 2, met: 3} as const;

/** The clock to show on a list row: still waiting, most urgent first. */
export function urgentClock(views: ClockView[]): ClockView | null {
  const waiting = views.filter(v => (v.state !== 'met' && !v.doneAt));
  waiting.sort((a, b) => URGENCY[a.state] - URGENCY[b.state] || a.dueAt.localeCompare(b.dueAt));
  return waiting[0] ?? null;
}

/** Active members of the organization whose roles grant `codename` exactly (never the owner's `*`). */
export async function holdersOf(db: PrismaClient, orgId: number, codename: string): Promise<number[]> {
  const roles = await db.role.findMany({
    where: {permissions: {some: {permission: {codename}}}},
    select: {id: true},
    take: 50,
  });
  if (!roles.length) return [];
  const holders = await db.userRole.findMany({where: {roleId: {in: roles.map(r => r.id)}}, select: {userId: true}, take: 500});
  const ids = [...new Set(holders.map(h => h.userId))];
  const [staff, active] = await Promise.all([
    db.staff.findMany({where: {orgId, userId: {in: ids}}, select: {userId: true}, take: 500}),
    db.user.findMany({where: {id: {in: ids}, status: 'active'}, select: {id: true}, take: 500}),
  ]);
  const live = new Set(active.map(a => a.id));
  return staff.map(s => s.userId).filter(id => live.has(id)).sort((a, b) => a - b);
}

/**
 * Who hears when the owner has not done it: their manager (People → manager);
 * else by routing: a BDC case's BDC Director, the store's sales manager (Hot,
 * sales CSI) or service manager (service CSI); else the Director of
 * Operations. Never the owner themself; null when nobody is set up.
 */
export async function escalationTarget(
  db: PrismaClient,
  orgId: number,
  c: {storeId: number; type: string; department: string; createdTeam: string},
  ownerId: number
): Promise<number | null> {
  const staff = await db.staff.findUnique({where: {userId: ownerId}, select: {managerUserId: true}});
  if (staff?.managerUserId && staff.managerUserId !== ownerId) {
    const manager = await db.user.findFirst({where: {id: staff.managerUserId, status: 'active'}, select: {id: true}});
    if (manager) return manager.id;
  }
  if (c.type === 'hot' && c.createdTeam === 'sales_bdc') {
    const director = (await holdersOf(db, orgId, PERMISSIONS.CASE_READ_HOT)).find(id => id !== ownerId);
    if (director) return director;
  }
  const kind = c.type === 'hot' ? 'hot_sales' : c.department === 'service' ? 'csi_service' : 'csi_sales';
  const route = await db.storeRoute.findUnique({where: {storeId_kind: {storeId: c.storeId, kind}}, select: {userId: true}});
  if (route && route.userId !== ownerId) {
    const live = await db.user.findFirst({where: {id: route.userId, status: 'active'}, select: {id: true}});
    if (live) return live.id;
  }
  return (await holdersOf(db, orgId, PERMISSIONS.CASE_REASSIGN)).find(id => id !== ownerId) ?? null;
}

type CaseInfo = {id: number; orgId: number; number: string; type: string; storeId: number; department: string; createdTeam: string; status: string};

/**
 * Turns due clocks red and escalates the ones still not done. Safe to run
 * again and from several places at once: every step is a conditional update,
 * and every alert has a dedupe key. Returns the people who got a new alert
 * (their email batch can go out now). `caseId` limits it to one case.
 */
export async function processClocks(db: PrismaClient, now: Date, caseId?: number): Promise<Set<number>> {
  const alerted = new Set<number>();
  const caseSelect = {id: true, orgId: true, number: true, type: true, storeId: true, department: true, createdTeam: true, status: true} as const;
  const scope = caseId ? {caseId} : {};

  const [due, toEscalate] = await Promise.all([
    db.caseClock.findMany({
      where: {...scope, status: 'running', dueAt: {lte: now}},
      select: {id: true, kind: true, ownerId: true, dueAt: true, case: {select: caseSelect}},
      orderBy: {dueAt: 'asc'},
      take: 100,
    }),
    db.caseClock.findMany({
      where: {...scope, status: 'missed', doneAt: null, escalatedAt: null, escalateAt: {lte: now}},
      select: {id: true, kind: true, ownerId: true, case: {select: caseSelect}},
      orderBy: {escalateAt: 'asc'},
      take: 100,
    }),
  ]);

  const rulesCache = new Map<string, Promise<Rules>>();
  const rules = (c: CaseInfo) => {
    const key = `${c.orgId}:${c.storeId}:${c.department}:${c.type}`;
    if (!rulesCache.has(key)) rulesCache.set(key, rulesFor(db, c.orgId, c.storeId, c.department, c.type));
    return rulesCache.get(key)!;
  };

  for (const clock of due) {
    const c = clock.case;
    if (c.status === 'closed') {
      await db.caseClock.updateMany({where: {id: clock.id, status: 'running'}, data: {status: 'met', doneAt: now}});
      continue;
    }
    const r = await rules(c);
    const {count} = await db.caseClock.updateMany({
      where: {id: clock.id, status: 'running'},
      data: {
        status: 'missed',
        missedAt: clock.dueAt,
        escalateAt: addSetting(clock.dueAt, r.settings.escalate!, r.schedule),
        overdueAt: addSetting(clock.dueAt, r.settings.overdue!, r.schedule),
      },
    });
    if (!count) continue;
    const label = clockLabel(c.type, clock.kind);
    await db.$transaction([
      db.notification.createMany({
        data: [
          {
            orgId: c.orgId,
            userId: clock.ownerId,
            caseId: c.id,
            kind: 'clock_missed',
            message: `${label} clock missed`,
            dedupeKey: `missed:${clock.id}`,
          },
        ],
        skipDuplicates: true,
      }),
      db.caseEvent.create({
        data: {caseId: c.id, actorId: SYSTEM_ACTOR, kind: 'clock_missed', toUserId: clock.ownerId, result: clock.kind, note: `${label}: missed.`},
        select: {id: true},
      }),
    ]);
    alerted.add(clock.ownerId);
  }

  for (const clock of toEscalate) {
    const c = clock.case;
    if (c.status === 'closed') {
      await db.caseClock.updateMany({where: {id: clock.id, escalatedAt: null}, data: {escalatedAt: now}});
      continue;
    }
    const target = await escalationTarget(db, c.orgId, c, clock.ownerId);
    const {count} = await db.caseClock.updateMany({
      where: {id: clock.id, escalatedAt: null},
      data: {escalatedAt: now, escalatedTo: target},
    });
    if (!count) continue;
    const label = clockLabel(c.type, clock.kind);
    await db.$transaction([
      ...(target
        ? [
            // The manager can open the case they are alerted about.
            db.caseParticipant.createMany({data: [{caseId: c.id, userId: target}], skipDuplicates: true}),
            db.notification.createMany({
              data: [
                {
                  orgId: c.orgId,
                  userId: target,
                  caseId: c.id,
                  kind: 'escalation',
                  message: `Escalated: ${label} still not done`,
                  dedupeKey: `esc:${clock.id}`,
                  escalation: true,
                },
              ],
              skipDuplicates: true,
            }),
          ]
        : []),
      db.caseEvent.create({
        data: {
          caseId: c.id,
          actorId: SYSTEM_ACTOR,
          kind: 'escalated',
          fromUserId: clock.ownerId,
          toUserId: target,
          result: clock.kind,
          note: target ? `${label}: still not done, so their manager was alerted.` : `${label}: still not done, and no manager is set up to alert.`,
        },
        select: {id: true},
      }),
    ]);
    if (target) alerted.add(target);
  }
  return alerted;
}

/** The next moment something may need doing on this case (a clock due or an escalation), or null. */
export async function nextClockMoment(db: PrismaClient, caseId: number): Promise<Date | null> {
  const [running, missed] = await Promise.all([
    db.caseClock.findFirst({where: {caseId, status: 'running'}, select: {dueAt: true}, orderBy: {dueAt: 'asc'}}),
    db.caseClock.findFirst({
      where: {caseId, status: 'missed', doneAt: null, escalatedAt: null},
      select: {escalateAt: true},
      orderBy: {escalateAt: 'asc'},
    }),
  ]);
  const times = [running?.dueAt, missed?.escalateAt].filter((d): d is Date => !!d);
  return times.length ? new Date(Math.min(...times.map(t => t.getTime()))) : null;
}

const BACKFILL = 200;

/**
 * Fills in the business minutes of contacts logged before they were recorded
 * (cases.first_contact_min, case_events.elapsed_min), 200 of each per run, from
 * the background sweep. New contacts get them when they are logged. Index:
 * cases(first_contact_min, first_contact_at), case_events(kind, elapsed_min).
 */
export async function fillBusinessMinutes(db: PrismaClient): Promise<number> {
  const [cases, events] = await Promise.all([
    db.case.findMany({
      where: {firstContactMin: null, firstContactAt: {not: null}},
      select: {id: true, createdAt: true, firstContactAt: true, storeId: true, department: true},
      take: BACKFILL,
    }),
    db.caseEvent.findMany({
      where: {kind: 'contacted', elapsedMin: null},
      select: {id: true, caseId: true, actorId: true, createdAt: true, case: {select: {createdAt: true, storeId: true, department: true}}},
      take: BACKFILL,
    }),
  ]);
  if (!cases.length && !events.length) return 0;
  const storeIds = [...new Set([...cases.map(c => c.storeId), ...events.map(e => e.case.storeId)])];
  const [hours, clocks] = await Promise.all([
    db.businessHours.findMany({
      where: {storeId: {in: storeIds}},
      select: {storeId: true, department: true, weekday: true, openMin: true, closeMin: true},
      take: 1000,
    }),
    events.length
      ? db.caseClock.findMany({
          where: {caseId: {in: [...new Set(events.map(e => e.caseId))]}, kind: 'accept'},
          select: {caseId: true, ownerId: true, startedAt: true},
          take: 2000,
        })
      : [],
  ]);
  const schedules = new Map<string, Schedule>();
  for (const h of hours) {
    const key = `${h.storeId}:${h.department}`;
    if (!schedules.has(key)) schedules.set(key, new Map());
    schedules.get(key)!.set(h.weekday, {open: h.openMin, close: h.closeMin});
  }
  const schedule = (storeId: number, department: string) => schedules.get(`${storeId}:${department}`) ?? new Map();
  await db.$transaction([
    ...cases.map(c =>
      db.case.update({
        where: {id: c.id},
        data: {firstContactMin: Math.round(businessMinutesBetween(c.createdAt, c.firstContactAt!, schedule(c.storeId, c.department)))},
        select: {id: true},
      })
    ),
    ...events.map(e => {
      // From when the person who logged it got the case: their latest accept clock before it, else the case's opening.
      const start =
        clocks
          .filter(k => k.caseId === e.caseId && k.ownerId === e.actorId && k.startedAt <= e.createdAt)
          .map(k => k.startedAt)
          .sort((a, b) => b.getTime() - a.getTime())[0] ?? e.case.createdAt;
      return db.caseEvent.update({
        where: {id: e.id},
        data: {elapsedMin: Math.round(businessMinutesBetween(start, e.createdAt, schedule(e.case.storeId, e.case.department)))},
        select: {id: true},
      });
    }),
  ]);
  return cases.length + events.length;
}
