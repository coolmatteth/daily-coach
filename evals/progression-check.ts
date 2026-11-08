// PR 4 checks for the progression engine, ported from the private coach's
// cases. Run: npx tsx evals/progression-check.ts
import { parseSets, liftKey, nextPrescription, stepFor, type LiftLog } from '../src/progression';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) console.log(`ok   ${name}`);
  else { failures++; console.log(`FAIL ${name} ${detail}`); }
}
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// Prescriptions as people type them.
check('60 × 10 × 3 → three sets', eq(parseSets('60 × 10 × 3'), [{ weight: 60, reps: 10 }, { weight: 60, reps: 10 }, { weight: 60, reps: 10 }]));
check('90/80/75 × 10 → per-set weights', eq(parseSets('90/80/75 × 10').map((s) => s.weight), [90, 80, 75]));
check('60 × 8 / 55 × 12 / 55 × 12 → per-set lines', eq(parseSets('60 × 8 / 55 × 12 / 55 × 12'), [{ weight: 60, reps: 8 }, { weight: 55, reps: 12 }, { weight: 55, reps: 12 }]));
check('100/100/90 × 12/10/10 → paired', eq(parseSets('100/100/90 × 12/10/10').map((s) => s.reps), [12, 10, 10]));
check('lowercase x works', parseSets('60 x 10 x 3').length === 3);
check('3 × 12 each side has no load', parseSets('3 × 12 each side').length === 0);
check('bodyweight × 12 × 3 has no load', parseSets('bodyweight × 12 × 3').length === 0);

// Names that mean the same lift.
check('DB Chest Press = Dumbbell Flat Press', liftKey('DB Chest Press') === liftKey('Dumbbell Flat Press'));
check('Chest press (machine) = machine chest press', liftKey('Chest press (machine)') === liftKey('machine chest press'));
check('Lat pulldown = pulldown', liftKey('Lat pulldown') === liftKey('pulldown'));
check('Straight-arm pulldown is not lat pulldown', liftKey('Straight-Arm Pulldown') !== liftKey('Lat Pulldown'));
check('Single-leg leg press is not leg press', liftKey('Single-Leg Leg Press') !== liftKey('Leg Press'));
check('Seated row = cable row = rows', liftKey('Seated row') === liftKey('cable row') && liftKey('seated rows') === 'seated row');
check('leg curl is not a DB curl', liftKey('Leg curl') !== liftKey('DB curl'));
check('steps: dumbbells 5, light machines 5, heavy machines 10', stepFor('db flat press', 60) === 5 && stepFor('rope pushdown', 30) === 5 && stepFor('leg press', 180) === 10);

// The rule, sessions oldest first.
const log = (date: string, w: number | number[], reps: number | number[], n = 3): LiftLog => {
  const ws = Array.isArray(w) ? w : Array(n).fill(w);
  const rs = Array.isArray(reps) ? reps : Array(n).fill(reps);
  return { exercise: 'Pec Deck', key: 'pec deck', date, sets: ws.map((weight, i) => ({ weight, reps: rs[i] })) };
};
{
  const p = nextPrescription([log('2026-09-29', 145, 12)], 'pec deck')!;
  check('one owned session → repeat it', p.weight === 145 && p.reason === 'hold', p.why);
}
{
  const p = nextPrescription([log('2026-09-15', 145, 12), log('2026-09-29', 145, 12)], 'pec deck')!;
  check('owned twice in a row → add a step', p.weight === 155 && p.reason === 'add', p.why);
}
{
  const p = nextPrescription([log('2026-09-15', 145, 12), log('2026-09-29', 145, 12), log('2026-10-12', 160, 12)], 'pec deck')!;
  check('a heavier weight owned once above the working one → repeat it to confirm', p.weight === 160 && p.reason === 'fill', p.why);
}
{
  const hist = [log('2026-09-02', 55, 12), log('2026-10-05', 55, 12), log('2026-10-12', 60, 10)].map((h) => ({ ...h, key: 'db flat press' }));
  const p = nextPrescription(hist, 'db flat press')!;
  check('60 × 10 × 3 on a 12-rep lift → 60 again, aim for 12', p.weight === 60 && p.repsHigh === 12 && p.repsLow === 8, p.why);
}
{
  const p = nextPrescription([log('2026-09-15', 145, 12), log('2026-09-29', 145, 12), log('2026-10-05', 130, 12)], 'pec deck')!;
  check('one session under the working weight → noise, back to it', p.weight === 145 && p.reason === 'hold', p.why);
}
{
  const p = nextPrescription([log('2026-09-15', 145, 12), log('2026-09-29', 145, 12), log('2026-10-05', 130, 12), log('2026-10-12', 130, 12)], 'pec deck')!;
  check('two sessions under → stale, working weight drops', p.weight === 130 && p.reason === 'drop', p.why);
}
{
  const p = nextPrescription([log('2026-09-15', 145, 12), log('2026-09-29', 145, 12), log('2026-10-12', [160, 145, 145], [6, 12, 12])], 'pec deck')!;
  check('a top set short of the range → back to the working weight', p.weight === 145, p.why);
}
{
  const p = nextPrescription([log('2026-09-15', 145, 12), log('2026-09-29', 145, 12), log('2026-10-05', 145, 6), log('2026-10-12', 145, 7)], 'pec deck')!;
  check('working weight missed twice → step down', p.weight === 135 && p.reason === 'drop', p.why);
}
{
  const curl = (date: string, w: number, reps = 12) => ({ ...log(date, w, reps), key: 'leg curl' });
  const p = nextPrescription([curl('2026-08-03', 75), curl('2026-08-11', 85), curl('2026-08-25', 80), curl('2026-09-08', 80, 10), curl('2026-10-07', 70), curl('2026-10-14', 80)], 'leg curl', '2026-10-21')!;
  check('owned twice with a lighter day between → hold, not add', p.weight === 80 && p.reason === 'hold', p.why);
}
{
  const ke = (date: string, w: number, reps = 12) => ({ ...log(date, w, reps), key: 'leg extension' });
  const p = nextPrescription([ke('2026-09-28', 85), ke('2026-10-07', 85), ke('2026-10-14', 90), ke('2026-10-16', 85)], 'leg extension', '2026-10-21')!;
  check('a heavier weight tried once then the old one → confirm the heavier, not step past', p.weight === 90 && p.reason === 'fill', p.why);
}
{
  const ab = (date: string, w: number) => ({ ...log(date, w, 12), key: 'hip abduction' });
  const p = nextPrescription([ab('2026-08-03', 130), ab('2026-08-25', 130), ab('2026-09-08', 130)], 'hip abduction', '2026-10-21')!;
  check('six weeks off → repeat the working weight, no step', p.weight === 130 && p.reason === 'hold' && /days ago/.test(p.why), p.why);
  const q = nextPrescription([ab('2026-08-03', 130), ab('2026-08-25', 130), ab('2026-09-08', 130)], 'hip abduction', '2026-09-15')!;
  check('same history a week later → the add stands', q.weight === 140 && q.reason === 'add', q.why);
}
{
  check('no history → null', nextPrescription([], 'leg press') === null);
  const first = nextPrescription([{ exercise: 'Leg press', key: 'leg press', date: '2026-11-03', sets: [{ weight: 180, reps: 10 }, { weight: 180, reps: 10 }, { weight: 180, reps: 9 }] }], 'leg press', '2026-11-06', 12)!;
  check('first session inside the template range → repeat it, aim for the template top', first.weight === 180 && first.reason === 'hold' && first.repsHigh === 12 && first.repsLow === 8, JSON.stringify(first));
}

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
if (failures) process.exit(1);
