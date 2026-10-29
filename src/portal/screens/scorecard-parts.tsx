import {Link} from '@tanstack/react-router';

import {formatDuration} from '../../lib/hub';
import type {ScoreGroup, ScoreRow} from '../../server/hub/scorecards';
import {type Column, percent, rateValue} from '../report-ui';

/**
 * The scorecard columns (build prompt section 11), shared by People
 * Scorecards and My Scorecard. Plain process words; every rate with its count;
 * every count a link to the cases behind it (only the cases the viewer may see).
 */

/** Where a scorecard number's cases live: the same dates and store, the person and the metric. */
export type ScoreScope = {from: string; to: string; store: string};

export type ScoreSearch = ScoreScope & {group: ScoreGroup; metric: string; person: string};

type Row = ScoreRow & {label?: string; scope?: ScoreScope};

function ScoreCount({row, group, metric, scope, noun}: {row: Row; group: ScoreGroup; metric: string; scope: ScoreScope; noun?: string}) {
  const n = row.counts[metric] ?? 0;
  const text = noun ? `${n.toLocaleString('en-US')} ${noun}${n === 1 ? '' : 's'}` : n.toLocaleString('en-US');
  return (
    <Link
      className="num-link"
      to="/scorecards/cases"
      search={{...(row.scope ?? scope), group, metric, person: String(row.id)} satisfies ScoreSearch}
      title="See these cases">
      {text}
    </Link>
  );
}

function ScoreRate({row, group, n, of, scope, noun = 'case'}: {row: Row; group: ScoreGroup; n: string; of: string; scope: ScoreScope; noun?: string}) {
  return (
    <span className="rate">
      <strong>{percent(row.counts[n] ?? 0, row.counts[of] ?? 0)}</strong>{' '}
      <span className="out-of">
        (<ScoreCount row={row} group={group} metric={n} scope={scope} /> of <ScoreCount row={row} group={group} metric={of} scope={scope} noun={noun} />)
      </span>
    </span>
  );
}

const nameColumn = (first: string): Column<Row> => ({key: 'name', label: first, value: r => r.label ?? r.name, render: r => r.label ?? r.name});
const count = (group: ScoreGroup, metric: string, label: string, scope: ScoreScope): Column<Row> => ({
  key: metric,
  label,
  value: r => r.counts[metric] ?? 0,
  render: r => <ScoreCount row={r} group={group} metric={metric} scope={scope} />,
  numeric: true,
});
const rate = (group: ScoreGroup, n: string, of: string, label: string, scope: ScoreScope, noun?: string): Column<Row> => ({
  key: n,
  label,
  value: r => rateValue(r.counts[n] ?? 0, r.counts[of] ?? 0),
  render: r => <ScoreRate row={r} group={group} n={n} of={of} scope={scope} noun={noun} />,
  numeric: true,
});

export const frontLineColumns = (first: string, scope: ScoreScope): Column<Row>[] => [
  nameColumn(first),
  count('frontLine', 'sent', 'Cases sent', scope),
  rate('frontLine', 'appointment', 'hotSent', 'Ended in appointment', scope, 'Hot Prospect'),
  rate('frontLine', 'sold', 'hotSent', 'Sold', scope, 'Hot Prospect'),
  rate('frontLine', 'lost', 'hotSent', 'Lost', scope, 'Hot Prospect'),
];

export const managerColumns = (first: string, scope: ScoreScope): Column<Row>[] => [
  nameColumn(first),
  count('managers', 'received', 'Cases received', scope),
  rate('managers', 'acceptedOnTime', 'received', 'Accepted on time', scope),
  rate('managers', 'contactedOnTime', 'contactClocks', 'Contacted on time', scope),
  rate('managers', 'reached', 'received', 'Reached the customer', scope),
  rate('managers', 'attemptedOnly', 'received', 'Attempted only', scope),
  {
    key: 'median',
    label: 'Median time to contact (business hours)',
    value: r => r.medianMinutes ?? Infinity,
    render: r => (r.medianMinutes === null ? '—' : formatDuration(r.medianMinutes * 60000)),
    numeric: true,
  },
  rate('managers', 'appointment', 'hotClosed', 'Appointment rate', scope, 'closed case'),
  rate('managers', 'sold', 'hotClosed', 'Sold rate', scope, 'closed case'),
  rate('managers', 'recovered', 'csiClosed', 'Recovered (CSI)', scope, 'closed case'),
  count('managers', 'handoffs', 'Handed off', scope),
];

export const csiRepColumns = (first: string, scope: ScoreScope): Column<Row>[] => [
  nameColumn(first),
  count('csiReps', 'calls', 'Calls logged', scope),
  rate('csiReps', 'reached', 'calls', 'Reached', scope, 'call'),
  rate('csiReps', 'unhappy', 'reached', 'Unhappy found', scope, 'reached call'),
  count('csiReps', 'opened', 'Cases opened', scope),
];
