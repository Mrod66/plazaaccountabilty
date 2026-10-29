/**
 * The Plaza Accountability Hub's vocabulary: every pick list, status path and
 * label, shared by the Site API (validation) and the portal (forms, chips), so
 * the two can never disagree. Browser-safe: no server imports.
 *
 * Codes are stored; labels are shown. Never rename a code that has shipped
 * (rows hold it); change its label instead. Phase 4 moves the editable lists
 * (reasons, lost reasons, problem types) into Admin.
 */

/** Raise with every release; the footer of every screen shows it. */
export const HUB_VERSION = 'v1.0';
export const HUB_NAME = 'Plaza Accountability Hub';

export type Option<T extends string = string> = {value: T; label: string};

const labelOf = (options: readonly Option[], value: string | null | undefined) =>
  options.find(option => option.value === value)?.label ?? value ?? '';

export const CASE_TYPES = [
  {value: 'hot', label: 'Hot Prospect'},
  {value: 'csi', label: 'CSI Recovery'},
] as const satisfies readonly Option[];
export type CaseType = (typeof CASE_TYPES)[number]['value'];

// ------------------------------------------------------------------ Hot Prospect

export const HOT_SOURCES = [
  {value: 'phone', label: 'Phone call'},
  {value: 'internet', label: 'Internet lead'},
  {value: 'walk_in', label: 'Walk-in follow-up'},
  {value: 'text', label: 'Text'},
  {value: 'other', label: 'Other'},
] as const satisfies readonly Option[];

export const HOT_REASONS = [
  {value: 'discount', label: 'Wants a discount'},
  {value: 'payment', label: 'Payment or budget'},
  {value: 'trade_value', label: 'Trade value'},
  {value: 'credit', label: 'Credit or financing'},
  {value: 'availability', label: 'Vehicle availability'},
  {value: 'complaint', label: 'Complaint'},
  {value: 'manager', label: 'Wants to talk to a manager'},
  {value: 'other', label: 'Other'},
] as const satisfies readonly Option[];

export const HOT_URGENCY = [
  {value: 'now', label: 'Customer on the line now'},
  {value: 'today', label: 'Call back today'},
  {value: 'by_time', label: 'Call back by a set time'},
] as const satisfies readonly Option[];

export const VEHICLE_CONDITION = [
  {value: 'new', label: 'New'},
  {value: 'used', label: 'Used'},
] as const satisfies readonly Option[];

export const HOT_OUTCOMES = [
  {value: 'appointment', label: 'Appointment set'},
  {value: 'sold', label: 'Sold'},
  {value: 'lost', label: 'Lost'},
  {value: 'follow_up', label: 'Still working, follow-up set'},
] as const satisfies readonly Option[];

export const LOST_REASONS = [
  {value: 'bought_elsewhere', label: 'Bought elsewhere'},
  {value: 'price', label: 'Price'},
  {value: 'payment', label: 'Payment'},
  {value: 'trade_value', label: 'Trade value'},
  {value: 'credit', label: 'Credit'},
  {value: 'not_interested', label: 'No longer interested'},
  {value: 'no_reach', label: 'Could not reach'},
  {value: 'other', label: 'Other'},
] as const satisfies readonly Option[];

export const SHOWED = [
  {value: 'yes', label: 'Yes, they showed'},
  {value: 'no', label: 'No show'},
  {value: 'rescheduled', label: 'Rescheduled'},
] as const satisfies readonly Option[];

// ------------------------------------------------------------------ CSI Recovery

export const CSI_DEPARTMENTS = [
  {value: 'sales', label: 'Sales delivery'},
  {value: 'service', label: 'Service visit'},
] as const satisfies readonly Option[];

export const CSI_STAGES = [
  {value: 'pre_survey', label: 'Pre-survey check-in call'},
  {value: 'survey_received', label: 'Survey already received'},
] as const satisfies readonly Option[];

export const SENTIMENTS = [
  {value: 'happy', label: 'Happy'},
  {value: 'neutral', label: 'Neutral'},
  {value: 'unhappy', label: 'Unhappy'},
  {value: 'no_reach', label: 'Could not reach'},
] as const satisfies readonly Option[];

export const PROBLEMS = [
  {value: 'wait_time', label: 'Wait time'},
  {value: 'price_fees', label: 'Price or fees'},
  {value: 'paperwork', label: 'Paperwork or finance'},
  {value: 'condition', label: 'Vehicle condition'},
  {value: 'not_fixed', label: 'Repair not fixed'},
  {value: 'communication', label: 'Communication'},
  {value: 'attitude', label: 'Staff attitude'},
  {value: 'delivery', label: 'Delivery experience'},
  {value: 'loaner', label: 'Loaner or ride'},
  {value: 'other', label: 'Other'},
] as const satisfies readonly Option[];

export const CSI_OUTCOMES = [
  {value: 'recovered', label: 'Recovered: customer satisfied, expects a good survey'},
  {value: 'partly', label: 'Partly recovered'},
  {value: 'not_recovered', label: 'Not recovered (customer still unhappy)'},
  {value: 'no_reach', label: 'Could not reach after 3 attempts'},
] as const satisfies readonly Option[];

/** Only when the check-in call found a happy customer: logged and closed at once. */
export const NO_ISSUE = {value: 'no_issue', label: 'No issue (happy customer)'} as const;

export const FINAL_SURVEY = [
  {value: 'good', label: 'Good'},
  {value: 'bad', label: 'Bad'},
  {value: 'not_returned', label: 'Not returned'},
  {value: 'unknown', label: 'Unknown'},
] as const satisfies readonly Option[];

// ------------------------------------------------------------------ the case's life

export const HOT_STATUSES = [
  {value: 'new', label: 'New'},
  {value: 'accepted', label: 'Accepted'},
  {value: 'contacted', label: 'Customer contacted'},
  {value: 'working', label: 'Working'},
  {value: 'closed', label: 'Closed'},
] as const satisfies readonly Option[];

export const CSI_STATUSES = [
  {value: 'new', label: 'New'},
  {value: 'accepted', label: 'Accepted'},
  {value: 'called', label: 'Manager called customer'},
  {value: 'fixing', label: 'Fix in progress'},
  {value: 'closed', label: 'Closed'},
] as const satisfies readonly Option[];

export const statusesOf = (type: string) => (type === 'csi' ? CSI_STATUSES : HOT_STATUSES);

/** Position on the progress bar (0 = New … 4 = Closed). */
export const statusStep = (type: string, status: string) =>
  Math.max(0, (statusesOf(type) as readonly Option[]).findIndex(option => option.value === status));

export const CONTACT_METHODS = [
  {value: 'call', label: 'Call'},
  {value: 'text', label: 'Text'},
  {value: 'email', label: 'Email'},
] as const satisfies readonly Option[];

export const CONTACT_RESULTS = [
  {value: 'reached', label: 'Reached the customer'},
  {value: 'left_message', label: 'Left a message'},
  {value: 'no_answer', label: 'No answer'},
  {value: 'wrong_number', label: 'Wrong number'},
] as const satisfies readonly Option[];

export const DEPARTMENTS = [
  {value: 'sales', label: 'Sales'},
  {value: 'service', label: 'Service'},
  {value: 'group', label: 'Group (leadership, BDC, CSI)'},
] as const satisfies readonly Option[];

/** Who a new case goes to, per store (Admin → Routing). */
export const ROUTE_KINDS = [
  {value: 'hot_bdc', label: 'Hot Prospect from a BDC rep'},
  {value: 'hot_sales', label: 'Hot Prospect from a salesperson'},
  {value: 'csi_sales', label: 'CSI: sales delivery'},
  {value: 'csi_service', label: 'CSI: service visit'},
] as const satisfies readonly Option[];
export type RouteKind = (typeof ROUTE_KINDS)[number]['value'];

/** Event kinds in a case's history, as the timeline says them. */
export const EVENT_LABELS: Record<string, string> = {
  created: 'Created the case',
  accepted: 'Accepted the case',
  handed_off: 'Handed off',
  reassigned: 'Reassigned',
  contacted: 'Logged a contact',
  note: 'Added a note',
  status: 'Changed the status',
  outcome: 'Closed the case',
  follow_up: 'Set a follow-up',
  reopened: 'Reopened the case',
  showed: 'Recorded whether the customer showed',
  final_survey: 'Recorded the final survey',
  sold_later: 'Marked as sold',
  clock_missed: 'Clock missed',
  escalated: 'Escalated to their manager',
  email_capped: 'Email not sent (limit reached)',
};

export const labels = {
  source: (v?: string | null) => labelOf(HOT_SOURCES, v),
  reason: (v?: string | null) => labelOf(HOT_REASONS, v),
  urgency: (v?: string | null) => labelOf(HOT_URGENCY, v),
  outcome: (v?: string | null) =>
    v === NO_ISSUE.value ? NO_ISSUE.label : labelOf([...HOT_OUTCOMES, ...CSI_OUTCOMES], v),
  lostReason: (v?: string | null) => labelOf(LOST_REASONS, v),
  showed: (v?: string | null) => labelOf(SHOWED, v),
  department: (type: string, v?: string | null) =>
    type === 'csi' ? labelOf(CSI_DEPARTMENTS, v) : labelOf(DEPARTMENTS, v),
  stage: (v?: string | null) => labelOf(CSI_STAGES, v),
  sentiment: (v?: string | null) => labelOf(SENTIMENTS, v),
  problem: (v?: string | null) => labelOf(PROBLEMS, v),
  finalSurvey: (v?: string | null) => labelOf(FINAL_SURVEY, v),
  status: (type: string, v?: string | null) => labelOf(statusesOf(type), v),
  method: (v?: string | null) => labelOf(CONTACT_METHODS, v),
  contactResult: (v?: string | null) => labelOf(CONTACT_RESULTS, v),
  type: (v?: string | null) => labelOf(CASE_TYPES, v),
  routeKind: (v?: string | null) => labelOf(ROUTE_KINDS, v),
};

export const valuesOf = <T extends string>(options: readonly Option<T>[]) => options.map(option => option.value);

// ------------------------------------------------------------------ phones, times

/** Digits only, without a leading US `1`: `(718) 555-1234` → `7185551234`. */
export function phoneDigits(input: string): string {
  const digits = input.replace(/\D/g, '');
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
}

/** A US mobile number: exactly 10 digits once cleaned. */
export const isPhone = (input: string) => /^\d{10}$/.test(phoneDigits(input));

/** `7185551234` → `(718) 555-1234`; anything else as it is. */
export function formatPhone(digits: string | null | undefined): string {
  if (!digits) return '';
  const d = phoneDigits(digits);
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : d;
}

/** Every time in the hub is Eastern (Plaza is in Brooklyn). */
export const HUB_TIME_ZONE = 'America/New_York';

const dateTime = new Intl.DateTimeFormat('en-US', {
  timeZone: HUB_TIME_ZONE,
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});
const dateOnly = new Intl.DateTimeFormat('en-US', {timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric'});
const timeOnly = new Intl.DateTimeFormat('en-US', {timeZone: HUB_TIME_ZONE, hour: 'numeric', minute: '2-digit'});

/** `Oct 29, 2026, 3:45 PM` in Eastern time. */
export const formatWhen = (iso: string | null | undefined) => (iso ? dateTime.format(new Date(iso)) : '—');
/** A calendar date stored as `YYYY-MM-DD` (no time zone shift). */
export const formatDate = (iso: string | null | undefined) => (iso ? dateOnly.format(new Date(`${iso.slice(0, 10)}T00:00:00Z`)) : '—');
export const formatTime = (iso: string | null | undefined) => (iso ? timeOnly.format(new Date(iso)) : '');

/** `2h 05m`, `3d 4h`, `12 min`: how long something took. */
export function formatDuration(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/**
 * The UTC instant of a wall-clock time in Eastern time: `2026-11-03T15:30`
 * (from a date + time field) → a Date. Handles daylight saving both ways.
 */
export function easternToUtc(local: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!match) return null;
  const [, y, mo, d, h, mi] = match.map(Number) as [number, number, number, number, number, number];
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  if (Number.isNaN(guess)) return null;
  // What Eastern clocks read at `guess`, and how far that is from what we wanted.
  const offsetAt = (instant: number) => {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', {
        timeZone: HUB_TIME_ZONE,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
        .formatToParts(new Date(instant))
        .map(part => [part.type, part.value])
    );
    const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
    return asUtc - instant;
  };
  const first = guess - offsetAt(guess);
  const result = guess - offsetAt(first);
  const back = new Date(result);
  return Number.isNaN(back.getTime()) ? null : back;
}

/** The Eastern wall-clock `YYYY-MM-DDTHH:MM` of an instant (to fill a datetime field). */
export function utcToEasternLocal(iso: string | Date): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: HUB_TIME_ZONE,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
      .formatToParts(new Date(iso))
      .map(part => [part.type, part.value])
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

// ------------------------------------------------------------------ API shapes

export interface StoreRow {
  id: number;
  name: string;
  shortName: string;
  manufacturer: string;
  hasService: boolean;
}

export interface Person {
  id: number;
  name: string;
}

/** The signed-in person's place in the hub (`GET /site-api/hub/me`). */
export interface HubMe {
  /** False: the account has no Staff profile yet (an admin adds them in People). */
  member: boolean;
  org: {id: number; name: string} | null;
  storeIds: number[];
  department: string | null;
  stores: StoreRow[];
}

/** The three clocks (build prompt section 7). */
export const CLOCK_KINDS = [
  {value: 'accept', label: 'Accept'},
  {value: 'contact', label: 'Contact the customer'},
  {value: 'close', label: 'Close or set a follow-up'},
] as const satisfies readonly Option[];

export const clockLabel = (type: string, kind: string) =>
  kind === 'follow_up'
    ? 'Follow up (log a contact or close)'
    : kind === 'contact' && type === 'csi'
    ? 'Manager calls the customer'
    : kind === 'close' && type === 'csi'
      ? 'Close the case'
      : (CLOCK_KINDS as readonly Option[]).find(k => k.value === kind)?.label ?? kind;

/** One clock as the screens show it: green (on_time), amber (warning), red (missed), done (met). */
export interface ClockView {
  id: number;
  kind: string;
  owner: Person;
  state: 'on_time' | 'warning' | 'missed' | 'met';
  startedAt: string;
  dueAt: string;
  doneAt: string | null;
  missedAt: string | null;
  escalatedAt: string | null;
  escalatedTo: Person | null;
  /** Two business days past due and still not done: on the Overdue panel. */
  overdue: boolean;
}

export interface CaseSummary {
  id: number;
  number: string;
  type: string;
  status: string;
  storeId: number;
  department: string;
  customerName: string;
  phone: string;
  reason: string | null;
  sentiment: string | null;
  urgency: string | null;
  callbackAt: string | null;
  owner: Person;
  createdBy: Person;
  accepted: boolean;
  outcome: string | null;
  createdAt: string;
  ownerSince: string;
  closedAt: string | null;
  /** The most urgent clock still waiting (red, then amber, then the next due), or null. */
  clock: ClockView | null;
}

export interface CaseEventRow {
  id: string;
  kind: string;
  actor: Person;
  from: Person | null;
  to: Person | null;
  fromStatus: string | null;
  toStatus: string | null;
  method: string | null;
  result: string | null;
  note: string | null;
  at: string | null;
  createdAt: string;
}

export interface TouchRow {
  person: Person;
  roles: string[];
  did: string[];
  /** How long they held it as owner (ms); 0 when they never owned it. */
  heldMs: number;
  /** They own it now. */
  current: boolean;
}

export interface CaseDetail extends CaseSummary {
  version: number;
  customerEmail: string | null;
  customerWords: string;
  createdTeam: string;
  acceptedAt: string | null;
  firstContactAt: string | null;
  /** First contact that actually reached the customer; null = attempted only (or none yet). */
  reachedAt: string | null;
  // Hot
  source: string | null;
  vehicleYear: number | null;
  vehicleMake: string | null;
  vehicleModel: string | null;
  vehicleCondition: string | null;
  stockNumber: string | null;
  hasTrade: boolean;
  tradeYear: number | null;
  tradeMake: string | null;
  tradeModel: string | null;
  tradeMiles: number | null;
  // CSI
  manufacturer: string | null;
  refNumber: string | null;
  eventDate: string | null;
  staffInvolved: Person | null;
  stage: string | null;
  surveyScore: string | null;
  problems: string[];
  // Outcome
  outcomeNote: string | null;
  appointmentAt: string | null;
  lostReason: string | null;
  followUpAt: string | null;
  showed: string | null;
  finalSurvey: string | null;
  /** What the viewer may do here (the server checks again). */
  can: {
    accept: boolean;
    work: boolean;
    handOff: boolean;
    note: boolean;
    reopen: boolean;
    afterClose: boolean;
  };
  events: CaseEventRow[];
  touchChain: TouchRow[];
  /** Every clock this case has had, oldest first (results are kept forever). */
  clocks: ClockView[];
}

export interface CasesPage {
  items: CaseSummary[];
  nextBefore: number | null;
}

export interface MyCases {
  waiting: CaseSummary[];
  created: CaseSummary[];
}

/** A phone number already on a case (the repeat flag). */
export interface PhoneMatch {
  visible: {id: number; number: string; type: string; status: string; owner: Person}[];
  /** Matching cases the viewer may not open: only that they exist is said. */
  hidden: number;
}

/** One of my alerts (`GET /site-api/alerts`). */
export interface AlertRow {
  id: string;
  caseId: number;
  caseNumber: string;
  customerName: string;
  caseClosed: boolean;
  kind: string;
  message: string;
  escalation: boolean;
  read: boolean;
  /** pending (waiting for the next batch), sent, capped (a limit blocked it), none (no email needed). */
  emailState: string;
  emailedAt: string | null;
  capped: boolean;
  createdAt: string;
}

/** Clock settings and business hours (Admin → Clocks and hours). */
export interface ClockSettingRow {
  caseType: string;
  kind: string;
  amount: number;
  unit: string;
}
export interface HoursRow {
  storeId: number;
  storeName: string;
  department: string;
  /** 7 entries, Sunday first: `{open: 'HH:MM', close: 'HH:MM'}` or null when closed. */
  days: ({open: string; close: string} | null)[];
}

export const CLOCK_SETTING_KINDS = [
  {value: 'accept', label: 'Accept within'},
  {value: 'contact', label: 'Contact / manager call within'},
  {value: 'close', label: 'Close (or follow-up set) within'},
  {value: 'escalate', label: 'After a miss, alert their manager after'},
  {value: 'overdue', label: 'After a miss, Overdue panel after'},
] as const satisfies readonly Option[];

export const CLOCK_UNITS = [
  {value: 'minutes', label: 'business minutes'},
  {value: 'hours', label: 'business hours'},
  {value: 'days', label: 'business days'},
] as const satisfies readonly Option[];

export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** 540 → `09:00`. */
export const minutesToTime = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
/** `09:00` → 540; null when not a time. */
export const timeToMinutes = (t: string): number | null => {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(t.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

// ------------------------------------------------------------------ reports (Phase 3)

/** One row of a dashboard table: a group (store, person, reason, week…) and its counts. */
export interface ReportRow {
  /** The group's key: a store or person id, a reason code, a week (`YYYY-MM-DD`), or null. */
  key: string | number | null;
  /** The person's name, for person groups. */
  name?: string;
  counts: Record<string, number>;
  medianMinutes: number | null;
}

export interface ReportPanel {
  totals: ReportRow;
  tables: Record<string, ReportRow[]>;
}

export interface DashboardData {
  /** The filter as the server read it (dates are Eastern calendar days, `to` included). */
  filter: {from: string; to: string; store: string; department: string; type: string};
  /** Null: not shown (filtered out, or the viewer may not see that kind of case). */
  hot: ReportPanel | null;
  csi: ReportPanel | null;
  overdue: CaseSummary[];
  generatedAt: string;
}

export interface DrillDown {
  label: string;
  /** Exactly the number on the dashboard. */
  total: number;
  /** The newest 200 of them. */
  items: CaseSummary[];
}

export const DATE_PRESETS = [
  {value: 'today', label: 'Today'},
  {value: 'week', label: 'This week'},
  {value: 'month', label: 'This month'},
  {value: 'last_month', label: 'Last month'},
  {value: 'custom', label: 'Custom'},
] as const satisfies readonly Option[];

/** The Eastern calendar dates (`YYYY-MM-DD`, both included) of a preset, as of `now`. */
export function presetRange(preset: string, now = new Date()): {from: string; to: string} {
  const today = utcToEasternLocal(now).slice(0, 10);
  const d = new Date(`${today}T12:00:00Z`);
  const iso = (x: Date) => x.toISOString().slice(0, 10);
  if (preset === 'today') return {from: today, to: today};
  if (preset === 'week') {
    // Weeks start on Monday.
    const monday = new Date(d);
    monday.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return {from: iso(monday), to: today};
  }
  if (preset === 'last_month') {
    const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1, 12));
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 0, 12));
    return {from: iso(first), to: iso(last)};
  }
  return {from: `${today.slice(0, 8)}01`, to: today};
}
