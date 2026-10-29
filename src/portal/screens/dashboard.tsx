import {useQuery} from '@tanstack/react-query';
import {useNavigate, useSearch} from '@tanstack/react-router';

import {formatDuration, labels, type ReportRow} from '../../lib/hub';
import {CaseTable, useHub, useLabels, useStores} from '../hub';
import {dashboardQuery} from '../queries';
import {
  type Column,
  Count,
  type Drill,
  Explain,
  Rate,
  rateValue,
  rangeOf,
  type ReportSearch,
  ReportFilters,
  SortableTable,
  Tile,
  TrendChart,
} from '../report-ui';
import {ErrorNote} from '../shared';

/**
 * The Leadership Dashboard (build prompt section 10): Owner, Director of
 * Operations, BDC Director, Admin. Every number is a link to the cases behind
 * it (same filter, same visibility), and every percentage shows its count.
 */
export function Dashboard() {
  const search = useSearch({from: '/dashboard'}) as ReportSearch;
  const navigate = useNavigate({from: '/dashboard'});
  const hub = useHub();
  const stores = useStores();
  const {from, to} = rangeOf(search);
  const params = {from, to, store: search.store ?? '', department: search.department ?? '', type: search.type ?? ''};
  const data = useQuery(dashboardQuery(params));
  const storeName = (id: unknown) => stores.get(Number(id))?.name ?? 'Unknown store';

  return (
    <div className="app-page">
      <ReportFilters
        search={search}
        stores={hub.data?.stores ?? []}
        pending={data.isFetching}
        onChange={next => void navigate({search: next as never, replace: true})}
      />
      {data.error && <ErrorNote error={data.error} />}
      {data.isPending && <p className="muted">Counting…</p>}
      {data.data && (
        <>
          {data.data.hot && <HotPanel panel={data.data.hot} search={search} storeName={storeName} />}
          {data.data.csi && <CsiPanel panel={data.data.csi} search={search} storeName={storeName} />}
          {!data.data.hot && !data.data.csi && <p className="app-card muted">No case type matches these filters.</p>}
          <section className={`app-card${data.data.overdue.length ? ' attention' : ''}`}>
            <h2>Overdue now: every red case</h2>
            <Explain
              shows="Every open case across the group with a missed clock that is still not done, the oldest deadline first."
              todo="Call the owner, or hand the case to someone who can act today."
            />
            {data.data.overdue.length ? (
              <CaseTable cases={data.data.overdue} stores={stores} show="both" caption="Red cases" />
            ) : (
              <p className="muted">Nothing is red right now.</p>
            )}
          </section>
        </>
      )}
    </div>
  );
}

type PanelProps = {panel: {totals: ReportRow; tables: Record<string, ReportRow[]>}; search: ReportSearch; storeName: (id: unknown) => string};

const keyOf = (row: ReportRow) => String(row.key);

function HotPanel({panel, search, storeName}: PanelProps) {
  const names = useLabels();
  const t = panel.totals.counts;
  const d = (measure: string, dim?: string, key?: ReportRow['key']): Drill => ({type: 'hot', measure, dim, key});
  const lostTotal = t.lost ?? 0;
  const count = (row: ReportRow, measure: string, dim: string) => <Count n={row.counts[measure] ?? 0} drill={d(measure, dim, row.key)} search={search} />;
  const rate = (row: ReportRow, n: string, of: string, dim: string) => (
    <Rate n={row.counts[n] ?? 0} of={row.counts[of] ?? 0} drill={d(n, dim, row.key)} ofDrill={d(of, dim, row.key)} search={search} />
  );
  const num = (m: string) => (row: ReportRow) => row.counts[m] ?? 0;
  const rv = (n: string, of: string) => (row: ReportRow) => rateValue(row.counts[n] ?? 0, row.counts[of] ?? 0);

  const storeColumns: Column<ReportRow>[] = [
    {key: 'store', label: 'Store', value: r => storeName(r.key), render: r => storeName(r.key)},
    {key: 'opened', label: 'Opened', value: num('opened'), render: r => count(r, 'opened', 'store'), numeric: true},
    {key: 'acc', label: 'Accepted on time', value: rv('accepted_on_time', 'opened'), render: r => rate(r, 'accepted_on_time', 'opened', 'store'), numeric: true},
    {key: 'con', label: 'Contacted on time', value: rv('contacted_on_time', 'opened'), render: r => rate(r, 'contacted_on_time', 'opened', 'store'), numeric: true},
    {key: 'reached', label: 'Reached the customer', value: rv('reached', 'opened'), render: r => rate(r, 'reached', 'opened', 'store'), numeric: true},
    {key: 'attempted', label: 'Attempted only', value: rv('attempted_only', 'opened'), render: r => rate(r, 'attempted_only', 'opened', 'store'), numeric: true},
    {key: 'median', label: 'Median time to contact (business hours)', value: r => r.medianMinutes ?? Infinity, render: r => (r.medianMinutes === null ? '—' : formatDuration(r.medianMinutes * 60000)), numeric: true},
    {key: 'appt', label: 'Appointment', value: rv('appointment', 'closed'), render: r => rate(r, 'appointment', 'closed', 'store'), numeric: true},
    {key: 'sold', label: 'Sold', value: rv('sold', 'closed'), render: r => rate(r, 'sold', 'closed', 'store'), numeric: true},
    {key: 'lost', label: 'Lost', value: rv('lost', 'closed'), render: r => rate(r, 'lost', 'closed', 'store'), numeric: true},
    {key: 'open', label: 'Still open', value: num('open'), render: r => count(r, 'open', 'store'), numeric: true},
    {key: 'red', label: 'Overdue now', value: num('overdue_now'), render: r => count(r, 'overdue_now', 'store'), numeric: true},
  ];
  const senderColumns: Column<ReportRow>[] = [
    {key: 'name', label: 'Sent by', value: r => r.name ?? '', render: r => r.name},
    {key: 'opened', label: 'Hot Prospects sent', value: num('opened'), render: r => count(r, 'opened', 'sender'), numeric: true},
    {key: 'appt', label: 'Converted to appointment', value: rv('appointment', 'closed'), render: r => rate(r, 'appointment', 'closed', 'sender'), numeric: true},
  ];
  const ownerColumns: Column<ReportRow>[] = [
    {key: 'name', label: 'Owner (manager)', value: r => r.name ?? '', render: r => r.name},
    {key: 'opened', label: 'Cases they have', value: num('opened'), render: r => count(r, 'opened', 'owner'), numeric: true},
    {key: 'acc', label: 'Accepted on time', value: rv('owner_accepted_on_time', 'opened'), render: r => rate(r, 'owner_accepted_on_time', 'opened', 'owner'), numeric: true},
    {key: 'con', label: 'Contacted on time', value: rv('contacted_on_time', 'opened'), render: r => rate(r, 'contacted_on_time', 'opened', 'owner'), numeric: true},
    {key: 'reached', label: 'Reached the customer', value: rv('reached', 'opened'), render: r => rate(r, 'reached', 'opened', 'owner'), numeric: true},
    {key: 'attempted', label: 'Attempted only', value: rv('attempted_only', 'opened'), render: r => rate(r, 'attempted_only', 'opened', 'owner'), numeric: true},
    {key: 'appt', label: 'Appointment', value: rv('appointment', 'closed'), render: r => rate(r, 'appointment', 'closed', 'owner'), numeric: true},
    {key: 'sold', label: 'Sold', value: rv('sold', 'closed'), render: r => rate(r, 'sold', 'closed', 'owner'), numeric: true},
  ];
  const reasonColumns: Column<ReportRow>[] = [
    {key: 'reason', label: 'Reason', value: r => names.reason(String(r.key)), render: r => names.reason(String(r.key))},
    {key: 'opened', label: 'Cases', value: num('opened'), render: r => count(r, 'opened', 'reason'), numeric: true},
    {key: 'appt', label: 'Converted to appointment', value: rv('appointment', 'closed'), render: r => rate(r, 'appointment', 'closed', 'reason'), numeric: true},
    {key: 'sold', label: 'Sold', value: rv('sold', 'closed'), render: r => rate(r, 'sold', 'closed', 'reason'), numeric: true},
  ];
  const lostColumns: Column<ReportRow>[] = [
    {key: 'reason', label: 'Lost reason', value: r => names.lostReason(String(r.key)), render: r => names.lostReason(String(r.key))},
    {
      key: 'lost',
      label: 'Lost',
      value: num('lost'),
      render: r => <Rate n={r.counts.lost ?? 0} of={lostTotal} drill={d('lost', 'lost_reason', r.key)} ofDrill={d('lost')} search={search} />,
      numeric: true,
    },
  ];

  return (
    <section className="report-section" aria-labelledby="hot-h">
      <h2 id="hot-h">Hot Prospects</h2>
      <div className="app-card">
        <Explain
          shows="Customers sent to a manager in this range: how fast they were picked up and called, and how they ended."
          todo="Click any number to see the cases behind it. Low on-time rates point to a person or store to coach."
        />
        <div className="stat-grid">
          <Tile label="Cases opened">
            <Count n={t.opened ?? 0} drill={d('opened')} search={search} />
          </Tile>
          <Tile label="Accepted on time">
            <Rate n={t.accepted_on_time ?? 0} of={t.opened ?? 0} drill={d('accepted_on_time')} ofDrill={d('opened')} search={search} />
          </Tile>
          <Tile label="Customer contacted on time">
            <Rate n={t.contacted_on_time ?? 0} of={t.opened ?? 0} drill={d('contacted_on_time')} ofDrill={d('opened')} search={search} />
          </Tile>
          <Tile label="Reached the customer">
            <Rate n={t.reached ?? 0} of={t.opened ?? 0} drill={d('reached')} ofDrill={d('opened')} search={search} />
          </Tile>
          <Tile label="Attempted only (not reached)">
            <Rate n={t.attempted_only ?? 0} of={t.opened ?? 0} drill={d('attempted_only')} ofDrill={d('opened')} search={search} />
          </Tile>
          <Tile label="Median time to first customer contact (business hours)">
            {panel.totals.medianMinutes === null ? '—' : formatDuration(panel.totals.medianMinutes * 60000)}{' '}
            <span className="out-of">
              (of <Count n={t.contacted ?? 0} drill={d('contacted')} search={search} noun="case" /> with a contact logged)
            </span>
          </Tile>
          <Tile label="Converted to appointment">
            <Rate n={t.appointment ?? 0} of={t.closed ?? 0} noun="closed case" drill={d('appointment')} ofDrill={d('closed')} search={search} />
          </Tile>
          <Tile label="Appointments that showed">
            <Rate n={t.showed ?? 0} of={t.appointment_past ?? 0} noun="past appointment" drill={d('showed')} ofDrill={d('appointment_past')} search={search} />
          </Tile>
          <Tile label="Sold">
            <Rate n={t.sold ?? 0} of={t.closed ?? 0} noun="closed case" drill={d('sold')} ofDrill={d('closed')} search={search} />
          </Tile>
          <Tile label="Lost">
            <Rate n={t.lost ?? 0} of={t.closed ?? 0} noun="closed case" drill={d('lost')} ofDrill={d('closed')} search={search} />
          </Tile>
          <Tile label="Still open">
            <Count n={t.open ?? 0} drill={d('open')} search={search} noun="case" />
          </Tile>
          <Tile label="Overdue now (red)">
            <Count n={t.overdue_now ?? 0} drill={d('overdue_now')} search={search} noun="case" />
          </Tile>
        </div>
      </div>

      <div className="app-card">
        <h3>Trend by week</h3>
        <Explain shows="Each week's share accepted on time (of cases opened) and converted to appointment (of cases closed)." todo="Look for a week that dips, then click into that week's cases above." />
        <TrendChart
          title="Hot Prospects by week"
          aLabel="Accepted on time"
          bLabel="Appointment"
          points={(panel.tables.trend ?? []).map(r => ({
            week: String(r.key),
            a: {n: r.counts.accepted_on_time ?? 0, of: r.counts.opened ?? 0},
            b: {n: r.counts.appointment ?? 0, of: r.counts.closed ?? 0},
          }))}
        />
      </div>

      <div className="app-card">
        <h3>By store</h3>
        <Explain shows="The same measures, one row per store." todo="Sort by a column to find the store that needs attention first." />
        <SortableTable rows={panel.tables.stores ?? []} columns={storeColumns} caption="Hot Prospects by store" rowKey={keyOf} initial="opened" />
      </div>
      <div className="report-pair">
        <div className="app-card">
          <h3>Who sends the most</h3>
          <Explain shows="Who sent Hot Prospects, and how many of their closed cases became appointments." todo="Thank the strong senders; coach the ones whose cases rarely convert." />
          <SortableTable rows={panel.tables.senders ?? []} columns={senderColumns} caption="Hot Prospects by sender" rowKey={keyOf} initial="opened" />
        </div>
        <div className="app-card">
          <h3>Who closes them</h3>
          <Explain shows="Each manager who has cases now: on-time accepting and contact, and how the closed ones ended." todo="Follow up with the managers whose on-time rates are lowest." />
          <SortableTable rows={panel.tables.owners ?? []} columns={ownerColumns} caption="Hot Prospects by owner" rowKey={keyOf} initial="opened" />
        </div>
      </div>
      <div className="report-pair">
        <div className="app-card">
          <h3>By escalation reason</h3>
          <Explain shows="Why reps asked for a manager, and how each reason converts." todo="A reason that rarely converts may need a new script or offer." />
          <SortableTable rows={panel.tables.reasons ?? []} columns={reasonColumns} caption="Hot Prospects by reason" rowKey={keyOf} initial="opened" />
        </div>
        <div className="app-card">
          <h3>Lost, by reason</h3>
          <Explain shows="Why lost cases were lost (out of all lost cases)." todo="Price and payment losses are worth a look by the desk." />
          <SortableTable rows={panel.tables.lostReasons ?? []} columns={lostColumns} caption="Lost cases by reason" rowKey={keyOf} initial="lost" />
        </div>
      </div>
    </section>
  );
}

function CsiPanel({panel, search}: PanelProps) {
  const names = useLabels();
  const t = panel.totals.counts;
  const d = (measure: string, dim?: string, key?: ReportRow['key']): Drill => ({type: 'csi', measure, dim, key});
  const count = (row: ReportRow, measure: string, dim: string) => <Count n={row.counts[measure] ?? 0} drill={d(measure, dim, row.key)} search={search} />;
  const rate = (row: ReportRow, n: string, of: string, dim: string) => (
    <Rate n={row.counts[n] ?? 0} of={row.counts[of] ?? 0} drill={d(n, dim, row.key)} ofDrill={d(of, dim, row.key)} search={search} />
  );
  const num = (m: string) => (row: ReportRow) => row.counts[m] ?? 0;
  const rv = (n: string, of: string) => (row: ReportRow) => rateValue(row.counts[n] ?? 0, row.counts[of] ?? 0);
  const outcome = (key: string, label: string) => (
    <Tile label={label}>
      <Rate n={t[key] ?? 0} of={t.recovery_closed ?? 0} noun="closed case" drill={d(key)} ofDrill={d('recovery_closed')} search={search} />
    </Tile>
  );

  const manufacturerColumns: Column<ReportRow>[] = [
    {key: 'm', label: 'Manufacturer', value: r => String(r.key ?? ''), render: r => r.key ?? '—'},
    {key: 'calls', label: 'Check-in calls', value: num('checkins'), render: r => count(r, 'checkins', 'manufacturer'), numeric: true},
    {key: 'reached', label: 'Reached', value: rv('checkins_reached', 'checkins'), render: r => rate(r, 'checkins_reached', 'checkins', 'manufacturer'), numeric: true},
    {key: 'unhappy', label: 'Unhappy', value: rv('checkins_unhappy', 'checkins_reached'), render: r => rate(r, 'checkins_unhappy', 'checkins_reached', 'manufacturer'), numeric: true},
    {key: 'opened', label: 'Recovery cases', value: num('recovery_opened'), render: r => count(r, 'recovery_opened', 'manufacturer'), numeric: true},
    {key: 'ontime', label: 'Manager called on time', value: rv('called_on_time', 'recovery_opened'), render: r => rate(r, 'called_on_time', 'recovery_opened', 'manufacturer'), numeric: true},
    {key: 'median', label: 'Median time to call (business hours)', value: r => r.medianMinutes ?? Infinity, render: r => (r.medianMinutes === null ? '—' : formatDuration(r.medianMinutes * 60000)), numeric: true},
    {key: 'recovered', label: 'Recovered', value: rv('recovered', 'recovery_closed'), render: r => rate(r, 'recovered', 'recovery_closed', 'manufacturer'), numeric: true},
    {key: 'partly', label: 'Partly', value: rv('partly', 'recovery_closed'), render: r => rate(r, 'partly', 'recovery_closed', 'manufacturer'), numeric: true},
    {key: 'not', label: 'Not recovered', value: rv('not_recovered', 'recovery_closed'), render: r => rate(r, 'not_recovered', 'recovery_closed', 'manufacturer'), numeric: true},
    {key: 'noreach', label: 'Could not reach', value: rv('no_reach', 'recovery_closed'), render: r => rate(r, 'no_reach', 'recovery_closed', 'manufacturer'), numeric: true},
    {key: 'turned', label: 'Turned around', value: rv('turned_around', 'unhappy_returned'), render: r => rate(r, 'turned_around', 'unhappy_returned', 'manufacturer'), numeric: true},
  ];
  const problemColumns: Column<ReportRow>[] = [
    {key: 'p', label: 'Problem', value: r => names.problem(String(r.key)), render: r => names.problem(String(r.key))},
    {key: 'opened', label: 'Recovery cases with it', value: num('recovery_opened'), render: r => count(r, 'recovery_opened', 'problem'), numeric: true},
    {key: 'fixed', label: 'Recovered', value: rv('recovered', 'recovery_closed'), render: r => rate(r, 'recovered', 'recovery_closed', 'problem'), numeric: true},
  ];
  const staffColumns: Column<ReportRow>[] = [
    {key: 'name', label: 'Salesperson or advisor involved', value: r => r.name ?? 'Not named', render: r => r.name ?? 'Not named'},
    {key: 'unhappy', label: 'Unhappy customers', value: num('unhappy'), render: r => count(r, 'unhappy', 'staff'), numeric: true},
    {key: 'opened', label: 'Recovery cases', value: num('recovery_opened'), render: r => count(r, 'recovery_opened', 'staff'), numeric: true},
  ];

  return (
    <section className="report-section" aria-labelledby="csi-h">
      <h2 id="csi-h">CSI Recovery</h2>
      <div className="app-card">
        <Explain
          shows="Check-in calls, the unhappy customers they found, and whether a manager called and turned it around."
          todo="Click any number for its cases. A low on-time call rate means unhappy customers are waiting."
        />
        <div className="stat-grid">
          <Tile label="Check-in calls logged">
            <Count n={t.checkins ?? 0} drill={d('checkins')} search={search} />
          </Tile>
          <Tile label="Reached">
            <Rate n={t.checkins_reached ?? 0} of={t.checkins ?? 0} noun="call" drill={d('checkins_reached')} ofDrill={d('checkins')} search={search} />
          </Tile>
          <Tile label="Unhappy">
            <Rate n={t.checkins_unhappy ?? 0} of={t.checkins_reached ?? 0} noun="reached call" drill={d('checkins_unhappy')} ofDrill={d('checkins_reached')} search={search} />
          </Tile>
          <Tile label="Recovery cases opened">
            <Count n={t.recovery_opened ?? 0} drill={d('recovery_opened')} search={search} />
          </Tile>
          <Tile label="Manager called on time">
            <Rate n={t.called_on_time ?? 0} of={t.recovery_opened ?? 0} drill={d('called_on_time')} ofDrill={d('recovery_opened')} search={search} />
          </Tile>
          <Tile label="Median time to manager call (business hours)">
            {panel.totals.medianMinutes === null ? '—' : formatDuration(panel.totals.medianMinutes * 60000)}{' '}
            <span className="out-of">
              (of <Count n={t.called ?? 0} drill={d('called')} search={search} noun="case" /> with a call logged)
            </span>
          </Tile>
          <Tile label="Reached the customer">
            <Rate n={t.reached ?? 0} of={t.recovery_opened ?? 0} drill={d('reached')} ofDrill={d('recovery_opened')} search={search} />
          </Tile>
          <Tile label="Attempted only (not reached)">
            <Rate n={t.attempted_only ?? 0} of={t.recovery_opened ?? 0} drill={d('attempted_only')} ofDrill={d('recovery_opened')} search={search} />
          </Tile>
          {outcome('recovered', 'Recovered')}
          {outcome('partly', 'Partly recovered')}
          {outcome('not_recovered', 'Not recovered')}
          {outcome('no_reach', 'Could not reach')}
          <Tile label="Turned around (final survey Good)">
            <Rate n={t.turned_around ?? 0} of={t.unhappy_returned ?? 0} noun="returned survey" drill={d('turned_around')} ofDrill={d('unhappy_returned')} search={search} />
          </Tile>
          <Tile label="Still open">
            <Count n={t.open ?? 0} drill={d('open')} search={search} noun="case" />
          </Tile>
          <Tile label="Overdue now (red)">
            <Count n={t.overdue_now ?? 0} drill={d('overdue_now')} search={search} noun="case" />
          </Tile>
        </div>
      </div>
      <div className="app-card">
        <h3>Trend by week</h3>
        <Explain shows="Each week's share of recovery cases with the manager's call on time, and the share recovered (of those closed)." todo="A falling line is a week to look into." />
        <TrendChart
          title="CSI Recovery by week"
          aLabel="Called on time"
          bLabel="Recovered"
          points={(panel.tables.trend ?? []).map(r => ({
            week: String(r.key),
            a: {n: r.counts.called_on_time ?? 0, of: r.counts.recovery_opened ?? 0},
            b: {n: r.counts.recovered ?? 0, of: r.counts.recovery_closed ?? 0},
          }))}
        />
      </div>
      <div className="app-card">
        <h3>By manufacturer</h3>
        <Explain shows="Every CSI measure, one row per manufacturer." todo="Start with the manufacturer whose survey is due soonest and whose recovery rate is lowest." />
        <SortableTable rows={panel.tables.manufacturers ?? []} columns={manufacturerColumns} caption="CSI by manufacturer" rowKey={keyOf} initial="calls" />
      </div>
      <div className="report-pair">
        <div className="app-card">
          <h3>By problem type</h3>
          <Explain shows="Which complaints come up most, and how often we fix them." todo="A common complaint with a low recovery rate is a process to fix at the store." />
          <SortableTable rows={panel.tables.problems ?? []} columns={problemColumns} caption="CSI by problem" rowKey={keyOf} initial="opened" />
        </div>
        <div className="app-card">
          <h3>By salesperson or advisor involved</h3>
          <Explain shows="How many unhappy customers trace back to each person (managers and up only)." todo="Use it to coach, privately. One case is not a pattern." />
          <SortableTable rows={panel.tables.staff ?? []} columns={staffColumns} caption="Unhappy customers by person involved" rowKey={keyOf} initial="unhappy" />
        </div>
      </div>
    </section>
  );
}

