// The Sunday pass (PR 3, 11/7/26): at 5 PM in each user's own time zone on
// Sunday, send the week's verdict and the prescriber summary, and write one
// coach line into their Athlete File so next week's plan starts from it.
// The cron fires hourly; this decides who is due.
import type { Channel, User } from './types';
import type { Store } from './store';
import type { Transport } from './transport';
import { dayKey, weekday } from './clock';
import { recapText } from './bot';
import { userTargets } from './athlete';
import { addDays } from './clock';
import { weeklyRecap } from './recap';

export const RECAP_HOUR = 17;

export function localHour(d: Date, tz: string | null): number {
  try {
    const h = new Intl.DateTimeFormat('en-US', { timeZone: tz ?? 'UTC', hour: 'numeric', hour12: false }).formatToParts(d).find((p) => p.type === 'hour')?.value;
    return Number(h) % 24;
  } catch { return d.getUTCHours(); }
}

export function isDue(u: User, now: Date): boolean {
  const today = dayKey(now, u.tz);
  return weekday(today) === 0 && localHour(now, u.tz) >= RECAP_HOUR && u.lastRecapDay !== today && Boolean(u.weightLb);
}

export async function weeklyPass(store: Store, transportFor: (channel: Channel) => Transport, now: Date): Promise<number> {
  let sent = 0;
  for (const u of await store.listUsers()) {
    if (!isDue(u, now)) continue;
    const today = dayKey(now, u.tz);
    const text = await recapText(store, u, today);
    await transportFor(u.channel).send(u.chatId, text);
    // The file line: one sentence of fact the next plan can read.
    const t = userTargets(u);
    if (t) {
      const days = await store.daySummaries(u.id, addDays(today, -14), addDays(today, -1));
      const r = weeklyRecap({ days, band: t.kcal, tiers: t.protein, dayAfterShot: () => false });
      const line = r.verdict === 'no verdict'
        ? `Week ending ${addDays(today, -1)}: ${r.loggedDays} days logged, no verdict.`
        : `Week ending ${addDays(today, -1)}: ${r.verdict}; protein at goal ${r.proteinGoalDays} of ${r.loggedDays} days${r.kcalAvg !== null ? `, ${Math.round(r.kcalAvg)} kcal a day` : ''}.`;
      await store.addNote(u.id, { date: today, kind: 'note', text: line, value: null, source: 'coach' }, now);
    }
    await store.updateUser(u.id, { lastRecapDay: today });
    sent++;
  }
  return sent;
}
