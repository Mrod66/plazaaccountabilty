/**
 * CSV in and out (RFC 4180): quoted fields, doubled quotes, commas and line
 * breaks inside quotes, CRLF or LF, and Excel's byte-order mark. Browser-safe.
 */

/** Rows of fields. Blank lines are skipped. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === '') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some(f => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some(f => f.trim() !== '')) rows.push(row);
  return rows;
}

/**
 * One CSV field. A value a spreadsheet would run as a formula (`=`, `+`, `-`,
 * `@`, tab, carriage return first) gets a leading apostrophe: an export can
 * never carry a formula into someone's Excel.
 */
export function csvField(value: unknown): string {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?%?$/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** A whole CSV file (with a byte-order mark so Excel reads it as UTF-8). */
export function toCsv(header: string[], rows: unknown[][]): string {
  return '﻿' + [header, ...rows].map(r => r.map(csvField).join(',')).join('\r\n') + '\r\n';
}

/** The CSV columns the people import reads (build prompt section 12), in order. */
export const PEOPLE_CSV_COLUMNS = ['First name', 'Last name', 'Email', 'Role(s)', 'Store(s)', 'Department', 'Manager email', 'Active'] as const;

/** One person as read from the CSV, before checking. */
export type PeopleCsvRow = {
  line: number;
  firstName: string;
  lastName: string;
  email: string;
  roles: string;
  stores: string;
  department: string;
  managerEmail: string;
  active: string;
};

/**
 * Reads the people CSV: the header row names the columns (any order, any
 * case); every later row is one person. Throws words for people when a
 * required column is missing.
 */
export function readPeopleCsv(text: string): PeopleCsvRow[] {
  const rows = parseCsv(text);
  if (!rows.length) throw new Error('The file is empty.');
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
  const header = rows[0]!.map(norm);
  const at = (name: string) => header.indexOf(norm(name));
  const missing = PEOPLE_CSV_COLUMNS.filter(c => at(c) < 0 && c !== 'Manager email' && c !== 'Active' && c !== 'Last name');
  if (missing.length) throw new Error(`The file has no ${missing.map(m => `"${m}"`).join(', ')} column. The first row must name the columns.`);
  const get = (row: string[], name: string) => (at(name) >= 0 ? (row[at(name)] ?? '').trim() : '');
  return rows.slice(1).map((row, i) => ({
    line: i + 2,
    firstName: get(row, 'First name'),
    lastName: get(row, 'Last name'),
    email: get(row, 'Email').toLowerCase(),
    roles: get(row, 'Role(s)'),
    stores: get(row, 'Store(s)'),
    department: get(row, 'Department'),
    managerEmail: get(row, 'Manager email').toLowerCase(),
    active: get(row, 'Active'),
  }));
}

/** "Sales Manager; BDC Manager" / "Honda, Kia" / "Honda|Kia" → items. */
export const splitList = (s: string) =>
  s
    .split(/[;|,/]/)
    .map(x => x.trim())
    .filter(Boolean);
