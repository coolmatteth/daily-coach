// PR 4 checks for the training bot: templates, the guards, replies with
// numbers, the check-in, the evening send. Run: npx tsx evals/training-check.ts
import { MemoryStore, emptyProfile } from '../src/store';
import { FakeTransport } from '../src/transport';
import { handleIncoming } from '../src/bot';
import { TEMPLATES, buildPlan, isLiftDay, parseSetLine, parseSetReply, parseCheckIn, renderPlan, matchLift, BLOCK_CAP, MAX_ADDS_PER_SESSION } from '../src/plans';
import { eveningPass, planDue, liftHistory } from '../src/training';
import type { LiftLog } from '../src/progression';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) console.log(`ok   ${name}`);
  else { failures++; console.log(`FAIL ${name} ${detail}`); }
}

// Templates and guards.
for (const n of [1, 2, 3, 4] as const) {
  check(`template ${n}: every day within the block cap`, TEMPLATES[n].every((d) => d.lifts.length <= BLOCK_CAP));
  check(`template ${n}: ${n} day${n === 1 ? '' : 's'} per cycle`, TEMPLATES[n].length === n);
}
check('two-day plan is full body on machines and dumbbells', TEMPLATES[2][0].title === 'Full body A' && TEMPLATES[2][0].lifts.some((l) => /machine/.test(l.name)));
{
  const p = { ...emptyProfile(), liftingDays: 2, weightLb: 230 };
  check('lift days: 2 → Mon and Thu', isLiftDay(p, '2026-11-09') && isLiftDay(p, '2026-11-12') && !isLiftDay(p, '2026-11-10'));
  const first = buildPlan(p, '2026-11-09', 0, new Map())!;
  check('first plan has no loads: pick 7 of 10', first.lifts.every((l) => l.weight === null && l.reason === 'first'));
  const text = renderPlan(first, true);
  check('first plan text says pick 7 of 10 and asks for numbers', /pick 7 of 10/.test(text) && /Reply with your numbers/.test(text) && /A held number is a good session/.test(text), text);
  const second = buildPlan(p, '2026-11-12', 1, new Map())!;
  check('template rotates on sessions done', first.title === 'Full body A' && second.title === 'Full body B');
  const shotP = { ...p, shotDay: 0 }; // Sunday shot, Monday is the day after
  const easy = buildPlan(shotP, '2026-11-09', 0, new Map())!;
  check('day after the shot: one set fewer, says so', easy.easier && easy.lifts.every((l) => l.sets === 2) && /Day after your shot/.test(renderPlan(easy, true)));
}
{
  // Guard 2: two lifts both owned twice → only one steps up this session.
  const p = { ...emptyProfile(), liftingDays: 2, weightLb: 230 };
  const owned = (key: string, w: number): LiftLog[] => [
    { exercise: key, key, date: '2026-11-02', sets: [{ weight: w, reps: 12 }, { weight: w, reps: 12 }, { weight: w, reps: 12 }] },
    { exercise: key, key, date: '2026-11-05', sets: [{ weight: w, reps: 12 }, { weight: w, reps: 12 }, { weight: w, reps: 12 }] },
  ];
  const h = new Map<string, LiftLog[]>([['leg press', owned('leg press', 180)], ['chest press', owned('chest press', 70)]]);
  const plan = buildPlan(p, '2026-11-09', 2, h)!;
  const adds = plan.lifts.filter((l) => l.reason === 'add');
  const lp = plan.lifts.find((l) => l.key === 'leg press')!;
  const cp = plan.lifts.find((l) => l.key === 'chest press')!;
  check('one step per session', adds.length === MAX_ADDS_PER_SESSION, JSON.stringify(plan.lifts.map((l) => [l.key, l.weight, l.reason])));
  check('leg press steps to 190, chest press holds at 70 with the reason', lp.weight === 190 && lp.reason === 'add' && cp.weight === 70 && cp.reason === 'hold' && /one step a session/.test(cp.why), JSON.stringify([lp, cp]));
  check('rendered plan marks the step', /Leg press: 3 × 8–12 at 190 ↑/.test(renderPlan(plan, true)), renderPlan(plan, true));
}

// Replies with numbers.
{
  const a = parseSetLine('leg press 180 x 10 x 3')!;
  check('"leg press 180 x 10 x 3"', a.name === 'leg press' && a.sets.length === 3 && a.sets[0].weight === 180 && a.sets[0].reps === 10);
  const b = parseSetLine('rows 3x8 at 95')!;
  check('"rows 3x8 at 95"', b.name === 'rows' && b.sets.length === 3 && b.sets[0].weight === 95 && b.sets[0].reps === 8, JSON.stringify(b));
  const c = parseSetLine('lat pulldown 80x12, 80x12, 80x10')!;
  check('"80x12, 80x12, 80x10" per set', c.sets.length === 3 && c.sets[2].reps === 10, JSON.stringify(c));
  const d = parseSetLine('chest press 70 for 3 sets of 12')!;
  check('"70 for 3 sets of 12"', d.sets.length === 3 && d.sets[0].weight === 70 && d.sets[0].reps === 12, JSON.stringify(d));
  const e = parseSetLine('leg curl 3 x 12 x 90')!;
  check('"3 x 12 x 90": the big number is the weight', e.sets.length === 3 && e.sets[0].weight === 90, JSON.stringify(e));
  check('a sentence is not a set line', parseSetLine('had chicken and rice for lunch') === null && parseSetLine('232') === null);
  const multi = parseSetReply('Leg press 180 x 10 x 3\nChest press 70 x 12 x 3\nSeated row 95 x 10 x 3');
  check('multi-line reply parses three lifts', multi.length === 3);
  check('a food message is not a set reply', parseSetReply('chicken thigh about 6 oz and rice').length === 0 && parseSetReply('that was 1 bar not 2').length === 0);
  const p = { ...emptyProfile(), liftingDays: 2, weightLb: 230 };
  const plan = buildPlan(p, '2026-11-09', 0, new Map())!;
  check('matchLift: "rows" → Seated row by key', matchLift('rows', plan).name === 'Seated row');
  check('matchLift: "chest press" → the planned name', matchLift('chest press', plan).name === 'Chest press (machine)');
  check('matchLift: an unplanned lift keeps its own name', matchLift('hip abduction', plan).name === 'hip abduction');
}

// The check-in.
check('check-in "4 3"', JSON.stringify(parseCheckIn('4 3')) === '{"stomach":4,"energy":3}');
check('check-in "4/3" and "stomach 2 energy 4"', parseCheckIn('4/3')?.energy === 3 && parseCheckIn('stomach 2, energy 4')?.stomach === 2);
check('check-in rejects out of range and non-pairs', parseCheckIn('6 3') === null && parseCheckIn('hello') === null && parseCheckIn('232') === null);

// Through the bot.
const T0 = new Date('2026-11-08T18:30:00Z'); // Sunday 6:30 PM UTC
const at = (d: number, h = 18, m = 30) => new Date(Date.UTC(2026, 10, 8 + d, h, m));
async function main() {
  const store = new MemoryStore();
  async function send(chatId: string, text: string, now: Date): Promise<string[]> {
    const tr = new FakeTransport('sim');
    await handleIncoming({ store, transport: tr, channel: 'sim', chatId, text, now, version: 'v' });
    return tr.sent.map((s) => s.text);
  }
  await send('u1', '/start', at(0, 10)); await send('u1', '2', at(0, 10)); await send('u1', '232', at(0, 10)); await send('u1', 'Zepbound', at(0, 10));
  const u = (await store.getUserByChat('sim', 'u1'))!;

  // Sunday evening: tomorrow (Monday) is a lifting day.
  check('plan due at 6 PM local, not before', planDue(u, T0) && !planDue(u, at(0, 12)));
  const out = new FakeTransport('sim');
  const sent = await eveningPass(store, () => out, T0);
  check('evening pass sends one plan', sent === 1 && /Tomorrow, Monday: Full body A/.test(out.sent[0].text), out.sent[0]?.text);
  check('evening pass is idempotent for the day', (await eveningPass(store, () => out, new Date(T0.getTime() + 3_600_000))) === 0);
  check('the plan is saved for Monday', (await store.getPlan(u.id, '2026-11-09')) !== null);

  // Monday: the user replies with numbers.
  let r = await send('u1', 'Leg press 180 x 10 x 3\nChest press 70 x 12 x 3\nrows 95 x 10 x 3', at(1, 19));
  check('sets recorded against the plan, with what is left', /Got it: Leg press 180 × 10 × 3; Chest press \(machine\) 70 × 12 × 3; Seated row 95 × 10 × 3/.test(r[0]) && /Not logged yet: Leg curl, Lat pulldown/.test(r[0]), r[0]);
  r = await send('u1', 'leg curl 90x12x3, lat pulldown 80 x 12 x 3', at(1, 19, 5));
  check('the rest of the session closes it out', /That is the whole session/.test(r[0]), r[0]);
  check('sets are stored under the planned key', (await store.listSets(u.id, 'leg press')).length === 3 && (await store.listSets(u.id, 'seated row')).length === 3);
  check('/plan shows today\'s plan', /Today, Monday: Full body A/.test((await send('u1', '/plan', at(1, 12)))[0]));

  // Monday evening: Tuesday is rest, so the check-in is asked.
  const out2 = new FakeTransport('sim');
  await eveningPass(store, () => out2, at(1));
  check('rest day message asks stomach and energy', /Tomorrow, Tuesday: rest/.test(out2.sent[0].text) && /Stomach and energy today, 1 to 5/.test(out2.sent[0].text), out2.sent[0]?.text);
  r = await send('u1', '2 4', at(1, 18, 40));
  check('"2 4" is read as the check-in and a rough stomach is noted', /stomach 2, energy 4/.test(r[0]) && /prescriber summary/.test(r[0]), r[0]);
  check('check-in stored, pending cleared', (await store.listCheckIns(u.id, '2026-11-09', '2026-11-09'))[0]?.stomach === 2 && (await store.getUserByChat('sim', 'u1'))?.pendingCheckinDay === null);
  r = await send('u1', '4 5', at(2, 9));
  check('"4 5" with no check-in pending is not a meal: it is still read as a check-in', /stomach 4, energy 5/.test(r[0]), r[0]);
  r = await send('u1', '/checkin 3 3', at(2, 10));
  check('/checkin logs explicitly', /stomach 3, energy 3/.test(r[0]));

  // Thursday: the second template day, with Monday's numbers as the baseline.
  const out3 = new FakeTransport('sim');
  await eveningPass(store, () => out3, at(3));
  check('Wednesday evening sends Thursday\'s Full body B with no loads yet for its new lifts', /Tomorrow, Thursday: Full body B/.test(out3.sent[0].text) && /Goblet squat: 3 × 8–12 at pick 7 of 10/.test(out3.sent[0].text), out3.sent[0]?.text);
  await send('u1', 'goblet squat 40 x 12 x 3', at(4, 19));
  // Next Monday: leg press was done once at 180 → repeat 180, aim for the top.
  const out4 = new FakeTransport('sim');
  await eveningPass(store, () => out4, at(7));
  check('a lift done once is repeated at the same load', /Monday: Full body A/.test(out4.sent[0].text) && /Leg press: 3 × 8–12 at 180/.test(out4.sent[0].text) && !/180 ↑/.test(out4.sent[0].text), out4.sent[0]?.text);
  const ALL_A = 'leg press 180 x 12 x 3, chest press 70 x 12 x 3, rows 95 x 12 x 3, leg curl 90 x 12 x 3, lat pulldown 80 x 12 x 3';
  await send('u1', ALL_A, at(8, 19));
  const h = await liftHistory(store, u.id, ['leg press']);
  check('history groups sets by day', h.get('leg press')!.length === 2 && h.get('leg press')![1].sets.length === 3);
  await eveningPass(store, () => new FakeTransport('sim'), at(10)); await send('u1', 'goblet squat 40 x 12 x 3', at(11, 19));
  const out5 = new FakeTransport('sim');
  await eveningPass(store, () => out5, at(14));
  check('owned once at the top after a lighter session → hold, not add', /Leg press: 3 × 8–12 at 180$/m.test(out5.sent[0].text), out5.sent[0]?.text);
  await send('u1', ALL_A, at(15, 19));
  await eveningPass(store, () => new FakeTransport('sim'), at(17)); await send('u1', 'goblet squat 40 x 12 x 3', at(18, 19));
  const out6 = new FakeTransport('sim');
  await eveningPass(store, () => out6, at(21));
  const monPlan = out6.sent[0]?.text ?? '';
  check('owned twice in a row → one lift steps up, the others hold', /Monday: Full body A/.test(monPlan) && /Leg press: 3 × 8–12 at 190 ↑/.test(monPlan) && /Chest press \(machine\): 3 × 8–12 at 70$/m.test(monPlan), monPlan);

  // No lifting days: the walk message and the check-in.
  await send('u2', '/start', at(0, 10)); await send('u2', '0', at(0, 10)); await send('u2', '150', at(0, 10)); await send('u2', 'none', at(0, 10));
  const out7 = new FakeTransport('sim');
  await eveningPass(store, () => out7, at(0, 19));
  const u2msg = out7.sent.find((s) => s.chatId === 'u2')?.text ?? '';
  check('0 lifting days: walk and protein, plus the check-in', /20-minute walk/.test(u2msg) && /Stomach and energy/.test(u2msg), u2msg);

  // Delete cascades.
  await send('u1', 'delete me', at(21));
  check('delete me removes sets, plans and check-ins', (await store.listSets(u.id, 'leg press')).length === 0 && (await store.getPlan(u.id, '2026-11-09')) === null && (await store.listCheckIns(u.id, '2026-11-01', '2026-12-01')).length === 0);

  console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
  if (failures) process.exit(1);
}
main();
