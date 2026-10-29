import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {useState} from 'react';

import {api, ApiError, read} from '../api';
import {type PickItem, type PickLists, listsQuery} from '../queries';
import {Explain} from '../report-ui';
import {ErrorNote} from '../shared';
import {Button, Field, rules, useForm} from '../ui';

const LISTS: {key: keyof PickLists; title: string; shows: string}[] = [
  {key: 'reason', title: 'Escalation reasons (Hot Prospect)', shows: 'Why a rep needs a manager. Reps pick one on every Hot Prospect.'},
  {key: 'lost_reason', title: 'Lost reasons', shows: 'Why a Hot Prospect was lost. Picked when closing as Lost.'},
  {key: 'problem', title: 'Problem types (CSI)', shows: 'What went wrong for an unhappy customer. CSI reps pick one or more.'},
];

/**
 * Admin → Pick lists: the escalation reasons, lost reasons and CSI problem
 * types the forms offer. Rename, reorder, add; switch an option off instead of
 * deleting it (old cases keep showing it, nobody can pick it any more).
 */
export function ListsAdmin() {
  const lists = useQuery(listsQuery);
  return (
    <div className="app-page">
      <section className="app-card">
        <Explain
          shows="The choices on the case forms. Reports group by them, so a renamed option keeps its history."
          todo="Switch an option off rather than renaming it to mean something else."
        />
      </section>
      {lists.error && <ErrorNote error={lists.error} />}
      {lists.isPending && <p className="muted">Loading…</p>}
      {lists.data && LISTS.map(l => <ListCard key={l.key} list={l.key} title={l.title} shows={l.shows} items={lists.data.lists[l.key]} />)}
    </div>
  );
}

function ListCard({list, title, shows, items}: {list: keyof PickLists; title: string; shows: string; items: PickItem[]}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<number | null>(null);
  const [label, setLabel] = useState('');
  const form = useForm({label: ''}, {label: [rules.required('Enter the option, like “Rebate expired”.'), rules.maxLength(60)]});
  const done = (data: {lists: PickLists}) => queryClient.setQueryData(listsQuery.queryKey, data);
  const add = useMutation({
    mutationFn: (value: string) => read<{lists: PickLists}>(api.settings.lists.$post({json: {list, label: value} as never})),
    onSuccess: data => {
      done(data);
      form.reset();
    },
    onError: error => {
      if (error instanceof ApiError) form.setServerErrors(error.fields as {label?: string});
    },
  });
  const change = useMutation({
    mutationFn: ({id, body}: {id: number; body: {label?: string; active?: boolean; move?: 'up' | 'down'}}) =>
      read<{lists: PickLists}>(api.settings.lists[':id'].$patch({param: {id: String(id)}, json: body as never})),
    onSuccess: data => {
      done(data);
      setEditing(null);
    },
  });
  const busyId = change.isPending ? change.variables?.id : null;
  return (
    <section className="app-card">
      <h2>{title}</h2>
      <p className="muted">{shows}</p>
      <div className="table-wrap">
        <table className="hub-table">
          <thead>
            <tr>
              <th scope="col">Option</th>
              <th scope="col">Offered</th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => {
              const busy = busyId === item.id;
              return (
                <tr key={item.id} aria-busy={busy || undefined}>
                  <td>
                    {editing === item.id ? (
                      <div className="inline-fields">
                        <label className="sr-only" htmlFor={`opt-${item.id}`}>
                          New wording for {item.label}
                        </label>
                        <input id={`opt-${item.id}`} className="wide-input" value={label} maxLength={60} onChange={e => setLabel(e.target.value)} />
                        <Button size="sm" disabled={!label.trim()} pending={busy} pendingLabel="Saving…" onClick={() => change.mutate({id: item.id, body: {label: label.trim()}})}>
                          Save
                        </Button>
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(null)}>
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      item.label
                    )}
                  </td>
                  <td>{item.active ? <span className="chip chip-good">On</span> : <span className="chip">Off</span>}</td>
                  <td className="nowrap">
                    <Button size="sm" variant="link" disabled={busy || i === 0} aria-label={`Move ${item.label} up`} onClick={() => change.mutate({id: item.id, body: {move: 'up'}})}>
                      ↑
                    </Button>
                    <Button
                      size="sm"
                      variant="link"
                      disabled={busy || i === items.length - 1}
                      aria-label={`Move ${item.label} down`}
                      onClick={() => change.mutate({id: item.id, body: {move: 'down'}})}>
                      ↓
                    </Button>
                    <Button size="sm" variant="link" disabled={busy} onClick={() => (setEditing(item.id), setLabel(item.label))}>
                      Rename
                    </Button>
                    <Button
                      size="sm"
                      variant={item.active ? 'danger' : 'ghost'}
                      pending={busy && change.variables?.body.active !== undefined}
                      pendingLabel="Saving…"
                      disabled={busy}
                      onClick={() =>
                        (item.active ? window.confirm(`Stop offering “${item.label}”? Cases that already have it keep it.`) : true) &&
                        change.mutate({id: item.id, body: {active: !item.active}})
                      }>
                      {item.active ? 'Switch off' : 'Switch on'}
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {change.error && <ErrorNote error={change.error} />}
      <form className="inline-fields gap-top" noValidate onSubmit={form.submit(values => add.mutate(values.label.trim()))}>
        <Field id={`f-label-${list}`} label="Add an option" error={form.error('label')}>
          <input
            {...form.field('label')}
            id={`f-label-${list}`}
            aria-describedby={form.error('label') ? `f-label-${list}-error` : undefined}
            className="wide-input"
            maxLength={80}
          />
        </Field>
        <Button type="submit" variant="ghost" pending={add.isPending} pendingLabel="Adding…">
          Add
        </Button>
      </form>
      {add.error && !(add.error instanceof ApiError && Object.keys(add.error.fields).length) && <ErrorNote error={add.error} />}
    </section>
  );
}
