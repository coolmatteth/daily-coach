// PR 2 checks for the weigh-in rules. Run: npx tsx evals/weighins-check.ts
import { sevenDayAverage, plateau, rapidLoss, noiseBandLb, weighInReply, RAPID_LOSS_TEXT, UNDER_FLOOR_TEXT, type WeighIn } from '../src/weighins';
import { addDays } from '../src/clock';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) console.log(`ok   ${name}`);
  else { failures++; console.log(`FAIL ${name} ${detail}`); }
}

const start = '2026-08-01';
const daily = (days: number, f: (i: number) => number): WeighIn[] => Array.from({ length: days }, (_, i) => ({ date: addDays(start, i), lb: f(i) }));

// Smoother
const noisy = daily(7, (i) => 230 + (i % 2 === 0 ? 1.5 : -1.5));
check('7-day average smooths the noise', Math.abs((sevenDayAverage(noisy, addDays(start, 6)) ?? 0) - 230.2) < 0.3);
check('no reading in the window gives null', sevenDayAverage(noisy, '2027-01-01') === null);
check('noise band is about 1%', noiseBandLb(230) === 2.3);

// Plateau: flat 12 weeks (with noise) is a plateau.
const flat = daily(100, (i) => 220 + Math.sin(i) * 1.2);
const flatCall = plateau(flat, addDays(start, 99));
check('plateau: flat 12 weeks called a plateau', flatCall !== null && flatCall.plateau, JSON.stringify(flatCall));

// Not a plateau: steady loss over 12 weeks.
const losing = daily(100, (i) => 240 - i * 0.2);
const losingCall = plateau(losing, addDays(start, 99));
check('plateau: 20 lb over 12 weeks is not a plateau', losingCall !== null && !losingCall.plateau, JSON.stringify(losingCall));

// Noisy 3 weeks: not enough history, no call at all.
const short = daily(21, (i) => 230 + Math.sin(i) * 1.5);
check('plateau: three noisy weeks gives no call', plateau(short, addDays(start, 20)) === null);

// Rapid loss: only when two weeks in a row exceed 1.5 kg.
const fast = daily(21, (i) => 240 - i * 0.6);   // 4.2 lb a week, two full weeks
check('rapid: 4.2 lb/week for two weeks fires', rapidLoss(fast, addDays(start, 20)));
const oneWeek = [...daily(14, () => 240), ...daily(7, (i) => 240 - (i + 1) * 0.6).map((w, i) => ({ ...w, date: addDays(start, 14 + i) }))];
check('rapid: one fast week does not fire', !rapidLoss(oneWeek, addDays(start, 20)));
const normal = daily(21, (i) => 240 - i * 0.2);   // 1.4 lb a week
check('rapid: 1.4 lb/week does not fire', !rapidLoss(normal, addDays(start, 20)));

// Reply wording
const reply = weighInReply(noisy, addDays(start, 6));
check('weigh-in reply names the average and the noise', reply.includes('7-day average') && reply.includes('noise'));

// The safety wording carries no number and no diagnosis.
for (const [name, text] of [['rapid', RAPID_LOSS_TEXT], ['floor', UNDER_FLOOR_TEXT]] as const) {
  check(`${name} text has no digits`, !/\d/.test(text), text);
  check(`${name} text suggests a professional, does not instruct`, /may be helpful/.test(text) && !/\b(must|stop|hold|step)\b/i.test(text));
}

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
if (failures) process.exit(1);
