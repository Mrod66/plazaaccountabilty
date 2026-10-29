import {easternToUtc, HUB_TIME_ZONE} from '../../lib/hub';

/**
 * Business time: case clocks run only while the store's department is open
 * (Eastern time) and pause the rest of the time. Pure functions; tested in
 * tests/business-time.test.ts. Holidays are not modelled: a holiday counts as
 * an ordinary day of its weekday (close it by editing the hours that week).
 */

/** Open hours per weekday (0 = Sunday), in minutes after midnight. A missing day is closed. */
export type Schedule = Map<number, {open: number; close: number}>;

export type ClockSetting = {amount: number; unit: string};

const MAX_DAYS = 60;

const partsFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: HUB_TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  weekday: 'short',
});
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** The Eastern calendar date, weekday and minute of the day of an instant. */
export function localParts(instant: Date): {date: string; weekday: number; minute: number} {
  const p = Object.fromEntries(partsFormat.formatToParts(instant).map(x => [x.type, x.value]));
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    weekday: WEEKDAYS.indexOf(p.weekday!),
    minute: Number(p.hour) * 60 + Number(p.minute),
  };
}

/** The instant of minute `minute` of Eastern date `date`. */
export function instantAt(date: string, minute: number): Date {
  const m = Math.max(0, Math.min(1439, Math.round(minute)));
  const hh = String(Math.floor(m / 60)).padStart(2, '0');
  const mm = String(m % 60).padStart(2, '0');
  return easternToUtc(`${date}T${hh}:${mm}`)!;
}

const nextDate = (date: string) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

const isOpenAtAll = (schedule: Schedule) => [...schedule.values()].some(h => h.close > h.open);

/** `start` plus `minutes` of open time. A schedule with no open hours counts every minute. */
export function addBusinessMinutes(start: Date, minutes: number, schedule: Schedule): Date {
  if (!isOpenAtAll(schedule)) return new Date(start.getTime() + minutes * 60_000);
  let {date, weekday, minute} = localParts(start);
  let left = Math.max(0, minutes);
  for (let i = 0; i < MAX_DAYS; i++) {
    const hours = schedule.get(weekday);
    if (hours) {
      const from = Math.max(minute, hours.open);
      if (from < hours.close) {
        const available = hours.close - from;
        if (left <= available) return instantAt(date, from + left);
        left -= available;
      }
    }
    date = nextDate(date);
    weekday = (weekday + 1) % 7;
    minute = 0;
  }
  return new Date(start.getTime() + minutes * 60_000);
}

/**
 * `start` plus `days` business days: the same time of day, `days` open days
 * later (a start outside hours counts from the next opening). Clamped into
 * that day's hours.
 */
export function addBusinessDays(start: Date, days: number, schedule: Schedule): Date {
  if (!isOpenAtAll(schedule)) return new Date(start.getTime() + days * 86_400_000);
  let {date, weekday, minute} = localParts(start);
  // The first open moment at or after `start`.
  let anchor = -1;
  for (let i = 0; i < MAX_DAYS && anchor < 0; i++) {
    const hours = schedule.get(weekday);
    if (hours && minute < hours.close) anchor = Math.max(minute, hours.open);
    else {
      date = nextDate(date);
      weekday = (weekday + 1) % 7;
      minute = 0;
    }
  }
  let counted = 0;
  for (let i = 0; i < MAX_DAYS && counted < days; i++) {
    date = nextDate(date);
    weekday = (weekday + 1) % 7;
    if (schedule.get(weekday)) counted++;
  }
  const hours = schedule.get(weekday)!;
  return instantAt(date, Math.min(Math.max(anchor, hours.open), hours.close));
}

/** How much open time lies between `from` and `to` (minutes; 0 when `to` is not later). */
export function businessMinutesBetween(from: Date, to: Date, schedule: Schedule): number {
  if (to <= from) return 0;
  if (!isOpenAtAll(schedule)) return (to.getTime() - from.getTime()) / 60_000;
  const end = localParts(to);
  let {date, weekday, minute} = localParts(from);
  let total = 0;
  for (let i = 0; i < MAX_DAYS; i++) {
    const hours = schedule.get(weekday);
    const last = date === end.date;
    if (hours) {
      const a = Math.max(minute, hours.open);
      const b = Math.min(last ? end.minute : 1440, hours.close);
      if (b > a) total += b - a;
    }
    if (last) return total;
    date = nextDate(date);
    weekday = (weekday + 1) % 7;
    minute = 0;
  }
  return total;
}

/**
 * The end of the business day `start` falls in: that day's closing time, or
 * the next open day's when `start` is on a closed day or after closing.
 */
export function endOfBusinessDay(start: Date, schedule: Schedule): Date {
  let {date, weekday, minute} = localParts(start);
  if (!isOpenAtAll(schedule)) return instantAt(date, 1439);
  for (let i = 0; i < MAX_DAYS; i++) {
    const hours = schedule.get(weekday);
    if (hours && minute < hours.close) return instantAt(date, hours.close);
    date = nextDate(date);
    weekday = (weekday + 1) % 7;
    minute = 0;
  }
  return instantAt(date, 1439);
}

/** A clock's deadline from its setting: minutes and hours of open time, or business days. */
export function addSetting(start: Date, setting: ClockSetting, schedule: Schedule): Date {
  if (setting.unit === 'days') return addBusinessDays(start, setting.amount, schedule);
  return addBusinessMinutes(start, setting.unit === 'hours' ? setting.amount * 60 : setting.amount, schedule);
}

export type ClockState = 'on_time' | 'warning' | 'missed' | 'met';

/**
 * Green, amber or red: a running clock is amber once less than 25% of its
 * open time is left, red once its deadline passed.
 */
export function clockState(
  clock: {status: string; startedAt: Date; dueAt: Date},
  schedule: Schedule,
  now: Date
): ClockState {
  if (clock.status === 'met') return 'met';
  if (clock.status === 'missed' || now > clock.dueAt) return 'missed';
  const total = businessMinutesBetween(clock.startedAt, clock.dueAt, schedule);
  const left = businessMinutesBetween(now, clock.dueAt, schedule);
  return total > 0 && left < total * 0.25 ? 'warning' : 'on_time';
}
