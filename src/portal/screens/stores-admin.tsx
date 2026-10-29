import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {useState} from 'react';

import {api, ApiError, read} from '../api';
import {type AdminStore, adminStoresQuery} from '../queries';
import {Explain} from '../report-ui';
import {ErrorNote} from '../shared';
import {Button, Field, rules, useForm} from '../ui';

const EMPTY = {name: '', shortName: '', manufacturer: '', hasService: true, address: ''};
const STORE_RULES = {
  name: [rules.required('Enter the store name, like Plaza Honda.'), rules.maxLength(80)],
  shortName: [rules.required('Enter a short label, like Honda.'), rules.maxLength(32)],
  manufacturer: [rules.required('Enter the manufacturer, like Honda (or Used).'), rules.maxLength(32)],
  address: [rules.maxLength(200)],
};

/**
 * Admin → Stores: names (shown on every list, report and email), short labels
 * (the chips), the manufacturer (on CSI cases), whether there is a service
 * department. A store is switched off, never deleted: its cases stay.
 */
export function StoresAdmin() {
  const stores = useQuery(adminStoresQuery);
  const [editing, setEditing] = useState<AdminStore | 'new' | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  return (
    <div className="app-page">
      <div className="app-page-head">
        <div>
          <h2>Stores</h2>
          <p className="muted">A new store gets default hours: set its real ones in Clocks and hours, and its managers in Routing.</p>
        </div>
        {editing === null && <Button onClick={() => (setSaved(null), setEditing('new'))}>Add a store</Button>}
      </div>
      {saved && (
        <p className="notice notice-ok" role="status">
          {saved}
        </p>
      )}
      {editing !== null && (
        <StoreForm
          store={editing === 'new' ? null : editing}
          onDone={message => {
            setEditing(null);
            setSaved(message);
          }}
          onCancel={() => setEditing(null)}
        />
      )}
      <section className="app-card">
        <Explain shows="Every store, in the order the lists show them." todo="Switch a store off when it closes; its cases and history stay." />
        {stores.error && <ErrorNote error={stores.error} />}
        {stores.isPending ? (
          <p className="muted">Loading…</p>
        ) : (
          <div className="table-wrap">
            <table className="hub-table">
              <thead>
                <tr>
                  <th scope="col">Store</th>
                  <th scope="col">Short label</th>
                  <th scope="col">Manufacturer</th>
                  <th scope="col">Service department</th>
                  <th scope="col">Status</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {(stores.data?.stores ?? []).map(s => (
                  <tr key={s.id}>
                    <td>
                      <strong>{s.name}</strong>
                      {s.address && <div className="muted">{s.address}</div>}
                    </td>
                    <td>{s.shortName}</td>
                    <td>{s.manufacturer}</td>
                    <td>{s.hasService ? 'Yes' : 'No (sales only)'}</td>
                    <td>{s.active ? <span className="chip chip-good">Open</span> : <span className="chip">Switched off</span>}</td>
                    <td>
                      <Button size="sm" variant="link" disabled={editing !== null} onClick={() => (setSaved(null), setEditing(s))}>
                        Edit
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function StoreForm({store, onDone, onCancel}: {store: AdminStore | null; onDone: (message: string) => void; onCancel: () => void}) {
  const queryClient = useQueryClient();
  const form = useForm(
    store ? {name: store.name, shortName: store.shortName, manufacturer: store.manufacturer, hasService: store.hasService, address: store.address ?? ''} : EMPTY,
    STORE_RULES
  );
  const [active, setActive] = useState(store?.active ?? true);
  const save = useMutation({
    mutationFn: (values: typeof EMPTY) => {
      const body = {...values, hasService: Boolean(values.hasService), active};
      return store
        ? read(api.settings.stores[':id'].$patch({param: {id: String(store.id)}, json: body as never}))
        : read(api.settings.stores.$post({json: body as never}));
    },
    onSuccess: async (_, values) => {
      await queryClient.invalidateQueries({queryKey: ['settings', 'stores']});
      await queryClient.invalidateQueries({queryKey: ['hub']});
      onDone(store ? `Saved ${values.name}.` : `Added ${values.name}.`);
    },
    onError: error => {
      if (error instanceof ApiError) form.setServerErrors(error.fields as Partial<Record<keyof typeof EMPTY, string>>);
    },
  });
  return (
    <form className="hub-form app-card dialog-card" noValidate onSubmit={form.submit(values => save.mutate(values as typeof EMPTY))}>
      <h3>{store ? `Edit ${store.name}` : 'Add a store'}</h3>
      <div className="hub-grid">
        <Field id="f-name" label="Store name" hint="Shown on lists, reports and emails." error={form.error('name')}>
          <input {...form.field('name')} />
        </Field>
        <Field id="f-shortName" label="Short label" hint="The chip on case lists, like Honda." error={form.error('shortName')}>
          <input {...form.field('shortName')} />
        </Field>
        <Field id="f-manufacturer" label="Manufacturer" hint="Shown on CSI cases; “Used” for a used-car store." error={form.error('manufacturer')}>
          <input {...form.field('manufacturer')} />
        </Field>
        <Field id="f-address" label="Address" optional error={form.error('address')}>
          <input {...form.field('address')} />
        </Field>
        <label className="check wide">
          <input type="checkbox" checked={Boolean(form.values.hasService)} onChange={e => form.set('hasService', e.target.checked)} /> Has a service department
        </label>
        {store && (
          <label className="check wide">
            <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} /> Open (switch off when the store closes; its cases stay)
          </label>
        )}
      </div>
      {save.error && !(save.error instanceof ApiError && Object.keys(save.error.fields).length) && <ErrorNote error={save.error} />}
      <div className="actions">
        <Button type="submit" pending={save.isPending} pendingLabel="Saving…">
          {store ? 'Save changes' : 'Add store'}
        </Button>
        <Button variant="ghost" disabled={save.isPending} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
