import {describe, expect, it} from 'vitest';

import {
  addBusinessDays,
  addBusinessMinutes,
  addSetting,
  businessMinutesBetween,
  endOfBusinessDay,
  clockState,
  type Schedule,
} from '../src/server/hub/business-time';

// Sales hours: Mon–Fri 9–21, Sat 9–19, Sun 11–17. Service: Mon–Fri 7:30–18, Sat 8–16, Sun closed.
const sales: Schedule = new Map([
  [0, {open: 660, close: 1020}],
  ...[1, 2, 3, 4, 5].map(d => [d, {open: 540, close: 1260}] as const),
  [6, {open: 540, close: 1140}],
]);
const service: Schedule = new Map([...[1, 2, 3, 4, 5].map(d => [d, {open: 450, close: 1080}] as const), [6, {open: 480, close: 960}]]);

// Eastern wall-clock → instant. October 2026 is daylight time (UTC-4).
const et = (local: string) => new Date(`${local}:00-04:00`);
const etWinter = (local: string) => new Date(`${local}:00-05:00`);

describe('business time', () => {
  it('adds minutes inside the day', () => {
    // Thu Oct 29 2026, 10:00 + 15 min.
    expect(addBusinessMinutes(et('2026-10-29T10:00'), 15, sales)).toEqual(et('2026-10-29T10:15'));
  });

  it('pauses overnight: 8:50 PM + 15 min = 9:05 AM the next day', () => {
    expect(addBusinessMinutes(et('2026-10-29T20:50'), 15, sales)).toEqual(et('2026-10-30T09:05'));
  });

  it('waits for opening: created at 6 AM, due 15 minutes after 9 AM', () => {
    expect(addBusinessMinutes(et('2026-10-29T06:00'), 15, sales)).toEqual(et('2026-10-29T09:15'));
  });

  it('skips a closed Sunday for service: Sat 3:30 PM + 1 business hour = Mon 8:00 AM', () => {
    // Sat Oct 31, 30 min left that day, then Monday Nov 2 (after DST ends: UTC-5) from 7:30.
    expect(addBusinessMinutes(et('2026-10-31T15:30'), 60, service)).toEqual(etWinter('2026-11-02T08:00'));
  });

  it('counts business days at the same time of day', () => {
    // Thu 10:00 + 2 business days = Sat 10:00 (sales is open Saturday).
    expect(addBusinessDays(et('2026-10-29T10:00'), 2, sales)).toEqual(et('2026-10-31T10:00'));
    // Service, Fri 10:00 + 2 = Mon 10:00 (Saturday counts, Sunday is closed).
    expect(addBusinessDays(et('2026-10-30T10:00'), 2, service)).toEqual(etWinter('2026-11-02T10:00'));
    // After closing, it counts from the next opening.
    expect(addBusinessDays(et('2026-10-29T22:00'), 1, sales)).toEqual(et('2026-10-31T09:00'));
  });

  it('the end of a business day: that day’s closing, or the next open day’s', () => {
    expect(endOfBusinessDay(et('2026-10-29T14:00'), sales)).toEqual(et('2026-10-29T21:00'));
    // After closing, or on a closed Sunday (service): the next open day's closing.
    expect(endOfBusinessDay(et('2026-10-29T22:00'), sales)).toEqual(et('2026-10-30T21:00'));
    expect(endOfBusinessDay(etWinter('2026-11-01T10:00'), service)).toEqual(etWinter('2026-11-02T18:00'));
  });

  it('measures open time between two instants', () => {
    expect(businessMinutesBetween(et('2026-10-29T20:00'), et('2026-10-30T10:00'), sales)).toBe(120);
    expect(businessMinutesBetween(et('2026-10-30T10:00'), et('2026-10-29T10:00'), sales)).toBe(0);
  });

  it('with no hours set, every minute counts', () => {
    expect(addSetting(et('2026-10-29T23:00'), {amount: 15, unit: 'minutes'}, new Map())).toEqual(et('2026-10-29T23:15'));
  });

  it('green, amber under 25% left, red after the deadline', () => {
    const clock = {status: 'running', startedAt: et('2026-10-29T10:00'), dueAt: et('2026-10-29T10:20')};
    expect(clockState(clock, sales, et('2026-10-29T10:10'))).toBe('on_time');
    expect(clockState(clock, sales, et('2026-10-29T10:16'))).toBe('warning');
    expect(clockState(clock, sales, et('2026-10-29T10:21'))).toBe('missed');
    expect(clockState({...clock, status: 'met'}, sales, et('2026-10-29T11:00'))).toBe('met');
  });
});
