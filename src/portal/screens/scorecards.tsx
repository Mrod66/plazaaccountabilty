import {useQuery} from '@tanstack/react-query';
import {useNavigate, useSearch} from '@tanstack/react-router';

import {useHub} from '../hub';
import {scorecardsQuery} from '../queries';
import {Explain, rangeOf, type ReportSearch, ReportFilters, SortableTable} from '../report-ui';
import {ErrorNote} from '../shared';
import {csiRepColumns, frontLineColumns, managerColumns} from './scorecard-parts';

/**
 * People Scorecards (build prompt section 11), managers and up: one row per
 * person, every rate with its count, sortable by any column. Store managers
 * see their own stores. Process language only: no "worst" labels.
 */
export function PeopleScorecards() {
  const search = useSearch({from: '/scorecards'}) as ReportSearch;
  const navigate = useNavigate({from: '/scorecards'});
  const hub = useHub();
  const {from, to} = rangeOf(search);
  const data = useQuery(scorecardsQuery({from, to, store: search.store ?? ''}));
  const card = data.data;
  const scope = {from, to, store: search.store ?? ''};
  return (
    <div className="app-page">
      <ReportFilters
        search={search}
        stores={hub.data?.stores ?? []}
        withType={false}
        pending={data.isFetching}
        onChange={next => void navigate({search: next as never, replace: true})}
      />
      {data.error && <ErrorNote error={data.error} />}
      {data.isPending && <p className="muted">Counting…</p>}
      {card && (
        <>
          <section className="app-card">
            <h2>Salespeople and BDC reps</h2>
            <Explain shows="What each person sent to a manager, and how those Hot Prospects ended. Click any number for its cases." todo="Sort by a column; talk with the people whose cases rarely end in an appointment." />
            <SortableTable rows={card.frontLine} columns={frontLineColumns('Person', scope)} caption="Salespeople and BDC reps" rowKey={r => String(r.id)} initial="sent" />
          </section>
          <section className="app-card">
            <h2>Managers</h2>
            <Explain
              shows="Cases each manager received: accepted and contacted on time, reached or only attempted, and how the cases they closed ended."
              todo="On-time rates show who is picking cases up fast; outcomes show who turns them into business."
            />
            <SortableTable rows={card.managers} columns={managerColumns('Manager', scope)} caption="Managers" rowKey={r => String(r.id)} initial="received" />
          </section>
          <section className="app-card">
            <h2>CSI reps</h2>
            <Explain shows="Check-in calls each CSI rep logged, who they reached, and the unhappy customers they found." todo="More calls reached means more problems caught before the survey." />
            <SortableTable rows={card.csiReps} columns={csiRepColumns('CSI rep', scope)} caption="CSI reps" rowKey={r => String(r.id)} initial="calls" />
          </section>
        </>
      )}
    </div>
  );
}
