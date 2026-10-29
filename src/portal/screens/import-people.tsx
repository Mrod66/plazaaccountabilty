import {useMutation, useQueryClient} from '@tanstack/react-query';
import {useRef, useState} from 'react';

import {PEOPLE_CSV_COLUMNS, type PeopleCsvRow, readPeopleCsv} from '../../lib/csv';
import type {ImportCheck} from '../../server/routes/settings';
import {api, ApiError, read} from '../api';
import {downloadCsv} from '../export';
import {Explain} from '../report-ui';
import {ErrorNote, useMe} from '../shared';
import {Button} from '../ui';

type Result = {line: number; email: string; userId: number | null; status: 'saved' | 'skipped' | 'error'; message?: string; roles: string[]; active: boolean};
type Outcome = {line: number; email: string; ok: boolean; message: string};

const CHUNK = 50;
const ACTION_WORDS: Record<ImportCheck['action'], string> = {add: 'Add', update: 'Update', same: 'No change', error: 'Error (skipped)'};

/** Runs `work` over `items`, `limit` at a time. */
async function inBatches<T>(items: T[], limit: number, work: (item: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += limit) await Promise.all(items.slice(i, i + limit).map(work));
}

/**
 * Admin → Import people (build prompt section 12): First name, Last name,
 * Email, Role(s), Store(s), Department, Manager email, Active. Check first
 * (nothing is saved), then apply the good rows. Safe to run again: people are
 * matched by email, never deleted; "Active: No" deactivates (history stays).
 */
export function ImportPeople() {
  const queryClient = useQueryClient();
  const me = useMe();
  const file = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<PeopleCsvRow[] | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [checks, setChecks] = useState<ImportCheck[] | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome[] | null>(null);

  const preview = useMutation({
    mutationFn: (list: PeopleCsvRow[]) => read<{rows: ImportCheck[]}>(api.settings.people.preview.$post({json: {rows: list} as never})),
    onSuccess: data => setChecks(data.rows),
  });

  const apply = useMutation({
    mutationFn: async (list: PeopleCsvRow[]) => {
      const chunks: PeopleCsvRow[][] = [];
      for (let i = 0; i < list.length; i += CHUNK) chunks.push(list.slice(i, i + CHUNK));
      let results: Result[] = [];
      // Two passes: the second links managers who were added later in the same file.
      for (const pass of [1, 2]) {
        results = [];
        for (const [i, chunk] of chunks.entries()) {
          setProgress(`Saving people: pass ${pass} of 2, part ${i + 1} of ${chunks.length}…`);
          const answer = await read<{results: Result[]}>(api.settings.people.apply.$post({json: {rows: chunk} as never}));
          results.push(...answer.results);
        }
      }
      // Roles and active state go through the managed, audited admin API.
      const out: Outcome[] = [];
      const byLine = new Map((checks ?? []).map(c => [c.line, c]));
      const saved = results.filter(r => r.status === 'saved' && r.userId);
      let done = 0;
      await inBatches(saved, 4, async r => {
        const check = byLine.get(r.line);
        const messages: string[] = [];
        let ok = true;
        const same = (a: string[], b: string[]) => [...a].sort().join(',') === [...b].sort().join(',');
        try {
          if (r.userId !== me.data?.viewer.id) {
            if (!check || !same(check.currentRoles, r.roles)) {
              await read(api.admin.users[':id'].roles.$put({param: {id: String(r.userId)}, json: {roles: r.roles}}));
              messages.push('roles set');
            }
            const isActive = check?.currentActive ?? true;
            if (isActive !== r.active) {
              await read(api.admin.users[':id'].$patch({param: {id: String(r.userId)}, json: {status: r.active ? 'active' : 'suspended'}}));
              messages.push(r.active ? 'reactivated' : 'deactivated');
            }
          }
        } catch (error) {
          ok = false;
          messages.push(error instanceof ApiError ? error.message : 'Could not set roles or status.');
        }
        done++;
        setProgress(`Setting roles and active state: ${done} of ${saved.length}…`);
        out.push({line: r.line, email: r.email, ok, message: messages.length ? messages.join(', ') : 'saved'});
      });
      for (const r of results.filter(x => x.status !== 'saved')) out.push({line: r.line, email: r.email, ok: false, message: r.message ?? 'Skipped.'});
      return out.sort((a, b) => a.line - b.line);
    },
    onSuccess: async out => {
      setOutcome(out);
      setProgress(null);
      await queryClient.invalidateQueries({queryKey: ['hub']});
      await queryClient.invalidateQueries({queryKey: ['users']});
    },
    onError: () => setProgress(null),
  });

  const pick = async (input: HTMLInputElement) => {
    setFileError(null);
    setChecks(null);
    setOutcome(null);
    setRows(null);
    const chosen = input.files?.[0];
    if (!chosen) return;
    if (chosen.size > 2_000_000) return setFileError('That file is over 2 MB. A people list is far smaller: check it is the right file.');
    try {
      const list = readPeopleCsv(await chosen.text());
      if (!list.length) return setFileError('The file has a header row but no people.');
      if (list.length > 1000) return setFileError(`The file has ${list.length} rows; import at most 1,000 at a time.`);
      setRows(list);
      preview.mutate(list);
    } catch (error) {
      setFileError(error instanceof Error ? error.message : 'Could not read that file.');
    }
  };

  const exportPeople = useMutation({
    mutationFn: () =>
      read<{people: {firstName: string; lastName: string; email: string; roles: string[]; stores: string[]; department: string; managerEmail: string; active: boolean}[]}>(
        api.settings.people.export.$get()
      ),
    onSuccess: ({people}) =>
      downloadCsv(
        'plaza-people',
        [...PEOPLE_CSV_COLUMNS],
        people.map(p => [p.firstName, p.lastName, p.email, p.roles.join('; '), p.stores.join('; '), p.department, p.managerEmail, p.active ? 'Yes' : 'No']),
        'People'
      ),
  });

  const counts = checks
    ? (['add', 'update', 'same', 'error'] as const).map(a => [a, checks.filter(c => c.action === a).length] as const)
    : [];
  const good = checks?.filter(c => c.action === 'add' || c.action === 'update').length ?? 0;

  return (
    <div className="app-page">
      <section className="app-card">
        <h2>Import people from a CSV file</h2>
        <Explain
          shows="The columns, in any order: First name, Last name, Email, Role(s), Store(s), Department, Manager email, Active. Several roles or stores: separate them with a semicolon, like “Sales Manager; BDC Manager”."
          todo="Check the file first: nothing is saved until you press Import. People are matched by email; nobody is ever deleted, and “Active: No” deactivates someone (their history stays)."
        />
        <div className="actions">
          <Button
            variant="ghost"
            onClick={() => downloadCsv('plaza-people-template', [...PEOPLE_CSV_COLUMNS], [['Saad', 'Miraz', 'saadm@plazacars.com', 'Sales Manager', 'Plaza Honda', 'Sales', 'uniceb@plazacars.com', 'Yes']], 'People template')}>
            Download a template
          </Button>
          <Button variant="ghost" pending={exportPeople.isPending} pendingLabel="Exporting…" onClick={() => exportPeople.mutate()}>
            Download everyone (same columns)
          </Button>
        </div>
        {exportPeople.error && <ErrorNote error={exportPeople.error} />}
        <div className="field gap-top">
          <label htmlFor="f-csv">CSV file</label>
          <input
            id="f-csv"
            ref={file}
            type="file"
            accept=".csv,text/csv"
            aria-invalid={fileError ? true : undefined}
            aria-describedby={fileError ? 'f-csv-error' : 'f-csv-hint'}
            disabled={preview.isPending || apply.isPending}
            onChange={e => void pick(e.currentTarget)}
          />
          {fileError ? (
            <p className="field-error" id="f-csv-error" role="alert">
              {fileError}
            </p>
          ) : (
            <p className="field-hint" id="f-csv-hint">
              Save the spreadsheet as “CSV (Comma delimited)”. Up to 1,000 people.
            </p>
          )}
        </div>
        {preview.isPending && <p className="muted">Checking {rows?.length ?? ''} rows…</p>}
        {preview.error && <ErrorNote error={preview.error} />}
      </section>

      {checks && !outcome && (
        <section className="app-card">
          <div className="section-head">
            <h2>Check before importing</h2>
            <p className="muted" role="status">
              {counts.map(([a, n]) => `${n} ${ACTION_WORDS[a].toLowerCase()}`).join(' · ')}
            </p>
          </div>
          <div className="table-wrap">
            <table className="hub-table">
              <thead>
                <tr>
                  <th scope="col">Row</th>
                  <th scope="col">Person</th>
                  <th scope="col">What happens</th>
                  <th scope="col">Details</th>
                </tr>
              </thead>
              <tbody>
                {checks.map(c => (
                  <tr key={c.line} className={c.action === 'error' ? 'attention' : undefined}>
                    <td className="num">{c.line}</td>
                    <td>
                      <strong>{c.name || '—'}</strong>
                      <div className="muted">{c.email}</div>
                    </td>
                    <td>{ACTION_WORDS[c.action]}</td>
                    <td>
                      {[...c.errors, ...c.changes, ...c.notes].map(text => (
                        <div key={text} className={c.errors.includes(text) ? 'field-error' : undefined}>
                          {text}
                        </div>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {apply.error && <ErrorNote error={apply.error} />}
          {progress && (
            <p className="muted" role="status">
              {progress}
            </p>
          )}
          <div className="actions gap-top">
            <Button disabled={!good} pending={apply.isPending} pendingLabel="Importing…" onClick={() => rows && apply.mutate(rows)}>
              {good ? `Import ${good} ${good === 1 ? 'person' : 'people'}` : 'Nothing to import'}
            </Button>
            <Button
              variant="ghost"
              disabled={apply.isPending}
              onClick={() => {
                setChecks(null);
                setRows(null);
                if (file.current) file.current.value = '';
              }}>
              Cancel
            </Button>
          </div>
        </section>
      )}

      {outcome && (
        <section className="app-card">
          <h2>Import finished</h2>
          <p role="status">
            {outcome.filter(o => o.ok).length} saved · {outcome.filter(o => !o.ok).length} not saved. The activity log has a line for it.
          </p>
          <div className="table-wrap">
            <table className="hub-table">
              <thead>
                <tr>
                  <th scope="col">Row</th>
                  <th scope="col">Email</th>
                  <th scope="col">Result</th>
                </tr>
              </thead>
              <tbody>
                {outcome.map(o => (
                  <tr key={o.line} className={o.ok ? undefined : 'attention'}>
                    <td className="num">{o.line}</td>
                    <td>{o.email}</td>
                    <td>{o.ok ? `Saved: ${o.message}` : o.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
