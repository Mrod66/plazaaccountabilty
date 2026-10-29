import {useInfiniteQuery} from '@tanstack/react-query';

import {auditQuery} from '../queries';
import {ErrorNote, when} from '../shared';
import {Button} from '../ui';

/** `/portal/activity` (site:audit:read): the audit log, newest first. */
export function Activity() {
  const events = useInfiniteQuery(auditQuery);
  const rows = events.data?.pages.flatMap(page => page.events) ?? [];

  return (
    <div className="app-page">
      <div className="app-page-head">
        <div>
          <h2>Activity</h2>
          <p className="muted">Sign-ups, password changes, role changes and security events.</p>
        </div>
      </div>
      {events.error && <ErrorNote error={events.error} />}
      {events.isPending ? (
        <p className="muted">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="app-empty">
          <p className="muted">Nothing yet.</p>
        </div>
      ) : (
        <section className="app-card">
          <table className="app-table">
            <thead>
              <tr>
                <th>What</th>
                <th>Who</th>
                <th>On</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(event => (
                <tr key={event.id}>
                  <td>{event.action.replaceAll('_', ' ')}</td>
                  <td className="muted">{event.actor?.name ?? 'System'}</td>
                  <td className="muted">{event.target ?? '—'}</td>
                  <td className="muted">{when(event.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      {events.hasNextPage && (
        <Button
          variant="ghost"
          onClick={() => events.fetchNextPage()}
          pending={events.isFetchingNextPage}
          pendingLabel="Loading…">
          Load more
        </Button>
      )}
    </div>
  );
}
