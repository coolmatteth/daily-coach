import type { Store } from './store';

// The test clock. On staging the simulated-user harness moves time forward
// so four weeks run in an afternoon; the bot asks `now()` and never
// `new Date()` directly. In production the offset is always zero.
export const CLOCK_OFFSET_KEY = 'clock_offset_ms';

export function withOffset(real: Date, offsetMs: number): Date {
  return new Date(real.getTime() + offsetMs);
}

export async function readOffsetMs(store: Store, staging: boolean): Promise<number> {
  if (!staging) return 0;
  const v = await store.getSetting(CLOCK_OFFSET_KEY);
  const n = v === null ? 0 : Number(v);
  return Number.isFinite(n) ? n : 0;
}

// The calendar day in the user's time zone (UTC until they tell us one).
export function dayKey(d: Date, tz?: string | null): string {
  if (!tz) return d.toISOString().slice(0, 10);
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')}`;
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

// 0 Sunday .. 6 Saturday for a YYYY-MM-DD.
export function weekday(day: string): number {
  return new Date(Date.parse(`${day}T00:00:00Z`)).getUTCDay();
}
