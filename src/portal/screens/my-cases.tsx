import {useQuery} from '@tanstack/react-query';
import {Link} from '@tanstack/react-router';

import {myCasesQuery} from '../queries';
import {CaseTable, useHub, useStores} from '../hub';
import {ErrorNote} from '../shared';

/**
 * Everyone's home screen: the two big "new case" buttons, the cases waiting
 * on me (not accepted first, then red clocks, then amber, then the oldest),
 * then the cases I sent.
 */
export function MyCases() {
  const hub = useHub();
  const stores = useStores();
  const mine = useQuery(myCasesQuery);
  const can = hub.data?.can;

  if (hub.data && !hub.data.member) return <NotMember />;

  const waiting = mine.data?.waiting ?? [];
  const created = mine.data?.created ?? [];
  const unaccepted = waiting.filter(c => !c.accepted).length;

  return (
    <div className="app-page">
      {(can?.createHot || can?.createCsi) && (
        <div className="big-actions">
          {can.createHot && (
            <Link className="button big-action" to="/new/hot">
              <span className="big-action-plus" aria-hidden="true">
                +
              </span>
              New Hot Prospect
            </Link>
          )}
          {can.createCsi && (
            <Link className="button big-action" to="/new/csi">
              <span className="big-action-plus" aria-hidden="true">
                +
              </span>
              New CSI Call
            </Link>
          )}
        </div>
      )}

      {mine.error && <ErrorNote error={mine.error} />}

      <section className={`app-card${unaccepted ? ' attention-warn' : ''}`} aria-labelledby="waiting-h">
        <div className="section-head">
          <h3 id="waiting-h">Waiting on you</h3>
          {mine.data && (
            <p className="muted" role="status">
              {waiting.length === 0
                ? 'Nothing is waiting on you.'
                : `${waiting.length} open ${waiting.length === 1 ? 'case' : 'cases'}${unaccepted ? `, ${unaccepted} not accepted yet` : ''}`}
            </p>
          )}
        </div>
        <p className="muted">What this shows: every open case you own: not accepted first, then missed clocks (red), then clocks running low (amber). What to do with it: work it top to bottom.</p>
        {mine.isPending ? (
          <p className="muted">Loading your cases…</p>
        ) : waiting.length ? (
          <CaseTable cases={waiting} stores={stores} show="creator" caption="Cases waiting on you" />
        ) : (
          !mine.error && <p className="empty-card muted">You are all caught up. New cases sent to you appear here.</p>
        )}
      </section>

      <section className="app-card" aria-labelledby="created-h">
        <div className="section-head">
          <h3 id="created-h">Cases you sent</h3>
          <Link to="/cases" search={{state: 'all'}}>
            View all
          </Link>
        </div>
        {mine.isPending ? (
          <p className="muted">Loading…</p>
        ) : created.length ? (
          <CaseTable cases={created} stores={stores} show="owner" caption="Cases you created" />
        ) : (
          !mine.error && (
            <div className="empty-card">
              <p className="muted">You have not sent a case yet.</p>
              {can?.createHot && (
                <Link className="button ghost" to="/new/hot">
                  Send a Hot Prospect
                </Link>
              )}
            </div>
          )
        )}
      </section>
    </div>
  );
}

export function NotMember() {
  return (
    <div className="app-page">
      <section className="app-card attention-info">
        <h3>Your account is not set up in the hub yet</h3>
        <p>Ask your admin to add you in People, with your store and role. Then sign in again.</p>
      </section>
    </div>
  );
}
