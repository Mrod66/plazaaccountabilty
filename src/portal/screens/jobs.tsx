import {useInfiniteQuery, useMutation, useQueryClient} from '@tanstack/react-query';
import {useState} from 'react';

import {type Job, JOB_TYPES} from '../../lib/types';
import {api, read} from '../api';
import {manageJobsQuery} from '../queries';
import {ErrorNote} from '../shared';
import {Button, Field, rules, useForm} from '../ui';

const EMPTY_JOB = {
  title: '',
  company: '',
  location: '',
  type: 'full-time',
  remote: false,
  description: '',
  applyUrl: '',
};

/** The job form's rules: the SAME limits `src/server/routes/jobs.ts` enforces. */
const JOB_RULES = {
  title: [rules.required('Enter a title.'), rules.maxLength(120)],
  company: [rules.required('Enter the company.'), rules.maxLength(80)],
  location: [rules.required('Enter a location, or "Anywhere".'), rules.maxLength(80)],
  description: [
    rules.required('Describe the job.'),
    rules.minLength(20, 'Write at least 20 characters so applicants know what it is.'),
    rules.maxLength(10000),
  ],
  applyUrl: [
    rules.required('Add where to apply.'),
    rules.pattern(/^(https:\/\/|mailto:)\S+$/i, 'Use an https:// link or a mailto: address.'),
    rules.maxLength(500),
  ],
};

/** Holders of `site:job:manage`: post, edit, close and delete jobs (`/site-api/jobs`). */
export function Jobs() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const form = useForm(EMPTY_JOB, JOB_RULES);
  const jobs = useInfiniteQuery(manageJobsQuery);
  const refresh = () => queryClient.invalidateQueries({queryKey: ['jobs']});
  const close = () => {
    setEditing(null);
    form.reset();
  };
  const save = useMutation({
    mutationFn: (values: typeof EMPTY_JOB) =>
      editing === 'new'
        ? read<{job: Job}>(api.jobs.$post({json: values}))
        : read<{job: Job}>(api.jobs[':id'].$patch({param: {id: String(editing)}, json: values})),
    onSuccess: () => {
      close();
      return refresh();
    },
  });
  const open = useMutation({
    mutationFn: (id: number) =>
      read<{job: Job}>(api.jobs.manage[':id'].$get({param: {id: String(id)}})),
    onSuccess: ({job}, id) => {
      form.reset({
        title: job.title,
        company: job.company,
        location: job.location,
        type: job.type,
        remote: job.remote,
        description: job.description,
        applyUrl: job.applyUrl,
      });
      save.reset();
      setEditing(id);
    },
  });
  const setStatus = useMutation({
    mutationFn: ({id, status}: {id: number; status: string}) =>
      read(api.jobs[':id'].$patch({param: {id: String(id)}, json: {status}})),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (id: number) => read(api.jobs[':id'].$delete({param: {id: String(id)}})),
    onSuccess: refresh,
  });
  // Which ROW is busy: only that row's buttons show it, and the row cannot be acted on twice.
  const busyId =
    (open.isPending && open.variables) ||
    (setStatus.isPending && setStatus.variables?.id) ||
    (remove.isPending && remove.variables) ||
    null;
  const rows = jobs.data?.pages.flatMap(page => page.jobs) ?? [];

  return (
    <div className="app-page">
      <div className="app-page-head">
        <h2>Jobs</h2>
        {editing === null && (
          <Button
            onClick={() => {
              form.reset();
              save.reset();
              setEditing('new');
            }}>
            Post a job
          </Button>
        )}
      </div>
      <p className="muted">
        Listed on <a href="/jobs/">/jobs</a>. Stored in this site's database; only people allowed to manage jobs see this screen.
      </p>

      {editing !== null && (
        <form className="app-card form-card" onSubmit={form.submit(values => save.mutate(values))} noValidate>
          <h3>{editing === 'new' ? 'New job' : 'Edit job'}</h3>
          <div className="form-grid">
            <Field id="f-title" label="Title" error={form.error('title')}>
              <input {...form.field('title')} autoComplete="off" />
            </Field>
            <Field id="f-company" label="Company" error={form.error('company')}>
              <input {...form.field('company')} autoComplete="organization" />
            </Field>
            <Field id="f-location" label="Location" error={form.error('location')}>
              <input {...form.field('location')} />
            </Field>
            <Field id="f-type" label="Job type">
              <select {...form.field('type')}>
                {JOB_TYPES.map(type => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </Field>
            <label className="check full">
              <input
                type="checkbox"
                checked={Boolean(form.values.remote)}
                onChange={event => form.set('remote', event.target.checked)}
              />{' '}
              Remote
            </label>
            <div className="full">
              <Field
                id="f-description"
                label="Description"
                hint="Leave a blank line between paragraphs."
                error={form.error('description')}>
                <textarea {...form.field('description')} rows={8} />
              </Field>
            </div>
            <div className="full">
              <Field
                id="f-applyUrl"
                label="Apply link"
                hint="An https:// link or a mailto: address."
                error={form.error('applyUrl')}>
                <input {...form.field('applyUrl')} inputMode="url" />
              </Field>
            </div>
          </div>
          {save.error && <ErrorNote error={save.error} />}
          <div className="actions">
            <Button type="submit" pending={save.isPending} pendingLabel="Saving…">
              {editing === 'new' ? 'Post job' : 'Save changes'}
            </Button>
            <Button variant="ghost" onClick={close} disabled={save.isPending}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {jobs.error && <ErrorNote error={jobs.error} />}
      {jobs.isPending && <p className="muted">Loading…</p>}
      {rows.length === 0 && jobs.isSuccess && (
        <div className="app-empty">
          <p className="muted">No jobs yet.</p>
        </div>
      )}
      <ul className="files">
        {rows.map(job => {
          const busy = busyId === job.id;
          return (
            <li key={job.id} aria-busy={busy || undefined}>
              <div>
                <a href={`/jobs/${encodeURIComponent(job.slug)}/`}>{job.title}</a>
                <span className="meta">
                  {job.company} · {job.location} · {job.status}
                </span>
              </div>
              <div className="row-actions">
                <Button
                  variant="link"
                  size="sm"
                  pending={open.isPending && open.variables === job.id}
                  pendingLabel="Opening…"
                  disabled={busy || save.isPending}
                  onClick={() => open.mutate(job.id)}>
                  Edit
                </Button>
                <Button
                  variant="link"
                  size="sm"
                  pending={setStatus.isPending && setStatus.variables?.id === job.id}
                  pendingLabel={job.status === 'open' ? 'Closing…' : 'Reopening…'}
                  disabled={busy}
                  onClick={() => setStatus.mutate({id: job.id, status: job.status === 'open' ? 'closed' : 'open'})}>
                  {job.status === 'open' ? 'Close' : 'Reopen'}
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  pending={remove.isPending && remove.variables === job.id}
                  pendingLabel="Deleting…"
                  disabled={busy}
                  onClick={() => window.confirm(`Delete “${job.title}”?`) && remove.mutate(job.id)}>
                  Delete
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      {(open.error || setStatus.error || remove.error) && (
        <ErrorNote error={(open.error ?? setStatus.error ?? remove.error)!} />
      )}
      {jobs.hasNextPage && (
        <Button
          variant="ghost"
          onClick={() => jobs.fetchNextPage()}
          pending={jobs.isFetchingNextPage}
          pendingLabel="Loading…">
          Load more
        </Button>
      )}
    </div>
  );
}
