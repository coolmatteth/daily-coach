// Glue between the store and the training rules (PR 4, 11/8/26): a lift's
// history from the sets table, the plan for a day, recording a reply with
// numbers, the evening send.
import type { Channel, User } from './types';
import type { Store } from './store';
import type { Transport } from './transport';
import { addDays, dayKey, weekday } from './clock';
import type { LiftLog } from './progression';
import { liftKey } from './progression';
import { buildPlan, isLiftDay, matchLift, NO_LIFT_TEXT, parseSetReply, renderPlan, REST_TEXT, setsReply, type Plan } from './plans';
import { localHour } from './weekly';

export const PLAN_HOUR = 18;

// Every lift the user has logged, oldest first, grouped by day.
export async function liftHistory(store: Store, userId: number, keys: string[]): Promise<Map<string, LiftLog[]>> {
  const out = new Map<string, LiftLog[]>();
  for (const key of keys) {
    const rows = await store.listSets(userId, key);
    const byDay = new Map<string, LiftLog>();
    for (const r of rows) {
      const log = byDay.get(r.day) ?? { exercise: r.exercise, key, date: r.day, sets: [] };
      log.sets.push({ weight: r.weight, reps: r.reps });
      byDay.set(r.day, log);
    }
    out.set(key, [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)));
  }
  return out;
}

export async function planFor(store: Store, u: User, day: string): Promise<Plan | null> {
  const saved = await store.getPlan(u.id, day);
  if (saved) { try { return JSON.parse(saved) as Plan; } catch { /* rebuild */ } }
  if (!isLiftDay(u, day)) return null;
  const sessions = await store.sessionDays(u.id);
  // The template rotates on sessions actually done, not days planned.
  const draft = buildPlan(u, day, sessions.filter((d) => d < day).length, new Map());
  if (!draft) return null;
  const history = await liftHistory(store, u.id, draft.lifts.map((l) => l.key));
  const plan = buildPlan(u, day, sessions.filter((d) => d < day).length, history);
  if (!plan) return null;
  return plan;
}

// The plan whose session the user is most likely reporting: today's, else
// the latest within the last two days.
export async function planForReply(store: Store, u: User, today: string): Promise<Plan | null> {
  const day = await store.latestPlanDay(u.id, today);
  if (!day || day < addDays(today, -2)) return null;
  const raw = await store.getPlan(u.id, day);
  if (!raw) return null;
  try { return JSON.parse(raw) as Plan; } catch { return null; }
}

export async function recordSets(store: Store, u: User, text: string, today: string, now: Date): Promise<string | null> {
  const parsed = parseSetReply(text);
  if (!parsed.length) return null;
  const plan = await planForReply(store, u, today);
  const day = plan && plan.day <= today ? plan.day : today;
  const alreadyDone = new Set((await store.listSetsForDay(u.id, day)).map((r) => r.key));
  const recorded: { name: string; sets: { weight: number; reps: number }[] }[] = [];
  for (const p of parsed) {
    const m = matchLift(p.name, plan);
    await store.addSets(u.id, p.sets.map((s, i) => ({ day, key: m.key, exercise: m.name, setIndex: i, weight: s.weight, reps: s.reps })), now);
    recorded.push({ name: m.name, sets: p.sets });
  }
  return setsReply(recorded, plan, alreadyDone);
}

export function dayAfterShot(u: User, day: string): boolean {
  return u.shotDay !== null && u.shotDay >= 0 && weekday(day) === (u.shotDay + 1) % 7;
}

// The evening message for `tomorrow`: the plan, or rest plus the check-in.
export async function eveningText(store: Store, u: User, today: string, now: Date): Promise<{ text: string; askCheckIn: boolean }> {
  const tomorrow = addDays(today, 1);
  // After the first few answered check-ins the instruction line goes.
  const seen = (await store.listCheckIns(u.id, addDays(today, -30), today)).length >= 2;
  if ((u.liftingDays ?? 0) === 0) return { text: NO_LIFT_TEXT(tomorrow, seen), askCheckIn: true };
  const plan = await planFor(store, u, tomorrow);
  if (!plan) return { text: REST_TEXT(tomorrow, seen), askCheckIn: true };
  await store.savePlan(u.id, tomorrow, JSON.stringify(plan), now);
  return { text: renderPlan(plan, true), askCheckIn: false };
}

export function planDue(u: User, now: Date): boolean {
  const today = dayKey(now, u.tz);
  return Boolean(u.weightLb) && u.liftingDays !== null && localHour(now, u.tz) >= PLAN_HOUR && u.lastPlanDay !== today;
}

// The hourly cron's evening half: for everyone at or past 6 PM local who
// has not had tonight's message, send it once.
export async function eveningPass(store: Store, transportFor: (channel: Channel) => Transport, now: Date): Promise<number> {
  let sent = 0;
  for (const u of await store.listUsers()) {
    if (!planDue(u, now)) continue;
    const today = dayKey(now, u.tz);
    const { text, askCheckIn } = await eveningText(store, u, today, now);
    await transportFor(u.channel).send(u.chatId, text);
    await store.updateUser(u.id, { lastPlanDay: today, ...(askCheckIn ? { pendingCheckinDay: today } : {}) });
    sent++;
  }
  return sent;
}

export const planKeys = (plan: Plan) => plan.lifts.map((l) => l.key);
export { liftKey };
