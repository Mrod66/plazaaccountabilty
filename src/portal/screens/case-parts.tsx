import {useQuery} from '@tanstack/react-query';
import {Link} from '@tanstack/react-router';

import {labels, phoneDigits} from '../../lib/hub';
import {type CaseOptions, phoneCheckQuery} from '../queries';
import {Field} from '../ui';

/** Pieces the two new-case forms share. */

type FieldProps = {
  id: string;
  name: string;
  value: string;
  ref: (node: HTMLElement | null) => void;
  onChange: (event: {target: {value: string}}) => void;
  onBlur: () => void;
};

/** The manager a case goes to: the store's managers, the routing default picked. */
export function ManagerPicker({
  storeId,
  options,
  loading,
  error,
  field,
  fieldError,
}: {
  storeId: string;
  options: CaseOptions | undefined;
  loading: boolean;
  error: Error | null;
  field: FieldProps;
  fieldError?: string;
}) {
  if (!storeId) return <p className="muted">Pick the store first: its managers show here.</p>;
  if (error) return <p className="field-error">Could not load the managers: {error.message}</p>;
  const managers = options?.managers ?? [];
  const here = managers.filter(m => m.atStore);
  const group = managers.filter(m => !m.atStore);
  const hint = options?.defaultId
    ? 'Filled in from this store’s routing. Pick someone else if you need to.'
    : 'No default is set for this store yet: pick a manager.';
  return (
    <Field id="f-assigneeId" label="Manager" hint={loading ? 'Loading this store’s managers…' : hint} error={fieldError}>
      <select {...field} disabled={loading && !options}>
        <option value="">{managers.length ? 'Pick a manager' : 'No managers set up for this store'}</option>
        {here.length > 0 && (
          <optgroup label="This store">
            {here.map(m => (
              <option key={m.id} value={m.id}>
                {m.name}
                {m.id === options?.defaultId ? ' (default)' : ''}
              </option>
            ))}
          </optgroup>
        )}
        {group.length > 0 && (
          <optgroup label="Group-wide">
            {group.map(m => (
              <option key={m.id} value={m.id}>
                {m.name}
                {m.id === options?.defaultId ? ' (default)' : ''}
              </option>
            ))}
          </optgroup>
        )}
      </select>
    </Field>
  );
}

/**
 * The repeat flag: this phone number is already on an open or recent case.
 * A case the viewer may open is linked; any other is only mentioned, never named.
 */
export function RepeatFlag({phone, except = ''}: {phone: string; except?: string}) {
  const digits = phoneDigits(phone);
  const check = useQuery(phoneCheckQuery(digits, except));
  const match = check.data;
  if (digits.length !== 10 || !match || (!match.visible.length && !match.hidden)) return null;
  return (
    <div className="repeat-flag" role="status">
      <strong>Repeat customer.</strong>{' '}
      {match.visible.length > 0 && (
        <>
          This number is on{' '}
          {match.visible.map((c, i) => (
            <span key={c.id}>
              {i > 0 && ', '}
              <Link to="/cases/$caseId" params={{caseId: String(c.id)}}>
                {c.number}
              </Link>{' '}
              ({labels.status(c.type, c.status).toLowerCase()}, with {c.owner.name})
            </span>
          ))}
          .{' '}
        </>
      )}
      {match.hidden > 0 && 'This customer has another open case with a manager.'}
    </div>
  );
}
