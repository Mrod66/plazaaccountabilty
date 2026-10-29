import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {useState} from 'react';

import {CASE_TYPES, CLOCK_SETTING_KINDS, CLOCK_UNITS, type ClockSettingRow, type HoursRow, labels, WEEKDAY_NAMES} from '../../lib/hub';
import {api, ApiError, read} from '../api';
import {clockAdminQuery} from '../queries';
import {ErrorNote} from '../shared';
import {Button} from '../ui';

/**
 * Admin → Clocks and hours: how long each clock gives (per case type), and
 * when each store's sales and service departments are open (clocks pause
 * outside these hours). Changes apply to clocks that start after the save.
 */
export function ClocksAdmin() {
  const data = useQuery(clockAdminQuery);
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const run = useMutation({
    mutationFn: () => read<{alerted: number; emails: {sent: number; deferred: number; capped: number}}>(api.hub.admin['run-checks'].$post()),
    onSuccess: async r => {
      await queryClient.invalidateQueries({queryKey: ['cases']});
      await queryClient.invalidateQueries({queryKey: ['alerts']});
      setMessage(
        `Checked. ${r.alerted} ${r.alerted === 1 ? 'person' : 'people'} got a new alert; ${r.emails.sent} email${r.emails.sent === 1 ? '' : 's'} sent, ${r.emails.deferred} waiting for their next batch.`
      );
    },
  });

  return (
    <div className="app-page">
      <div className="app-page-head">
        <div>
          <h2>Clocks and hours</h2>
          <p className="muted">
            Clocks count business time only. On the live site the hub checks every 5 minutes and right at each deadline.
          </p>
        </div>
        <Button pending={run.isPending} pendingLabel="Checking…" onClick={() => (setMessage(null), run.mutate())}>
          Run the clock check now
        </Button>
      </div>
      {message && (
        <p className="notice notice-ok" role="status">
          {message}
        </p>
      )}
      {run.error && <ErrorNote error={run.error} />}
      {data.error && <ErrorNote error={data.error} />}
      {data.isPending ? (
        <p className="muted">Loading…</p>
      ) : (
        data.data && (
          <>
            <section className="app-card">
              <h3>Clocks</h3>
              <p className="muted">What this shows: how long each step may take before its clock turns red, and what happens after a miss. What to do with it: keep the defaults unless the stores agree a change.</p>
              <div className="table-wrap">
                <table className="hub-table">
                  <thead>
                    <tr>
                      <th scope="col">Case type</th>
                      <th scope="col">Clock</th>
                      <th scope="col">Time allowed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {CASE_TYPES.flatMap(type =>
                      CLOCK_SETTING_KINDS.map(kind => {
                        const row = data.data.settings.find(s => s.caseType === type.value && s.kind === kind.value);
                        return row ? <SettingRow key={`${type.value}-${kind.value}`} row={row} /> : null;
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </section>
            <section className="app-card">
              <h3>Business hours (Eastern time)</h3>
              <p className="muted">What this shows: when each store's departments are open. Clocks pause outside these hours. What to do with it: close a day for a holiday, then open it again after.</p>
              <div className="table-wrap">
                <table className="hub-table hours-grid">
                  <thead>
                    <tr>
                      <th scope="col">Store</th>
                      {WEEKDAY_NAMES.map(d => (
                        <th key={d} scope="col">
                          {d}
                        </th>
                      ))}
                      <th scope="col">
                        <span className="sr-only">Save</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.data.hours.map(row => (
                      <HoursLine key={`${row.storeId}-${row.department}`} row={row} />
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )
      )}
    </div>
  );
}

function SettingRow({row}: {row: ClockSettingRow}) {
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState(String(row.amount));
  const [unit, setUnit] = useState(row.unit);
  const [done, setDone] = useState(false);
  const id = `clk-${row.caseType}-${row.kind}`;
  const save = useMutation({
    mutationFn: () => read(api.hub.admin.clocks.$put({json: {caseType: row.caseType, kind: row.kind, amount: Number(amount), unit} as never})),
    onSuccess: async () => {
      setDone(true);
      await queryClient.invalidateQueries({queryKey: ['hub', 'clocks']});
    },
  });
  const valid = /^\d{1,3}$/.test(amount.trim()) && Number(amount) >= 1;
  const changed = amount !== String(row.amount) || unit !== row.unit;
  const fieldError = save.error instanceof ApiError ? Object.values(save.error.fields)[0] : undefined;
  return (
    <tr>
      <td>{labels.type(row.caseType)}</td>
      <td>{CLOCK_SETTING_KINDS.find(k => k.value === row.kind)?.label}</td>
      <td>
        <div className="inline-fields">
          <label className="sr-only" htmlFor={`${id}-a`}>
            Amount
          </label>
          <input
            id={`${id}-a`}
            inputMode="numeric"
            value={amount}
            aria-invalid={!valid || undefined}
            aria-describedby={!valid || fieldError ? `${id}-e` : undefined}
            onChange={e => (setDone(false), setAmount(e.target.value))}
          />
          <label className="sr-only" htmlFor={`${id}-u`}>
            Unit
          </label>
          <select id={`${id}-u`} value={unit} onChange={e => (setDone(false), setUnit(e.target.value))}>
            {CLOCK_UNITS.map(u => (
              <option key={u.value} value={u.value}>
                {u.label}
              </option>
            ))}
          </select>
          <Button size="sm" variant="ghost" disabled={!valid || !changed} pending={save.isPending} pendingLabel="Saving…" onClick={() => save.mutate()}>
            Save
          </Button>
          {done && !changed && <span className="muted">Saved</span>}
        </div>
        {(!valid || fieldError) && (
          <p className="field-error" id={`${id}-e`} role="alert">
            {fieldError ?? 'Enter a whole number from 1 to 999.'}
          </p>
        )}
        {save.error && !fieldError && <ErrorNote error={save.error} />}
      </td>
    </tr>
  );
}

function HoursLine({row}: {row: HoursRow}) {
  const queryClient = useQueryClient();
  const [days, setDays] = useState(row.days);
  const [done, setDone] = useState(false);
  const save = useMutation({
    mutationFn: () => read(api.hub.admin.hours.$put({json: {storeId: row.storeId, department: row.department, days} as never})),
    onSuccess: async () => {
      setDone(true);
      await queryClient.invalidateQueries({queryKey: ['hub', 'clocks']});
    },
  });
  const bad = days.map(d => (d && !(d.open < d.close) ? 'Opening must be before closing.' : null));
  const set = (i: number, value: {open: string; close: string} | null) => {
    setDone(false);
    setDays(current => current.map((d, j) => (j === i ? value : d)));
  };
  const label = `${row.storeName} ${row.department === 'service' ? 'service' : 'sales'}`;
  return (
    <tr>
      <th scope="row">
        {row.storeName}
        <div className="muted">{row.department === 'service' ? 'Service' : 'Sales'}</div>
      </th>
      {days.map((day, i) => {
        const id = `h-${row.storeId}-${row.department}-${i}`;
        return (
          <td key={i}>
            <div className="hours-day">
              <label className="check">
                <input type="checkbox" checked={day !== null} onChange={e => set(i, e.target.checked ? {open: '09:00', close: '18:00'} : null)} />{' '}
                {day ? 'Open' : 'Closed'}
              </label>
              {day && (
                <>
                  <label className="sr-only" htmlFor={`${id}-o`}>
                    {label}, {WEEKDAY_NAMES[i]}, opens
                  </label>
                  <input id={`${id}-o`} type="time" value={day.open} aria-invalid={bad[i] ? true : undefined} onChange={e => set(i, {...day, open: e.target.value})} />
                  <label className="sr-only" htmlFor={`${id}-c`}>
                    {label}, {WEEKDAY_NAMES[i]}, closes
                  </label>
                  <input id={`${id}-c`} type="time" value={day.close} aria-invalid={bad[i] ? true : undefined} onChange={e => set(i, {...day, close: e.target.value})} />
                  {bad[i] && (
                    <span className="field-error" role="alert">
                      {bad[i]}
                    </span>
                  )}
                </>
              )}
            </div>
          </td>
        );
      })}
      <td>
        <Button size="sm" variant="ghost" disabled={bad.some(Boolean)} pending={save.isPending} pendingLabel="Saving…" onClick={() => save.mutate()}>
          Save
        </Button>
        {done && <div className="muted">Saved</div>}
        {save.error && <ErrorNote error={save.error} />}
      </td>
    </tr>
  );
}
