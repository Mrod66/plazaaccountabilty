import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {useState} from 'react';

import {rules} from '../../lib/rules';
import type {PermissionRow, RoleRow} from '../../lib/types';
import {api, ApiError, read} from '../api';
import {permissionsQuery, rolesQuery} from '../queries';
import {ErrorNote, useMe} from '../shared';
import {Button, Field, useForm} from '../ui';

/** The role form's rules: the SAME limits `src/platform/auth/admin.ts` enforces. */
const ROLE_RULES = {
  slug: [
    rules.required('Enter a short id, like "editor".'),
    rules.pattern(/^[a-z][a-z0-9-]{1,47}$/, 'Use 2 to 48 lowercase letters, digits or dashes, starting with a letter.'),
  ],
  name: [rules.required('Enter a name.'), rules.maxLength(80)],
  description: [rules.maxLength(255)],
};

/**
 * `/portal/roles` (site:role:read): what each role allows. Editing needs
 * site:role:update, and you can only grant permissions you hold yourself.
 * `owner` is fixed; built-in roles cannot be deleted.
 */
export function Roles() {
  const me = useMe();
  const canEdit = Boolean(me.data?.abilities.editRoles);
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<RoleRow | 'new' | null>(null);

  const roles = useQuery(rolesQuery);
  const catalogue = useQuery(permissionsQuery);
  const remove = useMutation({
    mutationFn: (slug: string) => read(api.admin.roles[':slug'].$delete({param: {slug}})),
    onSuccess: () => queryClient.invalidateQueries({queryKey: ['roles']}),
  });
  const titles = new Map(catalogue.data?.permissions.map(p => [p.codename, p.title]));

  return (
    <div className="app-page">
      <div className="app-page-head">
        <div>
          <h2>Roles</h2>
          <p className="muted">A role is a set of permissions. Give roles to people on the Users screen.</p>
        </div>
        {canEdit && editing === null && <Button onClick={() => setEditing('new')}>New role</Button>}
      </div>

      {editing !== null && (
        <RoleForm
          key={editing === 'new' ? 'new' : editing.slug}
          role={editing === 'new' ? null : editing}
          catalogue={catalogue.data?.permissions ?? []}
          onClose={() => setEditing(null)}
        />
      )}

      {roles.error && <ErrorNote error={roles.error} />}
      {roles.isPending && <p className="muted">Loading…</p>}
      {roles.data?.roles.map(role => {
        const busy = remove.isPending && remove.variables === role.slug;
        return (
          <section className="app-card" key={role.slug} aria-busy={busy || undefined}>
            <div className="app-card-head">
              <h3>
                {role.name} <span className="muted">({role.slug})</span>
              </h3>
              {canEdit && role.slug !== 'owner' && (
                <div className="row-actions">
                  <Button variant="link" size="sm" disabled={busy} onClick={() => setEditing(role)}>
                    Edit
                  </Button>
                  {!role.isSystem && (
                    <Button
                      variant="danger"
                      size="sm"
                      pending={busy}
                      pendingLabel="Deleting…"
                      onClick={() =>
                        window.confirm(`Delete the “${role.name}” role? People lose what it allowed.`) &&
                        remove.mutate(role.slug)
                      }>
                      Delete
                    </Button>
                  )}
                </div>
              )}
            </div>
            {role.description && <p className="muted">{role.description}</p>}
            <div className="chips">
              {role.permissions.length ? (
                role.permissions.map(codename => (
                  <span key={codename} className="chip" title={codename}>
                    {titles.get(codename) ?? codename}
                  </span>
                ))
              ) : (
                <span className="muted">Signed in, nothing more.</span>
              )}
            </div>
          </section>
        );
      })}
      {remove.error && <ErrorNote error={remove.error} />}
    </div>
  );
}

function RoleForm({role, catalogue, onClose}: {role: RoleRow | null; catalogue: PermissionRow[]; onClose: () => void}) {
  const queryClient = useQueryClient();
  const form = useForm(
    {slug: role?.slug ?? '', name: role?.name ?? '', description: role?.description ?? ''},
    role ? {name: ROLE_RULES.name, description: ROLE_RULES.description} : ROLE_RULES
  );
  const [picked, setPicked] = useState<string[]>(role?.permissions ?? []);
  const save = useMutation({
    mutationFn: (values: {slug: string; name: string; description: string}) =>
      role
        ? read(
            api.admin.roles[':slug'].$patch({
              param: {slug: role.slug},
              json: {name: values.name, description: values.description, permissions: picked},
            })
          )
        : read(api.admin.roles.$post({json: {...values, permissions: picked}})),
    onSuccess: () => {
      onClose();
      return queryClient.invalidateQueries({queryKey: ['roles']});
    },
    onError: err => err instanceof ApiError && form.setServerErrors(err.fields),
  });
  const groups = [...new Set(catalogue.map(p => p.group))];

  return (
    <form className="app-card form-card" noValidate onSubmit={form.submit(values => save.mutate(values))}>
      <h3>{role ? `Edit ${role.name}` : 'New role'}</h3>
      <div className="form-grid">
        {!role && (
          <Field id="f-slug" label="Id" hint="Lowercase, used in code. Cannot change later." error={form.error('slug')}>
            <input {...form.field('slug')} autoComplete="off" />
          </Field>
        )}
        <Field id="f-name" label="Name" error={form.error('name')}>
          <input {...form.field('name')} autoComplete="off" />
        </Field>
        <div className="full">
          <Field id="f-description" label="Description" optional error={form.error('description')}>
            <input {...form.field('description')} autoComplete="off" />
          </Field>
        </div>
      </div>
      {groups.map(group => (
        <fieldset className="perm-group" key={group}>
          <legend>{group}</legend>
          <div className="perm-list">
            {catalogue
              .filter(p => p.group === group)
              .map(permission => (
                <label key={permission.codename} className="check">
                  <input
                    type="checkbox"
                    checked={picked.includes(permission.codename)}
                    onChange={event =>
                      setPicked(current =>
                        event.target.checked
                          ? [...current, permission.codename]
                          : current.filter(codename => codename !== permission.codename)
                      )
                    }
                  />{' '}
                  <strong>{permission.title}</strong> <span className="muted">{permission.description}</span>
                </label>
              ))}
          </div>
        </fieldset>
      ))}
      {save.error && !(save.error instanceof ApiError && Object.keys(save.error.fields).length) && (
        <ErrorNote error={save.error} />
      )}
      <div className="actions">
        <Button type="submit" pending={save.isPending} pendingLabel="Saving…">
          {role ? 'Save changes' : 'Create role'}
        </Button>
        <Button variant="ghost" onClick={onClose} disabled={save.isPending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
