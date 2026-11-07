import type { Store } from './store';
import { dayKey } from './clock';

// Eight model calls per user per day (11/6/26). The October spec said 60,
// which at about a cent a call is twelve times its own $0.05 budget. Eight
// is the cap until the real per-call cost is measured in week one.
// Corrections, shortcuts, "yes" and commands never count: they are code.
export const MODEL_CALLS_PER_DAY = 8;

export function quotaDecision(countToday: number, cap = MODEL_CALLS_PER_DAY): { allowed: boolean; remaining: number } {
  const remaining = Math.max(0, cap - countToday);
  return { allowed: countToday < cap, remaining };
}

// Returns true and records the call, or false and records nothing.
export async function takeModelCall(store: Store, userId: number, kind: string, now: Date, cap = MODEL_CALLS_PER_DAY): Promise<boolean> {
  const day = dayKey(now);
  const n = await store.countModelCalls(userId, day);
  if (!quotaDecision(n, cap).allowed) return false;
  await store.recordModelCall(userId, day, kind, now);
  return true;
}

export const QUOTA_MESSAGE =
  "That's my limit of photo and plan estimates for today. I'll keep logging what you tell me in plain numbers, and the limit resets tomorrow.";
