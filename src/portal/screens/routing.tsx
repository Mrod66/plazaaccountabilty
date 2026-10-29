import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {useState} from 'react';

import {ROUTE_KINDS} from '../../lib/hub';
import {api, read} from '../api';
import {routingQuery} from '../queries';
import {ErrorNote} from '../shared';

/**
 * Admin → Routing: for each store, who a new case goes to by default. The
 * person creating a case can still pick another manager of that store.
 * Only people whose role receives cases are offered.
 */
export function Routing() {
  const queryClient = useQueryClient();
  const routing = useQuery(routingQuery);
  const [saved, setSaved] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (body: {storeId: number; kind: string; userId: number | null}) => read(api.hub.admin.routing.$put({json: body as never})),
    onSuccess: async () => {
      await queryClient.invalidateQueries({queryKey: ['hub', 'routing']});
      await queryClient.invalidateQueries({queryKey: ['cases', 'options']});
      setSaved('Saved.');
    },
  });
  const busyKey = save.isPending && save.variables ? `${save.variables.storeId}:${save.variables.kind}` : null;

  return (
    <div className="app-page">
      <div className="app-page-head">
        <div>
          <h2>Who new cases go to</h2>
          <p className="muted">What this shows: the default manager for each kind of case, per store. What to do with it: keep one name in every box, so no case lands with nobody.</p>
        </div>
      </div>
      {saved && (
        <p className="notice notice-ok" role="status">
          {saved}
        </p>
      )}
      {save.error && <ErrorNote error={save.error} />}
      {routing.error && <ErrorNote error={routing.error} />}
      {routing.isPending ? (
        <p className="muted">Loading…</p>
      ) : (
        <div className="table-wrap">
          <table className="hub-table">
            <thead>
              <tr>
                <th scope="col">Store</th>
                {ROUTE_KINDS.map(kind => (
                  <th key={kind.value} scope="col">
                    {kind.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(routing.data?.stores ?? []).map(store => (
                <tr key={store.id}>
                  <th scope="row">{store.name}</th>
                  {ROUTE_KINDS.map(kind => {
                    const key = `${store.id}:${kind.value}`;
                    if (kind.value === 'csi_service' && !store.hasService) {
                      return (
                        <td key={kind.value} className="muted">
                          No service department
                        </td>
                      );
                    }
                    const current = store.routes[kind.value];
                    return (
                      <td key={kind.value}>
                        <label className="sr-only" htmlFor={`r-${key}`}>
                          {store.name}: {kind.label}
                        </label>
                        <select
                          id={`r-${key}`}
                          className={current ? undefined : 'attention-warn'}
                          value={current ? String(current) : ''}
                          disabled={busyKey === key}
                          aria-busy={busyKey === key || undefined}
                          onChange={e => {
                            setSaved(null);
                            save.mutate({storeId: store.id, kind: kind.value, userId: e.target.value ? Number(e.target.value) : null});
                          }}>
                          <option value="">Nobody set</option>
                          {store.candidates.map(p => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                              {p.atStore ? '' : ' (group)'}
                            </option>
                          ))}
                        </select>
                        {busyKey === key && <span className="muted"> Saving…</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
