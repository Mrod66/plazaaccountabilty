import {useQuery} from '@tanstack/react-query';
import {Link, useNavigate, useSearch} from '@tanstack/react-router';

import {type CaseSummary, formatDuration, formatPhone, labels} from '../../lib/hub';
import {AcceptChip, ClockPill, StatusChip, StoreChip, useHub, useLabels, useNow, useStores} from '../hub';
import {boardQuery} from '../queries';
import {type Column, Explain, SortableTable} from '../report-ui';
import {ErrorNote} from '../shared';

export type BoardSearch = {store?: string; status?: string; clock?: string; owner?: string; reason?: string};

const CLOCK_FILTERS = [
  {value: '', label: 'Any clock'},
  {value: 'missed', label: 'Red: missed'},
  {value: 'warning', label: 'Amber: running low'},
  {value: 'on_time', label: 'Green: on time'},
  {value: 'none', label: 'No clock waiting'},
];
const URGENCY: Record<string, number> = {missed: 0, warning: 1, on_time: 2};


/**
 * The Store Board (managers): every open case of my stores that I may see,
 * filtered by status, clock, owner and reason, sortable by any column.
 */
export function StoreBoard() {
  const search = useSearch({from: '/board'}) as BoardSearch;
  const navigate = useNavigate({from: '/board'});
  const hub = useHub();
  const stores = useStores();
  const now = useNow();
  const board = useQuery(boardQuery(search.store ?? ''));
  const names = useLabels();
  /** Why the case went to a manager, in words. */
  const why = (c: CaseSummary) => (c.type === 'hot' ? names.reason(c.reason) : `CSI · ${labels.sentiment(c.sentiment)}`);
  const all = board.data?.items ?? [];
  const set = (next: Partial<BoardSearch>) => void navigate({search: {...search, ...next} as never, replace: true});

  const owners = [...new Map(all.map(c => [c.owner.id, c.owner.name])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const reasons = [...new Set(all.map(why))].sort();
  const statuses = [...new Map(all.map(c => [`${c.type}:${c.status}`, labels.status(c.type, c.status)])).entries()];
  const rows = all.filter(
    c =>
      (!search.status || `${c.type}:${c.status}` === search.status) &&
      (!search.clock || (search.clock === 'none' ? !c.clock : c.clock?.state === search.clock)) &&
      (!search.owner || String(c.owner.id) === search.owner) &&
      (!search.reason || why(c) === search.reason)
  );

  const columns: Column<CaseSummary>[] = [
    {
      key: 'number',
      label: 'Case',
      value: c => c.id,
      render: c => (
        <Link className="case-link" to="/cases/$caseId" params={{caseId: String(c.id)}}>
          {c.number}
        </Link>
      ),
    },
    {
      key: 'customer',
      label: 'Customer',
      value: c => c.customerName,
      render: c => (
        <>
          {c.customerName}
          <div className="muted nowrap">{formatPhone(c.phone)}</div>
        </>
      ),
    },
    {key: 'store', label: 'Store', value: c => stores.get(c.storeId)?.shortName ?? '', render: c => <StoreChip store={stores.get(c.storeId)} />},
    {
      key: 'status',
      label: 'Status',
      value: c => labels.status(c.type, c.status),
      render: c => (
        <div className="chips">
          <StatusChip type={c.type} status={c.status} />
          <AcceptChip accepted={c.accepted} closed={false} />
        </div>
      ),
    },
    {
      key: 'clock',
      label: 'Clock',
      value: c => (c.clock ? URGENCY[c.clock.state] ?? 3 : 4),
      render: c => (c.clock ? <ClockPill clock={c.clock} type={c.type} /> : <span className="muted">—</span>),
    },
    {key: 'why', label: 'Why', value: why, render: why},
    {key: 'owner', label: 'With', value: c => c.owner.name, render: c => c.owner.name},
    {
      key: 'waiting',
      label: 'Waiting',
      value: c => now - new Date(c.ownerSince).getTime(),
      render: c => formatDuration(now - new Date(c.ownerSince).getTime()),
      numeric: true,
    },
  ];

  return (
    <div className="app-page">
      <form className="toolbar app-card" noValidate onSubmit={e => e.preventDefault()}>
        <div className="field">
          <label htmlFor="b-store">Store</label>
          <select id="b-store" value={search.store ?? ''} onChange={e => set({store: e.target.value, owner: ''})}>
            <option value="">All my stores</option>
            {(hub.data?.stores ?? []).map(s => (
              <option key={s.id} value={String(s.id)}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="b-status">Status</label>
          <select id="b-status" value={search.status ?? ''} onChange={e => set({status: e.target.value})}>
            <option value="">Any status</option>
            {statuses.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="b-clock">Clock</label>
          <select id="b-clock" value={search.clock ?? ''} onChange={e => set({clock: e.target.value})}>
            {CLOCK_FILTERS.map(f => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="b-owner">With</label>
          <select id="b-owner" value={search.owner ?? ''} onChange={e => set({owner: e.target.value})}>
            <option value="">Anyone</option>
            {owners.map(([id, name]) => (
              <option key={id} value={String(id)}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="b-reason">Why</label>
          <select id="b-reason" value={search.reason ?? ''} onChange={e => set({reason: e.target.value})}>
            <option value="">Any reason</option>
            {reasons.map(r => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
      </form>
      <section className="app-card">
        <div className="section-head">
          <h2>Open cases</h2>
          {board.data && (
            <p className="muted" role="status">
              {rows.length} of {all.length}
              {board.data.more ? ' (the newest 300)' : ''}
            </p>
          )}
        </div>
        <Explain shows="Every open case of your stores you may see, with the clock that is waiting." todo="Sort by Clock to work the red cases first; filter by owner to check in with one person." />
        {board.error && <ErrorNote error={board.error} />}
        {board.isPending ? (
          <p className="muted">Loading…</p>
        ) : rows.length ? (
          <SortableTable rows={rows} columns={columns} caption="Open cases" rowKey={c => String(c.id)} initial="clock" initialDir={1} />
        ) : (
          !board.error && <p className="muted">No open case matches.</p>
        )}
      </section>
    </div>
  );
}
