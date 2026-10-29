import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {useNavigate} from '@tanstack/react-router';
import {useEffect} from 'react';

import {CSI_DEPARTMENTS, CSI_STAGES, phoneDigits, PROBLEMS, SENTIMENTS} from '../../lib/hub';
import {api, ApiError, read} from '../api';
import {Choices, Counter, MultiChoices, useHub, useLabels} from '../hub';
import {CSI_RULES, PROBLEMS_RULE} from '../hub-rules';
import {caseOptionsQuery} from '../queries';
import {ErrorNote} from '../shared';
import {Button, Field, useForm} from '../ui';
import {ManagerPicker, RepeatFlag} from './case-parts';
import {NotMember} from './my-cases';

const EMPTY = {
  storeId: '',
  department: '',
  customerName: '',
  phone: '',
  customerEmail: '',
  refNumber: '',
  eventDate: '',
  staffInvolvedId: '',
  stage: 'pre_survey',
  sentiment: '',
  surveyScore: '',
  problems: '',
  customerWords: '',
  assigneeId: '',
};

/**
 * A CSI rep logs a check-in call (or a survey that came back bad). A happy
 * customer is logged and closed at once ("No issue"), still counted; anyone
 * else goes to the store's sales or service manager to make it right.
 */
export function NewCsi() {
  const hub = useHub();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const stores = hub.data?.stores ?? [];
  const names = useLabels();
  const form = useForm(EMPTY, CSI_RULES);
  const v = form.values;
  const store = stores.find(s => String(s.id) === v.storeId);
  const happy = v.sentiment === 'happy';

  useEffect(() => {
    if (!v.storeId && hub.data?.storeIds.length === 1) form.set('storeId', String(hub.data.storeIds[0]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hub.data]);
  // Used Cars has no service department.
  useEffect(() => {
    if (store && !store.hasService && v.department !== 'sales') form.set('department', 'sales');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

  const options = useQuery(caseOptionsQuery(v.storeId, 'csi', v.department || 'sales'));
  useEffect(() => {
    if (options.data) {
      form.set('assigneeId', options.data.defaultId ? String(options.data.defaultId) : '');
      form.set('staffInvolvedId', '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.data, v.storeId, v.department]);

  const create = useMutation({
    mutationFn: ({values, closeNoIssue}: {values: typeof EMPTY; closeNoIssue: boolean}) =>
      read<{case: {id: number; number: string}}>(
        api.cases.csi.$post({
          json: {
            ...values,
            storeId: Number(values.storeId),
            phone: phoneDigits(values.phone),
            problems: values.problems ? values.problems.split(',') : [],
            staffInvolvedId: values.staffInvolvedId ? Number(values.staffInvolvedId) : null,
            assigneeId: closeNoIssue || !values.assigneeId ? null : Number(values.assigneeId),
            surveyScore: values.stage === 'survey_received' ? values.surveyScore : null,
            closeNoIssue,
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
  if (hub.data && !hub.data.can?.createCsi) {
    return (
      <div className="app-page">
        <p className="app-card">Your role does not log CSI calls.</p>
      </div>
    );
  }

  const send = (closeNoIssue: boolean) =>
    form.submit(values => {
      if (values.sentiment === 'unhappy') {
        const problem = PROBLEMS_RULE.problems[0]!(values.problems);
        if (problem) {
          form.setServerErrors({problems: problem});
          document.querySelector<HTMLInputElement>('input[name="problems"]')?.focus();
          return;
        }
      }
      create.mutate({values, closeNoIssue});
    });

  return (
    <div className="app-page">
      <form className="hub-form" onSubmit={send(happy)} noValidate>
        <fieldset>
          <legend>Store and visit</legend>
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
                name="department"
                legend="Department"
                required
                options={store && !store.hasService ? CSI_DEPARTMENTS.filter(d => d.value === 'sales') : CSI_DEPARTMENTS}
                value={v.department}
                onChange={value => form.set('department', value)}
                error={form.error('department')}
                inputRef={form.field('department').ref}
              />
            </div>
            {store && (
              <p className="muted wide">
                Manufacturer: <strong>{store.manufacturer}</strong> (from the store)
              </p>
            )}
            <Field
              id="f-refNumber"
              label={v.department === 'service' ? 'Repair Order (RO) #' : 'Deal #'}
              optional
              error={form.error('refNumber')}>
              <input {...form.field('refNumber')} autoComplete="off" />
            </Field>
            <Field
              id="f-eventDate"
              label={v.department === 'service' ? 'RO close date' : 'Delivery date'}
              optional
              error={form.error('eventDate')}>
              <input {...form.field('eventDate')} type="date" />
            </Field>
            <Field
              id="f-staffInvolvedId"
              label={v.department === 'service' ? 'Service advisor involved' : 'Salesperson involved'}
              optional
              hint={v.storeId ? undefined : 'Pick the store first.'}
              error={form.error('staffInvolvedId')}>
              <select {...form.field('staffInvolvedId')} disabled={!v.storeId}>
                <option value="">Not sure / not listed</option>
                {(options.data?.staff ?? []).map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </fieldset>

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
          <legend>The call</legend>
          <div className="hub-grid">
            <div className="wide">
              <Choices
                name="stage"
                legend="Stage"
                required
                options={CSI_STAGES}
                value={v.stage}
                onChange={value => form.set('stage', value)}
                error={form.error('stage')}
                inputRef={form.field('stage').ref}
              />
            </div>
            {v.stage === 'survey_received' && (
              <Field id="f-surveyScore" label="Survey score, as reported" optional error={form.error('surveyScore')}>
                <input {...form.field('surveyScore')} autoComplete="off" />
              </Field>
            )}
            <div className="wide">
              <Choices
                name="sentiment"
                legend="How the customer felt"
                required
                options={SENTIMENTS}
                value={v.sentiment}
                onChange={value => form.set('sentiment', value)}
                error={form.error('sentiment')}
                inputRef={form.field('sentiment').ref}
              />
            </div>
            {!happy && (
              <div className="wide">
                <MultiChoices
                  name="problems"
                  legend="What's wrong (pick one or more)"
                  hint={v.sentiment === 'unhappy' ? 'Required for an unhappy customer.' : undefined}
                  options={names.offered('problem') ?? PROBLEMS}
                  value={v.problems}
                  onChange={value => form.set('problems', value)}
                  error={form.error('problems')}
                />
              </div>
            )}
            <div className="wide">
              <Field
                id="f-customerWords"
                label={<>Customer&apos;s words <span className="req">· Required</span></>}
                error={form.error('customerWords')}>
                <textarea {...form.field('customerWords')} rows={3} maxLength={400} />
              </Field>
              <Counter value={v.customerWords} max={300} />
            </div>
          </div>
        </fieldset>

        {!happy && (
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
        )}

        {create.error && !(create.error instanceof ApiError && Object.keys(create.error.fields).length) && (
          <ErrorNote error={create.error} />
        )}
        <div className="form-bar">
          {happy ? (
            <Button type="submit" pending={create.isPending} pendingLabel="Logging…">
              Log call and close: no issue
            </Button>
          ) : (
            <Button type="submit" pending={create.isPending} pendingLabel="Sending…">
              Send to manager
            </Button>
          )}
          <Button variant="ghost" disabled={create.isPending} onClick={() => void navigate({to: '/'})}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
