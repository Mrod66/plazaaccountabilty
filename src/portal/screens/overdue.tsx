import {useQuery} from '@tanstack/react-query';

import {CaseTable, useStores} from '../hub';
import {overdueQuery} from '../queries';
import {ErrorNote} from '../shared';

/**
 * The Director of Operations' Overdue panel: open cases that missed a clock
 * and are still not done two business days later, the oldest first.
 * (Phase 3's Leadership Dashboard adds every red case across the group.)
 */
export function Overdue() {
  const overdue = useQuery(overdueQuery);
  const stores = useStores();
  const rows = overdue.data?.items ?? [];
  return (
    <div className="app-page">
      <section className={`app-card${rows.length ? ' attention' : ''}`}>
        <div className="section-head">
          <h3>Overdue: 2+ business days past a missed clock</h3>
          {overdue.data && <p className="muted">{rows.length === 1 ? '1 case' : `${rows.length} cases`}</p>}
        </div>
        <p className="muted">What this shows: open cases whose owner missed a clock and still has not done it, two business days later, oldest first.</p>
        <p className="muted">What to do with it: call the owner, or hand the case to someone who can act today.</p>
        {overdue.error && <ErrorNote error={overdue.error} />}
        {overdue.isPending ? (
          <p className="muted">Loading…</p>
        ) : rows.length ? (
          <CaseTable cases={rows} stores={stores} show="both" caption="Overdue cases" />
        ) : (
          !overdue.error && <p className="empty-card muted">Nothing is overdue. Good.</p>
        )}
      </section>
    </div>
  );
}
