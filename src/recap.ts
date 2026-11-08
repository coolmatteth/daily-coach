// The Sunday verdict and the prescriber summary (PR 3, 11/7/26).
//
// The verdict reads the week's food against the user's own band. It never
// says "hold", "stay" or "step" about a dose: under FDA's January 2026
// general-wellness guidance a prompt that recommends medical management is
// a device. What it can do is hand the user their own facts in the
// prescriber's vocabulary and say they are worth bringing to a check-in.
import type { DaySummary, Note } from './types';
import type { KcalBand, ProteinTiers } from './targets';
import { kcalDayOf, tierOf, kc, type KcalDay, type Tier } from './food';
import { UNDER_FLOOR_TEXT } from './weighins';

export const RECAP_MIN_DAYS = 4;
export const ABSOLUTE_FLOOR_KCAL = 1000;

const dayName = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
const md = (d: string) => d.slice(5).replace('-', '/');
const n0 = (x: number) => Math.round(x).toLocaleString('en-US');
const avg = (xs: number[]) => xs.reduce((n, x) => n + x, 0) / xs.length;

export type Verdict = 'on track' | 'a touch slow' | 'off pace' | 'under the floor' | 'no verdict';

export interface RecapInput {
  days: DaySummary[];                    // the 14 days ending yesterday, oldest first
  band: KcalBand | null;
  tiers: ProteinTiers;
  dayAfterShot: (day: string) => boolean;
}

export interface Recap { text: string; verdict: Verdict; proteinGoalDays: number; loggedDays: number; kcalAvg: number | null }

// The week's food verdict. With no band yet (height, age or sex missing)
// it reads protein only.
export function weeklyRecap(input: RecapInput): Recap {
  const { days, band, tiers, dayAfterShot } = input;
  const week = days.slice(-7);
  const prior = days.slice(-14, -7);
  const logged = week.filter((d) => d.meals > 0);
  const last = week[week.length - 1]?.day ?? days[days.length - 1]?.day ?? '';
  const head = `Week ending ${dayName(last)} ${md(last)}`;
  if (logged.length < RECAP_MIN_DAYS) {
    return {
      text: `${head}\n${logged.length ? `${logged.length} day${logged.length === 1 ? '' : 's'} logged` : 'Nothing logged'}; a verdict needs ${RECAP_MIN_DAYS}. Log most days and next Sunday says how the week went.`,
      verdict: 'no verdict', proteinGoalDays: 0, loggedDays: logged.length, kcalAvg: null,
    };
  }
  const protein = avg(logged.map((d) => d.protein_g));
  const kcal = avg(logged.map((d) => d.kcal));
  const count = (tier: Tier) => logged.filter((d) => tierOf(d.protein_g, tiers) === tier).length;
  const goalDays = count('goal') + count('stretch');
  const lines = [head];
  lines.push(`Protein: ${Math.round(protein)} g a day · ${count('stretch')} stretch · ${count('goal')} goal · ${count('floor')} floor · ${count('under')} under (${logged.length} days logged).`);

  let verdict: Verdict = 'on track';
  if (!band) {
    lines.push(`Calories: ${n0(kcal)} a day. Your band appears once I have your height, age and sex.`);
    // No band yet, but the Delphi consensus's absolute floor (1,000 to
    // 1,200 kcal/day) is below either sex's floor, so a week under it is
    // the safety case whoever the user is.
    if (kcal < ABSOLUTE_FLOOR_KCAL) {
      verdict = 'under the floor';
      lines.push(`Very little food logged on average: appetite is the limit this week, not discipline. ${UNDER_FLOOR_TEXT.replace(/^This week's calories averaged below the range this coach is built for\. /, '')}`);
    } else {
      verdict = goalDays >= Math.ceil(logged.length / 2) ? 'on track' : 'a touch slow';
      lines.push(verdict === 'on track' ? 'On track: protein at goal most days.' : 'A touch slow: protein under goal most days. Smaller sittings, more of them.');
    }
  } else {
    const kcount = (k: KcalDay) => logged.filter((d) => kcalDayOf(d.kcal, band) === k).length;
    const priorLogged = prior.filter((d) => d.meals > 0);
    const priorKcal = priorLogged.length >= RECAP_MIN_DAYS ? avg(priorLogged.map((d) => d.kcal)) : null;
    const delta = priorKcal != null ? ` Last week ${n0(priorKcal)} (${kcal >= priorKcal ? '+' : '−'}${n0(Math.abs(kcal - priorKcal))}).` : '';
    lines.push(`Calories: ${n0(kcal)} a day (aim ${n0(band.target)}) · ${kcount('band')} in the band · ${kcount('light')} light · ${kcount('big')} big.${delta}`);
    const big = logged.filter((d) => kcalDayOf(d.kcal, band) === 'big').map((d) => `${dayName(d.day)} ${n0(d.kcal)}`);
    const light = logged.filter((d) => kcalDayOf(d.kcal, band) === 'light' && !dayAfterShot(d.day));
    if (kcal < band.floor) {
      verdict = 'under the floor';
      lines.push(`Under your floor on average: appetite is the limit this week, not discipline. ${UNDER_FLOOR_TEXT.replace(/^This week's calories averaged below the range this coach is built for\. /, '')}`);
    } else if (kcal <= band.target + 100 && goalDays >= Math.ceil(logged.length / 2)) {
      lines.push('On track: inside the band, protein at goal most days.');
    } else if (kcal <= band.ceiling) {
      verdict = 'a touch slow';
      lines.push(`A touch slow.${goalDays < Math.ceil(logged.length / 2) ? ' Protein under goal most days: smaller sittings, more of them.' : ''}${big.length ? ` The big days: ${big.join(', ')}.` : ''}`);
    } else {
      verdict = 'off pace';
      lines.push(`Off pace: over the ceiling on average.${big.length ? ` The big days: ${big.join(', ')}.` : ''}`);
    }
    if (verdict !== 'under the floor' && light.length >= 3) {
      lines.push(`${light.length} days under your floor: that is the sessions-feel-flat zone, not faster loss. A shake on those days is the usual fix.`);
    }
  }
  return { text: lines.join('\n'), verdict, proteinGoalDays: goalDays, loggedDays: logged.length, kcalAvg: kcal };
}

export interface SummaryFacts {
  drug: string | null;
  weeksOnDose: number | null;        // from the latest dose note; null if unknown
  sideEffectDays: number;            // illness notes (and check-ins, later) in the week
  proteinGoalDays: number;
  loggedDays: number;
  kcalAvg: number | null;
  band: KcalBand | null;
  trendPct12wk: number | null;       // 7-day average now vs 12 weeks ago
  weeks: number;                     // weeks of weight history available
}

// The user's own facts in neutral words, ending with "worth bringing".
// No classification, no dose, no date, no "should".
export function prescriberSummary(f: SummaryFacts): string {
  if (!f.drug || f.drug === 'none') return '';
  const parts: string[] = [];
  parts.push(f.weeksOnDose !== null ? `${f.weeksOnDose} week${f.weeksOnDose === 1 ? '' : 's'} on your current dose of ${f.drug}.` : `On ${f.drug}; tell me when your current dose started ("/note dose started 10/30") and I will count the weeks for you.`);
  parts.push(f.sideEffectDays > 0 ? `${f.sideEffectDays} side-effect day${f.sideEffectDays === 1 ? '' : 's'} logged this week.` : 'No side-effect days logged this week.');
  if (f.loggedDays >= RECAP_MIN_DAYS) {
    parts.push(`Protein at goal ${f.proteinGoalDays} of ${f.loggedDays} logged days.`);
    if (f.kcalAvg !== null && f.band) {
      const where = f.kcalAvg < f.band.floor ? 'below your floor' : f.kcalAvg > f.band.ceiling ? 'above your ceiling' : 'inside your band';
      parts.push(`Calories averaged ${kc(f.kcalAvg)}, ${where}.`);
    }
  }
  if (f.trendPct12wk !== null) parts.push(`Weight trend over 12 weeks: ${f.trendPct12wk <= 0 ? 'down' : 'up'} ${Math.abs(f.trendPct12wk)}%.`);
  else if (f.weeks > 0) parts.push(`Weight trend: ${f.weeks} week${f.weeks === 1 ? '' : 's'} of weigh-ins so far; the 12-week trend appears at 12.`);
  parts.push("The label asks your prescriber to weigh how long you have been on a dose and how you are tolerating it. These numbers are worth bringing to your next check-in.");
  return `For your prescriber:\n${parts.join(' ')}`;
}

// Weeks since the latest dose note, or null.
export function weeksOnDose(notes: Note[], today: string): number | null {
  const dose = notes.filter((n) => n.kind === 'dose').sort((a, b) => b.date.localeCompare(a.date))[0];
  if (!dose) return null;
  const days = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${dose.date}T00:00:00Z`)) / 86_400_000;
  return Math.max(0, Math.floor(days / 7));
}

// The words that must never appear in anything about a dose.
export const FORBIDDEN_DOSE_WORDS = /\b(hold|stay on|step up|step down|increase|decrease|titrate)\b[^.]*\bdose\b|\bdose\b[^.]*\b(hold|stay|step up|step down|increase|decrease|titrate)\b/i;
