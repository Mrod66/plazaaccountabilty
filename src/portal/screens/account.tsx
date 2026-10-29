import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {useState} from 'react';

import {matchCheck, passwordChecks} from '../../lib/password-checks';
import {AUTH_RULES, rules} from '../../lib/rules';
import type {Viewer} from '../../lib/types';
import {api, ApiError, read} from '../api';
import {sessionsQuery, twoFactorQuery} from '../queries';
import {ErrorNote, useMe, when} from '../shared';
import {Button, Field, PasswordChecks, PasswordInput, useForm} from '../ui';

/**
 * `/portal/account`: your name, email, password, two-step sign-in, signed-in devices, and
 * deleting the account. Every action is the auth core's (`/site-api/auth/*`, docs/agent/auth.md).
 */
export function Account() {
  const me = useMe();
  const viewer = me.data?.viewer;
  if (!viewer) return me.error ? <ErrorNote error={me.error} /> : <p className="muted">Loading…</p>;
  return <AccountForms viewer={viewer} />;
}

function AccountForms({viewer}: {viewer: Viewer}) {
  const queryClient = useQueryClient();
  const profile = useForm({name: viewer.name ?? ''}, {name: AUTH_RULES.name});
  const [profileSaved, setProfileSaved] = useState(false);
  const saveProfile = useMutation({
    mutationFn: (values: {name: string}) => read(api.auth.me.$patch({json: values})),
    onSuccess: () => {
      setProfileSaved(true);
      return queryClient.invalidateQueries({queryKey: ['me']});
    },
    onError: err => err instanceof ApiError && profile.setServerErrors(err.fields),
  });

  const password = useForm(
    {currentPassword: '', newPassword: '', confirm: ''},
    {
      currentPassword: [rules.required('Enter your current password.')],
      newPassword: [rules.passwordMeetsRules(() => viewer.email ?? '')],
      confirm: [rules.required('Type the new password again.')],
    }
  );
  const [passwordDone, setPasswordDone] = useState<string | null>(null);
  const [passwordTried, setPasswordTried] = useState(false);
  const changePassword = useMutation({
    mutationFn: (values: {currentPassword: string; newPassword: string}) =>
      read<{message: string}>(api.auth['change-password'].$post({json: values})),
    onSuccess: data => {
      password.reset();
      setPasswordTried(false);
      setPasswordDone(data.message);
    },
    onError: err => err instanceof ApiError && password.setServerErrors(err.fields),
  });

  // Reloads when done (every page then renders signed out), so pending never needs resetting.
  const [endingAll, setEndingAll] = useState(false);
  const logoutAll = useMutation({
    mutationFn: () => read(api.auth['logout-all'].$post()),
    onMutate: () => setEndingAll(true),
    onSuccess: () => window.location.assign('/account/login/'),
    onError: () => setEndingAll(false),
  });

  return (
    <div className="app-page">
      <div className="app-page-head">
        <div>
          <h2>Your account</h2>
          <p className="muted">
            Signed in as {viewer.email}
            {viewer.emailVerified ? '' : ' (not confirmed yet)'}.
          </p>
        </div>
      </div>

      <form
        className="app-card form-card"
        noValidate
        onSubmit={profile.submit(values => {
          setProfileSaved(false);
          saveProfile.mutate({name: values.name});
        })}>
        <h3>Profile</h3>
        <Field id="f-name" label="Your name" error={profile.error('name')}>
          <input {...profile.field('name')} autoComplete="name" />
        </Field>
        {saveProfile.error && !(saveProfile.error instanceof ApiError && saveProfile.error.fields.name) && (
          <ErrorNote error={saveProfile.error} />
        )}
        {profileSaved && <p className="notice notice-ok" role="status">Saved.</p>}
        <div className="actions">
          <Button type="submit" pending={saveProfile.isPending} pendingLabel="Saving…">
            Save
          </Button>
        </div>
      </form>

      <form
        className="app-card form-card"
        noValidate
        onSubmit={event => {
          setPasswordTried(true);
          password.submit(values => {
            setPasswordDone(null);
            if (values.confirm !== values.newPassword) {
              password.setServerErrors({confirm: 'The two passwords are not the same.'});
              return;
            }
            changePassword.mutate({currentPassword: values.currentPassword, newPassword: values.newPassword});
          })(event);
        }}>
        <h3>Password</h3>
        <div className="form-grid">
          <div className="full">
            <Field id="f-currentPassword" label="Current password" error={password.error('currentPassword')}>
              <PasswordInput {...password.field('currentPassword')} autoComplete="current-password" />
            </Field>
          </div>
          <div className="pw-field">
            <Field id="f-newPassword" label="New password" error={password.error('newPassword')}>
              <PasswordInput
                {...password.field('newPassword')}
                aria-describedby={`${password.field('newPassword')['aria-describedby']} f-newPassword-checks`}
                autoComplete="new-password"
              />
            </Field>
            <PasswordChecks
              id="f-newPassword-checks"
              tried={passwordTried}
              checks={passwordChecks(password.values.newPassword, viewer.email ?? '')}
            />
          </div>
          <div className="pw-field">
            <Field id="f-confirm" label="Type it again" error={password.error('confirm')}>
              <PasswordInput
                {...password.field('confirm')}
                aria-describedby={`${password.field('confirm')['aria-describedby']} f-confirm-checks`}
                autoComplete="new-password"
              />
            </Field>
            {(password.values.confirm || passwordTried) && (
              <PasswordChecks
                id="f-confirm-checks"
                tried={passwordTried}
                checks={[matchCheck(password.values.newPassword, password.values.confirm)]}
              />
            )}
          </div>
        </div>
        {changePassword.error && !(changePassword.error instanceof ApiError && Object.keys(changePassword.error.fields).length) && (
          <ErrorNote error={changePassword.error} />
        )}
        {passwordDone && (
          <p className="notice notice-ok" role="status">
            {passwordDone}
          </p>
        )}
        <div className="actions">
          <Button type="submit" pending={changePassword.isPending} pendingLabel="Changing…">
            Change password
          </Button>
        </div>
      </form>

      <EmailSection viewer={viewer} />
      <TwoFactorSection />
      <DevicesSection endingAll={endingAll} onSignOutEverywhere={() => logoutAll.mutate()} error={logoutAll.error} />
      <DeleteSection />
    </div>
  );
}

/** The current password, when the account has one (an account made by the dashboard's "Open admin" may not). */
function usePasswordNeeded() {
  const status = useQuery(twoFactorQuery);
  return status.data?.hasPassword ?? true;
}

function EmailSection({viewer}: {viewer: Viewer}) {
  const needsPassword = usePasswordNeeded();
  const form = useForm(
    {email: '', password: ''},
    {email: AUTH_RULES.email, password: needsPassword ? [rules.required('Enter your current password.')] : []}
  );
  const [sent, setSent] = useState<string | null>(null);
  const change = useMutation({
    mutationFn: (values: {email: string; password: string}) => read<{message: string}>(api.auth.email.$post({json: values})),
    onSuccess: data => {
      form.reset();
      setSent(data.message);
    },
    onError: err => err instanceof ApiError && form.setServerErrors(err.fields),
  });
  return (
    <form
      className="app-card form-card"
      noValidate
      onSubmit={form.submit(values => {
        setSent(null);
        change.mutate({email: values.email, password: values.password});
      })}>
      <h3>Email address</h3>
      <p className="muted">You sign in with {viewer.email}. We send a link to the new address; nothing changes until you open it.</p>
      <div className="form-grid">
        <div className="full">
          <Field id="f-newEmail" label="New email address" error={form.error('email')}>
            <input {...form.field('email')} type="email" autoComplete="email" inputMode="email" />
          </Field>
        </div>
        {needsPassword && (
          <div className="full">
            <Field id="f-emailPassword" label="Current password" error={form.error('password')}>
              <PasswordInput {...form.field('password')} autoComplete="current-password" />
            </Field>
          </div>
        )}
      </div>
      {change.error && !(change.error instanceof ApiError && Object.keys(change.error.fields).length) && <ErrorNote error={change.error} />}
      {sent && (
        <p className="notice notice-ok" role="status">
          {sent}
        </p>
      )}
      <div className="actions">
        <Button type="submit" pending={change.isPending} pendingLabel="Sending…">
          Send the link
        </Button>
      </div>
    </form>
  );
}

function TwoFactorSection() {
  const queryClient = useQueryClient();
  const status = useQuery(twoFactorQuery);
  const needsPassword = status.data?.hasPassword ?? true;
  const [setup, setSetup] = useState<{secret: string; uri: string; qr: string} | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const passwordForm = useForm({password: ''}, {password: needsPassword ? [rules.required('Enter your current password.')] : []});
  const codeForm = useForm({code: ''}, {code: [rules.required('Enter the 6-digit code from your app.')]});
  const refresh = () => queryClient.invalidateQueries({queryKey: ['account', 'two-factor']});

  const start = useMutation({
    mutationFn: (values: {password: string}) =>
      read<{secret: string; uri: string; qr: string}>(api.auth['two-factor'].setup.$post({json: values})),
    onSuccess: data => {
      passwordForm.reset();
      setSetup(data);
    },
    onError: err => err instanceof ApiError && passwordForm.setServerErrors(err.fields),
  });
  const enable = useMutation({
    mutationFn: (values: {code: string}) => read<{recoveryCodes: string[]}>(api.auth['two-factor'].enable.$post({json: values})),
    onSuccess: data => {
      codeForm.reset();
      setSetup(null);
      setCodes(data.recoveryCodes);
      return refresh();
    },
    onError: err => err instanceof ApiError && codeForm.setServerErrors(err.fields),
  });
  const disable = useMutation({
    mutationFn: (values: {password: string}) => read(api.auth['two-factor'].disable.$post({json: values})),
    onSuccess: () => {
      passwordForm.reset();
      setCodes(null);
      return refresh();
    },
    onError: err => err instanceof ApiError && passwordForm.setServerErrors(err.fields),
  });
  const renew = useMutation({
    mutationFn: (values: {password: string}) =>
      read<{recoveryCodes: string[]}>(api.auth['two-factor']['recovery-codes'].$post({json: values})),
    onSuccess: data => {
      passwordForm.reset();
      setCodes(data.recoveryCodes);
      return refresh();
    },
    onError: err => err instanceof ApiError && passwordForm.setServerErrors(err.fields),
  });

  if (!status.data) {
    return (
      <section className="app-card form-card">
        <h3>Two-step sign-in</h3>
        {status.error ? <ErrorNote error={status.error} /> : <p className="muted">Loading…</p>}
      </section>
    );
  }

  const passwordField = needsPassword && (
    <Field id="f-2faPassword" label="Current password" error={passwordForm.error('password')}>
      <PasswordInput {...passwordForm.field('password')} autoComplete="current-password" />
    </Field>
  );
  const failed = start.error ?? enable.error ?? disable.error ?? renew.error;

  return (
    <section className="app-card form-card">
      <h3>Two-step sign-in</h3>
      {codes && (
        <div className="notice notice-ok" role="status">
          <p>
            <strong>Save your recovery codes now.</strong> Each one signs you in once if you lose your phone. You won't see them again.
          </p>
          <ul className="recovery-codes">
            {codes.map(code => (
              <li key={code}>
                <code>{code}</code>
              </li>
            ))}
          </ul>
          <div className="actions">
            <Button variant="ghost" onClick={() => void navigator.clipboard?.writeText(codes.join('\n'))}>
              Copy codes
            </Button>
            <Button variant="link" onClick={() => setCodes(null)}>
              I saved them
            </Button>
          </div>
        </div>
      )}

      {status.data.enabled ? (
        <form
          noValidate
          onSubmit={event => {
            const action = (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value');
            passwordForm.submit(values => (action === 'renew' ? renew : disable).mutate({password: values.password}))(event);
          }}>
          <p className="muted">
            On. Signing in asks for a code from your authenticator app. Recovery codes left: {status.data.recoveryCodesLeft}.
          </p>
          {passwordField}
          {failed && !(failed instanceof ApiError && Object.keys(failed.fields).length) && <ErrorNote error={failed} />}
          <div className="actions">
            <Button type="submit" value="renew" variant="ghost" pending={renew.isPending} pendingLabel="Making codes…">
              New recovery codes
            </Button>
            <Button type="submit" value="disable" variant="danger" pending={disable.isPending} pendingLabel="Turning off…">
              Turn off
            </Button>
          </div>
        </form>
      ) : setup ? (
        <form noValidate onSubmit={codeForm.submit(values => enable.mutate({code: values.code}))}>
          <p className="muted">Scan this with an authenticator app (Google Authenticator, 1Password, Authy…), then enter the code it shows.</p>
          <img className="qr" src={setup.qr} alt="QR code for your authenticator app" width={180} height={180} />
          <p className="muted">
            Can't scan? Enter this key in the app: <code>{setup.secret}</code>
          </p>
          <Field id="f-2faCode" label="6-digit code" error={codeForm.error('code')}>
            <input {...codeForm.field('code')} autoComplete="one-time-code" inputMode="numeric" maxLength={8} />
          </Field>
          {enable.error && !(enable.error instanceof ApiError && Object.keys(enable.error.fields).length) && <ErrorNote error={enable.error} />}
          <div className="actions">
            <Button type="submit" pending={enable.isPending} pendingLabel="Checking…">
              Turn on
            </Button>
            <Button variant="link" onClick={() => setSetup(null)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <form noValidate onSubmit={passwordForm.submit(values => start.mutate({password: values.password}))}>
          <p className="muted">Off. Turn it on and signing in also asks for a code from your phone, so a stolen password is not enough.</p>
          {passwordField}
          {start.error && !(start.error instanceof ApiError && Object.keys(start.error.fields).length) && <ErrorNote error={start.error} />}
          <div className="actions">
            <Button type="submit" pending={start.isPending} pendingLabel="Starting…">
              Set up two-step sign-in
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}

function DevicesSection({
  endingAll,
  onSignOutEverywhere,
  error,
}: {
  endingAll: boolean;
  onSignOutEverywhere: () => void;
  error: Error | null;
}) {
  const queryClient = useQueryClient();
  const sessions = useQuery(sessionsQuery);
  const signOut = useMutation({
    mutationFn: (id: string) => read(api.auth.sessions[':id'].$delete({param: {id}})),
    onSuccess: (_data, id) => {
      if (sessions.data?.sessions.find(s => s.id === id)?.current) {
        window.location.assign('/account/login/');
        return;
      }
      return queryClient.invalidateQueries({queryKey: ['account', 'sessions']});
    },
  });
  return (
    <section className="app-card form-card">
      <h3>Signed-in devices</h3>
      {sessions.error && <ErrorNote error={sessions.error} />}
      {!sessions.data && !sessions.error && <p className="muted">Loading…</p>}
      {sessions.data && (
        <ul className="device-list">
          {sessions.data.sessions.map(session => (
            <li key={session.id}>
              <span>
                <strong>{session.device}</strong>
                {session.current && <span className="badge">This device</span>}
                <span className="muted"> · active {when(session.lastActiveAt)}</span>
              </span>
              <Button
                variant="link"
                pending={signOut.isPending && signOut.variables === session.id}
                pendingLabel="Signing out…"
                onClick={() => signOut.mutate(session.id)}>
                Sign out
              </Button>
            </li>
          ))}
        </ul>
      )}
      {signOut.error && <ErrorNote error={signOut.error} />}
      {error && <ErrorNote error={error} />}
      <div className="actions">
        <Button
          variant="danger"
          pending={endingAll}
          pendingLabel="Signing out…"
          onClick={() => window.confirm('Sign out on every device, including this one?') && onSignOutEverywhere()}>
          Sign out everywhere
        </Button>
      </div>
    </section>
  );
}

function DeleteSection() {
  const needsPassword = usePasswordNeeded();
  const form = useForm(
    {password: '', confirm: ''},
    {
      password: needsPassword ? [rules.required('Enter your current password.')] : [],
      confirm: [rules.required('Type DELETE to confirm.')],
    }
  );
  const remove = useMutation({
    mutationFn: (values: {password: string; confirm: string}) => read(api.auth['delete-account'].$post({json: values})),
    onSuccess: () => window.location.assign('/'),
    onError: err => err instanceof ApiError && form.setServerErrors(err.fields),
  });
  return (
    <form
      className="app-card form-card"
      noValidate
      onSubmit={form.submit(values => remove.mutate({password: values.password, confirm: values.confirm.trim()}))}>
      <h3>Delete your account</h3>
      <p className="muted">This removes your account and signs you out everywhere. It can't be undone.</p>
      <div className="form-grid">
        {needsPassword && (
          <div className="full">
            <Field id="f-deletePassword" label="Current password" error={form.error('password')}>
              <PasswordInput {...form.field('password')} autoComplete="current-password" />
            </Field>
          </div>
        )}
        <div className="full">
          <Field id="f-deleteConfirm" label="Type DELETE to confirm" error={form.error('confirm')}>
            <input {...form.field('confirm')} autoComplete="off" spellCheck={false} />
          </Field>
        </div>
      </div>
      {remove.error && !(remove.error instanceof ApiError && Object.keys(remove.error.fields).length) && <ErrorNote error={remove.error} />}
      <div className="actions">
        <Button type="submit" variant="danger" pending={remove.isPending} pendingLabel="Deleting…">
          Delete my account
        </Button>
      </div>
    </form>
  );
}
