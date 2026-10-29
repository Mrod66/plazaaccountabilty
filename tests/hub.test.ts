import {describe, expect, it} from 'vitest';

import {easternToUtc, formatPhone, isPhone, phoneDigits, statusStep, utcToEasternLocal} from '../src/lib/hub';
import {authSettings} from '../src/server/auth-settings';
import {type Hub, teamOf, visibleCases} from '../src/server/hub/context';
import {touchChain} from '../src/server/routes/cases';

const NONE: Hub['scopes'] = {all: false, hot: false, hotBdc: false, storeSales: false, csi: false, storeService: false, serviceBdc: false};
const hub = (scopes: Partial<Hub['scopes']> = {}, storeIds: number[] = []) => ({userId: 7, orgId: 1, storeIds, scopes: {...NONE, ...scopes}});
const own = {participants: {some: {userId: 7}}};

describe('who sees which cases (visibleCases)', () => {
  it('a rep or salesperson: only cases they created or held, in their organization', () => {
    expect(visibleCases(hub())).toEqual({orgId: 1, OR: [own]});
  });

  it('leadership sees the whole organization, never another', () => {
    expect(visibleCases(hub({all: true}))).toEqual({orgId: 1});
  });

  it('a sales manager: Hot Prospects and sales-delivery CSI of THEIR stores only', () => {
    expect(visibleCases(hub({storeSales: true}, [2, 4]))).toEqual({
      orgId: 1,
      OR: [own, {type: 'hot', storeId: {in: [2, 4]}}, {type: 'csi', department: 'sales', storeId: {in: [2, 4]}}],
    });
    // No stores: nothing beyond their own.
    expect(visibleCases(hub({storeSales: true}))).toEqual({orgId: 1, OR: [own]});
  });

  it('a service manager: service CSI of their stores; a CSI rep: every CSI case, no Hot Prospects', () => {
    expect(visibleCases(hub({storeService: true}, [3]))).toEqual({
      orgId: 1,
      OR: [own, {type: 'csi', department: 'service', storeId: {in: [3]}}],
    });
    expect(visibleCases(hub({csi: true}))).toEqual({orgId: 1, OR: [own, {type: 'csi'}]});
  });

  it('BDC: the director every Hot Prospect, a manager those BDC reps created', () => {
    expect(visibleCases(hub({hot: true}))).toEqual({orgId: 1, OR: [own, {type: 'hot'}]});
    expect(visibleCases(hub({hotBdc: true}))).toEqual({orgId: 1, OR: [own, {type: 'hot', createdTeam: 'sales_bdc'}]});
  });

  it('files a creator under their front-line team', () => {
    expect(teamOf(['sales-bdc-rep'])).toBe('sales_bdc');
    expect(teamOf(['bdc-manager', 'sales-bdc-rep'])).toBe('sales_bdc');
    expect(teamOf(['salesperson'])).toBe('sales');
    expect(teamOf(['csi-rep'])).toBe('csi');
    expect(teamOf(['sales-manager'])).toBe('manager');
  });
});

describe('phones and times', () => {
  it('stores digits only and shows (718) 555-1234', () => {
    expect(phoneDigits('(718) 555-1234')).toBe('7185551234');
    expect(phoneDigits('+1 718.555.1234')).toBe('7185551234');
    expect(formatPhone('7185551234')).toBe('(718) 555-1234');
    expect(isPhone('718-555-123')).toBe(false);
  });

  it('reads Eastern wall-clock times through daylight saving', () => {
    expect(easternToUtc('2026-07-01T09:00')?.toISOString()).toBe('2026-07-01T13:00:00.000Z');
    expect(easternToUtc('2026-12-01T09:00')?.toISOString()).toBe('2026-12-01T14:00:00.000Z');
    expect(easternToUtc('2026-12-01')).toBeNull();
    expect(utcToEasternLocal('2026-12-01T14:00:00.000Z')).toBe('2026-12-01T09:00');
  });

  it('places a status on the progress bar', () => {
    expect(statusStep('hot', 'contacted')).toBe(2);
    expect(statusStep('csi', 'fixing')).toBe(3);
  });
});

describe('touch chain', () => {
  const at = (minutes: number) => new Date(Date.UTC(2026, 9, 29, 12, minutes));
  const e = (kind: string, actorId: number, minutes: number, toUserId: number | null = null) => ({
    id: BigInt(minutes),
    kind,
    actorId,
    fromUserId: null,
    toUserId,
    fromStatus: null,
    toStatus: null,
    method: null,
    result: null,
    note: null,
    at: null,
    createdAt: at(minutes),
  });

  it('lists everyone in order, what they did and how long they held it', () => {
    const chain = touchChain(
      [e('created', 1, 0, 2), e('accepted', 2, 5), e('handed_off', 2, 20, 3), e('accepted', 3, 30), e('outcome', 3, 50)],
      3,
      true
    );
    expect(chain.map(t => [t.id, t.heldMs / 60000, t.current])).toEqual([
      [1, 0, false],
      [2, 20, false],
      [3, 30, true],
    ]);
    expect(chain[1]!.did).toEqual(['Accepted the case', 'Handed off']);
  });
});

it('sign-up is closed on the site: the admin adds people', () => {
  expect(authSettings.registration).toBe('closed');
});
