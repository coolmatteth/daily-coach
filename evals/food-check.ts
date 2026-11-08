// PR 3 checks for the Food Log: the plain-code parts, the recap wording,
// and the bot flow with a fake estimator. Run: npx tsx evals/food-check.ts
import { MemoryStore } from '../src/store';
import { FakeTransport } from '../src/transport';
import { handleIncoming, BUSY_TEXT } from '../src/bot';
import { dayTotals, tierOf, tierLine, tierBar, statusLine, loggedReply, weekSummary, todayList, pickEntry, applyEdit, atTime, mergeTarget, mergeInto, kcalDayOf, parseAlias, matchAlias, normalizeWord } from '../src/food';
import { weeklyRecap, prescriberSummary, weeksOnDose, FORBIDDEN_DOSE_WORDS } from '../src/recap';
import { systemPrompt, todayContext, type Action, type Block, type Estimator } from '../src/estimator';
import { QUOTA_MESSAGE, MODEL_CALLS_PER_DAY } from '../src/quota';
import { weeklyPass, isDue } from '../src/weekly';
import { emptyProfile } from '../src/store';
import type { FoodEntry } from '../src/types';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) console.log(`ok   ${name}`);
  else { failures++; console.log(`FAIL ${name} ${detail}`); }
}

const T = { floor: 120, goal: 150, stretch: 180 };
const B = { floor: 1800, target: 2200, ceiling: 2600 };
const entry = (protein_g: number, kcal: number, name = 'meal', confidence: FoodEntry['confidence'] = 'high'): FoodEntry =>
  ({ at: '2026-11-01T19:00:00Z', text: name, photo: false, items: [{ name, protein_g, kcal }], protein_g, kcal, confidence });

// ---- pure helpers ----
{
  const t = dayTotals([entry(75.4, 300, 'shake'), entry(42.2, 650, 'chicken bowl')]);
  check('day totals round the sum', t.protein_g === 118 && t.kcal === 950 && t.meals === 2);
  check('tiers: under / floor / goal / stretch', tierOf(95, T) === 'under' && tierOf(120, T) === 'floor' && tierOf(150, T) === 'goal' && tierOf(180, T) === 'stretch');
  check('tier line shows all three gaps', tierLine(31, T) === '89 → floor · 119 → goal · 149 → stretch', tierLine(31, T));
  check('tier line past the top shows the surplus', tierLine(182, T) === 'floor ✅ · goal ✅ · stretch ✅ +2');
  check('bar has gaps at floor and goal', tierBar(31, T) === '▰▰▱▱▱▱▱▱ ▱▱ ▱▱', tierBar(31, T));
  check('status line is two lines', statusLine(31, 610, T).split('\n').length === 2);
  check('logged reply names the item and the total', /~42 g protein, ~650 kcal: chicken bowl 42 g/.test(loggedReply(entry(42, 650, 'chicken bowl'), 118, 950, T)));
  check('kcalDayOf', kcalDayOf(1799, B) === 'light' && kcalDayOf(1800, B) === 'band' && kcalDayOf(2601, B) === 'big');
  const w = weekSummary([{ day: '2026-10-12', protein_g: 140, meals: 4, kcal: 2100 }, { day: '2026-10-13', protein_g: 0, meals: 0, kcal: 0 }, { day: '2026-10-14', protein_g: 160, meals: 5, kcal: 2500 }], T, B);
  check('week average skips unlogged days', /150 g protein and 2,300 kcal \(aim 2,200\) a day on the 2 days you logged/.test(w), w.split('\n')[0]);
  check('week counts days per tier', /Days: 0 stretch · 1 goal · 1 floor · 0 under the floor/.test(w));
  check('week without a band has no calorie score', !/Calories:/.test(weekSummary([{ day: '2026-10-12', protein_g: 140, meals: 4, kcal: 2100 }], T, null)));
}
{
  const dinner: FoodEntry = { at: '2026-11-01T23:22:00Z', text: 'dinner', photo: false,
    items: [{ name: 'chicken sausage', protein_g: 14, kcal: 180 }, { name: 'apple cider donut x2', protein_g: 4, kcal: 480 }, { name: 'protein shake', protein_g: 25, kcal: 100 }],
    protein_g: 43, kcal: 760, confidence: 'low' };
  const pizza = entry(14, 300, 'pizza slice');
  const day = [pizza, dinner];
  check('/today numbers the meals', /^1\. .*pizza.*\(14 g · 300 kcal\)\n2\. .*sausage.*\(43 g · 760 kcal\)\n/.test(todayList(day, T, null)));
  check('pickEntry finds the entry holding the item', pickEntry(day, null, ['shake']) === 1 && pickEntry(day, null, ['pizza']) === 0);
  const r = applyEdit(day, null, ['protein shake'], [{ name: 'broccoli', protein_g: 4, kcal: 55 }]);
  check('remove the shake, add broccoli, same entry', r.removed.length === 1 && r.added.length === 1 && r.entries[1].items.length === 3 && !r.entries[1].items.some((i) => /shake/.test(i.name)));
  check('totals recomputed', Math.round(r.entries[1].protein_g) === 22 && dayTotals(r.entries).protein_g === 36);
  check('removing every item deletes the entry', applyEdit(day, null, ['sausage', 'donut', 'shake'], []).deletedEntry !== null);
  check('a miss removes nothing', applyEdit(day, null, ['steak'], []).removed.length === 0);
  check('"lunch at 1pm" lands at 1 PM Pacific', atTime('2026-10-19', '13:00', 'x', 'America/Los_Angeles') === '2026-10-19T20:00:00.000Z');
  check('no time keeps the fallback', atTime('2026-10-19', '', 'fb', null) === 'fb');
  const a: FoodEntry = { ...entry(28, 540, 'beef patty'), at: '2026-10-19T23:12:00Z' };
  const b: FoodEntry = { ...entry(14, 300, 'pizza slice', 'medium'), at: '2026-10-19T23:22:00Z' };
  check('a meal 10 minutes later joins the previous one', mergeTarget([a], b.at, false) === 0 && mergeTarget([a], '2026-10-19T23:37:00Z', false) === -1 && mergeTarget([a], b.at, true) === -1);
  const m = mergeInto(a, b);
  check('merged meal keeps the first time, sums, takes the lower confidence', m.at === a.at && m.items.length === 2 && m.protein_g === 42 && m.confidence === 'medium');
  const al = parseAlias('/alias shake = whey 2 scoops, 50 g, 240 kcal');
  check('alias parses word, name and both numbers', !('error' in al) && al.word === 'shake' && al.item.name === 'whey 2 scoops' && al.item.protein_g === 50 && al.item.kcal === 240);
  check('missing kcal is an error', 'error' in parseAlias('/alias shake = whey 50 g'));
  check('normalizeWord strips "a" and punctuation', normalizeWord('A Shake!') === 'shake');
  const aliases = [al as { word: string; item: { name: string; protein_g: number; kcal: number } }];
  check('exact word matches, a sentence does not', matchAlias('a shake', aliases) !== undefined && matchAlias('shake and a banana', aliases) === undefined);
}

// ---- the recap and the prescriber summary ----
{
  const d = (day: string, protein_g: number, kcal: number, meals = 4) => ({ day, protein_g, kcal, meals });
  const last = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11'].map((x) => d(x, 170, 2100));
  const week = (f: (i: number) => [number, number]) => ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18'].map((x, i) => d(x, ...f(i)));
  const no = () => false;
  const onTrack = weeklyRecap({ days: [...last, ...week(() => [165, 2150])], band: B, tiers: T, dayAfterShot: no });
  check('on track inside the band with protein at goal', onTrack.verdict === 'on track' && /On track/.test(onTrack.text), onTrack.text);
  check('recap head names the week', /^Week ending Sun 10\/18/.test(onTrack.text));
  const slow = weeklyRecap({ days: [...last, ...week((i) => [180, i === 2 ? 2900 : 2450])], band: B, tiers: T, dayAfterShot: no });
  check('a touch slow names the big day', slow.verdict === 'a touch slow' && /The big days: Wed 2,900/.test(slow.text), slow.text);
  const off = weeklyRecap({ days: [...last, ...week(() => [180, 2800])], band: B, tiers: T, dayAfterShot: no });
  check('off pace over the ceiling', off.verdict === 'off pace');
  const under = weeklyRecap({ days: [...last, ...week(() => [160, 1650])], band: B, tiers: T, dayAfterShot: no });
  check('a week under the floor gets the safety wording', under.verdict === 'under the floor' && /may be helpful/.test(under.text), under.text);
  check('the under-floor line says it once', (under.text.match(/below the range|Under your floor/g) ?? []).length === 1, under.text);
  const few = weeklyRecap({ days: [...last, d('2026-10-12', 180, 2200), ...week(() => [0, 0]).slice(1).map((x) => ({ ...x, meals: 0 }))], band: B, tiers: T, dayAfterShot: no });
  check('too few days: no verdict', few.verdict === 'no verdict' && /a verdict needs 4/.test(few.text));
  const lightWk = weeklyRecap({ days: [...last, ...week((i) => [150, [0, 1, 3].includes(i) ? 1600 : 2100])], band: B, tiers: T, dayAfterShot: no });
  check('three light days get the flat-sessions line', /3 days under your floor/.test(lightWk.text), lightWk.text);
  const shotWk = weeklyRecap({ days: [...last, ...week((i) => [150, [0, 1, 3].includes(i) ? 1600 : 2100])], band: B, tiers: T, dayAfterShot: (day) => day === '2026-10-13' });
  check('a post-shot light day does not count', !/days under your floor/.test(shotWk.text));
  const noBand = weeklyRecap({ days: [...last, ...week(() => [165, 2150])], band: null, tiers: T, dayAfterShot: no });
  check('no band: protein-only verdict', /band appears once/.test(noBand.text) && noBand.verdict === 'on track');
  const starving = weeklyRecap({ days: [...last, ...week(() => [40, 520])], band: null, tiers: T, dayAfterShot: no });
  check('no band but a few hundred calories a day: the safety wording', starving.verdict === 'under the floor' && /may be helpful/.test(starving.text), starving.text);
  for (const r of [onTrack, slow, off, under, lightWk, noBand]) {
    check('recap never says hold, stay or step about a dose', !FORBIDDEN_DOSE_WORDS.test(r.text) && !/\b(hold|step up)\b/i.test(r.text), r.text);
  }
  const s = prescriberSummary({ drug: 'Zepbound', weeksOnDose: 5, sideEffectDays: 2, proteinGoalDays: 5, loggedDays: 7, kcalAvg: 2100, band: B, trendPct12wk: -4.1, weeks: 14 });
  check('summary carries weeks, side-effect days, protein, calories, trend', /5 weeks on your current dose of Zepbound/.test(s) && /2 side-effect days/.test(s) && /Protein at goal 5 of 7/.test(s) && /inside your band/.test(s) && /down 4.1%/.test(s), s);
  check('summary ends with "worth bringing" and names no action', /worth bringing to your next check-in/.test(s) && !FORBIDDEN_DOSE_WORDS.test(s) && !/\byou should\b/i.test(s));
  const noDose = prescriberSummary({ drug: 'Wegovy', weeksOnDose: null, sideEffectDays: 0, proteinGoalDays: 0, loggedDays: 2, kcalAvg: null, band: null, trendPct12wk: null, weeks: 0 });
  check('summary with no dose note asks for one, with no dose number in the example', /count the weeks/.test(noDose) && !/\d+\s*mg/.test(noDose), noDose);
  check('no summary without a drug', prescriberSummary({ drug: 'none', weeksOnDose: null, sideEffectDays: 0, proteinGoalDays: 0, loggedDays: 0, kcalAvg: null, band: null, trendPct12wk: null, weeks: 0 }) === '');
  check('weeksOnDose from the latest dose note', weeksOnDose([{ id: 1, userId: 1, date: '2026-10-01', kind: 'dose', text: 'x', value: null, source: 'user', createdAt: '' }, { id: 2, userId: 1, date: '2026-09-01', kind: 'dose', text: 'y', value: null, source: 'user', createdAt: '' }], '2026-11-07') === 5);
  check('FORBIDDEN catches the private wording', FORBIDDEN_DOSE_WORDS.test('Hold the dose; the body adapts.') && FORBIDDEN_DOSE_WORDS.test('the sign to talk about the next dose step up'));
}

// ---- the system prompt is per user ----
{
  const p = { ...emptyProfile(), drug: 'Zepbound', liftingDays: 2 };
  const s = systemPrompt(p, T, [{ word: 'shake', item: { name: 'whey', protein_g: 50, kcal: 240 } }]);
  check('prompt names the drug, the days and the tiers', /on Zepbound/.test(s) && /lifts 2 days/.test(s) && /150 g of protein/.test(s));
  check('prompt carries the shortcuts and the no-dose-advice line', /"shake" = whey, 50 g, 240 kcal/.test(s) && /Never give advice about their medication/.test(s));
  check('prompt names nobody', !/Matt/.test(s));
  check('context lists today numbered', /1\. .*: chicken bowl \(42 g\)/.test(todayContext([entry(42, 650, 'chicken bowl')], null)));
}

// ---- the bot flow with a fake estimator ----
class FakeEstimator implements Estimator {
  calls = 0;
  constructor(private script: Record<string, Action>) {}
  async decide(_s: string, _c: string, content: Block[]): Promise<Action> {
    this.calls++;
    const text = content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join(' ');
    const hit = Object.entries(this.script).find(([k]) => text.includes(k));
    return hit ? hit[1] : { action: 'answer', items: [], entry: null, remove_items: [], time: '', confidence: 'high', question: '', reply: 'Noted.' };
  }
}
const A = (a: Partial<Action>): Action => ({ action: 'log', items: [], entry: null, remove_items: [], time: '', confidence: 'high', question: '', reply: '', ...a });
const T0 = new Date('2026-11-07T18:00:00Z');
const at = (min: number) => new Date(T0.getTime() + min * 60_000);

async function main() {
  const est = new FakeEstimator({
    'chicken thigh': A({ items: [{ name: 'chicken thigh 6 oz', protein_g: 44, kcal: 400 }, { name: 'rice', protein_g: 4, kcal: 200 }] }),
    'bro polo': A({ action: 'ask', items: [{ name: 'broccoli', protein_g: 4, kcal: 55 }], confidence: 'low', question: 'Did you mean broccoli?' }),
    '1 bar not 2': A({ action: 'edit', remove_items: ['protein bar x2'], items: [{ name: 'protein bar', protein_g: 12, kcal: 210 }] }),
    'two bars': A({ items: [{ name: 'protein bar x2', protein_g: 24, kcal: 420 }] }),
    'lunch at 1pm': A({ items: [{ name: 'tuna sandwich', protein_g: 30, kcal: 450 }], time: '13:00' }),
    'remove the rice': A({ action: 'edit', remove_items: ['rice'], items: [] }),
    'how much protein': A({ action: 'answer', reply: 'Your goal is on your file; /me shows it.' }),
    'latte': A({ action: 'ask', items: [], confidence: 'low', question: 'I could not read "latte" as food.' }),
    'burrito': A({ items: [{ name: 'chicken burrito', protein_g: 38, kcal: 650 }] }),
    '232': A({ action: 'ask', items: [], confidence: 'low', question: 'I could not read "232" as food. What was it?' }),
  });
  const store = new MemoryStore();
  async function send(chatId: string, text: string, now = T0, photo?: () => Promise<Block | null>): Promise<string[]> {
    const transport = new FakeTransport('sim');
    await handleIncoming({ store, transport, channel: 'sim', chatId, text, now, version: 'abc1234', estimator: est, photo });
    return transport.sent.map((s) => s.text);
  }
  // Onboard quickly.
  await send('u1', '/start'); await send('u1', '2'); await send('u1', '232'); await send('u1', 'Zepbound');

  let r = await send('u1', 'chicken thigh about 6 oz and rice', at(1));
  check('a meal is logged with items and the status bar', /Logged ~48 g protein, ~600 kcal: chicken thigh 6 oz 44 g, rice 4 g/.test(r[0]) && /Today: 48 g protein/.test(r[0]), r[0]);
  check('one model call', est.calls === 1);

  r = await send('u1', 'a bit more bro polo', at(5));
  check('a guess is asked about, not logged', /Did you mean broccoli\?/.test(r[0]) && /Reply "yes"/.test(r[0]) && (await store.listMeals(1, '2026-11-07')).length === 1, r[0]);
  r = await send('u1', 'yes', at(6));
  check('"yes" logs the pending guess with no model call, merged into the sitting', /Added to your .* meal: broccoli 4 g/.test(r[0]) && est.calls === 2, r[0]);
  check('merged: still one meal with three items', (await store.listMeals(1, '2026-11-07'))[0].items.length === 3);
  r = await send('u1', '232', at(6, ));
  check('a bare number the model cannot read hints at /weight and offers no "yes"', /say "weight 232"/.test(r[0]) && !/Reply "yes"/.test(r[0]), r[0]);
  check('an empty reading leaves nothing pending', (await store.getUserByChat('sim', 'u1'))?.pendingMeal === null);

  r = await send('u1', 'remove the rice', at(7));
  check('a plain-word correction removes the item', /Removed rice 4 g/.test(r[0]) && (await store.listMeals(1, '2026-11-07'))[0].items.length === 2, r[0]);

  r = await send('u1', 'two bars', at(60));
  check('a later meal is its own entry', (await store.listMeals(1, '2026-11-07')).length === 2);
  r = await send('u1', 'that was 1 bar not 2', at(61));
  check('"1 bar not 2" replaces the item', /Removed protein bar x2 24 g, added protein bar 12 g/.test(r[0]), r[0]);

  r = await send('u1', 'lunch at 1pm tuna sandwich', at(120));
  check('a stated time is its own meal at that time', (await store.listMeals(1, '2026-11-07')).length === 3 && /1:00 PM/.test((await send('u1', '/today', at(121)))[0]));

  r = await send('u1', '/alias shake = whey 2 scoops, 50 g, 240 kcal', at(122));
  check('alias saved', /Saved: "shake"/.test(r[0]));
  const before = est.calls;
  r = await send('u1', 'shake', at(123));
  check('a shortcut word logs with no model call', /Logged ~50 g protein/.test(r[0]) && est.calls === before, r[0]);

  r = await send('u1', '/today', at(124));
  check('/today lists four meals', r[0].startsWith('1. ') && r[0].split('\n').filter((l) => /^\d\. /.test(l)).length === 4);
  r = await send('u1', '/delete 9', at(125));
  check('/delete out of range asks which', /Which one\? \/delete 1 to 4/.test(r[0]));
  r = await send('u1', '/undo', at(126));
  check('/undo removes the last meal', /Deleted 4\./.test(r[0]) && (await store.listMeals(1, '2026-11-07')).length === 3);

  r = await send('u1', 'how much protein should I eat', at(127));
  check('a question gets an answer, with no protein bar under it', /Your goal is on your file/.test(r[0]) && !/Today:/.test(r[0]), r[0]);

  r = await send('u1', '/week', at(128));
  check('/week reads the last 7 days', /Last 7 days:/.test(r[0]) && /11\/07 — /.test(r[0]));
  r = await send('u1', '/recap', at(129));
  check('/recap with too few days says so, and still gives the prescriber summary', /a verdict needs 4/.test(r[0]) && /For your prescriber/.test(r[0]) && /count the weeks/.test(r[0]), r[0]);
  check('recap text has no forbidden dose words', !FORBIDDEN_DOSE_WORDS.test(r[0]));

  // Friction fixes from the transcripts (11/8/26).
  const D2 = (min: number) => new Date(Date.UTC(2026, 10, 8, 12, min));
  r = await send('u1', 'latte', D2(0));
  check('an unknown one-word meal offers a one-time definition', /I don't know "latte" yet/.test(r[0]) && /make "latte" a shortcut/.test(r[0]), r[0]);
  r = await send('u1', 'oat milk latte, 8 g, 180 kcal', D2(1));
  check('the definition logs it and saves the shortcut', r.some((x) => /Logged ~8 g/.test(x)) && r.some((x) => /"latte" is a shortcut now/.test(x)) && (await store.listAliases(1)).some((a) => a.word === 'latte'), r.join(' | '));
  r = await send('u1', 'latte', D2(2));
  check('the word now logs with no model call', /(Logged ~8 g|Added to your .* meal: oat milk latte 8 g)/.test(r[0]), r[0]);
  const before2 = est.calls;
  r = await send('u1', 'burrito', D2(3));
  check('a readable one-word meal is logged and offered as a shortcut', r.some((x) => /Want "burrito" to mean this every time\? Reply "save"/.test(x)), r.join(' | '));
  r = await send('u1', 'save', D2(4));
  check('"save" saves it with the estimated numbers', /Saved: "burrito"/.test(r[0]) && (await store.listAliases(1)).some((a) => a.word === 'burrito'), r[0]);
  check('one model call for the burrito, none for save', est.calls === before2 + 1);
  r = await send('u1', 'remove the rice', D2(5));
  check('a correction that matches nothing is one line', /No rice in today's meals\. \/today shows what is\./.test(r[0]), r[0]);

  // Quota: the cap stops model calls, logging by shortcut still works.
  for (let i = await store.countModelCalls(1, '2026-11-07'); i < MODEL_CALLS_PER_DAY; i++) await send('u1', `meal number ${i}`, at(200 + i));
  const beforeQ = est.calls;
  r = await send('u1', 'one more meal please', at(300));
  check('over the cap: a plain refusal, no model call', r[0] === QUOTA_MESSAGE && est.calls === beforeQ, r[0]);
  r = await send('u1', 'shake', at(301));
  check('shortcuts still log over the cap', /Logged ~50 g/.test(r[0]));
  r = await send('u1', 'one more meal please', new Date('2026-11-08T18:00:00Z'));
  check('the cap resets the next day', r[0] !== QUOTA_MESSAGE);

  // Photo path.
  const photoEst = new FakeEstimator({ 'What is in this photo': A({ items: [{ name: 'salmon fillet', protein_g: 34, kcal: 280 }] }) });
  const s2 = new MemoryStore();
  const tr = new FakeTransport('sim');
  await handleIncoming({ store: s2, transport: tr, channel: 'sim', chatId: 'p', text: '/start', now: T0, version: 'v' });
  for (const t of ['3', '180', 'Wegovy']) await handleIncoming({ store: s2, transport: new FakeTransport('sim'), channel: 'sim', chatId: 'p', text: t, now: T0, version: 'v' });
  const tr2 = new FakeTransport('sim');
  await handleIncoming({ store: s2, transport: tr2, channel: 'sim', chatId: 'p', text: '', now: at(1), version: 'v', estimator: photoEst, photo: async () => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } }) });
  check('a photo with no caption is estimated and logged', /Logged ~34 g protein.*salmon/.test(tr2.sent[0]?.text ?? ''), tr2.sent[0]?.text);

  // Two users are separate; the lock stops interleaving.
  await send('u2', '/start'); await send('u2', '1'); await send('u2', '150'); await send('u2', 'none');
  r = await send('u2', '/today', at(130));
  check('a second user sees an empty day', /Nothing logged yet today/.test(r[0]));
  const u2 = await store.getUserByChat('sim', 'u2');
  check('lock: a second message while one is in flight is refused', (await store.acquireLock(u2!.id, at(131), 30_000)) && (await (async () => { const t2 = new FakeTransport('sim'); await handleIncoming({ store, transport: t2, channel: 'sim', chatId: 'u2', text: 'shake', now: at(131), version: 'v' }); return t2.sent[0].text; })()) === BUSY_TEXT);
  await store.releaseLock(u2!.id);
  check('lock: expired lock can be taken', (await store.acquireLock(u2!.id, at(132), 1)) && (await store.acquireLock(u2!.id, at(133), 1)));
  await store.releaseLock(u2!.id);

  // A pending onboarding question does not swallow a meal.
  // The shot-day question has been asked twice already in this script; reset
  // the ask count so this tests the drop-on-meal rule, not the stop rule.
  await store.updateUser(1, { askCount: 0, pendingField: null });
  r = await send('u1', 'hello', new Date('2026-11-09T18:00:00Z'));
  check('a day-two question is asked', r[1]?.startsWith('Which day is your shot'), r.join(' || '));
  r = await send('u1', 'chicken thigh and rice', new Date('2026-11-09T18:01:00Z'));
  check('a meal while a later question is pending is logged, the question dropped for today', /Logged ~48 g/.test(r[0]) && (await store.getUserByChat('sim', 'u1'))?.pendingField === null, r[0]);

  // The Sunday pass.
  const sunday = new Date('2026-11-15T17:30:00Z'); // Sunday, UTC users
  const u1 = await store.getUserByChat('sim', 'u1');
  check('isDue on Sunday after 5 PM local', isDue(u1!, sunday) && !isDue(u1!, new Date('2026-11-15T10:00:00Z')) && !isDue(u1!, new Date('2026-11-16T18:00:00Z')));
  const out = new FakeTransport('sim');
  const sent = await weeklyPass(store, () => out, sunday);
  check('weekly pass sends to every due user once', sent === 2 && out.sent.length === 2);
  check('weekly pass writes a coach line into the file', (await store.listNotes(u1!.id)).some((n) => n.source === 'coach' && /Week ending 2026-11-14/.test(n.text)));
  check('weekly pass is idempotent for the day', (await weeklyPass(store, () => out, new Date('2026-11-15T19:00:00Z'))) === 0);

  // Delete cascades through meals and aliases.
  await send('u1', 'delete me', at(400));
  check('delete me removes meals and aliases', (await store.listMeals(1, '2026-11-07')).length === 0 && (await store.listAliases(1)).length === 0);

  console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
  if (failures) process.exit(1);
}

main();
