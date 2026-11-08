// PR 5: the whole cast runs two simulated weeks in process, and every coach
// message passes the invariants. Run: npx tsx evals/sim-check.ts
import { PERSONAS } from '../sim/personas';
import { LocalCoach } from '../sim/coach';
import { runPersona } from '../sim/run';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) console.log(`ok   ${name}`);
  else { failures++; console.log(`FAIL ${name} ${detail}`); }
}

async function main() {
  const coach = new LocalCoach();
  for (const p of PERSONAS) {
    const r = await runPersona(coach, p, 2);
    check(`${p.id}: no invariant violations`, r.violations.length === 0, r.violations.slice(0, 3).map((v) => `${v.rule}: ${v.text.slice(0, 80)}`).join(' | '));
    check(`${p.id}: the coach answered`, r.coachMessages > 0);
    const text = r.turns.filter((t) => t.who === 'coach').map((t) => t.text).join('\n');
    if (p.liftDays > 0) {
      check(`${p.id}: got a plan`, /Reply with your numbers/.test(text));
      check(`${p.id}: sets were recorded`, /Got it:/.test(text));
    } else {
      check(`${p.id}: got the walk-and-protein evening`, /20-minute walk/.test(text));
    }
    check(`${p.id}: got a Sunday recap`, /Week ending/.test(text) && /For your prescriber/.test(text));
    check(`${p.id}: the first plan asked for 7 of 10 or had no plan`, p.liftDays === 0 || /pick 7 of 10/.test(text));
  }
  // The cast's accounts are separate: dana's file never shows marcus's shortcut.
  const dana = await coach.store.getUserByChat('sim', 'sim-dana');
  const marcus = await coach.store.getUserByChat('sim', 'sim-marcus');
  check('two personas are two users', dana !== null && marcus !== null && dana.id !== marcus.id);
  check('shortcuts do not leak between users', (await coach.store.listAliases(dana!.id)).length === 0 && (await coach.store.listAliases(marcus!.id)).length === 1);
  console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
  if (failures) process.exit(1);
}
main();
