import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {useNavigate} from '@tanstack/react-router';
import {useEffect} from 'react';

import {HOT_REASONS, HOT_SOURCES, HOT_URGENCY, phoneDigits, VEHICLE_CONDITION} from '../../lib/hub';
import {api, ApiError, read} from '../api';
import {Choices, Counter, useHub, useLabels} from '../hub';
import {CALLBACK_RULES, HOT_RULES, TRADE_RULES} from '../hub-rules';
import {caseOptionsQuery} from '../queries';
import {ErrorNote} from '../shared';
import {Button, Field, useForm} from '../ui';
import {ManagerPicker, RepeatFlag} from './case-parts';
import {NotMember} from './my-cases';

const EMPTY = {
  storeId: '',
  source: '',
  customerName: '',
  phone: '',
  customerEmail: '',
  reason: '',
  customerWords: '',
  urgency: '',
  callbackAt: '',
  vehicleYear: '',
  vehicleMake: '',
  vehicleModel: '',
  vehicleCondition: '',
  stockNumber: '',
  hasTrade: 'no',
  tradeYear: '',
  tradeMake: '',
  tradeModel: '',
  tradeMiles: '',
  assigneeId: '',
};

/**
 * A rep sends a customer to a manager. One screen, phone-first, the fields in
 * the order the call goes: who, which store, why, what they said, how urgent.
 * Vehicle and trade are optional. The manager is filled in from the store's
 * routing; the rep may pick another manager of that store.
 */
export function NewHot() {
  const hub = useHub();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const stores = hub.data?.stores ?? [];
  const names = useLabels();
  // Always-required fields here; the callback time and trade-in fields are
  // checked on submit, only when they apply (`submit` below).
  const form = useForm(EMPTY, HOT_RULES);

  // One store: pick it for them.
  useEffect(() => {
    if (!form.values.storeId && hub.data?.storeIds.length === 1) form.set('storeId', String(hub.data.storeIds[0]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hub.data]);

  const options = useQuery(caseOptionsQuery(form.values.storeId, 'hot', 'sales'));
  // A new store: its default manager.
  useEffect(() => {
    if (options.data) form.set('assigneeId', options.data.defaultId ? String(options.data.defaultId) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.data, form.values.storeId]);

  const create = useMutation({
    mutationFn: (values: typeof EMPTY) =>
      read<{case: {id: number; number: string}}>(
        api.cases.hot.$post({
          json: {
            ...values,
            storeId: Number(values.storeId),
            phone: phoneDigits(values.phone),
            hasTrade: values.hasTrade === 'yes',
            assigneeId: values.assigneeId ? Number(values.assigneeId) : null,
            callbackAt: values.urgency === 'by_time' ? values.callbackAt : null,
          },
        })
      ),
    onSuccess: async ({case: created}) => {
      await queryClient.invalidateQueries({queryKey: ['cases']});
      await navigate({to: '/cases/$caseId', params: {caseId: String(created.id)}, search: {created: 1}});
    },
    onError: error => {
      if (error instanceof ApiError) form.setServerErrors(error.fields as Partial<Record<keyof typeof EMPTY, string>>);
    },
  });

  if (hub.data && !hub.data.member) return <NotMember />;
  if (hub.data && !hub.data.can?.createHot) {
    return (
      <div className="app-page">
        <p className="app-card">Your role does not send Hot Prospects.</p>
      </div>
    );
  }

  const v = form.values;
  // The callback time and trade-in fields are required only when they apply.
  const extraErrors = (name: 'callbackAt' | 'tradeYear' | 'tradeMake' | 'tradeModel' | 'tradeMiles') => form.error(name);
  const submit = form.submit(values => {
    // Conditional rules the static schema cannot know about.
    const problems: Partial<Record<keyof typeof EMPTY, string>> = {};
    if (values.urgency === 'by_time' && !values.callbackAt) problems.callbackAt = CALLBACK_RULES.callbackAt[0]!('')!;
    if (values.hasTrade === 'yes') {
      for (const [name, list] of Object.entries(TRADE_RULES)) {
        for (const rule of list) {
          const message = rule(String(values[name as keyof typeof EMPTY]));
          if (message) {
            problems[name as keyof typeof EMPTY] ??= message;
            break;
          }
        }
      }
    }
    if (Object.keys(problems).length) {
      form.setServerErrors(problems);
      document.getElementById(`f-${Object.keys(problems)[0]}`)?.focus();
      return;
    }
    create.mutate(values);
  });

  return (
    <div className="app-page">
      <form className="hub-form" onSubmit={submit} noValidate>
        <fieldset>
          <legend>Customer</legend>
          <div className="hub-grid">
            <Field id="f-customerName" label={<>Customer name <span className="req">· Required</span></>} error={form.error('customerName')}>
              <input {...form.field('customerName')} autoComplete="off" autoCapitalize="words" />
            </Field>
            <Field
              id="f-phone"
              label={<>Mobile phone <span className="req">· Required</span></>}
              hint="10 digits, like (718) 555-1234."
              error={form.error('phone')}>
              <input {...form.field('phone')} type="tel" inputMode="tel" autoComplete="off" />
            </Field>
            <Field id="f-customerEmail" label="Email" optional error={form.error('customerEmail')}>
              <input {...form.field('customerEmail')} type="email" inputMode="email" autoComplete="off" />
            </Field>
            <div className="wide">
              <RepeatFlag phone={v.phone} />
            </div>
          </div>
        </fieldset>

        <fieldset>
          <legend>Store and source</legend>
          <div className="hub-grid">
            <div className="wide">
              <Choices
                name="storeId"
                legend="Store"
                required
                options={stores.map(s => ({value: String(s.id), label: s.shortName}))}
                value={v.storeId}
                onChange={value => form.set('storeId', value)}
                error={form.error('storeId')}
                inputRef={form.field('storeId').ref}
              />
            </div>
            <div className="wide">
              <Choices
                name="source"
                legend="Where they came from"
                required
                options={HOT_SOURCES}
                value={v.source}
                onChange={value => form.set('source', value)}
                error={form.error('source')}
                inputRef={form.field('source').ref}
              />
            </div>
          </div>
        </fieldset>

        <fieldset>
          <legend>Why a manager is needed</legend>
          <div className="hub-grid">
            <div className="wide">
              <Choices
                name="reason"
                legend="Reason"
                required
                options={names.offered('reason') ?? HOT_REASONS}
                value={v.reason}
                onChange={value => form.set('reason', value)}
                error={form.error('reason')}
                inputRef={form.field('reason').ref}
              />
            </div>
            <div className="wide">
              <Field
                id="f-customerWords"
                label={<>What the customer said <span className="req">· Required</span></>}
                hint="In their words: price, payment, trade, anything the manager needs before calling."
                error={form.error('customerWords')}>
                <textarea {...form.field('customerWords')} rows={3} maxLength={400} />
              </Field>
              <Counter value={v.customerWords} max={300} />
            </div>
            <div className="wide">
              <Choices
                name="urgency"
                legend="How urgent"
                required
                options={HOT_URGENCY}
                value={v.urgency}
                onChange={value => form.set('urgency', value)}
                error={form.error('urgency')}
                inputRef={form.field('urgency').ref}
              />
            </div>
            {v.urgency === 'by_time' && (
              <Field
                id="f-callbackAt"
                label={<>Call back by <span className="req">· Required</span></>}
                hint="Date and time, Eastern."
                error={extraErrors('callbackAt')}>
                <input {...form.field('callbackAt')} type="datetime-local" />
              </Field>
            )}
          </div>
        </fieldset>

        <fieldset>
          <legend>Vehicle of interest (optional)</legend>
          <div className="hub-grid">
            <Field id="f-vehicleYear" label="Year" optional error={form.error('vehicleYear')}>
              <input {...form.field('vehicleYear')} inputMode="numeric" maxLength={4} />
            </Field>
            <Field id="f-vehicleMake" label="Make" optional error={form.error('vehicleMake')}>
              <input {...form.field('vehicleMake')} autoCapitalize="words" />
            </Field>
            <Field id="f-vehicleModel" label="Model" optional error={form.error('vehicleModel')}>
              <input {...form.field('vehicleModel')} autoCapitalize="words" />
            </Field>
            <Field id="f-stockNumber" label="Stock #" optional error={form.error('stockNumber')}>
              <input {...form.field('stockNumber')} autoCapitalize="characters" />
            </Field>
            <div className="wide">
              <Choices
                name="vehicleCondition"
                legend="New or used"
                options={VEHICLE_CONDITION}
                value={v.vehicleCondition}
                onChange={value => form.set('vehicleCondition', value)}
              />
            </div>
            <div className="wide">
              <Choices
                name="hasTrade"
                legend="Trade-in?"
                options={[
                  {value: 'no', label: 'No trade'},
                  {value: 'yes', label: 'Yes, has a trade'},
                ]}
                value={v.hasTrade}
                onChange={value => form.set('hasTrade', value)}
              />
            </div>
            {v.hasTrade === 'yes' && (
              <>
                <Field id="f-tradeYear" label="Trade year" optional error={extraErrors('tradeYear')}>
                  <input {...form.field('tradeYear')} inputMode="numeric" maxLength={4} />
                </Field>
                <Field id="f-tradeMake" label={<>Trade make <span className="req">· Required</span></>} error={extraErrors('tradeMake')}>
                  <input {...form.field('tradeMake')} autoCapitalize="words" />
                </Field>
                <Field id="f-tradeModel" label={<>Trade model <span className="req">· Required</span></>} error={extraErrors('tradeModel')}>
                  <input {...form.field('tradeModel')} autoCapitalize="words" />
                </Field>
                <Field id="f-tradeMiles" label="Trade miles" optional error={extraErrors('tradeMiles')}>
                  <input {...form.field('tradeMiles')} inputMode="numeric" />
                </Field>
              </>
            )}
          </div>
        </fieldset>

        <fieldset>
          <legend>Send to</legend>
          <ManagerPicker
            storeId={v.storeId}
            options={options.data}
            loading={options.isFetching}
            error={options.error}
            field={form.field('assigneeId')}
            fieldError={form.error('assigneeId')}
          />
        </fieldset>

        {create.error && !(create.error instanceof ApiError && Object.keys(create.error.fields).length) && (
          <ErrorNote error={create.error} />
        )}
        <div className="form-bar">
          <Button type="submit" pending={create.isPending} pendingLabel="Sending…">
            Send to manager
          </Button>
          <Button variant="ghost" disabled={create.isPending} onClick={() => void navigate({to: '/'})}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
