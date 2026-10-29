import {useInfiniteQuery, useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {type FormEvent, useState} from 'react';

import type {AdminUser} from '../../lib/types';
import {api, read} from '../api';
import {rolesQuery, usersQuery} from '../queries';
import {ErrorNote, useMe, when} from '../shared';
import {Button} from '../ui';


/**
 * `/portal/users` (site:user:read): every account, newest first, keyset-paged.
 * Find one by its exact email. Actions need site:user:update; the server
 * refuses anything that would act on someone with more access than you.
 */
export function Users() {
  const me = useMe();
  const abilities = me.data?.abilities;
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState('');
  const [filter, setFilter] = useState({email: '', status: ''});
  const [editing, setEditing] = useState<AdminUser | null>(null);

  const users = useInfiniteQuery(usersQuery(filter));
  const refresh = () => queryClient.invalidateQueries({queryKey: ['users']});

  const setUserStatus = useMutation({
    mutationFn: ({id, status}: {id: number; status: 'active' | 'suspended'}) =>
      read(api.admin.users[':id'].$patch({param: {id: String(id)}, json: {status}})),
    onSuccess: refresh,
  });
  const endSessions = useMutation({
    mutationFn: (id: number) => read(api.admin.users[':id'].sessions.revoke.$post({param: {id: String(id)}})),
  });
  const busyId =
    (setUserStatus.isPending && setUserStatus.variables?.id) || (endSessions.isPending && endSessions.variables) || null;
  const rows = users.data?.pages.flatMap(page => page.users) ?? [];

  const search = (event: FormEvent) => {
    event.preventDefault();
    setFilter({email: email.trim(), status});
  };

  return (
    <div className="app-page">
      <div className="app-page-head">
        <div>
          <h2>Users</h2>
          <p className="muted">Everyone with an account on this site.</p>
        </div>
      </div>

      <form className="search" onSubmit={search} noValidate>
        <input
          type="search"
          aria-label="Find a user by their exact email"
          placeholder="Exact email, e.g. name@example.com"
          value={email}
          onChange={event => setEmail(event.target.value)}
          maxLength={254}
        />
        <select aria-label="Status" value={status} onChange={event => setStatus(event.target.value)}>
          <option value="">Any status</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
        </select>
        <Button variant="ghost" type="submit" pending={users.isFetching && !users.isFetchingNextPage} pendingLabel="Searching…">
          Search
        </Button>
      </form>

      {editing && (
        <RoleEditor
          user={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void refresh();
          }}
        />
      )}

      {users.error && <ErrorNote error={users.error} />}
      {users.isPending ? (
        <p className="muted">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="app-empty">
          <p className="muted">{filter.email ? 'No user has that email.' : 'No users yet.'}</p>
        </div>
      ) : (
        <section className="app-card">
          <table className="app-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Roles</th>
                <th>Status</th>
                <th>Last sign-in</th>
                {abilities?.updateUsers && <th aria-label="Actions" />}
              </tr>
            </thead>
            <tbody>
              {rows.map(user => {
                const busy = busyId === user.id;
                const self = user.id === me.data?.viewer.id;
                return (
                  <tr key={user.id} aria-busy={busy || undefined}>
                    <td>{user.name}</td>
                    <td className="muted">
                      {user.email}
                      {!user.emailVerified && ' (unconfirmed)'}
                    </td>
                    <td>
                      <span className="chips">
                        {user.roles.map(role => (
                          <span key={role} className="chip">
                            {role}
                          </span>
                        ))}
                      </span>
                    </td>
                    <td>{user.status}</td>
                    <td className="muted">{when(user.lastLoginAt)}</td>
                    {abilities?.updateUsers && (
                      <td>
                        <div className="row-actions">
                          {abilities.manageRoles && (
                            <Button variant="link" size="sm" disabled={busy} onClick={() => setEditing(user)}>
                              Roles
                            </Button>
                          )}
                          <Button
                            variant="link"
                            size="sm"
                            disabled={busy}
                            pending={endSessions.isPending && endSessions.variables === user.id}
                            pendingLabel="Ending…"
                            onClick={() =>
                              window.confirm(`Sign ${user.name} out on every device?`) && endSessions.mutate(user.id)
                            }>
                            End sessions
                          </Button>
                          {!self && (
                            <Button
                              variant="danger"
                              size="sm"
                              disabled={busy}
                              pending={setUserStatus.isPending && setUserStatus.variables?.id === user.id}
                              pendingLabel={user.status === 'active' ? 'Suspending…' : 'Reactivating…'}
                              onClick={() => {
                                const next = user.status === 'active' ? 'suspended' : 'active';
                                if (next === 'active' || window.confirm(`Suspend ${user.name}? They are signed out at once.`)) {
                                  setUserStatus.mutate({id: user.id, status: next});
                                }
                              }}>
                              {user.status === 'active' ? 'Suspend' : 'Reactivate'}
                            </Button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
      {(setUserStatus.error || endSessions.error) && <ErrorNote error={(setUserStatus.error ?? endSessions.error)!} />}
      {endSessions.isSuccess && (
        <p className="notice notice-ok" role="status">
          Signed out everywhere.
        </p>
      )}
      {users.hasNextPage && (
        <Button
          variant="ghost"
          onClick={() => users.fetchNextPage()}
          pending={users.isFetchingNextPage}
          pendingLabel="Loading…">
          Load more
        </Button>
      )}
    </div>
  );
}

/** Pick a user's roles. The server refuses roles you could not grant yourself. */
function RoleEditor({user, onClose, onSaved}: {user: AdminUser; onClose: () => void; onSaved: () => void}) {
  const roles = useQuery(rolesQuery);
  const [picked, setPicked] = useState<string[]>(user.roles);
  const save = useMutation({
    mutationFn: () =>
      read<{user: AdminUser}>(api.admin.users[':id'].roles.$put({param: {id: String(user.id)}, json: {roles: picked}})),
    onSuccess: onSaved,
  });
  const changed = picked.slice().sort().join() !== user.roles.slice().sort().join();

  return (
    <form
      className="app-card form-card"
      noValidate
      onSubmit={event => {
        event.preventDefault();
        save.mutate();
      }}>
      <h3>Roles for {user.name}</h3>
      {roles.error && <ErrorNote error={roles.error} />}
      {roles.isPending ? (
        <p className="muted">Loading…</p>
      ) : (
        <fieldset className="perm-group">
          <legend>Roles</legend>
          <div className="perm-list">
            {roles.data?.roles.map(role => (
              <label key={role.slug} className="check">
                <input
                  type="checkbox"
                  checked={picked.includes(role.slug)}
                  onChange={event =>
                    setPicked(current =>
                      event.target.checked ? [...current, role.slug] : current.filter(slug => slug !== role.slug)
                    )
                  }
                />{' '}
                <strong>{role.name}</strong> <span className="muted">{role.description}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {save.error && <ErrorNote error={save.error} />}
      <div className="actions">
        <Button type="submit" pending={save.isPending} pendingLabel="Saving…" disabled={!changed}>
          Save roles
        </Button>
        <Button variant="ghost" onClick={onClose} disabled={save.isPending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
