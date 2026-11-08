// Weight progression in plain code (PR 4, 11/8/26). Ported from the
// private coach, where it ran in shadow mode against logged sessions before
// it was trusted; the rules are unchanged, the Notion and PR-window parts
// are not here. The log is the only source: no model, no table of weights.
//
// The working weight is the heaviest load owned in two sessions. Around it:
//   • a heavier load tried once and owned, or landed inside the range, is
//     prescribed AGAIN so the second time can happen (repeat to confirm);
//   • the working weight owned in the last two sessions in a row → add one
//     step (two owned sessions with a lighter day between do not count);
//   • one session under the working weight → noise, prescribe it again;
//   • two sessions in a row under it → stale, step down;
//   • after LAYOFF_DAYS away from a lift, repeat the working weight.

export interface LoggedSet { weight: number; reps: number }

export interface LiftLog {
  exercise: string;   // as typed
  key: string;        // normalized name, used to match sessions
  date: string;       // YYYY-MM-DD
  sets: LoggedSet[];  // in the order done; empty when there was no load
}

export interface Prescription {
  weight: number;
  repsLow: number;
  repsHigh: number;
  sets: number;
  reason: 'first' | 'add' | 'fill' | 'hold' | 'drop';
  why: string;        // one short clause for the plan's note
}

// ---------- names ----------

// Different spellings of one lift. Generic gym names; a user's own name for
// a lift that matches none of these is its own key.
const ALIASES: [RegExp, string][] = [
  [/\b(db|dumbbell)\b.*\b(chest|flat|bench)\b.*press/, 'db flat press'],
  [/incline.*curl/, 'incline db curl'],
  [/\bincline\b.*\b(db|dumbbell)\b.*press|\b(db|dumbbell)\b.*\bincline\b.*press/, 'incline db press'],
  [/\bincline\b.*(machine|press)/, 'incline machine press'],
  [/converging|chest press|machine press|bench press machine/, 'chest press'],
  [/reverse pec|rear delt/, 'reverse pec deck'],
  [/pec deck|pec fly|chest fly/, 'pec deck'],
  [/shoulder press|overhead press|ohp/, 'shoulder press'],
  [/face pull/, 'face pull'],
  [/lateral/, 'lateral raise'],
  [/overhead.*tri|tri.*overhead|skull/, 'overhead tricep extension'],
  [/pushdown|push.?down|rope.*tri|tri.*rope/, 'rope pushdown'],
  [/straight.arm/, 'straight-arm pulldown'],
  [/pulldown|pull-down|lat pull/, 'lat pulldown'],
  [/cable row|seated row|low row/, 'seated row'],
  [/chest.supported|machine row|t-bar/, 'chest-supported row'],
  [/high row/, 'high row'],
  [/one.arm|single.arm.*row|db row|dumbbell row/, 'one-arm db row'],
  [/\brows?\b/, 'seated row'],
  [/back ext|roman chair|hyper/, 'back extension'],
  [/preacher/, 'preacher curl'],
  [/hammer/, 'hammer curl'],
  [/\bcurl\b.*(leg|lying|prone|seated|hamstring)|(leg|lying|prone|seated|hamstring).*\bcurl\b/, 'leg curl'],
  [/\bcurl\b/, 'db curl'],
  [/knee ext|leg ext|quad ext/, 'leg extension'],
  [/leg press/, 'leg press'],
  [/hack/, 'hack squat'],
  [/goblet/, 'goblet squat'],
  [/squat/, 'squat'],
  [/hip thrust|glute bridge/, 'hip thrust'],
  [/rdl|romanian|deadlift/, 'romanian deadlift'],
  [/abduct/, 'hip abduction'],
  [/adduct/, 'hip adduction'],
  [/seated.*calf/, 'seated calf raise'],
  [/calf/, 'calf raise'],
];

export function liftKey(exercise: string): string {
  const s = exercise.toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9 -]/g, ' ').replace(/\s+/g, ' ').trim();
  const uni = /single.?leg|single.?arm|one.?arm/.test(s) && !/row/.test(s) ? 'single ' : '';
  for (const [re, key] of ALIASES) if (re.test(s)) return uni + key;
  return uni + s.replace(/single.?leg|single.?arm|one.?arm/, '').trim();
}

// ---------- parsing ----------

const NUM = /\d+(?:\.\d+)?/g;
const SPLIT_X = /\s*[×x]\s*/i;

// "60 × 10 × 3" → 3 sets of 60×10 · "90/80/75 × 10" → three sets · "60 × 8 /
// 55 × 12 / 55 × 12" → per-set · "100/100/90 × 12/10/10" → paired · "3 × 12
// each side" (no load) → [] · "70 × 12 × 3–4" (a planned range) → 3 sets.
export function parseSets(prescription: string): LoggedSet[] {
  const p = prescription.replace(/–|—/g, '-').trim();
  if (!/[×x]/i.test(p)) return [];
  const segs = p.split('/').map((s) => s.trim());
  if (segs.length > 1 && segs.every((s) => /[×x]/i.test(s))) return segs.flatMap((s) => parseSets(s));
  const parts = p.split(SPLIT_X).map((s) => s.trim());
  const weights = (parts[0].match(NUM) ?? []).map(Number);
  const reps = (parts[1]?.match(NUM) ?? []).map(Number);
  if (!weights.length || !reps.length) return [];
  if (parts.length === 2 && weights.length === 1 && weights[0] <= 6) return [];
  let count: number;
  if (parts.length >= 3) {
    const m = /^(\d{1,2})(?:\s*-\s*(\d{1,2}))?/.exec(parts[2]);
    count = m ? parseInt(m[1], 10) : Math.max(weights.length, reps.length);
  } else count = Math.max(weights.length, reps.length);
  const out: LoggedSet[] = [];
  for (let i = 0; i < count; i++) {
    out.push({ weight: weights[Math.min(i, weights.length - 1)], reps: reps[Math.min(i, reps.length - 1)] });
  }
  return out;
}

// ---------- the rule ----------

// Smallest honest step for the implement: dumbbells by 5, machines and
// cables by 10 when heavy and 5 when light.
export function stepFor(key: string, weight: number): number {
  if (/\bdb\b|dumbbell|goblet|lateral|curl/.test(key)) return 5;
  if (weight < 40) return 5;
  return 10;
}

// The top of the range is the reps the lift is usually trained at (the
// modal reps across its history), the floor four below. A planned range
// from the template seeds it until there is history.
// With fewer than two sessions of history the template's range stands:
// one session at 10 when 12 was asked is a session short of the top, not
// a new target.
export const RANGE_MIN_SETS = 6;
export function repRange(history: LiftLog[], fallbackHigh = 12): { low: number; high: number } {
  const counts = new Map<number, number>();
  let total = 0;
  for (const h of history) for (const s of h.sets) { counts.set(s.reps, (counts.get(s.reps) ?? 0) + 1); total++; }
  let high = fallbackHigh; let best = -1;
  if (total >= RANGE_MIN_SETS) for (const [r, n] of counts) if (n > best || (n === best && r > high)) { high = r; best = n; }
  return { low: Math.max(high - 4, 5), high };
}

function topWeight(sets: LoggedSet[]): number { return Math.max(...sets.map((s) => s.weight)); }
function ownedAt(sets: LoggedSet[], high: number): boolean {
  const W = topWeight(sets);
  return sets.every((s) => s.weight === W && s.reps >= high);
}
function topSetReps(sets: LoggedSet[]): number {
  const W = topWeight(sets);
  return Math.max(...sets.filter((s) => s.weight === W).map((s) => s.reps));
}

export const LAYOFF_DAYS = 21;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

// One lift's history, oldest first. What the next session should prescribe.
export function nextPrescription(history: LiftLog[], key: string, asOf?: string, fallbackHigh = 12): Prescription | null {
  const logs = history.filter((h) => h.sets.length > 0);
  if (!logs.length) return null;
  const range = repRange(logs, fallbackHigh);
  const last = logs[logs.length - 1];
  const prev = logs.length > 1 ? logs[logs.length - 2] : undefined;
  const n = last.sets.length;
  const base = { repsLow: range.low, repsHigh: range.high, sets: n };
  const L = topWeight(last.sets);

  const owned = new Map<number, number>();
  for (const h of logs) if (ownedAt(h.sets, range.high)) { const w = topWeight(h.sets); owned.set(w, (owned.get(w) ?? 0) + 1); }
  let work = 0;
  for (const [w, c] of owned) if (c >= 2 && w > work) work = w;
  if (!work) for (const [w] of owned) if (w > work) work = w;
  if (!work) work = L;
  const step = stepFor(key, work);

  if (asOf) {
    const gap = daysBetween(last.date, asOf);
    if (gap > LAYOFF_DAYS) return { ...base, weight: work, reason: 'hold', why: `last done ${last.date}, ${gap} days ago, repeat ${work}` };
  }

  if (L > work) {
    if (ownedAt(last.sets, range.high) || topSetReps(last.sets) >= range.low) {
      return { ...base, weight: L, reason: 'fill', why: `${L} last time was above your working ${work}; repeat it to confirm` };
    }
    return { ...base, weight: work, reason: 'hold', why: `${L} fell short of ${range.low} reps; back to your working ${work}` };
  }
  if (L === work) {
    if (prev && topWeight(prev.sets) > work && (ownedAt(prev.sets, range.high) || topSetReps(prev.sets) >= range.low)) {
      const tried = topWeight(prev.sets);
      return { ...base, weight: tried, reason: 'fill', why: `${tried} met the floor on ${prev.date}; repeat it to confirm before stepping past` };
    }
    const consecutive = !!prev && topWeight(prev.sets) === work && ownedAt(prev.sets, range.high);
    if (ownedAt(last.sets, range.high) && consecutive) {
      return { ...base, weight: work + step, reason: 'add', why: `${work} owned twice in a row (${n} × ${range.high}); add ${step}` };
    }
    if (topSetReps(last.sets) >= range.low) {
      return { ...base, weight: work, reason: 'hold', why: `${work} inside ${range.low}–${range.high}; aim for ${range.high} on every set` };
    }
    if (prev && topWeight(prev.sets) >= work && topSetReps(prev.sets) < range.low) {
      const down = Math.max(work - step, 0);
      return { ...base, weight: down, reason: 'drop', why: `under ${range.low} reps two sessions running; drop to ${down}` };
    }
    return { ...base, weight: work, reason: 'hold', why: `short of ${range.low} reps once; one off day is noise, repeat ${work}` };
  }
  if (prev && topWeight(prev.sets) < work) {
    const better = Math.max(L, topWeight(prev.sets));
    return { ...base, weight: better, reason: 'drop', why: `two sessions under ${work}; your working weight is now ${better}` };
  }
  return { ...base, weight: work, reason: 'hold', why: `${L} was one session under your working ${work}; noise, repeat ${work}` };
}
