import {Link} from '@tanstack/react-router';
import {type ReactNode, useMemo, useRef, useState} from 'react';

import {DATE_PRESETS, formatDate, presetRange, type StoreRow} from '../lib/hub';
import {ExportButton} from './export';

/**
 * The pieces every report screen is made of. Two rules hold everywhere:
 *   - every percentage carries its count: "62% (31 of 50)";
 *   - every number on the Leadership Dashboard is a link to the cases behind it.
 */

export type ReportSearch = {preset?: string; from?: string; to?: string; store?: string; department?: string; type?: string};

/** The dates a search means: a preset's, or the custom ones. */
export function rangeOf(search: ReportSearch) {
  const preset = search.preset ?? 'month';
  if (preset === 'custom' && search.from && search.to) return {from: search.from, to: search.to};
  return presetRange(preset);
}

export type Drill = {type: 'hot' | 'csi'; measure: string; dim?: string; key?: string | number | null};

/** Where a number's case list lives: the same filter, plus the measure (and the row's group). */
export function drillSearch(search: ReportSearch, d: Drill) {
  const {from, to} = rangeOf(search);
  return {
    type: d.type,
    measure: d.measure,
    from,
    to,
    store: search.store ?? '',
    department: search.department ?? '',
    ...(d.dim ? {dim: d.dim, key: d.key === null || d.key === undefined ? 'null' : String(d.key)} : {}),
  };
}

const plural = (n: number, noun: string) => `${n.toLocaleString('en-US')} ${noun}${n === 1 ? '' : 's'}`;

/** A count; a link to its cases when `drill` is given. */
export function Count({n, drill, search, noun}: {n: number; drill?: Drill; search?: ReportSearch; noun?: string}) {
  const text = noun ? plural(n, noun) : n.toLocaleString('en-US');
  if (!drill || !search) return <span className="num">{text}</span>;
  return (
    <Link className="num-link" to="/dashboard/cases" search={drillSearch(search, drill)} title="See these cases">
      {text}
    </Link>
  );
}

export const percent = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : '—');

/** "62% (31 of 50 cases)": the rate, and both counts (each a link when drillable). */
export function Rate({
  n,
  of,
  noun = 'case',
  drill,
  ofDrill,
  search,
}: {
  n: number;
  of: number;
  noun?: string;
  drill?: Drill;
  ofDrill?: Drill;
  search?: ReportSearch;
}) {
  return (
    <span className="rate">
      <strong>{percent(n, of)}</strong>{' '}
      <span className="out-of">
        (<Count n={n} drill={drill} search={search} /> of <Count n={of} drill={ofDrill} search={search} noun={noun} />)
      </span>
    </span>
  );
}

/** One headline number: label, the number, its "out of" line, what to do with it. */
export function Tile({label, children, hint}: {label: string; children: ReactNode; hint?: string}) {
  return (
    <div className="stat report-tile">
      <p className="stat-label">{label}</p>
      <div className="stat-value">{children}</div>
      {hint && <p className="stat-hint">{hint}</p>}
    </div>
  );
}

/** The two lines every report section carries. */
export function Explain({shows, todo}: {shows: string; todo: string}) {
  return (
    <div className="explain">
      <p>
        <strong>What this shows:</strong> {shows}
      </p>
      <p>
        <strong>What to do with it:</strong> {todo}
      </p>
    </div>
  );
}

export type Column<T> = {
  key: string;
  label: string;
  /** What the column sorts by. */
  value: (row: T) => number | string;
  render: (row: T) => ReactNode;
  numeric?: boolean;
};

/** A table sortable by any column (click a header; again to reverse). */
export function SortableTable<T>({
  rows,
  columns,
  caption,
  initial,
  initialDir,
  rowKey,
}: {
  rows: T[];
  columns: Column<T>[];
  caption: string;
  /** The column sorted first (largest first, unless `initialDir` is 1). */
  initial?: string;
  initialDir?: 1 | -1;
  rowKey: (row: T) => string;
}) {
  const table = useRef<HTMLTableElement>(null);
  const [sort, setSort] = useState<{key: string; dir: 1 | -1}>({key: initial ?? columns[0]!.key, dir: initialDir ?? (initial ? -1 : 1)});
  const sorted = useMemo(() => {
    const column = columns.find(c => c.key === sort.key) ?? columns[0]!;
    return [...rows].sort((a, b) => {
      const x = column.value(a);
      const y = column.value(b);
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * sort.dir;
    });
  }, [rows, columns, sort]);
  if (!rows.length) return <p className="muted">Nothing in this range.</p>;
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
            {columns.map(c => {
              const active = sort.key === c.key;
              return (
                <th key={c.key} scope="col" className={c.numeric ? 'num' : undefined} aria-sort={active ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}>
                  <button
                    type="button"
                    className="sort-button"
                    onClick={() => setSort(s => ({key: c.key, dir: s.key === c.key ? (s.dir === 1 ? -1 : 1) : c.numeric ? -1 : 1}))}>
                    {c.label}
                    <span aria-hidden="true">{active ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}</span>
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map(row => (
            <tr key={rowKey(row)}>
              {columns.map(c => (
                <td key={c.key} className={c.numeric ? 'num' : undefined}>
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </>
  );
}

/** Rate as a sortable number (no denominator sorts last). */
export const rateValue = (n: number, of: number) => (of ? n / of : -1);

/** The filters on top of a report: date range, store, and (optionally) department and case type. */
export function ReportFilters({
  search,
  stores,
  onChange,
  withType = true,
  pending,
}: {
  search: ReportSearch;
  stores: StoreRow[];
  onChange: (next: ReportSearch) => void;
  withType?: boolean;
  pending?: boolean;
}) {
  const preset = search.preset ?? 'month';
  const range = rangeOf(search);
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to);
  const badRange = preset === 'custom' && (!from || !to || from > to);
  return (
    <form
      className="toolbar app-card"
      noValidate
      onSubmit={event => {
        event.preventDefault();
        if (!badRange) onChange({...search, preset: 'custom', from, to});
      }}>
      <div className="field">
        <label htmlFor="f-preset">Date range</label>
        <select
          id="f-preset"
          value={preset}
          onChange={e => {
            const next = e.target.value;
            if (next === 'custom') {
              onChange({...search, preset: 'custom', from: range.from, to: range.to});
            } else onChange({...search, preset: next, from: undefined, to: undefined});
          }}>
          {DATE_PRESETS.map(p => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </div>
      {preset === 'custom' && (
        <>
          <div className="field">
            <label htmlFor="f-from">From</label>
            <input id="f-from" type="date" value={from} onChange={e => setFrom(e.target.value)} aria-invalid={badRange || undefined} aria-describedby={badRange ? 'f-range-error' : undefined} />
          </div>
          <div className="field">
            <label htmlFor="f-to">To</label>
            <input id="f-to" type="date" value={to} onChange={e => setTo(e.target.value)} aria-invalid={badRange || undefined} />
          </div>
        </>
      )}
      <div className="field">
        <label htmlFor="f-store">Store</label>
        <select id="f-store" value={search.store ?? ''} onChange={e => onChange({...search, store: e.target.value})}>
          <option value="">All Plaza</option>
          {stores.map(s => (
            <option key={s.id} value={String(s.id)}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      {withType && (
        <>
          <div className="field">
            <label htmlFor="f-dept">Department</label>
            <select id="f-dept" value={search.department ?? ''} onChange={e => onChange({...search, department: e.target.value})}>
              <option value="">Sales and service</option>
              <option value="sales">Sales</option>
              <option value="service">Service</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="f-type">Case type</label>
            <select id="f-type" value={search.type ?? ''} onChange={e => onChange({...search, type: e.target.value})}>
              <option value="">Both</option>
              <option value="hot">Hot Prospects</option>
              <option value="csi">CSI Recovery</option>
            </select>
          </div>
        </>
      )}
      {preset === 'custom' && (
        <button type="submit" className="button ghost" disabled={badRange}>
          Apply dates
        </button>
      )}
      {pending && (
        <span className="muted" role="status">
          Updating…
        </span>
      )}
      {badRange && (
        <p className="field-error wide-error" id="f-range-error" role="alert">
          Pick a start date on or before the end date.
        </p>
      )}
      <p className="muted wide-error">
        Counting the cases opened {formatDate(range.from)} to {formatDate(range.to)} (Eastern time), and what has happened to them since.
      </p>
    </form>
  );
}

export type TrendPoint = {week: string; a: {n: number; of: number}; b: {n: number; of: number}};

/**
 * A weekly trend of two rates on ONE 0–100% axis: series A solid Plaza Blue,
 * series B dashed Steel (dash + direct labels, so identity is never color
 * alone). Hover or focus a week for its numbers; a table view sits below.
 */
export function TrendChart({points, aLabel, bLabel, title}: {points: TrendPoint[]; aLabel: string; bLabel: string; title: string}) {
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const W = 720;
  const H = 240;
  const pad = {l: 44, r: 150, t: 16, b: 34};
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const x = (i: number) => pad.l + (points.length <= 1 ? iw / 2 : (i * iw) / (points.length - 1));
  const y = (v: number) => pad.t + ih - (v / 100) * ih;
  const val = (p: {n: number; of: number}) => (p.of ? (p.n / p.of) * 100 : null);
  const path = (pick: (p: TrendPoint) => {n: number; of: number}) => {
    let d = '';
    let pen = false;
    points.forEach((p, i) => {
      const v = val(pick(p));
      if (v === null) {
        pen = false;
        return;
      }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };
  const lastOf = (pick: (p: TrendPoint) => {n: number; of: number}) => {
    for (let i = points.length - 1; i >= 0; i--) {
      const v = val(pick(points[i]!));
      if (v !== null) return {i, v};
    }
    return null;
  };
  const la = lastOf(p => p.a);
  const lb = lastOf(p => p.b);
  // Keep the two end labels apart.
  let ya = la ? y(la.v) : 0;
  let yb = lb ? y(lb.v) : 0;
  if (la && lb && Math.abs(ya - yb) < 16) {
    if (ya <= yb) {
      ya -= 8;
      yb += 8;
    } else {
      ya += 8;
      yb -= 8;
    }
  }
  const week = (iso: string) => `Week of ${formatDate(iso)}`;
  const describe = (p: TrendPoint) =>
    `${week(p.week)}: ${aLabel} ${percent(p.a.n, p.a.of)} (${p.a.n} of ${p.a.of}); ${bLabel} ${percent(p.b.n, p.b.of)} (${p.b.n} of ${p.b.of})`;

  if (!points.length) return <p className="muted">No weeks in this range yet.</p>;
  return (
    <figure className="trend">
      <figcaption className="trend-head">
        <span>{title}</span>
        <span className="legend">
          <span className="legend-item">
            <svg width="28" height="10" aria-hidden="true">
              <line x1="0" y1="5" x2="28" y2="5" className="series-a" />
            </svg>
            {aLabel}
          </span>
          <span className="legend-item">
            <svg width="28" height="10" aria-hidden="true">
              <line x1="0" y1="5" x2="28" y2="5" className="series-b" />
            </svg>
            {bLabel}
          </span>
        </span>
        <button type="button" className="button link small-button" onClick={() => setAsTable(v => !v)} aria-pressed={asTable}>
          {asTable ? 'Show the chart' : 'Show as a table'}
        </button>
      </figcaption>
      {asTable ? (
        <div className="table-wrap">
          <table className="hub-table">
            <thead>
              <tr>
                <th scope="col">Week</th>
                <th scope="col" className="num">
                  {aLabel}
                </th>
                <th scope="col" className="num">
                  {bLabel}
                </th>
              </tr>
            </thead>
            <tbody>
              {points.map(p => (
                <tr key={p.week}>
                  <td>{week(p.week)}</td>
                  <td className="num">
                    {percent(p.a.n, p.a.of)} ({p.a.n} of {p.a.of})
                  </td>
                  <td className="num">
                    {percent(p.b.n, p.b.of)} ({p.b.n} of {p.b.of})
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="trend-plot">
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}. ${points.map(describe).join('. ')}`}>
            {[0, 25, 50, 75, 100].map(t => (
              <g key={t}>
                <line x1={pad.l} x2={pad.l + iw} y1={y(t)} y2={y(t)} className="grid" />
                <text x={pad.l - 8} y={y(t) + 4} className="axis" textAnchor="end">
                  {t}%
                </text>
              </g>
            ))}
            {points.map((p, i) =>
              points.length <= 8 || i % Math.ceil(points.length / 8) === 0 ? (
                <text key={p.week} x={x(i)} y={H - 10} className="axis" textAnchor="middle">
                  {formatDate(p.week).replace(/, \d{4}$/, '')}
                </text>
              ) : null
            )}
            {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + ih} className="crosshair" />}
            <path d={path(p => p.a)} className="series-a" fill="none" />
            <path d={path(p => p.b)} className="series-b" fill="none" />
            {points.map((p, i) => {
              const va = val(p.a);
              const vb = val(p.b);
              return (
                <g key={p.week}>
                  {va !== null && <circle cx={x(i)} cy={y(va)} r={4} className="dot-a" />}
                  {vb !== null && <rect x={x(i) - 4} y={y(vb) - 4} width={8} height={8} className="dot-b" />}
                </g>
              );
            })}
            {la && (
              <text x={x(la.i) + 10} y={ya + 4} className="end-label">
                {aLabel} {Math.round(la.v)}%
              </text>
            )}
            {lb && (
              <text x={x(lb.i) + 10} y={yb + 4} className="end-label">
                {bLabel} {Math.round(lb.v)}%
              </text>
            )}
            {points.map((p, i) => {
              const w = points.length <= 1 ? iw : iw / (points.length - 1);
              return (
                <rect
                  key={`hit-${p.week}`}
                  x={x(i) - w / 2}
                  y={pad.t}
                  width={w}
                  height={ih}
                  className="hit"
                  tabIndex={0}
                  aria-label={describe(p)}
                  onMouseEnter={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                  onBlur={() => setHover(null)}
                />
              );
            })}
          </svg>
          {hover !== null && (
            <div className="tooltip" role="status">
              <strong>{week(points[hover]!.week)}</strong>
              <div>
                {aLabel}: {percent(points[hover]!.a.n, points[hover]!.a.of)} ({points[hover]!.a.n} of {points[hover]!.a.of})
              </div>
              <div>
                {bLabel}: {percent(points[hover]!.b.n, points[hover]!.b.of)} ({points[hover]!.b.n} of {points[hover]!.b.of})
              </div>
            </div>
          )}
        </div>
      )}
    </figure>
  );
}
