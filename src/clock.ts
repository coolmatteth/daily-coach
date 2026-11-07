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

export function dayKey(d: Date): string {
  // UTC calendar day until onboarding knows the user's time zone (PR 2).
  return d.toISOString().slice(0, 10);
}
