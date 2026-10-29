import {useQuery} from '@tanstack/react-query';
import {Link} from '@tanstack/react-router';
import {useEffect, useRef, useState} from 'react';

import {
  type CaseSummary,
  clockLabel,
  type ClockView,
  formatDuration,
  formatPhone,
  formatWhen,
  HUB_NAME,
  HUB_VERSION,
  labels,
  type Option,
  statusesOf,
  statusStep,
  type StoreRow,
} from '../lib/hub';
import {ExportButton} from './export';
import {alertCountQuery, hubMeQuery, listsQuery, type PickLists} from './queries';

/** The hub's small shared pieces (chips, progress bar, choices, case table). */

export function useHub() {
  return useQuery(hubMeQuery);
}

/**
 * Labels for the editable lists (escalation reasons, lost reasons, problem
 * types): the admin's wording, falling back to the built-in labels.
 */
export function useLabels() {
  const lists = useQuery(listsQuery);
  const find = (list: keyof PickLists, fallback: (v?: string | null) => string) => (code?: string | null) =>
    lists.data?.lists[list].find(o => o.value === code)?.label ?? fallback(code);
  return {
    reason: find('reason', labels.reason),
    lostReason: find('lost_reason', labels.lostReason),
    problem: find('problem', labels.problem),
    /** The switched-on options of a list, for a form (null while loading). */
    offered: (list: keyof PickLists) => lists.data?.lists[list].filter(o => o.active).map(o => ({value: o.value, label: o.label})) ?? null,
  };
}

/** `id → store` from the hub's store list. */
export function useStores(): Map<number, StoreRow> {
  const hub = useHub();
  return new Map((hub.data?.stores ?? []).map(store => [store.id, store]));
}

/** A store, as a neutral chip (never a manufacturer color). */
export function StoreChip({store}: {store: StoreRow | undefined}) {
  return <span className="chip">{store?.shortName ?? 'Store'}</span>;
}

export function StatusChip({type, status}: {type: string; status: string}) {
  return (
    <span className="chip chip-status" data-status={status}>
      {labels.status(type, status)}
    </span>
  );
}

/** "Waiting to be accepted", with words (never color alone). */
export function AcceptChip({accepted, closed}: {accepted: boolean; closed: boolean}) {
  if (accepted || closed) return null;
  return (
    <span className="chip chip-wait">
      <span className="dot" aria-hidden="true" />
      Not accepted yet
    </span>
  );
}

export function ProgressBar({type, status}: {type: string; status: string}) {
  const steps = statusesOf(type);
  const at = statusStep(type, status);
  return (
    <ol className="progress" aria-label={`Status: ${labels.status(type, status)}, step ${at + 1} of ${steps.length}`}>
      {steps.map((step, i) => (
        <li key={step.value} data-done={i <= at ? '' : undefined} data-current={i === at ? '' : undefined}>
          {step.label}
        </li>
      ))}
    </ol>
  );
}

/**
 * One-tap choices (radio pills) with a visible legend and its error in place.
 * `inputRef` is the first pill, so a form can move focus to the group.
 */
export function Choices({
  name,
  legend,
  options,
  value,
  onChange,
  error,
  required,
  inputRef,
}: {
  name: string;
  legend: string;
  options: readonly Option[];
  value: string;
  onChange: (value: string) => void;
  error?: string;
  required?: boolean;
  inputRef?: (node: HTMLElement | null) => void;
}) {
  const id = `f-${name}`;
  return (
    <fieldset className="field" aria-describedby={error ? `${id}-error` : undefined}>
      <legend className="field-label">
        {legend}
        {required && <span className="req"> · Required</span>}
      </legend>
      <div className="choices" role="radiogroup" aria-invalid={error ? true : undefined}>
        {options.map((option, i) => (
          <label className="choice" key={option.value}>
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              ref={i === 0 ? inputRef : undefined}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
      {error && (
        <p className="field-error" id={`${id}-error`} role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}

/** Several choices at once (checkbox pills); the value is a comma-separated list. */
export function MultiChoices({
  name,
  legend,
  options,
  value,
  onChange,
  error,
  hint,
  inputRef,
}: {
  name: string;
  legend: string;
  options: readonly Option[];
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
  inputRef?: (node: HTMLElement | null) => void;
}) {
  const id = `f-${name}`;
  const picked = new Set(value ? value.split(',') : []);
  const toggle = (v: string) => {
    if (picked.has(v)) picked.delete(v);
    else picked.add(v);
    onChange(options.map(o => o.value).filter(o => picked.has(o)).join(','));
  };
  return (
    <fieldset className="field" aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}>
      <legend className="field-label">{legend}</legend>
      <div className="choices" aria-invalid={error ? true : undefined}>
        {options.map((option, i) => (
          <label className="choice" key={option.value}>
            <input
              type="checkbox"
              name={name}
              value={option.value}
              checked={picked.has(option.value)}
              onChange={() => toggle(option.value)}
              ref={i === 0 ? inputRef : undefined}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
      {hint && !error && (
        <p className="field-hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
      {error && (
        <p className="field-error" id={`${id}-error`} role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}

/** "123 / 300" under a limited text area; turns red past the limit. */
export function Counter({value, max}: {value: string; max: number}) {
  const n = value.trim().length;
  return (
    <p className="counter" data-over={n > max ? '' : undefined} aria-live="polite">
      {n} / {max}
    </p>
  );
}

/** How long ago, refreshed every minute. */
export function useNow(intervalMs = 60_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export function CaseTable({
  cases,
  stores,
  show = 'owner',
  caption,
}: {
  cases: CaseSummary[];
  stores: Map<number, StoreRow>;
  show?: 'owner' | 'creator' | 'both';
  caption: string;
}) {
  const now = useNow();
  const names = useLabels();
  const table = useRef<HTMLTableElement>(null);
  return (
    <>
    <div className="export-row">
      <ExportButton table={table} name={caption} />
    </div>
    <div className="table-wrap">
      <table className="hub-table" ref={table}>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Case</th>
            <th scope="col">Customer</th>
            <th scope="col">Store</th>
            <th scope="col">Status</th>
            <th scope="col">Clock</th>
            <th scope="col">Why</th>
            {show !== 'creator' && <th scope="col">With</th>}
            {show !== 'owner' && <th scope="col">Sent by</th>}
            <th scope="col">Waiting</th>
          </tr>
        </thead>
        <tbody>
          {cases.map(c => (
            <tr
              key={c.id}
              className={c.clock?.state === 'missed' ? 'attention' : c.clock?.state === 'warning' || (!c.accepted && !c.closedAt) ? 'attention-warn' : undefined}>
              <td>
                <Link className="case-link" to="/cases/$caseId" params={{caseId: String(c.id)}}>
                  {c.number}
                </Link>
              </td>
              <td>
                {c.customerName}
                <div className="muted nowrap">{formatPhone(c.phone)}</div>
              </td>
              <td>
                <StoreChip store={stores.get(c.storeId)} />
              </td>
              <td>
                <div className="chips">
                  <StatusChip type={c.type} status={c.status} />
                  <AcceptChip accepted={c.accepted} closed={c.closedAt !== null} />
                </div>
              </td>
              <td>{c.clock ? <ClockPill clock={c.clock} type={c.type} /> : <span className="muted">—</span>}</td>
              <td>{c.type === 'hot' ? names.reason(c.reason) : `CSI · ${labels.sentiment(c.sentiment)}`}</td>
              {show !== 'creator' && <td>{c.owner.name}</td>}
              {show !== 'owner' && <td>{c.createdBy.name}</td>}
              <td className="nowrap">
                {c.closedAt ? (
                  <span className="muted">Closed {formatWhen(c.closedAt)}</span>
                ) : (
                  <span title={`With the current owner since ${formatWhen(c.ownerSince)}`}>
                    {formatDuration(now - new Date(c.ownerSince).getTime())}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </>
  );
}

/** The footer of every hub screen: version, name, when the data was read. */
export function HubFooter({asOf}: {asOf: number}) {
  return (
    <footer className="hub-footer">
      {HUB_VERSION} · {HUB_NAME} · data as of {asOf ? formatWhen(new Date(asOf).toISOString()) : '—'}
    </footer>
  );
}

/** "in 12 min", "Tue 9:15 AM": when a deadline is, in words. */
function dueWords(dueIso: string, now: number) {
  const ms = new Date(dueIso).getTime() - now;
  if (ms <= 0) return `missed by ${formatDuration(-ms)}`;
  if (ms < 12 * 3_600_000) return `due in ${formatDuration(ms)}`;
  return `due ${formatWhen(dueIso)}`;
}

/**
 * One clock, as a pill: a dot, the clock's name and its state in words
 * (never color alone). Green on time, amber under 25% left, red missed.
 */
export function ClockPill({clock, type, showOwner = false}: {clock: ClockView; type: string; showOwner?: boolean}) {
  const now = useNow();
  const name = clockLabel(type, clock.kind);
  let words: string;
  if (clock.state === 'met') {
    words = `done in ${formatDuration(new Date(clock.doneAt!).getTime() - new Date(clock.startedAt).getTime())}`;
  } else if (clock.state === 'missed') {
    words = clock.doneAt
      ? `missed, done ${formatDuration(new Date(clock.doneAt).getTime() - new Date(clock.dueAt).getTime())} late`
      : dueWords(clock.dueAt, now) + (clock.escalatedAt ? `, ${clock.escalatedTo?.name ?? 'manager'} alerted` : '');
  } else {
    words = dueWords(clock.dueAt, now);
  }
  return (
    <span className="clock" data-state={clock.state} title={`Due ${formatWhen(clock.dueAt)}`}>
      <span className="dot" aria-hidden="true" />
      <span>
        {clock.state === 'met' ? 'Done' : clock.state === 'missed' ? 'Missed' : clock.state === 'warning' ? 'Running low' : 'On time'}:{' '}
        {name}
        {showOwner ? ` (${clock.owner.name})` : ''} · {words}
        {clock.overdue ? ' · OVERDUE' : ''}
      </span>
    </span>
  );
}

/** The bell: unread alerts, on every screen. */
export function Bell() {
  const count = useQuery(alertCountQuery);
  const unread = count.data?.unread ?? 0;
  const label = unread ? `Alerts: ${unread > 99 ? '99+' : unread} unread` : 'Alerts: none unread';
  return (
    <Link className="bell" to="/alerts" aria-label={label} title={label}>
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
        <path
          fill="currentColor"
          d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-6V11a7 7 0 0 0-5.5-6.84V3a1.5 1.5 0 0 0-3 0v1.16A7 7 0 0 0 5 11v5l-2 2v1h18v-1l-2-2Z"
        />
      </svg>
      {unread > 0 && <span className="bell-count">{unread > 99 ? '99+' : unread}</span>}
    </Link>
  );
}
