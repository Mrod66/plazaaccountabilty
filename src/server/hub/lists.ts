import type {PrismaClient} from '../../generated/prisma/client';
import {HOT_REASONS, LOST_REASONS, type Option, PROBLEMS} from '../../lib/hub';

/**
 * The editable pick lists (Admin → Pick lists): escalation reasons, lost
 * reasons, CSI problem types. Codes are stored on cases and never change;
 * labels, order and "offered or not" are the admin's. An organization with no
 * rows yet uses the built-in lists.
 */
export const PICK_LISTS = ['reason', 'lost_reason', 'problem'] as const;
export type PickList = (typeof PICK_LISTS)[number];

export type PickItem = Option & {id: number; active: boolean};
export type Lists = Record<PickList, PickItem[]>;

const BUILT_IN: Record<PickList, readonly Option[]> = {reason: HOT_REASONS, lost_reason: LOST_REASONS, problem: PROBLEMS};

export async function loadLists(db: PrismaClient, orgId: number): Promise<Lists> {
  const rows = await db.pickOption.findMany({
    where: {orgId},
    select: {id: true, list: true, code: true, label: true, active: true},
    orderBy: [{sortOrder: 'asc'}, {id: 'asc'}],
    take: 500,
  });
  const out = {} as Lists;
  for (const list of PICK_LISTS) {
    const mine = rows.filter(r => r.list === list);
    out[list] = mine.length
      ? mine.map(r => ({id: r.id, value: r.code, label: r.label, active: r.active}))
      : BUILT_IN[list].map((o, i) => ({id: -(i + 1), value: o.value, label: o.label, active: true}));
  }
  return out;
}

/** The codes that may be PICKED now (switched-off options stay readable on old cases). */
export const offered = (lists: Lists, list: PickList) => lists[list].filter(o => o.active).map(o => o.value);

/** `Wants a discount`-style label for a stored code, whatever its state. */
export const labelIn = (lists: Lists, list: PickList, code: string | null | undefined) =>
  lists[list].find(o => o.value === code)?.label ?? code ?? '';

/** A new option's code from its label: `Rebate expired` → `rebate_expired` (unique in the list). */
export function codeFor(label: string, taken: Set<string>): string {
  const base =
    label
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 20) || 'option';
  let code = base;
  for (let n = 2; taken.has(code); n++) code = `${base.slice(0, 20)}_${n}`;
  return code;
}
