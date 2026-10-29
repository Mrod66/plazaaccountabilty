import {useInfiniteQuery} from '@tanstack/react-query';
import {useNavigate, useSearch} from '@tanstack/react-router';
import {type FormEvent, useState} from 'react';

import {CASE_TYPES} from '../../lib/hub';
import {CaseTable, useStores} from '../hub';
import {casesQuery} from '../queries';
import {ErrorNote} from '../shared';
import {Button, Field} from '../ui';

const STATES = [
  {value: 'open', label: 'Open'},
  {value: 'closed', label: 'Closed'},
  {value: 'all', label: 'All'},
];

/**
 * Every case the viewer may see, newest first: a rep sees their own, a
 * manager their stores', leadership everything (the server decides). Search
 * by case number (HP-1042), phone or customer name. Phase 3 adds the Store
 * Board's sorting and filters.
 */
export function Cases() {
  const search = useSearch({from: '/cases'});
  const navigate = useNavigate({from: '/cases'});
  const filter = {q: search.q ?? '', state: search.state ?? 'open', type: search.type ?? ''};
  const [q, setQ] = useState(filter.q);
  const stores = useStores();
  const cases = useInfiniteQuery(casesQuery(filter));
  const rows = cases.data?.pages.flatMap(page => page.items) ?? [];

  const apply = (next: Partial<typeof filter>) => void navigate({search: {...filter, ...next}, replace: true});
  const submit = (event: FormEvent) => {
    event.preventDefault();
    apply({q: q.trim().slice(0, 80)});
  };

  return (
    <div className="app-page">
      <div className="app-page-head">
        <div>
          <h2>Cases you can see</h2>
          <p className="muted">Your own cases, plus any your role lets you see. Search by case number, phone or customer name.</p>
        </div>
      </div>
      <form className="toolbar app-card" onSubmit={submit} noValidate role="search">
        <Field id="f-q" label="Search">
          <input id="f-q" type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="e.g. HP-1042, 555-1234 or Rivera" maxLength={80} />
        </Field>
        <Field id="f-state" label="Status">
          <select id="f-state" value={filter.state} onChange={e => apply({state: e.target.value})}>
            {STATES.map(s => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>
        <Field id="f-type" label="Case type">
          <select id="f-type" value={filter.type} onChange={e => apply({type: e.target.value})}>
            <option value="">Both</option>
            {CASE_TYPES.map(t => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </Field>
        <Button type="submit" variant="ghost" pending={cases.isFetching && !cases.isFetchingNextPage} pendingLabel="Searching…">
          Search
        </Button>
      </form>

      {cases.error && <ErrorNote error={cases.error} />}
      {cases.isPending ? (
        <p className="muted">Loading…</p>
      ) : rows.length === 0 ? (
        !cases.error && (
          <div className="app-card empty-card">
            <p className="muted">{filter.q ? 'No case you can see matches that search.' : 'No cases here yet.'}</p>
            {filter.q && (
              <Button variant="ghost" onClick={() => (setQ(''), apply({q: ''}))}>
                Clear the search
              </Button>
            )}
          </div>
        )
      ) : (
        <CaseTable cases={rows} stores={stores} show="both" caption="Cases you can see" />
      )}
      {cases.hasNextPage && (
        <Button variant="ghost" onClick={() => cases.fetchNextPage()} pending={cases.isFetchingNextPage} pendingLabel="Loading…">
          Load more
        </Button>
      )}
    </div>
  );
}
