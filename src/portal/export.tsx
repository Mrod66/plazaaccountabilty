import {type RefObject, useState} from 'react';

import {toCsv} from '../lib/csv';
import {api} from './api';
import {useMe} from './shared';
import {Button} from './ui';

/**
 * CSV export (build prompt section 12): any list or report table, exactly as
 * it is on screen (its sort order, its words: "62% (31 of 50 cases)"), so the
 * file and the screen always agree. People who may export (site:hub:export)
 * see the button; every export is written to the activity log.
 */

const cellText = (cell: Element) => (cell.textContent ?? '').replace(/[▲▼]/g, '').replace(/\s+/g, ' ').trim();

/** Today's date for a file name: `2026-10-29`. */
const stamp = () => new Date().toISOString().slice(0, 10);

export function downloadCsv(fileName: string, header: string[], rows: unknown[][], what: string) {
  const blob = new Blob([toCsv(header, rows)], {type: 'text/csv;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${fileName.replace(/[^\w-]+/g, '-').replace(/-+/g, '-')}-${stamp()}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  // The activity log line; the download does not wait for it.
  void api.settings['export-log'].$post({json: {what: what.slice(0, 60), rows: rows.length}}).catch(() => undefined);
}

/** The table's header and rows, as text. */
export function tableRows(table: HTMLTableElement): {header: string[]; rows: string[][]} {
  const header = [...table.querySelectorAll('thead th')].map(cellText);
  const rows = [...table.querySelectorAll('tbody tr')].map(tr => [...tr.querySelectorAll('th, td')].map(cellText));
  // Columns with no header (row buttons) are left out.
  const keep = header.map((h, i) => (h ? i : -1)).filter(i => i >= 0);
  return {header: keep.map(i => header[i]!), rows: rows.map(r => keep.map(i => r[i] ?? ''))};
}

/** "Export CSV" for one table, shown only to people who may export. */
export function ExportButton({table, name}: {table: RefObject<HTMLTableElement | null>; name: string}) {
  const me = useMe();
  const [busy, setBusy] = useState(false);
  if (!me.data?.abilities.exportData) return null;
  return (
    <Button
      variant="ghost"
      size="sm"
      pending={busy}
      pendingLabel="Exporting…"
      className="export-button"
      onClick={() => {
        if (!table.current) return;
        setBusy(true);
        const {header, rows} = tableRows(table.current);
        downloadCsv(name, header, rows, name);
        setBusy(false);
      }}>
      Export CSV
    </Button>
  );
}
