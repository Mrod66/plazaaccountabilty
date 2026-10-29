import {useQuery} from '@tanstack/react-query';
import {Link, useSearch} from '@tanstack/react-router';

import {formatDate, labels} from '../../lib/hub';
import {CaseTable, useLabels, useStores} from '../hub';
import {drillQuery, type DrillParams} from '../queries';
import {ErrorNote} from '../shared';

/** What a breakdown key means, in words. */
function groupWords(
  dim: string | undefined,
  key: string | undefined,
  store: (id: number) => string | undefined,
  names: ReturnType<typeof useLabels>
): string | null {
  if (!dim) return null;
  if (key === undefined || key === 'null') return 'not set';
  switch (dim) {
    case 'store':
      return store(Number(key)) ?? 'a store';
    case 'reason':
      return names.reason(key);
    case 'lost_reason':
      return names.lostReason(key);
    case 'problem':
      return names.problem(key);
    case 'manufacturer':
      return key;
    case 'week':
      return `week of ${formatDate(key)}`;
    default:
      return 'one person';
  }
}

/**
 * The cases behind one dashboard number: the same filter, the same
 * definition, the same visibility. The count at the top IS the number.
 */
export function DrillCases() {
  const search = useSearch({from: '/dashboard/cases'}) as DrillParams;
  const stores = useStores();
  const data = useQuery(drillQuery(search));
  const store = search.store ? stores.get(Number(search.store))?.name : 'All Plaza';
  const names = useLabels();
  const group = groupWords(search.dim, search.key, id => stores.get(id)?.name, names);
  return (
    <div className="app-page">
      <p>
        <Link to="/dashboard" search={{preset: 'custom', from: search.from, to: search.to, store: search.store, department: search.department}}>
          ← Back to the dashboard
        </Link>
      </p>
      {data.error && <ErrorNote error={data.error} />}
      {data.isPending && <p className="muted">Finding the cases…</p>}
      {data.data && (
        <section className="app-card">
          <h2>
            {labels.type(search.type)} · {data.data.label}: {data.data.total.toLocaleString('en-US')} {data.data.total === 1 ? 'case' : 'cases'}
          </h2>
          <p className="muted">
            Opened {formatDate(search.from)} to {formatDate(search.to)} · {store}
            {search.department ? ` · ${search.department === 'service' ? 'Service' : 'Sales'}` : ''}
            {group ? ` · ${group}` : ''}. Only cases you may see are counted or listed.
          </p>
          {data.data.total > data.data.items.length && <p className="muted">Showing the newest {data.data.items.length} of {data.data.total}.</p>}
          {data.data.items.length ? (
            <CaseTable cases={data.data.items} stores={stores} show="both" caption={data.data.label} />
          ) : (
            <p className="muted">No cases.</p>
          )}
        </section>
      )}
    </div>
  );
}
