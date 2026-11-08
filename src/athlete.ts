// The Athlete File and onboarding (PR 2, 11/7/26).
//
// Onboarding is three questions on day one (lifting days, weight,
// medication), then one question a day, each with the reason it buys the
// user. A user who ignores a question gets defaults; "skip" declines it
// for good. Nothing here calls a model: every answer is parsed in code.
//
// The file is forty lines the user can read with /me: the profile, the
// numbers, and dated notes, newest first. Memory is facts, never a chat.

import type { Note, NoteKind, Profile, ProfileField, Sex, User } from './types';
import { addDays, weekday } from './clock';
import { explainTargets, targets, type TargetInput, type Targets } from './targets';

export const DAY_ONE_FIELDS: ProfileField[] = ['liftingDays', 'weightLb', 'drug'];
export const FIELD_ORDER: ProfileField[] = ['liftingDays', 'weightLb', 'drug', 'shotDay', 'heightIn', 'sex', 'age', 'tz', 'goalLb'];

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const WEEKDAY_SHORT = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

const TZ_WORDS: Record<string, string> = {
  pacific: 'America/Los_Angeles', pt: 'America/Los_Angeles', pst: 'America/Los_Angeles', pdt: 'America/Los_Angeles',
  mountain: 'America/Denver', mt: 'America/Denver', mst: 'America/Denver', mdt: 'America/Denver', arizona: 'America/Phoenix',
  central: 'America/Chicago', ct: 'America/Chicago', cst: 'America/Chicago', cdt: 'America/Chicago',
  eastern: 'America/New_York', et: 'America/New_York', est: 'America/New_York', edt: 'America/New_York',
  alaska: 'America/Anchorage', hawaii: 'Pacific/Honolulu', uk: 'Europe/London', london: 'Europe/London', gmt: 'Europe/London', bst: 'Europe/London',
};

const DRUGS: [RegExp, string][] = [
  [/zepbound/i, 'Zepbound'], [/mounjaro/i, 'Mounjaro'], [/tirzepatide/i, 'tirzepatide'],
  [/wegovy/i, 'Wegovy'], [/ozempic/i, 'Ozempic'], [/rybelsus/i, 'Rybelsus'], [/semaglutide/i, 'semaglutide'],
  [/foundayo|orforglipron/i, 'Foundayo'], [/saxenda|liraglutide/i, 'Saxenda'], [/compound/i, 'compounded GLP-1'],
  [/\b(none|nothing|not on|off it|no med)/i, 'none'],
];

export interface Question {
  field: ProfileField;
  ask: string;
  parse: (text: string) => Partial<Profile> | null;
  retry: string;
}

const num = (s: string) => { const m = /(-?\d+(?:[.,]\d+)?)/.exec(s); return m ? Number(m[1].replace(',', '.')) : null; };

export function parseWeightLb(text: string): number | null {
  const n = num(text);
  if (n === null || n <= 0) return null;
  const kg = /\bkg|kilo/i.test(text);
  const lb = kg ? n * 2.20462 : n;
  if (lb < 60 || lb > 800) return null;
  return Math.round(lb * 10) / 10;
}

export function parseHeightIn(text: string): number | null {
  const t = text.toLowerCase().replace(/[’′]/g, "'");
  let m = /(\d)\s*(?:'|ft|feet|foot)\s*(\d{1,2})?/.exec(t);
  if (m) { const inches = Number(m[1]) * 12 + Number(m[2] ?? 0); return inches >= 48 && inches <= 90 ? inches : null; }
  m = /(\d{2,3}(?:\.\d+)?)\s*cm/.exec(t);
  if (m) { const inches = Number(m[1]) / 2.54; return inches >= 48 && inches <= 90 ? Math.round(inches * 10) / 10 : null; }
  m = /(\d{2})\s*(?:in|inches|")?\b/.exec(t);
  if (m) { const inches = Number(m[1]); return inches >= 48 && inches <= 90 ? inches : null; }
  return null;
}

export function parseSex(text: string): Sex | null {
  const t = text.trim().toLowerCase();
  if (/^(f|female|woman|w)\b/.test(t)) return 'F';
  if (/^(m|male|man)\b/.test(t)) return 'M';
  return null;
}

export function parseDrug(text: string): string | null {
  for (const [re, name] of DRUGS) if (re.test(text)) return name;
  const t = text.trim();
  return t.length >= 3 && t.length <= 40 ? t : null;
}

export function parseShotDay(text: string): number | null {
  const t = text.trim().toLowerCase();
  if (/\b(pill|daily|oral|tablet|every day)\b/.test(t)) return -1;
  for (let i = 0; i < 7; i++) if (t.includes(WEEKDAYS[i]) || new RegExp(`\\b${WEEKDAY_SHORT[i]}s?\\b`).test(t)) return i;
  return null;
}

export function parseTz(text: string): string | null {
  const t = text.trim();
  const w = t.toLowerCase().replace(/[^a-z]/g, '');
  if (TZ_WORDS[w]) return TZ_WORDS[w];
  if (/^[A-Za-z_]+\/[A-Za-z_]+(\/[A-Za-z_]+)?$/.test(t)) {
    try { new Intl.DateTimeFormat('en-US', { timeZone: t }); return t; } catch { return null; }
  }
  return null;
}

export const QUESTIONS: Question[] = [
  {
    field: 'liftingDays',
    ask: 'How many days a week can you lift, 0 to 4? (This sets how your week is built.)',
    retry: 'A number from 0 to 4, please. How many days a week can you lift?',
    parse: (t) => { const n = num(t); return n !== null && n >= 0 && n <= 4 ? { liftingDays: Math.round(n) } : null; },
  },
  {
    field: 'weightLb',
    ask: 'Current weight? (Your protein numbers come from this.)',
    retry: 'A number in lb or kg, please. Current weight?',
    parse: (t) => { const w = parseWeightLb(t); return w === null ? null : { weightLb: w }; },
  },
  {
    field: 'drug',
    ask: 'Which medication are you on? Zepbound, Wegovy, Mounjaro, Ozempic, a pill, or none. (So the week is read against it.)',
    retry: 'The name is enough, or "none". Which medication?',
    parse: (t) => { const d = parseDrug(t); return d === null ? null : isPill(t) ? { drug: d, shotDay: -1 } : { drug: d }; },
  },
  {
    field: 'shotDay',
    ask: 'Which day is your shot? Or "pill" if it is daily. (The day after gets an easier plan.)',
    retry: 'A weekday, or "pill". Which day is your shot?',
    parse: (t) => { const d = parseShotDay(t); return d === null ? null : { shotDay: d }; },
  },
  {
    field: 'heightIn',
    ask: 'Height? (For your calorie band.)',
    retry: 'Like 5\'6, 66 in, or 168 cm. Height?',
    parse: (t) => { const h = parseHeightIn(t); return h === null ? null : { heightIn: h }; },
  },
  {
    field: 'sex',
    ask: 'Sex, for the calorie math: F or M?',
    retry: 'F or M, please.',
    parse: (t) => { const s = parseSex(t); return s === null ? null : { sex: s }; },
  },
  {
    field: 'age',
    ask: 'Age? (The burn estimate needs it.)',
    retry: 'A number, please. Age?',
    parse: (t) => { const n = num(t); return n !== null && n >= 16 && n <= 100 ? { age: Math.round(n) } : null; },
  },
  {
    field: 'tz',
    ask: 'Time zone? Pacific, Mountain, Central, Eastern, or a name like Europe/London. (So the evening message lands in your evening.)',
    retry: 'Pacific, Mountain, Central, Eastern, or a name like Europe/London. Time zone?',
    parse: (t) => { const z = parseTz(t); return z === null ? null : { tz: z }; },
  },
  {
    field: 'goalLb',
    ask: 'A goal weight, if you have one? Say skip if not. (Only used for the pace line.)',
    retry: 'A number, or skip. Goal weight?',
    parse: (t) => { const w = parseWeightLb(t); return w === null ? null : { goalLb: w }; },
  },
];

export const questionFor = (f: ProfileField) => QUESTIONS.find((q) => q.field === f)!;

export function isMissing(p: Profile, f: ProfileField): boolean {
  if (p.skipped.includes(f)) return false;
  if (f === 'shotDay' && (p.drug === 'none' || p.drug === null)) return false;
  return p[f] === null;
}

// "wegovy pill", "rybelsus", "the oral one": a daily pill has no shot day.
export function isPill(text: string): boolean {
  return /\b(pill|oral|tablet|rybelsus|foundayo|orforglipron)\b/i.test(text);
}

// A question ignored this many times stops being asked. The person can
// still give the answer any time; the file is theirs.
export const MAX_ASKS = 3;

export function dayOneDone(p: Profile): boolean {
  return DAY_ONE_FIELDS.every((f) => !isMissing(p, f));
}

// The next question to ask now, or null. Day-one fields are asked back to
// back; after that at most one question a day.
export function nextQuestion(p: Profile, today: string): Question | null {
  for (const f of FIELD_ORDER) {
    if (!isMissing(p, f)) continue;
    // Day-one questions come back to back, unless the person answered
    // twice with something else today: then they wait until tomorrow.
    if (DAY_ONE_FIELDS.includes(f)) return p.deferredDay === today ? null : questionFor(f);
    return p.lastAskedDay === today ? null : questionFor(f);
  }
  return null;
}

// How many non-answers a day-one question takes before it is set aside.
export const MAX_RETRIES = 2;

export function isSkip(text: string): boolean {
  return /^(skip|pass|no thanks|later|n\/a)\b/i.test(text.trim());
}

export function targetInput(p: Profile): TargetInput {
  return {
    weightLb: p.weightLb ?? 0,
    heightIn: p.heightIn ?? undefined,
    sex: p.sex ?? undefined,
    age: p.age ?? undefined,
    liftingDays: p.liftingDays ?? 0,
    leanMassLb: p.leanMassLb ?? undefined,
  };
}

export function userTargets(p: Profile): Targets | null {
  return p.weightLb ? targets(targetInput(p)) : null;
}

export const SHOT_DAY_NAME = (d: number) => (d === -1 ? 'daily pill' : WEEKDAYS[d][0].toUpperCase() + WEEKDAYS[d].slice(1));

// The message after the day-one questions.
export function numbersText(p: Profile): string {
  const t = userTargets(p);
  if (!t) return 'Your numbers appear once I have your weight.';
  const lines = ['Done for today. Your numbers:', ''];
  lines.push(`Protein: floor ${t.protein.floor} g, goal ${t.protein.goal} g, stretch ${t.protein.stretch} g.`);
  if (t.kcal) lines.push(`Calories: ${t.kcal.floor} to ${t.kcal.ceiling} a day, aim near ${t.kcal.target}, judged on the weekly average.`);
  else lines.push('Calories: your band comes once I have your height, age and sex. I will ask one at a time.');
  const days = p.liftingDays ?? 0;
  lines.push(days > 0 ? `Lifting: ${days} day${days === 1 ? '' : 's'} a week, full body, machines and dumbbells first.` : 'Lifting: 0 days for now. The plan will be walking and protein until that changes.');
  lines.push('Pace: most people on these medications lose 10 to 15% in the first six months and slower after that. Everyone plateaus eventually.');
  lines.push('');
  lines.push(days > 0
    ? 'Reply "why" to see where any number comes from. Text or photograph what you eat any time; your first plan arrives this evening at 6.'
    : 'Reply "why" to see where any number comes from. Text or photograph what you eat any time; each evening at 6 I check in.');
  return lines.join('\n');
}

export function whyText(p: Profile): string {
  const t = userTargets(p);
  if (!t) return 'I need your weight first.';
  return explainTargets(t, targetInput(p));
}

// ---- Notes (the file's dated lines) ----

const KIND_WORDS: Record<string, NoteKind> = {
  injur: 'injury', knee: 'injury', shoulder: 'injury', back: 'injury', elbow: 'injury', wrist: 'injury', hip: 'injury', pain: 'injury', tweak: 'injury', strain: 'injury', flare: 'injury',
  gym: 'equipment', equipment: 'equipment', dumbbell: 'equipment', machine: 'equipment', barbell: 'equipment', home: 'equipment',
  prefer: 'preference', hate: 'preference', love: 'preference', like: 'preference', avoid: 'preference',
  dose: 'dose', dosage: 'dose', stepped: 'dose', titrat: 'dose', mg: 'dose',
  shot: 'shot', inject: 'shot', pen: 'shot',
  travel: 'travel', trip: 'travel', flight: 'travel', vacation: 'travel', hotel: 'travel',
  sick: 'illness', ill: 'illness', cold: 'illness', flu: 'illness', fever: 'illness', nause: 'illness', stomach: 'illness',
  rule: 'rule', always: 'rule', never: 'rule',
};

export function kindOf(text: string): NoteKind {
  const words = text.toLowerCase().split(/\s+/).slice(0, 6).map((w) => w.replace(/[^a-z]/g, ''));
  for (const w of words) for (const [stem, kind] of Object.entries(KIND_WORDS)) if (w === stem || w.startsWith(stem)) return kind;
  return 'note';
}

function takeDate(text: string, today: string): { date: string; rest: string } {
  let m = /\b(?:on\s+)?(\d{4})-(\d{2})-(\d{2})\b/.exec(text);
  if (m) return { date: `${m[1]}-${m[2]}-${m[3]}`, rest: text.replace(m[0], ' ') };
  m = /\b(?:on\s+)?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(text);
  if (m) {
    const y = m[3] ? (m[3].length === 2 ? `20${m[3]}` : m[3]) : today.slice(0, 4);
    return { date: `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`, rest: text.replace(m[0], ' ') };
  }
  m = /\byesterday\b/i.exec(text);
  if (m) return { date: addDays(today, -1), rest: text.replace(m[0], ' ') };
  m = /\btoday\b/i.exec(text);
  if (m) return { date: today, rest: text.replace(m[0], ' ') };
  return { date: today, rest: text };
}

function takeValue(text: string): string | null {
  const m = /(-?\d+(?:[.,]\d+)?)\s*(mg|mcg|g|kg|lb|lbs|%|bpm|min)\b/i.exec(text);
  return m ? `${m[1]} ${m[2].toLowerCase()}` : null;
}

export function parseNote(input: string, today: string): { date: string; kind: NoteKind; text: string; value: string | null } | null {
  const raw = input.replace(/^\/note(@\w+)?/i, '').trim();
  if (!raw) return null;
  const { date, rest } = takeDate(raw, today);
  const text = rest.replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return { date, kind: kindOf(text), text, value: takeValue(text) };
}

// ---- The file ----

export const FILE_MAX_LINES = 40;

export function renderFile(u: User, notes: Note[], today: string): string {
  const lines: string[] = ['Your file'];
  const bits: string[] = [];
  if (u.weightLb) bits.push(`${u.weightLb} lb`);
  if (u.heightIn) bits.push(`${Math.floor(u.heightIn / 12)}'${Math.round(u.heightIn % 12)}`);
  if (u.sex) bits.push(u.sex);
  if (u.age) bits.push(`${u.age}`);
  if (bits.length) lines.push(bits.join(', '));
  if (u.drug) lines.push(`Medication: ${u.drug}${u.shotDay !== null ? `, ${SHOT_DAY_NAME(u.shotDay)}` : ''}`);
  if (u.liftingDays !== null) lines.push(`Lifting: ${u.liftingDays} days a week`);
  if (u.tz) lines.push(`Time zone: ${u.tz}`);
  if (u.goalLb) lines.push(`Goal: ${u.goalLb} lb`);
  const t = userTargets(u);
  if (t) {
    lines.push(`Protein: ${t.protein.floor} / ${t.protein.goal} / ${t.protein.stretch} g`);
    if (t.kcal) lines.push(`Calories: ${t.kcal.floor} to ${t.kcal.ceiling}, aim ${t.kcal.target}`);
  }
  if (u.shotDay !== null && u.shotDay >= 0) {
    const wd = weekday(today);
    if (wd === (u.shotDay + 1) % 7) lines.push('Today is the day after your shot.');
    if (wd === (u.shotDay + 6) % 7) lines.push('Tomorrow is shot day; today is usually the hungry one.');
  }
  if (notes.length) {
    lines.push('');
    lines.push('Notes, newest first:');
    const room = Math.max(5, FILE_MAX_LINES - lines.length);
    for (const n of notes.slice(0, room)) lines.push(`#${n.id} ${n.date} ${n.kind}: ${n.text}`);
    if (notes.length > room) lines.push(`(${notes.length - room} older)`);
  } else {
    lines.push('');
    lines.push('No notes yet. Tell me anything that should shape your plan: "/note left knee, no deep squats".');
  }
  return lines.join('\n');
}
