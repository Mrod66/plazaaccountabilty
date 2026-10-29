import {useQuery} from '@tanstack/react-query';
import {Link} from '@tanstack/react-router';

import type {Abilities, Viewer} from '../lib/types';
import {meQuery, siteQuery} from './queries';

/** Small pieces every portal screen uses. */

export const when = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat('en-GB', {dateStyle: 'medium', timeStyle: 'short'}).format(new Date(iso))
    : '—';

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(word => word[0]?.toUpperCase() ?? '')
    .join('');

export function ErrorNote({error}: {error: Error}) {
  return (
    <p className="notice notice-error" role="alert">
      {error.message}
    </p>
  );
}

export function Avatar({name}: {name: string}) {
  return (
    <span className="avatar avatar-fallback" aria-hidden="true">
      {initials(name)}
    </span>
  );
}

export interface Me {
  viewer: Viewer;
  roles: string[];
  abilities: Abilities;
}

/** Who is signed in, and what the portal may SHOW them. Shared by every screen. */
export function useMe() {
  return useQuery(meQuery);
}

/** The brand, for the sidebar. Public and cached on the server. */
export function useSite() {
  return useQuery(siteQuery);
}

/** One number on the overview. `value` null = still loading. */
export function Stat({label, value, hint, to}: {label: string; value: string | null; hint?: string; to?: string}) {
  const body = (
    <>
      <p className="stat-label">{label}</p>
      <p className="stat-value">{value ?? '—'}</p>
      {hint && <p className="stat-hint">{hint}</p>}
    </>
  );
  return to ? (
    <Link className="stat stat-link" to={to}>
      {body}
    </Link>
  ) : (
    <div className="stat">{body}</div>
  );
}

/**
 * A count for a stat tile from the FIRST page of a keyset list: "12", or
 * "25+" when there are more. Never a COUNT query per request; a total that
 * must be exact comes from a counter kept in the Site Database on write.
 */
export const pageCount = (rows: unknown[] | undefined, more: boolean) =>
  rows ? `${rows.length}${more ? '+' : ''}` : null;
