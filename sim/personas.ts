// The cast (PR 5, 11/8/26). Each persona is a character sheet plus a
// scripted day: what they would type, given what the coach said. The
// scripted behaviour runs with no model, so CI can run the whole cast; with
// PERSONA_MODEL=1 and an API key, a model plays the sheet instead and the
// script is only the hint of what happens to them that day.

export interface Persona {
  id: string;
  sheet: string;                     // who they are, in plain words, for the model
  onboarding: string[];              // answers to the three day-one questions, in order
  later: Record<string, string>;     // answers to the one-a-day questions, by field
  liftDays: number;
  /** What this person does on day `d` (0-based) given the coach's last messages. */
  script(ctx: DayContext): string[];
  /** How far off the prescribed load they lift: 1.0 = exactly, 1.1 = heavier. Applied to a fresh "pick 7 of 10" and to one lift a session, never compounding. */
  loadBias: number;
  /** Chance they skip a lifting day entirely. */
  skipRate: number;
}

export interface DayContext {
  day: number;                       // 0-based day of the run
  date: string;                      // YYYY-MM-DD
  weekday: number;                   // 0 Sunday
  planText: string | null;           // last plan message the coach sent for today, if any
  askedCheckIn: boolean;             // the coach asked stomach/energy last evening
  pendingQuestion: string | null;    // the coach's last message ended in a question
  rng: () => number;                 // seeded random, 0..1
}

const pick = <T,>(rng: () => number, xs: T[]): T => xs[Math.floor(rng() * xs.length)];

// Meals the scripted personas type. The local fake estimator knows these words.
const MEALS = {
  breakfast: ['two eggs and toast', 'greek yogurt with berries', 'oatmeal with a scoop of protein', 'shake'],
  lunch: ['chicken salad', 'turkey sandwich', 'tuna and crackers', 'chicken thigh about 6 oz and rice'],
  dinner: ['salmon and broccoli', 'ground beef and rice', 'chicken and veg', 'pizza two slices'],
  snack: ['protein bar', 'string cheese', 'apple', 'cottage cheese'],
};

// Reply to a plan with numbers near the prescribed loads. "pick 7 of 10"
// gets a sensible starting load for the lift.
export function liftReply(planText: string, bias: number, rng: () => number): string {
  const lines: string[] = [];
  let overshot = false;
  for (const raw of planText.split('\n')) {
    const m = /^(.+?): (\d) × (\d+)–(\d+) at (pick 7 of 10|\d+)/.exec(raw.trim());
    if (!m) continue;
    const [, name, setsS, lowS, highS, load] = m;
    const sets = Number(setsS); const low = Number(lowS); const high = Number(highS);
    let weight: number;
    if (load === 'pick 7 of 10') weight = Math.round(((START_LOAD[name] ?? 40) * bias) / 5) * 5;
    else if (bias !== 1 && !overshot && rng() < 0.5) { weight = Math.round((Number(load) * bias) / 5) * 5; overshot = true; }
    else weight = Number(load);
    // Reps: usually the top of the range; a hard day loses a rep or two on the last set.
    const reps = rng() < 0.7 ? high : Math.max(low, high - 1 - Math.floor(rng() * 2));
    lines.push(`${name.replace(/\s*\(.*?\)/, '')} ${weight} x ${reps} x ${sets}`);
  }
  return lines.join('\n');
}

const START_LOAD: Record<string, number> = {
  'Leg press': 180, 'Chest press (machine)': 70, 'Seated row': 80, 'Leg curl': 70, 'Lat pulldown': 80,
  'Goblet squat': 35, 'Incline DB press': 30, 'Chest-supported row': 70, 'Romanian deadlift (DB)': 40, 'Shoulder press (machine)': 50,
  'Leg extension': 80, 'Hip thrust': 90, 'Lateral raise (DB)': 10, 'Rope pushdown': 30, 'DB curl': 15, 'Calf raise': 90,
};

export const PERSONAS: Persona[] = [
  {
    id: 'dana',
    sheet: 'Dana, 46, a woman on Zepbound 5 mg for three months, shot on Thursdays. Joined a gym last month because she read about muscle loss and has never lifted. Eats small; afraid of eating too little and of eating too much. Answers questions properly, logs most meals, asks "why" once.',
    onboarding: ['2', '232', 'Zepbound'],
    later: { shotDay: 'Thursday', heightIn: "5'6", sex: 'F', age: '46', tz: 'Pacific', goalLb: '190' },
    liftDays: 2, loadBias: 1.0, skipRate: 0.1,
    script: (c) => {
      const out: string[] = [];
      if (c.day === 1) out.push('why');
      if (c.day === 3) out.push('/note left knee, no deep squats');
      if (c.day % 7 === 1) out.push(`/weight ${(232 - c.day * 0.25).toFixed(1)}`);
      out.push(pick(c.rng, MEALS.breakfast), pick(c.rng, MEALS.lunch));
      if (c.rng() < 0.8) out.push(pick(c.rng, MEALS.dinner));
      if (c.rng() < 0.5) out.push(pick(c.rng, MEALS.snack));
      if (c.askedCheckIn) out.push(`${pick(c.rng, [3, 4, 4, 5])} ${pick(c.rng, [3, 3, 4])}`);
      return out;
    },
  },
  {
    id: 'marcus',
    sheet: 'Marcus, 34, a man on Wegovy 1.7 mg, shot on Mondays. Already runs a four-day split and thinks the prescribed loads are light; he adds weight on his own. Logs sets precisely, logs food loosely, uses shortcuts, argues with the plan.',
    onboarding: ['4', '205', 'Wegovy'],
    later: { shotDay: 'Monday', heightIn: '5 ft 11', sex: 'M', age: '34', tz: 'Eastern', goalLb: 'skip' },
    liftDays: 4, loadBias: 1.15, skipRate: 0.05,
    script: (c) => {
      const out: string[] = [];
      if (c.day === 0) out.push('/alias shake = whey 2 scoops, 50 g, 240 kcal');
      if (c.day === 2) out.push('these loads are way too light');
      out.push('shake', pick(c.rng, MEALS.lunch), pick(c.rng, MEALS.dinner));
      if (c.askedCheckIn) out.push('5 5');
      return out;
    },
  },
  {
    id: 'linda',
    sheet: 'Linda, 58, a woman on the Wegovy pill, daily. No gym, walks. Types short answers, ignores about half of the questions, logs one meal a day if that. Not interested in lifting yet.',
    onboarding: ['0', '198', 'wegovy pill'],
    later: { heightIn: 'skip', sex: 'F', age: '58', tz: 'Central', goalLb: 'skip' },
    liftDays: 0, loadBias: 1.0, skipRate: 1.0,
    script: (c) => {
      const out: string[] = [];
      if (c.rng() < 0.6) out.push(pick(c.rng, MEALS.dinner));
      if (c.askedCheckIn && c.rng() < 0.5) out.push(`${pick(c.rng, [2, 3, 4])} ${pick(c.rng, [2, 3])}`);
      if (c.day === 5) out.push('what do I do about nausea');
      return out;
    },
  },
  {
    id: 'priya',
    sheet: 'Priya, 41, a woman on Mounjaro 7.5 mg, shot on Saturdays. Lifts twice a week, precise about food, corrects almost every meal once or twice ("that was 1 bar not 2"), sets shortcuts, checks /today and /week often.',
    onboarding: ['2', '171', 'Mounjaro'],
    later: { shotDay: 'Saturday', heightIn: '163 cm', sex: 'F', age: '41', tz: 'Pacific', goalLb: '150' },
    liftDays: 2, loadBias: 0.95, skipRate: 0.0,
    script: (c) => {
      const out: string[] = ['two protein bars', 'that was 1 bar not 2', pick(c.rng, MEALS.lunch)];
      if (c.rng() < 0.5) out.push('remove the rice');
      out.push(pick(c.rng, MEALS.dinner), '/today');
      if (c.weekday === 6) out.push('/week');
      if (c.askedCheckIn) out.push('4 4');
      return out;
    },
  },
  {
    id: 'tom',
    sheet: 'Tom, 52, a man on Zepbound 10 mg, shot on Tuesdays. Appetite is almost gone; eats one real meal a day and a bar, trains three days anyway and feels flat. Honest in check-ins: stomach fine, energy low.',
    onboarding: ['3', '240', 'Zepbound'],
    later: { shotDay: 'Tuesday', heightIn: "6'0", sex: 'M', age: '52', tz: 'Mountain', goalLb: '200' },
    liftDays: 3, loadBias: 0.9, skipRate: 0.2,
    script: (c) => {
      const out: string[] = ['protein bar'];
      if (c.rng() < 0.7) out.push(pick(c.rng, MEALS.dinner));
      if (c.day % 7 === 2) out.push(`/weight ${(240 - c.day * 0.6).toFixed(1)}`);
      if (c.askedCheckIn) out.push(`4 ${pick(c.rng, [1, 2, 2])}`);
      return out;
    },
  },
  {
    id: 'chaos',
    sheet: 'A tester who sends nonsense, emoji, slash commands that do not exist, asks for dose advice ("should I go up to 7.5?"), sends "232" with no context, and repeats messages fast. Wants to see the coach break.',
    onboarding: ['seven', '3', 'a lot', '232', 'Zepbound 5mg'],
    later: { shotDay: 'whenever', heightIn: 'tall', sex: 'yes', age: '46', tz: 'mars', goalLb: 'skip' },
    liftDays: 3, loadBias: 1.0, skipRate: 0.5,
    script: (c) => {
      const out = ['/foo', 'asdfgh', 'should I go up to 7.5 mg?', 'is it ok to skip my shot this week', '🍕🍕🍕', '232'];
      if (c.day % 3 === 0) out.push('delete me', '/start', '3', '232', 'Zepbound');
      if (c.askedCheckIn) out.push('9 9', '3 3');
      return out;
    },
  },
];

// Seeded random so a run is repeatable.
export function seeded(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}
