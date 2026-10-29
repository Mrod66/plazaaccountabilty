import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {Link, useParams, useSearch} from '@tanstack/react-router';
import {type ReactNode, useEffect, useState} from 'react';

import {
  type CaseDetail,
  type CaseEventRow,
  CONTACT_METHODS,
  CONTACT_RESULTS,
  CSI_OUTCOMES,
  EVENT_LABELS,
  FINAL_SURVEY,
  formatDate,
  formatDuration,
  formatPhone,
  formatWhen,
  HOT_OUTCOMES,
  labels,
  LOST_REASONS,
  SHOWED,
} from '../../lib/hub';
import {api, ApiError, read} from '../api';
import {AcceptChip, Choices, ClockPill, Counter, ProgressBar, StatusChip, StoreChip, useLabels, useStores} from '../hub';
import {caseQuery, handoffPeopleQuery} from '../queries';
import {ErrorNote} from '../shared';
import {Button, Field, rules, useForm} from '../ui';

type Panel = 'contact' | 'note' | 'handoff' | 'close' | 'reopen' | 'after' | null;

/**
 * One case: who has it, where it stands, everything that happened, and the
 * actions the viewer may take now (the server decides `can`, and checks again).
 * Every save sends the version on screen: if someone changed the case
 * meanwhile, nothing is saved and the screen says to reload.
 */
export function Case() {
  const {caseId} = useParams({from: '/cases/$caseId'});
  const search = useSearch({from: '/cases/$caseId'});
  const query = useQuery(caseQuery(caseId));
  const stores = useStores();
  const [panel, setPanel] = useState<Panel>(null);
  const [done, setDone] = useState<string | null>(search.created ? 'Sent. The manager has it now.' : null);
  const queryClient = useQueryClient();
  // Opening a case marks your alerts about it read (the bell goes down).
  useEffect(() => {
    void read(api.alerts.read.$post({json: {caseId: Number(caseId)}}))
      .then(() => queryClient.invalidateQueries({queryKey: ['alerts']}))
      .catch(() => undefined);
  }, [caseId, queryClient]);

  if (query.isPending) return <p className="muted">Loading the case…</p>;
  if (query.error) {
    return (
      <div className="app-page">
        {query.error instanceof ApiError && query.error.status === 404 ? (
          <section className="app-card">
            <h3>Case not found</h3>
            <p>Either it does not exist, or it is not one of yours.</p>
            <Link className="button ghost" to="/">
              Back to My Cases
            </Link>
          </section>
        ) : (
          <ErrorNote error={query.error} />
        )}
      </div>
    );
  }

  const c = query.data.case;
  const closed = c.status === 'closed';
  const store = stores.get(c.storeId);
  const open = (next: Panel) => {
    setDone(null);
    setPanel(current => (current === next ? null : next));
  };
  const finished = (message: string) => {
    setPanel(null);
    setDone(message);
  };

  return (
    <div className="app-page">
      <section className={`app-card${!c.accepted && !closed ? ' attention-warn' : ''}`} aria-labelledby="case-h">
        <div className="section-head">
          <h2 id="case-h">
            {c.number} · {labels.type(c.type)}
          </h2>
          <div className="chips">
            <StoreChip store={store} />
            {c.type === 'csi' && <span className="chip">{labels.department('csi', c.department)}</span>}
            <StatusChip type={c.type} status={c.status} />
            <AcceptChip accepted={c.accepted} closed={closed} />
          </div>
        </div>
        <ProgressBar type={c.type} status={c.status} />
        <dl className="facts gap-top">
          <Fact label={closed ? 'Was with' : 'With'}>
            <strong>{c.owner.name}</strong> since {formatWhen(c.ownerSince)}
          </Fact>
          <Fact label="Sent by">
            {c.createdBy.name}, {formatWhen(c.createdAt)}
          </Fact>
          <Fact label="Accepted">{c.acceptedAt ? formatWhen(c.acceptedAt) : 'Not yet'}</Fact>
          <Fact label={c.type === 'csi' ? 'Manager first called' : 'Customer first contacted'}>
            {c.firstContactAt ? formatWhen(c.firstContactAt) : 'Not yet'}
          </Fact>
          <Fact label="Customer reached">
            {c.reachedAt ? formatWhen(c.reachedAt) : c.firstContactAt ? 'Attempted only, not reached yet' : 'Not yet'}
          </Fact>
          {closed && <Fact label="Closed">{formatWhen(c.closedAt)}</Fact>}
          {c.followUpAt && !closed && <Fact label="Next follow-up">{formatWhen(c.followUpAt)}</Fact>}
        </dl>
        {!c.accepted && !closed && (
          <p className="waiting-note" role="status">
            <span className="dot" aria-hidden="true" />
            Waiting for {c.owner.name} to accept.
          </p>
        )}
      </section>

      {done && (
        <p className="notice notice-ok" role="status">
          {done}
        </p>
      )}

      {c.clocks.length > 0 && (
        <section className={`app-card${c.clock?.state === 'missed' ? ' attention' : c.clock?.state === 'warning' ? ' attention-warn' : ''}`} aria-labelledby="clocks-h">
          <h3 id="clocks-h">Clocks</h3>
          <ul className="clock-list">
            {c.clocks.map(clock => (
              <li key={clock.id}>
                <ClockPill clock={clock} type={c.type} showOwner={clock.kind === 'accept' && c.clocks.filter(k => k.kind === 'accept').length > 1} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <Actions c={c} panel={panel} open={open} finished={finished} />

      <div className="case-layout">
        <div className="case-side">
          <section className="app-card" aria-labelledby="cust-h">
            <h3 id="cust-h">Customer</h3>
            <dl className="facts">
              <Fact label="Name">{c.customerName}</Fact>
              <Fact label="Mobile">
                <a href={`tel:${c.phone}`}>{formatPhone(c.phone)}</a>
              </Fact>
              {c.customerEmail && (
                <Fact label="Email">
                  <a href={`mailto:${c.customerEmail}`}>{c.customerEmail}</a>
                </Fact>
              )}
            </dl>
            <h3 className="gap-top">{c.type === 'csi' ? "Customer's words" : 'What the customer said'}</h3>
            <p className="quote">{c.customerWords}</p>
          </section>

          {c.type === 'hot' ? <HotFacts c={c} /> : <CsiFacts c={c} />}
          {c.outcome && <OutcomeFacts c={c} />}

          <section className="app-card" aria-labelledby="hist-h">
            <h3 id="hist-h">History</h3>
            <ol className="timeline">
              {c.events.map(event => (
                <li key={event.id}>
                  <time dateTime={event.createdAt}>{formatWhen(event.createdAt)}</time>
                  <span className="rail" aria-hidden="true" />
                  <div className="what">
                    <EventLine event={event} type={c.type} />
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <aside className="case-side" aria-label="Touch chain">
          <section className="app-card">
            <h3>Touch chain</h3>
            <p className="muted">Everyone who touched this case, what they did, and how long they held it.</p>
            <ol className="touch">
              {c.touchChain.map(t => (
                <li key={t.person.id} data-current={t.current ? '' : undefined}>
                  <strong>{t.person.name}</strong>
                  {t.current && <span className="muted"> · has it now</span>}
                  {t.roles.length > 0 && <div className="muted">{t.roles.join(', ')}</div>}
                  <div>{t.did.join(' · ') || 'Received it'}</div>
                  {t.heldMs > 0 && <div className="muted">Held it {formatDuration(t.heldMs)}</div>}
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>
    </div>
  );
}

function Fact({label, children}: {label: string; children: ReactNode}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function HotFacts({c}: {c: CaseDetail}) {
  const names = useLabels();
  const vehicle = [c.vehicleYear, c.vehicleMake, c.vehicleModel].filter(Boolean).join(' ');
  const trade = [c.tradeYear, c.tradeMake, c.tradeModel].filter(Boolean).join(' ');
  return (
    <section className="app-card">
      <h3>The deal</h3>
      <dl className="facts">
        <Fact label="Reason">{names.reason(c.reason)}</Fact>
        <Fact label="Source">{labels.source(c.source)}</Fact>
        <Fact label="Urgency">
          {labels.urgency(c.urgency)}
          {c.callbackAt ? `: ${formatWhen(c.callbackAt)}` : ''}
        </Fact>
        <Fact label="Vehicle">
          {vehicle || '—'}
          {c.vehicleCondition ? ` (${c.vehicleCondition})` : ''}
          {c.stockNumber ? ` · Stock ${c.stockNumber}` : ''}
        </Fact>
        <Fact label="Trade-in">
          {c.hasTrade ? `${trade}${c.tradeMiles !== null ? `, ${c.tradeMiles.toLocaleString('en-US')} miles` : ''}` : 'No'}
        </Fact>
      </dl>
    </section>
  );
}

function CsiFacts({c}: {c: CaseDetail}) {
  const names = useLabels();
  return (
    <section className="app-card">
      <h3>The visit</h3>
      <dl className="facts">
        <Fact label="Manufacturer">{c.manufacturer}</Fact>
        <Fact label={c.department === 'service' ? 'RO #' : 'Deal #'}>{c.refNumber ?? '—'}</Fact>
        <Fact label={c.department === 'service' ? 'RO closed' : 'Delivered'}>{formatDate(c.eventDate)}</Fact>
        <Fact label={c.department === 'service' ? 'Advisor' : 'Salesperson'}>{c.staffInvolved?.name ?? '—'}</Fact>
        <Fact label="Stage">{labels.stage(c.stage)}</Fact>
        <Fact label="Sentiment">{labels.sentiment(c.sentiment)}</Fact>
        {c.surveyScore && <Fact label="Survey score">{c.surveyScore}</Fact>}
        <Fact label="What's wrong">{c.problems.map(p => names.problem(p)).join(', ') || '—'}</Fact>
      </dl>
    </section>
  );
}

function OutcomeFacts({c}: {c: CaseDetail}) {
  const names = useLabels();
  return (
    <section className="app-card">
      <h3>Outcome</h3>
      <dl className="facts">
        <Fact label="Outcome">{labels.outcome(c.outcome)}</Fact>
        {c.appointmentAt && <Fact label="Appointment">{formatWhen(c.appointmentAt)}</Fact>}
        {c.lostReason && <Fact label="Lost because">{names.lostReason(c.lostReason)}</Fact>}
        {c.showed && <Fact label="Showed?">{labels.showed(c.showed)}</Fact>}
        {c.type === 'csi' && <Fact label="Final survey">{c.finalSurvey ? labels.finalSurvey(c.finalSurvey) : 'Not entered yet'}</Fact>}
      </dl>
      {c.outcomeNote && <p className="quote">{c.outcomeNote}</p>}
    </section>
  );
}

function EventLine({event, type}: {event: CaseEventRow; type: string}) {
  let detail: ReactNode = null;
  switch (event.kind) {
    case 'created':
      detail = event.to ? <>Sent to {event.to.name}</> : null;
      break;
    case 'handed_off':
    case 'reassigned':
      detail = (
        <>
          From {event.from?.name} to {event.to?.name}. Waiting for them to accept.
        </>
      );
      break;
    case 'contacted':
      detail = (
        <>
          {labels.method(event.method)}: {labels.contactResult(event.result)}
        </>
      );
      break;
    case 'status':
    case 'reopened':
      detail = <>Now: {labels.status(type, event.toStatus)}</>;
      break;
    case 'outcome':
      detail = (
        <>
          {labels.outcome(event.result)}
          {event.at ? `: ${formatWhen(event.at)}` : ''}
        </>
      );
      break;
    case 'follow_up':
      detail = <>Next follow-up {formatWhen(event.at)}</>;
      break;
    case 'showed':
      detail = <>{labels.showed(event.result)}</>;
      break;
    case 'final_survey':
      detail = <>Final survey: {labels.finalSurvey(event.result)}</>;
      break;
  }
  return (
    <>
      <strong>{event.actor.name}</strong> · {EVENT_LABELS[event.kind] ?? event.kind}
      {detail && <div>{detail}</div>}
      {event.note && <p>{event.note}</p>}
    </>
  );
}

// ---------------------------------------------------------------- actions

function useCaseAction(c: CaseDetail, path: string, done: (message: string) => void, message: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      read(
        // The typed client knows these paths; one call site keeps the version handling in one place.
        (api.cases[':id'] as unknown as Record<string, {$post: (a: unknown) => Promise<Response>}>)[path]!.$post({
          param: {id: String(c.id)},
          json: {version: c.version, ...body},
        })
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({queryKey: ['cases']});
      done(message);
    },
  });
}

/** A stale save: say so, with the way out. */
function SaveError({error, caseId}: {error: Error | null; caseId: number}) {
  const queryClient = useQueryClient();
  if (!error || (error instanceof ApiError && Object.keys(error.fields).length)) return null;
  const stale = error instanceof ApiError && error.status === 409;
  return (
    <div className="notice notice-error" role="alert">
      {error.message}{' '}
      {stale && (
        <Button
          variant="link"
          size="sm"
          onClick={() => void queryClient.invalidateQueries({queryKey: ['cases', 'one', String(caseId)]})}>
          Reload the case
        </Button>
      )}
    </div>
  );
}

function Actions({c, panel, open, finished}: {c: CaseDetail; panel: Panel; open: (p: Panel) => void; finished: (m: string) => void}) {
  const accept = useCaseAction(c, 'accept', finished, 'Accepted. It is yours now: contact the customer.');
  const working = useCaseAction(c, 'status', finished, c.type === 'csi' ? 'Marked as fix in progress.' : 'Marked as working.');
  const busy = accept.isPending || working.isPending;
  const workLabel = c.type === 'csi' ? 'Mark fix in progress' : 'Mark as working';
  const showWorking = c.can.work && !['working', 'fixing'].includes(c.status);
  const any = c.can.accept || c.can.work || c.can.handOff || c.can.note || c.can.reopen || c.can.afterClose;
  if (!any) return null;
  return (
    <section className="app-card" aria-label="Actions">
      <div className="case-actions">
        {c.can.accept && (
          <Button pending={accept.isPending} pendingLabel="Accepting…" disabled={busy} onClick={() => accept.mutate({})}>
            Accept this case
          </Button>
        )}
        {c.can.work && (
          <Button disabled={busy} onClick={() => open('contact')} aria-expanded={panel === 'contact'}>
            {c.type === 'csi' ? 'Log a call' : 'Log contact'}
          </Button>
        )}
        {showWorking && (
          <Button variant="ghost" pending={working.isPending} pendingLabel="Saving…" disabled={busy} onClick={() => working.mutate({})}>
            {workLabel}
          </Button>
        )}
        {c.can.note && (
          <Button variant="ghost" disabled={busy} onClick={() => open('note')} aria-expanded={panel === 'note'}>
            Add a note
          </Button>
        )}
        {c.can.handOff && (
          <Button variant="ghost" disabled={busy} onClick={() => open('handoff')} aria-expanded={panel === 'handoff'}>
            Hand off
          </Button>
        )}
        {c.can.work && (
          <Button variant="danger" disabled={busy} onClick={() => open('close')} aria-expanded={panel === 'close'}>
            Close case
          </Button>
        )}
        {c.can.afterClose && (
          <Button variant="ghost" disabled={busy} onClick={() => open('after')} aria-expanded={panel === 'after'}>
            {c.type === 'csi' ? 'Enter final survey' : 'Showed / sold'}
          </Button>
        )}
        {c.can.reopen && (
          <Button variant="ghost" disabled={busy} onClick={() => open('reopen')} aria-expanded={panel === 'reopen'}>
            Reopen
          </Button>
        )}
      </div>
      <SaveError error={accept.error ?? working.error} caseId={c.id} />
      {panel === 'contact' && <ContactPanel c={c} done={finished} cancel={() => open(null)} />}
      {panel === 'note' && <NotePanel c={c} done={finished} cancel={() => open(null)} />}
      {panel === 'handoff' && <HandoffPanel c={c} done={finished} cancel={() => open(null)} />}
      {panel === 'close' && <ClosePanel c={c} done={finished} cancel={() => open(null)} />}
      {panel === 'reopen' && <ReopenPanel c={c} done={finished} cancel={() => open(null)} />}
      {panel === 'after' && <AfterPanel c={c} done={finished} cancel={() => open(null)} />}
    </section>
  );
}

type PanelProps = {c: CaseDetail; done: (message: string) => void; cancel: () => void};

function PanelBar({pending, label, pendingLabel, cancel}: {pending: boolean; label: string; pendingLabel: string; cancel: () => void}) {
  return (
    <div className="actions">
      <Button type="submit" pending={pending} pendingLabel={pendingLabel}>
        {label}
      </Button>
      <Button variant="ghost" disabled={pending} onClick={cancel}>
        Cancel
      </Button>
    </div>
  );
}

const setFieldErrors = (form: {setServerErrors: (e: Record<string, string>) => void}) => (error: Error) => {
  if (error instanceof ApiError) form.setServerErrors(error.fields);
};

function ContactPanel({c, done, cancel}: PanelProps) {
  const form = useForm({method: 'call', result: '', note: ''}, {result: [rules.required('Pick what happened.')], note: [rules.maxLength(1000)]});
  const save = useCaseAction(c, 'contact', done, 'Contact logged.');
  return (
    <form className="hub-form dialog-card app-card panel-form" noValidate onSubmit={form.submit(values => save.mutate(values, {onError: setFieldErrors(form)}))}>
      <h3>{c.type === 'csi' ? 'Log a call to the customer' : 'Log a contact with the customer'}</h3>
      <Choices name="method" legend="How" options={CONTACT_METHODS} value={form.values.method} onChange={v => form.set('method', v)} error={form.error('method')} />
      <Choices
        name="result"
        legend="What happened"
        required
        options={CONTACT_RESULTS}
        value={form.values.result}
        onChange={v => form.set('result', v)}
        error={form.error('result')}
        inputRef={form.field('result').ref}
      />
      <Field id="f-note" label="Note" optional error={form.error('note')}>
        <textarea {...form.field('note')} rows={3} />
      </Field>
      <SaveError error={save.error} caseId={c.id} />
      <PanelBar pending={save.isPending} label="Save" pendingLabel="Saving…" cancel={cancel} />
    </form>
  );
}

function NotePanel({c, done, cancel}: PanelProps) {
  const form = useForm({note: ''}, {note: [rules.required('Write the note.'), rules.maxLength(1000)]});
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: (values: {note: string}) => read(api.cases[':id'].note.$post({param: {id: String(c.id)}, json: values})),
    onSuccess: async () => {
      await queryClient.invalidateQueries({queryKey: ['cases']});
      done('Note added.');
    },
    onError: setFieldErrors(form),
  });
  return (
    <form className="hub-form dialog-card app-card panel-form" noValidate onSubmit={form.submit(values => save.mutate(values))}>
      <h3>Add a note</h3>
      <Field id="f-note" label="Note" error={form.error('note')}>
        <textarea {...form.field('note')} rows={3} />
      </Field>
      <Counter value={form.values.note} max={1000} />
      <SaveError error={save.error} caseId={c.id} />
      <PanelBar pending={save.isPending} label="Add note" pendingLabel="Adding…" cancel={cancel} />
    </form>
  );
}

function HandoffPanel({c, done, cancel}: PanelProps) {
  const people = useQuery(handoffPeopleQuery(String(c.id)));
  const form = useForm(
    {toUserId: '', reason: ''},
    {toUserId: [rules.required('Pick who takes it over.')], reason: [rules.required('Say why you are handing it off.'), rules.maxLength(300)]}
  );
  const save = useCaseAction(c, 'handoff', done, 'Handed off. It now waits for them to accept.');
  const list = people.data?.people ?? [];
  return (
    <form
      className="hub-form dialog-card app-card panel-form"
      noValidate
      onSubmit={form.submit(values => save.mutate({toUserId: Number(values.toUserId), reason: values.reason}, {onError: setFieldErrors(form)}))}>
      <h3>Hand off this case</h3>
      <p className="muted">The new person must accept it. Until they do, it shows as not accepted.</p>
      <Field id="f-toUserId" label="Hand off to" error={form.error('toUserId')} hint={people.isPending ? 'Loading people…' : undefined}>
        <select {...form.field('toUserId')}>
          <option value="">Pick a person</option>
          <optgroup label="This store">
            {list.filter(p => p.atStore).map(p => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </optgroup>
          <optgroup label="Everyone else">
            {list.filter(p => !p.atStore).map(p => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </optgroup>
        </select>
      </Field>
      {people.error && <ErrorNote error={people.error} />}
      <Field id="f-reason" label="Why" error={form.error('reason')}>
        <textarea {...form.field('reason')} rows={2} />
      </Field>
      <Counter value={form.values.reason} max={300} />
      <SaveError error={save.error} caseId={c.id} />
      <PanelBar pending={save.isPending} label="Hand off" pendingLabel="Handing off…" cancel={cancel} />
    </form>
  );
}

function ClosePanel({c, done, cancel}: PanelProps) {
  const names = useLabels();
  const form = useForm(
    {outcome: '', note: '', appointmentAt: '', lostReason: '', followUpAt: ''},
    {outcome: [rules.required('Pick how it ended.')], note: [rules.required('Write a note: what happened.'), rules.maxLength(1000)]}
  );
  const save = useCaseAction(c, 'close', done, 'Saved.');
  const outcome = form.values.outcome;
  const submit = form.submit(values => {
    // The extra field each outcome needs (the server checks the same).
    const extra: Record<string, string> = {};
    if (values.outcome === 'appointment' && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(values.appointmentAt)) {
      extra.appointmentAt = 'Pick the appointment date AND time.';
    }
    if (values.outcome === 'lost' && !values.lostReason) extra.lostReason = 'Pick why it was lost.';
    if (values.outcome === 'follow_up' && !values.followUpAt) extra.followUpAt = 'Pick the next follow-up date and time.';
    if (Object.keys(extra).length) {
      form.setServerErrors(extra);
      document.getElementById(`f-${Object.keys(extra)[0]}`)?.focus();
      return;
    }
    save.mutate(values, {onError: setFieldErrors(form)});
  });
  return (
    <form className="hub-form dialog-card app-card panel-form" noValidate onSubmit={submit}>
      <h3>Close this case</h3>
      <p className="muted">An outcome AND a note are required.</p>
      <Choices
        name="outcome"
        legend="Outcome"
        required
        options={c.type === 'csi' ? CSI_OUTCOMES : HOT_OUTCOMES}
        value={outcome}
        onChange={v => form.set('outcome', v)}
        error={form.error('outcome')}
        inputRef={form.field('outcome').ref}
      />
      {outcome === 'appointment' && (
        <Field id="f-appointmentAt" label="Appointment date and time" hint="Eastern time. A specific time is required." error={form.error('appointmentAt')}>
          <input {...form.field('appointmentAt')} type="datetime-local" />
        </Field>
      )}
      {outcome === 'lost' && (
        <Choices
          name="lostReason"
          legend="Lost reason"
          required
          options={names.offered('lost_reason') ?? LOST_REASONS}
          value={form.values.lostReason}
          onChange={v => form.set('lostReason', v)}
          error={form.error('lostReason')}
        />
      )}
      {outcome === 'follow_up' && (
        <Field id="f-followUpAt" label="Next follow-up" hint="Keeps the case open, as Working. On that day, log a contact or close it before the store closes, or its clock is missed." error={form.error('followUpAt')}>
          <input {...form.field('followUpAt')} type="datetime-local" />
        </Field>
      )}
      <Field id="f-note" label="Note" error={form.error('note')}>
        <textarea {...form.field('note')} rows={3} />
      </Field>
      <SaveError error={save.error} caseId={c.id} />
      <PanelBar
        pending={save.isPending}
        label={outcome === 'follow_up' ? 'Save follow-up' : 'Close case'}
        pendingLabel={outcome === 'follow_up' ? 'Saving…' : 'Closing…'}
        cancel={cancel}
      />
    </form>
  );
}

function ReopenPanel({c, done, cancel}: PanelProps) {
  const form = useForm({reason: ''}, {reason: [rules.required('Say why it is being reopened.'), rules.maxLength(300)]});
  const save = useCaseAction(c, 'reopen', done, 'Reopened. The outcome stays in the history.');
  return (
    <form className="hub-form dialog-card app-card panel-form" noValidate onSubmit={form.submit(values => save.mutate(values, {onError: setFieldErrors(form)}))}>
      <h3>Reopen this case</h3>
      <Field id="f-reason" label="Why" error={form.error('reason')}>
        <textarea {...form.field('reason')} rows={2} />
      </Field>
      <SaveError error={save.error} caseId={c.id} />
      <PanelBar pending={save.isPending} label="Reopen" pendingLabel="Reopening…" cancel={cancel} />
    </form>
  );
}

function AfterPanel({c, done, cancel}: PanelProps) {
  const isHot = c.type === 'hot';
  const appointmentPast = c.appointmentAt ? new Date(c.appointmentAt).getTime() <= Date.now() : false;
  const form = useForm(
    {choice: '', note: ''},
    {choice: [rules.required(isHot ? 'Pick one.' : 'Pick the final survey result.')], note: [rules.maxLength(1000)]}
  );
  const save = useCaseAction(c, 'after', done, 'Saved.');
  const options = isHot
    ? [
        ...(c.outcome === 'appointment' && appointmentPast ? SHOWED : []),
        ...(c.outcome !== 'sold' ? [{value: 'sold', label: 'It sold'}] : []),
      ]
    : FINAL_SURVEY;
  return (
    <form
      className="hub-form dialog-card app-card panel-form"
      noValidate
      onSubmit={form.submit(values =>
        save.mutate(
          isHot ? (values.choice === 'sold' ? {sold: true, note: values.note} : {showed: values.choice, note: values.note}) : {finalSurvey: values.choice, note: values.note},
          {onError: setFieldErrors(form)}
        )
      )}>
      <h3>{isHot ? 'After the appointment' : 'Final survey result'}</h3>
      {isHot && c.outcome === 'appointment' && !appointmentPast && (
        <p className="muted">Whether they showed can be entered after {formatWhen(c.appointmentAt)}.</p>
      )}
      {options.length ? (
        <Choices
          name="choice"
          legend={isHot ? 'What happened' : 'Survey came back'}
          required
          options={options}
          value={form.values.choice}
          onChange={v => form.set('choice', v)}
          error={form.error('choice')}
          inputRef={form.field('choice').ref}
        />
      ) : (
        <p className="muted">Nothing to record yet.</p>
      )}
      <Field id="f-note" label="Note" optional error={form.error('note')}>
        <textarea {...form.field('note')} rows={2} />
      </Field>
      <SaveError error={save.error} caseId={c.id} />
      <PanelBar pending={save.isPending} label="Save" pendingLabel="Saving…" cancel={cancel} />
    </form>
  );
}
