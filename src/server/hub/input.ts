import {easternToUtc, isPhone, phoneDigits} from '../../lib/hub';

/**
 * Field-by-field input reading for the hub's forms. Every reader REJECTS a
 * wrong value with words that say how to fix it (never "fixes" it), and the
 * route answers `422 {error: 'invalid_input', fields}` so each message lands
 * under its own field. The portal's rules (src/portal/hub-rules.ts) mirror these.
 */
export class Fields {
  readonly errors: Record<string, string> = {};
  constructor(private readonly body: Record<string, unknown>) {}

  get ok() {
    return Object.keys(this.errors).length === 0;
  }

  fail(name: string, message: string) {
    this.errors[name] ??= message;
  }

  has(name: string) {
    const v = this.body[name];
    return v !== undefined && v !== null && !(typeof v === 'string' && v.trim() === '');
  }

  /** Trimmed text, `max` characters at most. Empty → null (or an error when `required`). */
  text(name: string, max: number, required: string | false = false): string | null {
    const v = this.body[name];
    const s = typeof v === 'string' ? v.trim() : v === undefined || v === null ? '' : null;
    if (s === null) return this.fail(name, 'Enter text here.'), null;
    if (!s) {
      if (required) this.fail(name, required);
      return null;
    }
    if (s.length > max) return this.fail(name, `Use at most ${max} characters (now ${s.length}).`), null;
    return s;
  }

  /** One of `allowed`. */
  pick<T extends string>(name: string, allowed: readonly T[], required: string | false): T | null {
    const v = this.body[name];
    if (v === undefined || v === null || v === '') {
      if (required) this.fail(name, required);
      return null;
    }
    if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) {
      return this.fail(name, 'Pick one from the list.'), null;
    }
    return v as T;
  }

  /** Several of `allowed` (no repeats). */
  pickMany<T extends string>(name: string, allowed: readonly T[], max: number): T[] {
    const v = this.body[name];
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v) || v.length > max || !v.every(x => typeof x === 'string' && (allowed as readonly string[]).includes(x))) {
      this.fail(name, 'Pick from the list.');
      return [];
    }
    return [...new Set(v as T[])];
  }

  /** A positive whole number id. */
  id(name: string, required: string | false): number | null {
    const v = this.body[name];
    if (v === undefined || v === null || v === '') {
      if (required) this.fail(name, required);
      return null;
    }
    const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
    if (!Number.isSafeInteger(n) || n <= 0) return this.fail(name, 'Pick one from the list.'), null;
    return n;
  }

  /** Several ids. */
  ids(name: string, max: number): number[] {
    const v = this.body[name];
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v) || v.length > max || !v.every(x => Number.isSafeInteger(x) && (x as number) > 0)) {
      this.fail(name, 'Pick from the list.');
      return [];
    }
    return [...new Set(v as number[])];
  }

  /** A whole number between `min` and `max`. */
  int(name: string, min: number, max: number, message: string): number | null {
    const v = this.body[name];
    if (v === undefined || v === null || v === '') return null;
    const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v.trim().replace(/,/g, '')) ? Number(v.trim().replace(/,/g, '')) : NaN;
    if (!Number.isSafeInteger(n) || n < min || n > max) return this.fail(name, message), null;
    return n;
  }

  bool(name: string): boolean {
    return this.body[name] === true;
  }

  /** A US mobile number, stored as 10 digits. */
  phone(name: string, required: string): string | null {
    const s = this.text(name, 30, required);
    if (s === null) return null;
    if (!isPhone(s)) return this.fail(name, 'Enter a 10-digit phone number, like (718) 555-1234.'), null;
    return phoneDigits(s);
  }

  email(name: string): string | null {
    const s = this.text(name, 254);
    if (s === null) return null;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s)) return this.fail(name, 'Enter a valid email, like name@example.com.'), null;
    return s.toLowerCase();
  }

  /** An Eastern wall-clock date and time (`YYYY-MM-DDTHH:MM`), as an instant. */
  when(name: string, required: string | false): Date | null {
    const v = this.body[name];
    if (v === undefined || v === null || v === '') {
      if (required) this.fail(name, required);
      return null;
    }
    const at = typeof v === 'string' ? easternToUtc(v.trim()) : null;
    if (!at) return this.fail(name, 'Pick a date AND a time.'), null;
    return at;
  }

  /** A calendar date (`YYYY-MM-DD`). */
  date(name: string): Date | null {
    const v = this.body[name];
    if (v === undefined || v === null || v === '') return null;
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v.trim())) return this.fail(name, 'Pick a date.'), null;
    const d = new Date(`${v.trim()}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return this.fail(name, 'Pick a date.'), null;
    return d;
  }
}

export const asBody = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

export const invalidInput = (fields: Record<string, string>) => ({
  error: 'invalid_input',
  message: 'Some fields need fixing. Look for the notes under them.',
  fields,
});

/** A positive integer route param or query value, or undefined. */
export const idOf = (value: unknown) => {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : undefined;
};
