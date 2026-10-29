import {useQuery} from '@tanstack/react-query';

import {formatDate} from '../../lib/hub';
import type {ScoreRow} from '../../server/hub/scorecards';
import {myScorecardQuery} from '../queries';
import {Explain, SortableTable} from '../report-ui';
import {ErrorNote} from '../shared';
import {csiRepColumns, frontLineColumns, managerColumns, type ScoreScope} from './scorecard-parts';

/**
 * My Scorecard (everyone): my own numbers, this month against last month.
 * Only my own work is counted; every number opens the cases behind it.
 */
export function MyScorecard() {
  const data = useQuery(myScorecardQuery);
  const d = data.data;
  const scopes = d
    ? {
        now: {from: d.thisMonth.from, to: d.thisMonth.to, store: ''} satisfies ScoreScope,
        last: {from: d.lastMonth.from, to: d.lastMonth.to, store: ''} satisfies ScoreScope,
      }
    : null;
  const pair = (a: ScoreRow | undefined, b: ScoreRow | undefined) =>
    a && b && scopes && d
      ? [
          {...a, label: `This month (from ${formatDate(d.thisMonth.from)})`, scope: scopes.now},
          {...b, label: `Last month (${formatDate(d.lastMonth.from)} to ${formatDate(d.lastMonth.to)})`, scope: scopes.last},
        ]
      : [];
  const front = pair(d?.thisMonth.frontLine[0], d?.lastMonth.frontLine[0]);
  const manager = pair(d?.thisMonth.managers[0], d?.lastMonth.managers[0]);
  const csi = pair(d?.thisMonth.csiReps[0], d?.lastMonth.csiReps[0]);
  const scope = scopes?.now ?? {from: '', to: '', store: ''};
  return (
    <div className="app-page">
      {data.error && <ErrorNote error={data.error} />}
      {data.isPending && <p className="muted">Counting…</p>}
      {d && (
        <>
          <section className="app-card">
            <Explain shows="Your own numbers this month next to last month. Only your own work is counted; click a number for its cases." todo="Pick one number to improve this month." />
          </section>
          {front.length > 0 && (
            <section className="app-card">
              <h2>Cases you sent</h2>
              <SortableTable rows={front} columns={frontLineColumns('Month', scope)} caption="Cases you sent" rowKey={r => r.label ?? r.name} />
            </section>
          )}
          {manager.length > 0 && (
            <section className="app-card">
              <h2>Cases you received</h2>
              <SortableTable rows={manager} columns={managerColumns('Month', scope)} caption="Cases you received" rowKey={r => r.label ?? r.name} />
            </section>
          )}
          {csi.length > 0 && (
            <section className="app-card">
              <h2>Your check-in calls</h2>
              <SortableTable rows={csi} columns={csiRepColumns('Month', scope)} caption="Your check-in calls" rowKey={r => r.label ?? r.name} />
            </section>
          )}
          {!front.length && !manager.length && !csi.length && (
            <p className="app-card muted">Your role has no scorecard yet. It fills in once you send, receive or log cases.</p>
          )}
        </>
      )}
    </div>
  );
}
