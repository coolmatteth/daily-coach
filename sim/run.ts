// The simulated-user harness (PR 5, 11/8/26). Runs the cast through N
// weeks against a Coach, writes one transcript per persona to sim/out/,
// checks every message against the invariants, and prints a summary.
//
//   npx tsx sim/run.ts                      # local, scripted personas, 4 weeks
//   WEEKS=2 npx tsx sim/run.ts dana marcus  # some of the cast
//   SIM_BASE=https://glp1-coach-staging.<sub>.workers.dev SIM_SECRET=... npx tsx sim/run.ts
//                                           # against staging, real model
//   PERSONA_MODEL=1 ANTHROPIC_API_KEY=...   # a model plays each persona and
//                                           # answers the three feedback questions
import { mkdirSync, writeFileSync } from 'node:fs';
import { PERSONAS, liftReply, seeded, type Persona, type DayContext } from './personas';
import { LocalCoach, RemoteCoach, type Coach } from './coach';
import { checkDayModelCalls, checkMessage, type Violation } from './invariants';
import { QUESTIONS } from '../src/athlete';
import { playPersona, weeklyFeedback } from './model';

const DAY = 86_400_000;
const START = new Date('2026-11-09T00:00:00Z'); // a Monday, midnight UTC
// November offsets for the zones the cast names; the evening send is at 6 PM
// in the user's own zone, so the harness has to run it then.
const TZ_OFFSET: Record<string, number> = { Pacific: -8, Mountain: -7, Central: -6, Eastern: -5 };
const offsetHours = (p: Persona) => TZ_OFFSET[p.later.tz ?? ''] ?? 0;
const weeks = Number(process.env.WEEKS ?? 4);
const chosen = process.argv.slice(2);
const cast = chosen.length ? PERSONAS.filter((p) => chosen.includes(p.id)) : PERSONAS;
const useModel = process.env.PERSONA_MODEL === '1' && Boolean(process.env.ANTHROPIC_API_KEY);

interface Turn { at: string; who: 'user' | 'coach'; text: string }

export interface RunResult {
  persona: string;
  turns: Turn[];
  violations: Violation[];
  coachMessages: number;
  userMessages: number;
  feedback: string[];
}

export async function runPersona(coach: Coach, p: Persona, weeks: number, seed = 7): Promise<RunResult> {
  const rng = seeded(seed);
  const chatId = `sim-${p.id}`;
  const turns: Turn[] = [];
  const violations: Violation[] = [];
  const feedback: string[] = [];
  let planToday: string | null = null;
  let askedCheckIn = false;
  let lastQuestion: string | null = null;
  let callsAtDayStart = coach.modelCalls() ?? 0;

  const say = async (text: string, at: Date) => {
    turns.push({ at: at.toISOString(), who: 'user', text });
    const replies = await coach.send(chatId, text);
    for (const r of replies) {
      turns.push({ at: at.toISOString(), who: 'coach', text: r });
      violations.push(...checkMessage(p.id, Math.floor((at.getTime() - START.getTime()) / DAY), r));
    }
    const q = [...replies].reverse().find((r) => QUESTIONS.some((x) => x.ask === r || x.retry === r) || /What do you weigh\?$/.test(r));
    if (q) lastQuestion = q; // stays pending until the persona answers it
    return replies;
  };

  // The persona's zone is UTC until they tell the coach otherwise, as in life.
  let off = 0;
  const startAt = new Date(START.getTime() + (8 - off) * 3_600_000); // 8 AM local
  await coach.reset(chatId);
  await coach.setClock(startAt);
  const startReplies = await say('/start', startAt);
  // Day-one onboarding: answer whatever is asked, in order, until the numbers arrive.
  let i = 0;
  let guard = 0;
  while (lastQuestion && i < p.onboarding.length && guard++ < 12) {
    const before = lastQuestion;
    const r = await say(p.onboarding[i++], startAt);
    if (lastQuestion === before && !r.some((x) => QUESTIONS.some((q) => q.retry === x))) lastQuestion = null;
    if (r.some((x) => /Done for today/.test(x))) { lastQuestion = null; break; }
  }
  void startReplies;

  for (let d = 0; d < weeks * 7; d++) {
    const morning = new Date(START.getTime() + d * DAY + (9 - off) * 3_600_000);   // 9 AM local
    const evening = new Date(START.getTime() + d * DAY + (18.5 - off) * 3_600_000); // 6:30 PM local
    const date = new Date(START.getTime() + d * DAY).toISOString().slice(0, 10);
    await coach.setClock(morning);
    const ctx: DayContext = { day: d, date, weekday: new Date(START.getTime() + d * DAY).getUTCDay(), planText: planToday, askedCheckIn, pendingQuestion: lastQuestion, rng };

    let messages: string[];
    if (useModel) {
      messages = await playPersona(p, ctx, turns.slice(-8).map((t) => `${t.who}: ${t.text}`));
    } else {
      messages = [...p.script(ctx)];
      // Answer a one-a-day onboarding question when one is pending.
      if (lastQuestion) {
        const field = fieldOf(lastQuestion);
        if (field && p.later[field] !== undefined) {
          messages.unshift(p.later[field]);
          if (field === 'tz') off = offsetHours(p);
          lastQuestion = null;
        }
      }
      // Lift, unless skipping today.
      if (planToday && rng() >= p.skipRate) messages.push(liftReply(planToday, p.loadBias, rng));
    }
    let minute = 0;
    for (const m of messages) {
      const at = new Date(morning.getTime() + minute * 60_000);
      await coach.setClock(at);
      await say(m, at);
      minute += 5 + Math.floor(rng() * 40);
      // A question asked mid-day gets its answer in a few minutes, as a
      // person would; the scripted persona answers what it has an answer for.
      if (!useModel && lastQuestion) {
        const field = fieldOf(lastQuestion);
        if (field && p.later[field] !== undefined && rng() < 0.7) {
          const at2 = new Date(morning.getTime() + minute * 60_000);
          await coach.setClock(at2);
          await say(p.later[field], at2);
          if (field === 'tz') off = offsetHours(p);
          lastQuestion = null;
          minute += 3;
        }
      }
    }
    // Evening: the coach sends tomorrow's plan or the check-in, and on Sunday the recap.
    await coach.setClock(evening);
    const sent = await coach.passes(chatId);
    for (const r of sent) {
      turns.push({ at: evening.toISOString(), who: 'coach', text: r });
      violations.push(...checkMessage(p.id, d, r));
    }
    planToday = sent.find((s) => /^Tomorrow, \w+: (?!rest)/.test(s) && /Reply with your numbers/.test(s)) ?? null;
    askedCheckIn = sent.some((s) => /Stomach and energy today/.test(s));
    const calls = coach.modelCalls();
    if (calls !== null) { violations.push(...checkDayModelCalls(p.id, d, calls - callsAtDayStart)); callsAtDayStart = calls; }

    if (useModel && (d + 1) % 7 === 0) {
      feedback.push(await weeklyFeedback(p, Math.floor(d / 7) + 1, turns.filter((t) => t.at >= new Date(START.getTime() + (d - 6) * DAY).toISOString()).map((t) => `${t.who}: ${t.text}`)));
    }
  }

  return {
    persona: p.id, turns, violations,
    coachMessages: turns.filter((t) => t.who === 'coach').length,
    userMessages: turns.filter((t) => t.who === 'user').length,
    feedback,
  };
}

function fieldOf(question: string): string | null {
  if (/shot/.test(question)) return 'shotDay';
  if (/^Height/.test(question)) return 'heightIn';
  if (/^Sex/.test(question)) return 'sex';
  if (/^Age/.test(question)) return 'age';
  if (/^Time zone/.test(question)) return 'tz';
  if (/goal weight/.test(question)) return 'goalLb';
  return null;
}

export function transcript(r: RunResult): string {
  const lines = [`# ${r.persona}`, '', `${r.userMessages} user messages, ${r.coachMessages} coach messages, ${r.violations.length} violations.`, ''];
  let lastDay = '';
  for (const t of r.turns) {
    const day = t.at.slice(0, 10);
    if (day !== lastDay) { lines.push('', `## ${day}`, ''); lastDay = day; }
    lines.push(`**${t.who === 'user' ? 'user' : 'coach'}** ${t.at.slice(11, 16)}`, '', t.text.split('\n').map((l) => `> ${l}`).join('\n'), '');
  }
  if (r.violations.length) {
    lines.push('', '## Violations', '');
    for (const v of r.violations) lines.push(`- day ${v.day}: ${v.rule}${v.text ? ` — "${v.text.slice(0, 120)}"` : ''}`);
  }
  if (r.feedback.length) {
    lines.push('', '## Persona feedback', '');
    r.feedback.forEach((f, i) => lines.push(`### Week ${i + 1}`, '', f, ''));
  }
  return lines.join('\n');
}

async function main() {
  const coach: Coach = process.env.SIM_BASE
    ? new RemoteCoach(process.env.SIM_BASE.replace(/\/$/, ''), process.env.SIM_SECRET ?? '')
    : new LocalCoach();
  mkdirSync('sim/out', { recursive: true });
  const results: RunResult[] = [];
  for (const p of cast) {
    const r = await runPersona(coach, p, weeks);
    writeFileSync(`sim/out/${p.id}.md`, transcript(r));
    results.push(r);
    console.log(`${p.id.padEnd(8)} ${String(r.userMessages).padStart(4)} in ${String(r.coachMessages).padStart(4)} out ${String(r.violations.length).padStart(3)} violations`);
  }
  const total = results.reduce((n, r) => n + r.violations.length, 0);
  const byRule = new Map<string, number>();
  for (const r of results) for (const v of r.violations) byRule.set(v.rule, (byRule.get(v.rule) ?? 0) + 1);
  console.log(`\n${total} violation(s)${byRule.size ? ': ' + [...byRule].map(([k, n]) => `${k} ×${n}`).join(', ') : ''}`);
  console.log(`Transcripts in sim/out/. ${useModel ? 'Persona feedback included.' : 'Scripted personas; set PERSONA_MODEL=1 with an API key for model-played personas and feedback.'}`);
  if (total) process.exit(1);
}

if (process.argv[1] && /sim[\\/]run\.ts$/.test(process.argv[1])) main();
