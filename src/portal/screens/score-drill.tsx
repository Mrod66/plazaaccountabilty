import {useQuery} from '@tanstack/react-query';
import {Link, useSearch} from '@tanstack/react-router';

import {formatDate} from '../../lib/hub';
import {CaseTable, useStores} from '../hub';
import {scoreDrillQuery} from '../queries';
import {ErrorNote} from '../shared';
import type {ScoreSearch} from './scorecard-parts';

/**
 * The cases behind one scorecard number: the same person, metric, dates and
 * store. The count at the top IS the number; only cases you may see.
 */
export function ScoreDrill() {
  const search = useSearch({from: '/scorecards/cases'}) as ScoreSearch;
  const stores = useStores();
  const data = useQuery(scoreDrillQuery(search));
  const store = search.store ? stores.get(Number(search.store))?.name : 'All stores';
  return (
    <div className="app-page">
      <p>
        <Link to="/scorecards" search={{preset: 'custom', from: search.from, to: search.to, store: search.store}}>
          ← Back to People Scorecards
        </Link>{' '}
        ·{' '}
        <Link to="/my-scorecard">My Scorecard</Link>
      </p>
      {data.error && <ErrorNote error={data.error} />}
      {data.isPending && <p className="muted">Finding the cases…</p>}
      {data.data && (
        <section className="app-card">
          <h2>
            {data.data.person} · {data.data.label}: {data.data.total.toLocaleString('en-US')} {data.data.total === 1 ? 'case' : 'cases'}
          </h2>
          <p className="muted">
            {formatDate(search.from)} to {formatDate(search.to)} · {store}. Only cases you may see are counted or listed.
          </p>
          {data.data.total > data.data.items.length && <p className="muted">Showing the newest {data.data.items.length} of {data.data.total}.</p>}
          {data.data.items.length ? <CaseTable cases={data.data.items} stores={stores} show="both" caption={data.data.label} /> : <p className="muted">No cases.</p>}
        </section>
      )}
    </div>
  );
}
