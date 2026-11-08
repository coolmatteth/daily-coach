// The training bot (PR 4, 11/8/26): a small template library, loads from
// the progression engine, three generic guards, and the plan text. The
// first session of any lift has no load: "pick what feels like 7 of 10 and
// reply with the numbers." Those numbers become the baseline.
import type { Profile } from './types';
import { addDays, weekday } from './clock';
import { liftKey, nextPrescription, type LiftLog, type Prescription } from './progression';

export interface TemplateLift { name: string; sets: number; repsHigh: number; note?: string }
export interface TemplateDay { title: string; lifts: TemplateLift[] }

// Machines and dumbbells first: the numbers are printed on them and the
// user coming back to a gym after years does not need a spotter.
const LEG_PRESS: TemplateLift = { name: 'Leg press', sets: 3, repsHigh: 12 };
const LEG_CURL: TemplateLift = { name: 'Leg curl', sets: 3, repsHigh: 12 };
const LEG_EXT: TemplateLift = { name: 'Leg extension', sets: 3, repsHigh: 12 };
const CHEST_PRESS: TemplateLift = { name: 'Chest press (machine)', sets: 3, repsHigh: 12 };
const INCLINE_DB: TemplateLift = { name: 'Incline DB press', sets: 3, repsHigh: 10 };
const SHOULDER_PRESS: TemplateLift = { name: 'Shoulder press (machine)', sets: 3, repsHigh: 12 };
const SEATED_ROW: TemplateLift = { name: 'Seated row', sets: 3, repsHigh: 12 };
const PULLDOWN: TemplateLift = { name: 'Lat pulldown', sets: 3, repsHigh: 12 };
const CS_ROW: TemplateLift = { name: 'Chest-supported row', sets: 3, repsHigh: 12 };
const RDL: TemplateLift = { name: 'Romanian deadlift (DB)', sets: 3, repsHigh: 12, note: 'hinge, soft knees, stop when the hamstrings pull' };
const GOBLET: TemplateLift = { name: 'Goblet squat', sets: 3, repsHigh: 12 };
const HIP_THRUST: TemplateLift = { name: 'Hip thrust', sets: 3, repsHigh: 12 };
const LATERAL: TemplateLift = { name: 'Lateral raise (DB)', sets: 3, repsHigh: 15 };
const PUSHDOWN: TemplateLift = { name: 'Rope pushdown', sets: 3, repsHigh: 15 };
const CURL: TemplateLift = { name: 'DB curl', sets: 3, repsHigh: 12 };
const CALF: TemplateLift = { name: 'Calf raise', sets: 3, repsHigh: 15 };

export const TEMPLATES: Record<1 | 2 | 3 | 4, TemplateDay[]> = {
  1: [{ title: 'Full body', lifts: [LEG_PRESS, CHEST_PRESS, SEATED_ROW, LEG_CURL, PULLDOWN] }],
  2: [
    { title: 'Full body A', lifts: [LEG_PRESS, CHEST_PRESS, SEATED_ROW, LEG_CURL, PULLDOWN] },
    { title: 'Full body B', lifts: [GOBLET, INCLINE_DB, CS_ROW, RDL, SHOULDER_PRESS] },
  ],
  3: [
    { title: 'Full body A', lifts: [LEG_PRESS, CHEST_PRESS, SEATED_ROW, LEG_CURL, PULLDOWN] },
    { title: 'Full body B', lifts: [GOBLET, INCLINE_DB, CS_ROW, RDL, SHOULDER_PRESS] },
    { title: 'Full body C', lifts: [LEG_EXT, HIP_THRUST, PULLDOWN, CHEST_PRESS, LATERAL] },
  ],
  4: [
    { title: 'Upper A', lifts: [CHEST_PRESS, SEATED_ROW, SHOULDER_PRESS, PULLDOWN, PUSHDOWN, CURL] },
    { title: 'Lower A', lifts: [LEG_PRESS, LEG_CURL, LEG_EXT, HIP_THRUST, CALF] },
    { title: 'Upper B', lifts: [INCLINE_DB, CS_ROW, LATERAL, PULLDOWN, PUSHDOWN, CURL] },
    { title: 'Lower B', lifts: [GOBLET, RDL, LEG_PRESS, LEG_CURL, CALF] },
  ],
};

// Guard 1: a session never carries more than this many lifts.
export const BLOCK_CAP = 6;
// Guard 2: at most one lift steps up per session. Progress one number at a
// time; the rest of the session is the confirmation.
export const MAX_ADDS_PER_SESSION = 1;
// Guard 3, repeat to confirm, lives in the progression engine itself.

// Which weekdays are lifting days for a given count. Simple and stable, so
// the user knows the rhythm; 0 Sunday .. 6 Saturday.
export const LIFT_DAYS: Record<number, number[]> = {
  0: [],
  1: [1],
  2: [1, 4],
  3: [1, 3, 5],
  4: [1, 2, 4, 5],
};

export function isLiftDay(p: Profile, day: string): boolean {
  const n = Math.max(0, Math.min(4, p.liftingDays ?? 0));
  return LIFT_DAYS[n].includes(weekday(day));
}

export function templateFor(p: Profile, sessionsDone: number): TemplateDay | null {
  const n = Math.max(0, Math.min(4, p.liftingDays ?? 0)) as 0 | 1 | 2 | 3 | 4;
  if (n === 0) return null;
  const days = TEMPLATES[n];
  return days[sessionsDone % days.length];
}

export interface PlannedLift {
  name: string;
  key: string;
  sets: number;
  repsHigh: number;
  repsLow: number;
  weight: number | null;     // null = first time, pick 7 of 10
  reason: Prescription['reason'];
  why: string;
}

export interface Plan {
  day: string;               // the day the session is for
  title: string;
  lifts: PlannedLift[];
  easier: boolean;           // the day after the shot
}

// Build the plan for `day` from the template and each lift's history.
export function buildPlan(p: Profile, day: string, sessionsDone: number, history: Map<string, LiftLog[]>): Plan | null {
  const t = templateFor(p, sessionsDone);
  if (!t) return null;
  const easier = p.shotDay !== null && p.shotDay >= 0 && weekday(day) === (p.shotDay + 1) % 7;
  let adds = 0;
  const lifts: PlannedLift[] = [];
  for (const l of t.lifts.slice(0, BLOCK_CAP)) {
    const key = liftKey(l.name);
    const h = history.get(key) ?? [];
    const rx = nextPrescription(h, key, day, l.repsHigh);
    const sets = easier ? Math.max(2, l.sets - 1) : l.sets;
    if (!rx) {
      lifts.push({ name: l.name, key, sets, repsHigh: l.repsHigh, repsLow: Math.max(l.repsHigh - 4, 5), weight: null, reason: 'first', why: 'first time: pick what feels like 7 of 10' });
      continue;
    }
    let reason = rx.reason; let weight = rx.weight; let why = rx.why;
    if (reason === 'add') {
      adds++;
      if (adds > MAX_ADDS_PER_SESSION) {
        // Guard 2: hold the others at the working weight this session.
        const work = weight - (weight - Math.max(...h[h.length - 1].sets.map((s) => s.weight)));
        reason = 'hold'; weight = work; why = 'owned twice too, but one step a session; next time';
      }
    }
    lifts.push({ name: l.name, key, sets, repsHigh: rx.repsHigh, repsLow: rx.repsLow, weight, reason, why });
  }
  return { day, title: t.title, lifts, easier };
}

const dayName = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });

export function renderPlan(plan: Plan, forTomorrow: boolean): string {
  const when = forTomorrow ? 'Tomorrow' : 'Today';
  const lines = [`${when}, ${dayName(plan.day)}: ${plan.title}, about ${plan.lifts.length * 8} min.`];
  if (plan.easier) lines.push('Day after your shot: one set fewer on each, stop at 7 of 10.');
  lines.push('');
  for (const l of plan.lifts) {
    const load = l.weight === null ? 'pick 7 of 10' : `${l.weight}`;
    const up = l.reason === 'add' ? ' ↑' : '';
    lines.push(`${l.name}: ${l.sets} × ${l.repsLow}–${l.repsHigh} at ${load}${up}`);
  }
  lines.push('');
  lines.push('Walk 10 to 15 minutes after if you have it.');
  lines.push('Reply with your numbers when you are done, like "leg press 180 x 10 x 3". A held number is a good session.');
  return lines.join('\n');
}

export const REST_TEXT = (tomorrow: string) => `Tomorrow, ${dayName(tomorrow)}: rest. A walk if you like.\n\nStomach and energy today, 1 to 5? Reply with two numbers, like "4 3".`;
export const NO_LIFT_TEXT = (tomorrow: string) => `Tomorrow, ${dayName(tomorrow)}: a 20-minute walk and protein. Say "/me" and change your lifting days when you are ready to add the gym.\n\nStomach and energy today, 1 to 5? Reply with two numbers, like "4 3".`;

// ---------- replies with numbers ----------

export interface ParsedLine { name: string; sets: { weight: number; reps: number }[] }

// "leg press 180 x 10 x 3", "rows 3x8 at 95", "lat pulldown 80x12, 80x12,
// 80x10", "chest press 70 for 3 sets of 12". One lift per line or comma
// group; the name is the text before the first number.
export function parseSetLine(line: string): ParsedLine | null {
  const raw = line.replace(/[×*]/g, 'x').replace(/\s+/g, ' ').trim();
  const m = /^(.*?)\s*(\d.*)$/.exec(raw);
  if (!m || !m[1].trim()) return null;
  const name = m[1].replace(/[:\-–]+$/, '').trim();
  let nums = m[2].trim();
  // "3 sets of 12 at 180" / "3x12 at 180" → "180 x 12 x 3"
  let s = /^(\d+)\s*(?:sets?\s*of|x)\s*(\d+)\s*(?:at|@|with)\s*(\d+(?:\.\d+)?)/i.exec(nums);
  if (s) nums = `${s[3]} x ${s[2]} x ${s[1]}`;
  // "180 for 3 sets of 12" / "180 for 3x12"
  s = /^(\d+(?:\.\d+)?)\s*(?:for|,)\s*(\d+)\s*(?:sets?\s*of|x)\s*(\d+)/i.exec(nums);
  if (s) nums = `${s[1]} x ${s[3]} x ${s[2]}`;
  // "180x10, 180x10, 180x9" → "180 x 10 / 180 x 10 / 180 x 9"
  if (/^\d+(?:\.\d+)?\s*x\s*\d+(?:\s*,\s*\d+(?:\.\d+)?\s*x\s*\d+)+$/i.test(nums)) nums = nums.split(/\s*,\s*/).join(' / ');
  // "180 x 10 x 3" with the set count first ("3 x 10 x 180"): the big number is the weight.
  const triple = /^(\d+(?:\.\d+)?)\s*x\s*(\d+)\s*x\s*(\d+(?:\.\d+)?)$/i.exec(nums);
  if (triple && Number(triple[1]) <= 6 && Number(triple[3]) > 6) nums = `${triple[3]} x ${triple[2]} x ${triple[1]}`;
  // "180 x 10" alone: one set.
  const sets = parseSetsLoose(nums);
  if (!sets.length) return null;
  return { name, sets };
}

function parseSetsLoose(nums: string): { weight: number; reps: number }[] {
  const parts = nums.split('/').map((x) => x.trim()).filter(Boolean);
  if (parts.length > 1) return parts.flatMap((p) => parseSetsLoose(p));
  const m = /^(\d+(?:\.\d+)?)\s*x\s*(\d+)(?:\s*x\s*(\d+))?\b/i.exec(nums);
  if (!m) return [];
  const weight = Number(m[1]); const reps = Number(m[2]); const count = m[3] ? Number(m[3]) : 1;
  if (count > 10 || reps > 100) return [];
  return Array.from({ length: count }, () => ({ weight, reps }));
}

// A message is a set reply when most of its lines parse as sets.
export function parseSetReply(text: string): ParsedLine[] {
  const lines = text.split(/\n|;|(?<=\d)\s*,\s*(?=[a-z])/i).map((l) => l.trim()).filter(Boolean);
  const parsed = lines.map(parseSetLine).filter((x): x is ParsedLine => x !== null);
  return parsed.length && parsed.length >= Math.ceil(lines.length / 2) ? parsed : [];
}

// Match a typed name to a planned lift: same key, else the typed words are
// inside the planned name. Returns the planned lift's name and key.
export function matchLift(name: string, plan: Plan | null): { name: string; key: string } {
  const key = liftKey(name);
  if (plan) {
    const exact = plan.lifts.find((l) => l.key === key);
    if (exact) return { name: exact.name, key: exact.key };
    const words = name.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    const loose = plan.lifts.find((l) => words.length && words.every((w) => l.name.toLowerCase().includes(w)));
    if (loose) return { name: loose.name, key: loose.key };
  }
  return { name, key };
}

export function setsReply(recorded: { name: string; sets: { weight: number; reps: number }[] }[], plan: Plan | null, alreadyDone: Set<string> = new Set()): string {
  const lines = recorded.map((r) => {
    const w = [...new Set(r.sets.map((s) => s.weight))];
    const reps = r.sets.map((s) => s.reps);
    const same = w.length === 1 && new Set(reps).size === 1;
    return same ? `${r.name} ${w[0]} × ${reps[0]} × ${r.sets.length}` : `${r.name} ${r.sets.map((s) => `${s.weight}×${s.reps}`).join(', ')}`;
  });
  const out = [`Got it: ${lines.join('; ')}.`];
  if (plan) {
    const done = new Set([...alreadyDone, ...recorded.map((r) => liftKey(r.name))]);
    const left = plan.lifts.filter((l) => !done.has(l.key)).map((l) => l.name);
    out.push(left.length ? `Not logged yet: ${left.join(', ')}. Send them when you have them, or skip them.` : 'That is the whole session. Loads step up only after you own a number twice.');
  }
  return out.join('\n');
}

// ---------- the check-in ----------

export interface CheckIn { stomach: number; energy: number }

// "4 3", "4/3", "stomach 4 energy 3", "4, 3". Two numbers 1 to 5.
export function parseCheckIn(text: string): CheckIn | null {
  const t = text.toLowerCase();
  const labeled = /stomach\D*(\d)\D+energy\D*(\d)/.exec(t) ?? (/energy\D*(\d)\D+stomach\D*(\d)/.exec(t) ? (() => { const m = /energy\D*(\d)\D+stomach\D*(\d)/.exec(t)!; return [m[0], m[2], m[1]] as unknown as RegExpExecArray; })() : null);
  const m = labeled ?? /^\s*([1-5])\s*[\/,\s-]\s*([1-5])\s*$/.exec(t);
  if (!m) return null;
  const stomach = Number(m[1]); const energy = Number(m[2]);
  if (![stomach, energy].every((n) => n >= 1 && n <= 5)) return null;
  return { stomach, energy };
}

// A rough stomach (1 or 2) counts as a side-effect day in the recap.
export const ROUGH_STOMACH = 2;

export function checkInReply(c: CheckIn, dayAfterShot: boolean): string {
  if (c.stomach <= ROUGH_STOMACH) {
    return `Noted: stomach ${c.stomach}, energy ${c.energy}.${dayAfterShot ? ' The day after the shot is the usual rough one.' : ''} Small sittings, fluids, and a shake if a meal will not go down. It goes on your file for the prescriber summary.`;
  }
  if (c.energy <= 2) return `Noted: stomach ${c.stomach}, energy ${c.energy}. Low energy is the early sign of under-eating; check today's protein with /today.`;
  return `Noted: stomach ${c.stomach}, energy ${c.energy}.`;
}

export const tomorrowOf = (day: string) => addDays(day, 1);
