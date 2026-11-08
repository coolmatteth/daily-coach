// PR 2 checks for onboarding and the Athlete File, through the bot. Run: npx tsx evals/athlete-check.ts
import { MemoryStore } from '../src/store';
import { FakeTransport } from '../src/transport';
import { handleIncoming, START_TEXT, SKIPPED_TEXT } from '../src/bot';
import { parseHeightIn, parseWeightLb, parseShotDay, parseTz, parseDrug, parseNote, nextQuestion, QUESTIONS, FIELD_ORDER } from '../src/athlete';
import { emptyProfile } from '../src/store';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) console.log(`ok   ${name}`);
  else { failures++; console.log(`FAIL ${name} ${detail}`); }
}

const T0 = new Date('2026-11-07T18:00:00Z');
const day = (n: number) => new Date(T0.getTime() + n * 86_400_000);

async function send(store: MemoryStore, chatId: string, text: string, now = T0): Promise<string[]> {
  const transport = new FakeTransport('sim');
  await handleIncoming({ store, transport, channel: 'sim', chatId, text, now, version: 'abc1234' });
  return transport.sent.map((s) => s.text);
}

async function main() {
  // Parsers
  check('weight: "232" → 232', parseWeightLb('232') === 232);
  check('weight: "105 kg" → 231.5', parseWeightLb('105 kg') === 231.5);
  check('weight: nonsense → null', parseWeightLb('a lot') === null && parseWeightLb('5') === null);
  check('height: 5\'6 → 66', parseHeightIn("5'6") === 66);
  check('height: 5 ft 6 → 66', parseHeightIn('5 ft 6') === 66);
  check('height: 168 cm → 66.1', parseHeightIn('168 cm') === 66.1);
  check('height: 66 → 66', parseHeightIn('66') === 66);
  check('shot: Thursday → 4', parseShotDay('Thursdays') === 4);
  check('shot: pill → -1', parseShotDay('pill, daily') === -1);
  check('tz: pacific → America/Los_Angeles', parseTz('Pacific') === 'America/Los_Angeles');
  check('tz: Europe/London accepted', parseTz('Europe/London') === 'Europe/London');
  check('tz: nonsense → null', parseTz('mars') === null);
  check('drug: "zepbound 5mg" → Zepbound', parseDrug('zepbound 5mg') === 'Zepbound');
  check('drug: none', parseDrug('not on anything') === 'none');
  const n = parseNote('/note left knee, no deep squats', '2026-11-07');
  check('note: kind injury from "knee"', n?.kind === 'injury' && n.text === 'left knee, no deep squats');
  const d = parseNote('/note stepped to 7.5 mg on 11/3', '2026-11-07');
  check('note: dose with date and value', d?.kind === 'dose' && d.date === '2026-11-03' && d.value === '7.5 mg', JSON.stringify(d));
  check('questions cover every field in order', QUESTIONS.map((q) => q.field).join() === FIELD_ORDER.join());

  // nextQuestion: day-one fields back to back, then one a day.
  const p = emptyProfile();
  check('next: lifting days first', nextQuestion(p, '2026-11-07')?.field === 'liftingDays');
  p.liftingDays = 2; p.weightLb = 232; p.drug = 'Zepbound';
  p.lastAskedDay = '2026-11-07';
  check('next: nothing more today after day one', nextQuestion(p, '2026-11-07') === null);
  check('next: shot day tomorrow', nextQuestion(p, '2026-11-08')?.field === 'shotDay');
  p.drug = 'none';
  check('next: no shot day on no medication', nextQuestion(p, '2026-11-08')?.field === 'heightIn');

  // The flow through the bot.
  const store = new MemoryStore();
  let r = await send(store, 'u1', '/start');
  check('/start sends the disclosure then the first question', r.length === 2 && r[0] === START_TEXT && r[1].startsWith('How many days a week'));
  r = await send(store, 'u1', 'seven');
  check('bad answer gets the retry, nothing stored', r.length === 1 && /0 to 4/.test(r[0]));
  r = await send(store, 'u1', '2');
  check('lifting days stored, weight asked next', r.length === 1 && r[0].startsWith('Current weight'));
  r = await send(store, 'u1', '232');
  check('weight stored, medication asked next', r.length === 1 && r[0].startsWith('Which medication'));
  r = await send(store, 'u1', 'Zepbound');
  check('day one done: numbers, no further question today', r.length === 1 && r[0].startsWith('Done for today') && r[0].includes('Protein: floor'));
  check('numbers say the band is still coming', r[0].includes('height, age and sex'));
  let u = await store.getUserByChat('sim', 'u1');
  check('profile stored', u?.liftingDays === 2 && u.weightLb === 232 && u.drug === 'Zepbound' && u.pendingField === null);

  r = await send(store, 'u1', 'hello');
  check('later that day: no new question', r.length === 1 && !/\?$/.test(r[0]));

  r = await send(store, 'u1', 'hello', day(1));
  check('next day: one question appended (shot day)', r.length === 2 && r[1].startsWith('Which day is your shot'));
  r = await send(store, 'u1', 'Thursday', day(1));
  check('shot day stored with an ack, no second question that day', r.length === 1 && /day after/.test(r[0]));
  u = await store.getUserByChat('sim', 'u1');
  check('shot day is 4', u?.shotDay === 4);

  r = await send(store, 'u1', 'why', day(1));
  check('why explains the protein formula', r[0].includes('g per kg'));

  r = await send(store, 'u1', '/me', day(2));
  check('/me renders the file and asks the day\'s question', r[0].startsWith('Your file') && r[0].includes('Zepbound, Thursday') && r.length === 2 && r[1].startsWith('Height'));
  r = await send(store, 'u1', 'skip', day(2));
  check('skip declines the question', r[0] === SKIPPED_TEXT);
  u = await store.getUserByChat('sim', 'u1');
  check('skipped recorded', u?.skipped.includes('heightIn') === true);
  r = await send(store, 'u1', 'hi', day(3));
  check('skipped field not asked again; sex asked instead', r.length === 2 && r[1].startsWith('Sex'));
  await send(store, 'u1', 'F', day(3));
  r = await send(store, 'u1', 'hi', day(4));
  check('age asked on day four', r[1]?.startsWith('Age'));
  r = await send(store, 'u1', '46', day(4));
  check('age ack without a band (height skipped)', r.length === 1 && r[0].startsWith('Thanks'));

  // Found by the simulated users: meals typed into a day-one question.
  const s3 = new MemoryStore();
  await send(s3, 'u3', '/start');
  r = await send(s3, 'u3', 'two eggs and toast');
  check('deferral: first miss retries', /0 to 4/.test(r[0]));
  r = await send(s3, 'u3', 'chicken salad');
  check('deferral: second miss retries', /0 to 4/.test(r[0]));
  r = await send(s3, 'u3', 'pizza two slices');
  check('deferral: third message is read as a message, not a retry', !/0 to 4/.test(r[0]) && /weigh/.test(r[0]), r.join(' | '));
  check('deferral: the question is set aside for today', (await s3.getUserByChat('sim', 'u3'))?.deferredDay === '2026-11-07');
  r = await send(s3, 'u3', 'hello', day(1));
  check('deferral: tomorrow the day-one question is asked again', r.some((x) => /0 to 4|weigh/.test(x)), r.join(' | '));

  // A late answer after a meal came between (found by the simulated users).
  const s4 = new MemoryStore();
  await send(s4, 'u4', '/start'); await send(s4, 'u4', '2'); await send(s4, 'u4', '232'); await send(s4, 'u4', 'Zepbound');
  r = await send(s4, 'u4', 'hello', day(1));
  check('late answer: shot day asked', r[1]?.startsWith('Which day is your shot'));
  r = await send(s4, 'u4', 'chicken salad', day(1));
  check('late answer: a meal drops the question for now', (await s4.getUserByChat('sim', 'u4'))?.pendingField === null);
  r = await send(s4, 'u4', 'Thursday', day(1));
  check('late answer: "Thursday" later that day still sets the shot day', (await s4.getUserByChat('sim', 'u4'))?.shotDay === 4 && /day after your shot/.test(r[0]), r.join(' | '));

  // Notes
  r = await send(store, 'u1', '/note left knee, no deep squats', day(5));
  check('note added with its id', /Noted #1 \(injury\)/.test(r[0]));
  r = await send(store, 'u1', '/me', day(5));
  check('file shows the note', r[0].includes('#1 2026-11-12 injury: left knee, no deep squats'));
  r = await send(store, 'u1', '/forget 1', day(5));
  check('forget removes it', r[0] === 'Removed #1.');
  r = await send(store, 'u1', '/forget 9', day(5));
  check('forget unknown says so', /No note #9/.test(r[0]));

  // Weigh-ins
  r = await send(store, 'u1', '/weight 231.4', day(6));
  check('weigh-in logged with the noise line', r[0].startsWith('Logged 231.4 lb') && r[0].includes('noise'));
  r = await send(store, 'u1', 'weight 230.8', day(7));
  check('second weigh-in reports the 7-day average', r[0].includes('7-day average'));
  u = await store.getUserByChat('sim', 'u1');
  check('profile weight follows the latest weigh-in', u?.weightLb === 230.8);

  // Delete cascades.
  r = await send(store, 'u1', 'delete me', day(8));
  check('delete me removes the user', (await store.getUserByChat('sim', 'u1')) === null);
  r = await send(store, 'u1', '/me', day(8));
  check('after delete, /me says /start', r[0] === 'Say /start to begin.');

  // A second user is separate and gets the full band once height, age, sex are in.
  const s2 = new MemoryStore();
  await send(s2, 'u2', '/start');
  await send(s2, 'u2', '4'); await send(s2, 'u2', '180'); await send(s2, 'u2', 'Wegovy');
  await send(s2, 'u2', 'x', day(1)); await send(s2, 'u2', 'Monday', day(1));
  await send(s2, 'u2', 'x', day(2)); await send(s2, 'u2', "5'10", day(2));
  await send(s2, 'u2', 'x', day(3)); await send(s2, 'u2', 'M', day(3));
  await send(s2, 'u2', 'x', day(4)); r = await send(s2, 'u2', '34', day(4));
  check('band appears once height, sex and age are in', /Calories: \d+ to \d+/.test(r[0]), r[0]);
  r = await send(s2, 'u2', '/me', day(5));
  check('file carries the band', /Calories: \d+ to \d+, aim \d+/.test(r[0]));

  console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
  if (failures) process.exit(1);
}

main();
