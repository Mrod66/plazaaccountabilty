import {useInfiniteQuery, useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {type FormEvent, useState} from 'react';

import {DEPARTMENTS, formatWhen, labels} from '../../lib/hub';
import {api, ApiError, read} from '../api';
import {Choices, MultiChoices, StoreChip, useHub, useStores} from '../hub';
import {type HubPerson, hubPeopleQuery, rolesQuery} from '../queries';
import {ErrorNote} from '../shared';
import {Button, Field, rules, useForm} from '../ui';

/** Roles never handed out here: `owner` is the platform's, `member` is every account's. */
const HIDDEN_ROLES = new Set(['owner', 'member']);

const EMPTY = {firstName: '', lastName: '', email: '', department: 'sales', storeIds: '', roles: '', managerUserId: ''};
const PERSON_RULES = {
  firstName: [rules.required('Enter the first name.'), rules.maxLength(40)],
  lastName: [rules.maxLength(40)],
  email: [rules.required('Enter their work email, like name@plazacars.com.'), rules.email(), rules.maxLength(254)],
  department: [rules.required('Pick a department.')],
  roles: [rules.required('Pick at least one role.')],
};

/**
 * Admin → People: everyone in the organization. Adding a person makes their
 * account (no password: they sign in with a 6-digit code emailed to their work
 * address). People are deactivated, never deleted: their history stays.
 */
export function People() {
  const queryClient = useQueryClient();
  const hub = useHub();
  const stores = useStores();
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<HubPerson | 'new' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const people = useInfiniteQuery(hubPeopleQuery(query));
  const rows = people.data?.pages.flatMap(page => page.people) ?? [];
  const refresh = () => queryClient.invalidateQueries({queryKey: ['hub']});

  const starter = useMutation({
    mutationFn: () => read<{added: string[]; skipped: string[]; problems: string[]; routesSet: number}>(api.hub.admin.starter.$post()),
    onSuccess: async result => {
      await refresh();
      setNotice(
        `Starter list: ${result.added.length} added, ${result.skipped.length} already here, ${result.routesSet} routes set.` +
          (result.problems.length ? ` Not done: ${result.problems.join('; ')}` : '')
      );
    },
  });
  const setStatus = useMutation({
    mutationFn: ({id, status}: {id: number; status: 'active' | 'suspended'}) =>
      read(api.admin.users[':id'].$patch({param: {id: String(id)}, json: {status}})),
    onSuccess: async (_, {status}) => {
      await refresh();
      setNotice(status === 'suspended' ? 'Deactivated. They can no longer sign in; their cases and history stay.' : 'Reactivated.');
    },
  });
  const busyId = setStatus.isPending ? setStatus.variables?.id : null;

  const search = (event: FormEvent) => {
    event.preventDefault();
    setQuery(q.trim());
  };

  return (
    <div className="app-page">
      <div className="app-page-head">
        <div>
          <h2>People</h2>
          <p className="muted">
            Everyone in {hub.data?.org?.name ?? 'the organization'}. New people sign in at the sign-in page with a code emailed to
            their work address.
          </p>
        </div>
        {editing === null && <Button onClick={() => (setNotice(null), setEditing('new'))}>Add a person</Button>}
      </div>

      {notice && (
        <p className="notice notice-ok" role="status">
          {notice}
        </p>
      )}

      {editing !== null && (
        <PersonForm
          person={editing === 'new' ? null : editing}
          everyone={rows}
          onDone={async message => {
            setEditing(null);
            setNotice(message);
            await refresh();
          }}
          onCancel={() => setEditing(null)}
        />
      )}

      <form className="toolbar app-card" onSubmit={search} noValidate role="search">
        <Field id="f-people-q" label="Find by name">
          <input id="f-people-q" type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="e.g. Kendall" maxLength={60} />
        </Field>
        <Button type="submit" variant="ghost" pending={people.isFetching && !people.isFetchingNextPage} pendingLabel="Searching…">
          Search
        </Button>
        <Button
          variant="ghost"
          pending={starter.isPending}
          pendingLabel="Loading the list…"
          onClick={() =>
            window.confirm(
              'Add the leadership, BDC, sales and service managers from the build prompt (emails like saadm@plazacars.com), and fill any empty routing? People already here are left alone.'
            ) && starter.mutate()
          }>
          Load the starter list
        </Button>
      </form>
      {starter.error && <ErrorNote error={starter.error} />}
      {setStatus.error && <ErrorNote error={setStatus.error} />}
      {people.error && <ErrorNote error={people.error} />}

      {people.isPending ? (
        <p className="muted">Loading…</p>
      ) : rows.length === 0 ? (
        !people.error && (
          <div className="app-card empty-card">
            <p className="muted">{query ? 'Nobody by that name.' : 'Nobody here yet. Add a person, or load the starter list.'}</p>
          </div>
        )
      ) : (
        <div className="table-wrap">
          <table className="hub-table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Email</th>
                <th scope="col">Roles</th>
                <th scope="col">Stores</th>
                <th scope="col">Department</th>
                <th scope="col">Manager</th>
                <th scope="col">Status</th>
                <th scope="col">Last sign-in</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(p => {
                const busy = busyId === p.id;
                const active = p.status === 'active';
                return (
                  <tr key={p.id} aria-busy={busy || undefined}>
                    <td>
                      <strong>{p.name}</strong>
                    </td>
                    <td className="muted">{p.email ?? '—'}</td>
                    <td>{p.roles.map(r => r.name).join(', ') || <span className="muted">No role</span>}</td>
                    <td>
                      <div className="chips">
                        {p.storeIds.length ? p.storeIds.map(id => <StoreChip key={id} store={stores.get(id)} />) : <span className="muted">Group</span>}
                      </div>
                    </td>
                    <td>{labels.department('hot', p.department)}</td>
                    <td>{p.manager?.name ?? '—'}</td>
                    <td>{active ? <span className="chip chip-good">Active</span> : <span className="chip">Deactivated</span>}</td>
                    <td className="nowrap muted">{p.lastLoginAt ? formatWhen(p.lastLoginAt) : 'Never'}</td>
                    <td className="nowrap">
                      <Button variant="link" size="sm" disabled={busy || editing !== null} onClick={() => (setNotice(null), setEditing(p))}>
                        Edit
                      </Button>
                      <Button
                        variant={active ? 'danger' : 'ghost'}
                        size="sm"
                        pending={busy}
                        pendingLabel={active ? 'Deactivating…' : 'Reactivating…'}
                        disabled={busy}
                        onClick={() =>
                          (active
                            ? window.confirm(`Deactivate ${p.name}? They can no longer sign in. Their cases and history stay.`)
                            : true) && setStatus.mutate({id: p.id, status: active ? 'suspended' : 'active'})
                        }>
                        {active ? 'Deactivate' : 'Reactivate'}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {people.hasNextPage && (
        <Button variant="ghost" onClick={() => people.fetchNextPage()} pending={people.isFetchingNextPage} pendingLabel="Loading…">
          Load more
        </Button>
      )}
    </div>
  );
}

function PersonForm({
  person,
  everyone,
  onDone,
  onCancel,
}: {
  person: HubPerson | null;
  everyone: HubPerson[];
  onDone: (message: string) => void;
  onCancel: () => void;
}) {
  const hub = useHub();
  const roles = useQuery(rolesQuery);
  const creating = person === null;
  const keepRoles = (person?.roles ?? []).filter(r => HIDDEN_ROLES.has(r.slug)).map(r => r.slug);
  const form = useForm(
    person
      ? {
          firstName: person.firstName,
          lastName: person.lastName,
          email: person.email ?? '',
          department: person.department,
          storeIds: person.storeIds.join(','),
          roles: person.roles.filter(r => !HIDDEN_ROLES.has(r.slug)).map(r => r.slug).join(','),
          managerUserId: person.manager ? String(person.manager.id) : '',
        }
      : EMPTY,
    creating ? PERSON_RULES : {firstName: PERSON_RULES.firstName, lastName: PERSON_RULES.lastName, department: PERSON_RULES.department}
  );
  const v = form.values;
  const save = useMutation({
    mutationFn: async (values: typeof EMPTY) => {
      const body = {
        firstName: values.firstName,
        lastName: values.lastName,
        department: values.department,
        storeIds: values.storeIds ? values.storeIds.split(',').map(Number) : [],
        managerUserId: values.managerUserId ? Number(values.managerUserId) : null,
      };
      const roleList = values.roles ? values.roles.split(',') : [];
      if (creating) {
        const created = await read<{id: number; rolesRefused: string | null}>(
          api.hub.admin.people.$post({json: {...body, email: values.email, roles: roleList} as never})
        );
        return created.rolesRefused ? `Added, but: ${created.rolesRefused}` : `Added ${values.firstName}. They can sign in now with a code sent to ${values.email}.`;
      }
      await read(api.hub.admin.people[':id'].$patch({param: {id: String(person.id)}, json: body as never}));
      const before = person.roles.filter(r => !HIDDEN_ROLES.has(r.slug)).map(r => r.slug).sort().join(',');
      if (before !== [...roleList].sort().join(',')) {
        // Roles go through the managed, audited, anti-escalation route.
        await read(api.admin.users[':id'].roles.$put({param: {id: String(person.id)}, json: {roles: [...keepRoles, ...roleList]}}));
      }
      return `Saved ${values.firstName}.`;
    },
    onSuccess: onDone,
    onError: error => {
      if (error instanceof ApiError) form.setServerErrors(error.fields as Partial<Record<keyof typeof EMPTY, string>>);
    },
  });
  const roleOptions = (roles.data?.roles ?? []).filter(r => !HIDDEN_ROLES.has(r.slug)).map(r => ({value: r.slug, label: r.name}));
  const storeOptions = (hub.data?.stores ?? []).map(s => ({value: String(s.id), label: s.shortName}));
  const managers = everyone.filter(p => p.id !== person?.id && p.status === 'active');

  return (
    <form className="hub-form app-card dialog-card" noValidate onSubmit={form.submit(values => save.mutate(values))}>
      <h3>{creating ? 'Add a person' : `Edit ${person.name}`}</h3>
      <div className="hub-grid">
        <Field id="f-firstName" label="First name" error={form.error('firstName')}>
          <input {...form.field('firstName')} autoComplete="off" />
        </Field>
        <Field id="f-lastName" label="Last name" optional error={form.error('lastName')}>
          <input {...form.field('lastName')} autoComplete="off" />
        </Field>
        {creating ? (
          <Field id="f-email" label="Work email" hint="Usually first name + last initial, like saadm@plazacars.com." error={form.error('email')}>
            <input {...form.field('email')} type="email" inputMode="email" autoComplete="off" />
          </Field>
        ) : (
          <p className="muted">
            Email: {person.email ?? '—'} (they change it themselves in Your account)
          </p>
        )}
        <Field id="f-managerUserId" label="Their manager" optional hint="Escalations go to this person (Phase 2)." error={form.error('managerUserId')}>
          <select {...form.field('managerUserId')}>
            <option value="">None</option>
            {managers.map(p => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="wide">
          <Choices
            name="department"
            legend="Department"
            required
            options={DEPARTMENTS}
            value={v.department}
            onChange={value => form.set('department', value)}
            error={form.error('department')}
          />
        </div>
        <div className="wide">
          <MultiChoices
            name="storeIds"
            legend="Stores"
            hint="Leave empty for group teams (BDC, CSI, leadership): they float across every store."
            options={storeOptions}
            value={v.storeIds}
            onChange={value => form.set('storeIds', value)}
            error={form.error('storeIds')}
          />
        </div>
        <div className="wide">
          <MultiChoices
            name="roles"
            legend="Roles"
            hint="A person can hold more than one."
            options={roleOptions}
            value={v.roles}
            onChange={value => form.set('roles', value)}
            error={form.error('roles')}
          />
          {roles.error && <ErrorNote error={roles.error} />}
        </div>
      </div>
      {save.error && !(save.error instanceof ApiError && Object.keys(save.error.fields).length) && <ErrorNote error={save.error} />}
      <div className="actions">
        <Button type="submit" pending={save.isPending} pendingLabel="Saving…">
          {creating ? 'Add person' : 'Save changes'}
        </Button>
        <Button variant="ghost" disabled={save.isPending} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
