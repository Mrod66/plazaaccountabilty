import {useInfiniteQuery, useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {Link} from '@tanstack/react-router';
import {useState} from 'react';

import {type AlertRow, formatWhen} from '../../lib/hub';
import {api, read} from '../api';
import {Choices} from '../hub';
import {alertPrefsQuery, alertsQuery} from '../queries';
import {ErrorNote} from '../shared';
import {Button} from '../ui';

const MODES = [
  {value: 'batched', label: 'Batched alerts during the day'},
  {value: 'summary', label: 'One summary at 8:00 AM and 4:00 PM'},
];

/** What happened to an alert's email, in words. */
function emailWords(alert: AlertRow) {
  if (alert.emailState === 'sent') return `Emailed ${formatWhen(alert.emailedAt)}`;
  if (alert.emailState === 'capped' || alert.capped) return 'Email not sent (limit reached)';
  if (alert.emailState === 'pending') return alert.read ? 'No email needed' : 'In your next email batch';
  return 'No email needed';
}

/**
 * Your alerts: the official record of what is waiting on you. Email is only a
 * nudge about these, sent in batches; everything is here whether or not an
 * email went out.
 */
export function Alerts() {
  const queryClient = useQueryClient();
  const alerts = useInfiniteQuery(alertsQuery);
  const prefs = useQuery(alertPrefsQuery);
  const [mode, setMode] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const rows = alerts.data?.pages.flatMap(p => p.items) ?? [];
  const unread = rows.filter(r => !r.read).length;

  const markAll = useMutation({
    mutationFn: () => read(api.alerts.read.$post({json: {all: true}})),
    onSuccess: () => queryClient.invalidateQueries({queryKey: ['alerts']}),
  });
  const savePrefs = useMutation({
    mutationFn: (alertMode: string) => read<{alertMode: string}>(api.alerts.prefs.$put({json: {alertMode}})),
    onSuccess: async ({alertMode}) => {
      await queryClient.invalidateQueries({queryKey: ['alerts', 'prefs']});
      setSaved(alertMode === 'summary' ? 'Saved: you get a summary at 8:00 AM and 4:00 PM. Escalations still come right away.' : 'Saved: alerts come in batches during the day.');
    },
  });
  const current = mode ?? prefs.data?.alertMode ?? 'batched';

  return (
    <div className="app-page">
      <section className="app-card">
        <div className="section-head">
          <h3>Your alerts</h3>
          <Button variant="ghost" size="sm" disabled={!unread} pending={markAll.isPending} pendingLabel="Marking…" onClick={() => markAll.mutate()}>
            Mark all as read
          </Button>
        </div>
        <p className="muted">What this shows: every case sent, handed off or escalated to you, and every clock you missed. What to do with it: open each one and act; opening a case marks its alerts read.</p>
        {markAll.error && <ErrorNote error={markAll.error} />}
        {alerts.error && <ErrorNote error={alerts.error} />}
        {alerts.isPending ? (
          <p className="muted">Loading…</p>
        ) : rows.length === 0 ? (
          !alerts.error && <p className="empty-card muted">No alerts yet. New cases sent to you will show here.</p>
        ) : (
          <ul className="alert-list">
            {rows.map(a => (
              <li key={a.id} data-unread={a.read ? undefined : ''} data-escalation={a.escalation ? '' : undefined}>
                <div>
                  <strong>{a.message}</strong>
                  {!a.read && <span className="chip chip-status gap-left">New</span>}
                  <div>
                    <Link to="/cases/$caseId" params={{caseId: String(a.caseId)}}>
                      {a.caseNumber}
                    </Link>{' '}
                    · {a.customerName}
                    {a.caseClosed ? ' · closed' : ''}
                  </div>
                </div>
                <div className="muted">
                  {formatWhen(a.createdAt)}
                  <div>{emailWords(a)}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
        {alerts.hasNextPage && (
          <Button variant="ghost" onClick={() => alerts.fetchNextPage()} pending={alerts.isFetchingNextPage} pendingLabel="Loading…">
            Load more
          </Button>
        )}
      </section>

      <form
        className="app-card hub-form"
        noValidate
        onSubmit={event => {
          event.preventDefault();
          setSaved(null);
          savePrefs.mutate(current);
        }}>
        <h3>Your alert emails</h3>
        <p className="muted">Emails never carry a customer’s phone number. Escalations always come right away.</p>
        <Choices name="alertMode" legend="Email me" options={MODES} value={current} onChange={setMode} />
        {savePrefs.error && <ErrorNote error={savePrefs.error} />}
        {saved && (
          <p className="notice notice-ok" role="status">
            {saved}
          </p>
        )}
        <div className="actions">
          <Button type="submit" pending={savePrefs.isPending} pendingLabel="Saving…" disabled={prefs.isPending || current === prefs.data?.alertMode}>
            Save
          </Button>
        </div>
      </form>
    </div>
  );
}
