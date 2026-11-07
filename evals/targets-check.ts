// PR 2 checks for the onboarding math. Run: npx tsx evals/targets-check.ts
import { targets, bmiOf, KCAL_FLOOR, PROTEIN_CAP_G_PER_KG_ACTUAL, LB_PER_KG, restingEnergy, activityFactor } from '../src/targets';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) console.log(`ok   ${name}`);
  else { failures++; console.log(`FAIL ${name} ${detail}`); }
}

// A 230 lb, 5'6" woman, 46, lifting 2 days. BMI ~37, so the adjusted basis.
const woman = targets({ weightLb: 230, heightIn: 66, sex: 'F', age: 46, liftingDays: 2 });
check('woman: BMI about 37', woman.bmi !== null && woman.bmi > 36.5 && woman.bmi < 37.5, `bmi ${woman.bmi}`);
check('woman: adjusted basis above BMI 35', woman.proteinBasis === 'adjusted');
check('woman: tiers ascend and are multiples of 5', woman.protein.floor < woman.protein.goal && woman.protein.goal < woman.protein.stretch && woman.protein.goal % 5 === 0);
check('woman: goal in a sensible range (90 to 130 g)', woman.protein.goal >= 90 && woman.protein.goal <= 130, `goal ${woman.protein.goal}`);
check('woman: band exists', woman.kcal !== null && woman.burn !== null);
check('woman: floor never below 1,200', (woman.kcal?.floor ?? 0) >= KCAL_FLOOR.F);
check('woman: floor < target < ceiling', woman.kcal !== null && woman.kcal.floor <= woman.kcal.target && woman.kcal.target <= woman.kcal.ceiling);
check('woman: pace in percent is small and positive', woman.pacePctPerWeek !== null && woman.pacePctPerWeek > 0 && woman.pacePctPerWeek < 1.5, `pct ${woman.pacePctPerWeek}`);

// A 180 lb, 5'10" man, 34, lifting 4 days. BMI ~26, actual basis.
const man = targets({ weightLb: 180, heightIn: 70, sex: 'M', age: 34, liftingDays: 4 });
check('man: actual basis under BMI 35', man.proteinBasis === 'actual');
check('man: goal about 1.3 g/kg', Math.abs(man.protein.goal - (180 / LB_PER_KG) * 1.3) <= 3, `goal ${man.protein.goal}`);
check('man: floor never below 1,800', (man.kcal?.floor ?? 0) >= KCAL_FLOOR.M);
check('man: higher activity factor than 0 days', activityFactor(4) > activityFactor(0));

// The BMI 35 switch.
const under = targets({ weightLb: 200, heightIn: 66, sex: 'F', age: 40 });
const over = targets({ weightLb: 230, heightIn: 66, sex: 'F', age: 40 });
check('switch: BMI 32 uses actual', under.proteinBasis === 'actual', `bmi ${under.bmi}`);
check('switch: BMI 37 uses adjusted', over.proteinBasis === 'adjusted', `bmi ${over.bmi}`);
check('switch: adjusted goal is below the actual-weight goal would be', over.protein.goal < (230 / LB_PER_KG) * 1.3);

// The floor clamp: a small, older woman with low burn.
const small = targets({ weightLb: 130, heightIn: 60, sex: 'F', age: 68, liftingDays: 0 });
check('clamp: small user floor is exactly 1,200', small.kcal?.floor === 1200, `floor ${small.kcal?.floor}`);
check('clamp: target never below floor', (small.kcal?.target ?? 0) >= 1200);

// The stretch cap under 2 g/kg of actual weight.
const lean = targets({ weightLb: 160, heightIn: 68, sex: 'M', age: 30, leanMassLb: 150 });
check('cap: lean-mass stretch capped under 2 g/kg actual', lean.protein.stretch <= Math.round((160 / LB_PER_KG) * PROTEIN_CAP_G_PER_KG_ACTUAL) + 2, `stretch ${lean.protein.stretch}`);
check('cap: lean basis reported', lean.proteinBasis === 'lean');

// Weight only: tiers yes, band no.
const weightOnly = targets({ weightLb: 232 });
check('weight only: tiers present', weightOnly.protein.goal > 0);
check('weight only: no band until height, age, sex', weightOnly.kcal === null && weightOnly.pacePctPerWeek === null);

// Formula sanity.
check('mifflin: known value', Math.abs(restingEnergy(154.3, 70.9, 30, 'M') - 1680) < 10);
check('bmi: 5\'6 at 230 lb', Math.abs(bmiOf(230, 66) - 37.1) < 0.2);

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
if (failures) process.exit(1);
