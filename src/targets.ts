// Onboarding math (PR 2, 11/7/26). Every number a user sees comes from a
// named formula here, never from a constant copied from one person.
//
// Sources, cited by short name in the comments below:
//  - Advisory: Mozaffarian et al., "Nutritional priorities to support GLP-1
//    therapy for obesity", joint advisory of ACLM, ASN, OMA and TOS, 2025.
//  - Delphi: Sievenpiper et al., modified-Delphi consensus on nutrition
//    during GLP-1 therapy, Obesity Pillars, Nov 2025.
//  - Mifflin: Mifflin-St Jeor resting energy equation, 1990.
//  - Devine: Devine ideal body weight formula, 1974.
//  - Murphy & Koehler 2021: energy deficit of ~500 kcal/day already blunts
//    lean gains from resistance training (meta-regression).

export type Sex = 'F' | 'M';

export interface TargetInput {
  weightLb: number;
  heightIn?: number;
  sex?: Sex;
  age?: number;
  liftingDays?: number;   // 0..4
  leanMassLb?: number;    // from a scan, if the user has one
}

export interface ProteinTiers { floor: number; goal: number; stretch: number }
export interface KcalBand { floor: number; target: number; ceiling: number }

export interface Targets {
  protein: ProteinTiers;
  proteinBasis: 'actual' | 'adjusted' | 'lean';
  bmi: number | null;
  kcal: KcalBand | null;       // null until height, age and sex are known
  burn: number | null;
  paceLbPerWeek: number | null;
  pacePctPerWeek: number | null;
}

export const LB_PER_KG = 2.20462;
export const KCAL_PER_LB = 3500; // the rule of thumb; stated once, here

// Calorie floors below which the Advisory flags micronutrient risk:
// 1,200 kcal/day for women, 1,800 for men. The Delphi's absolute floor is
// 1,000 to 1,200 with a protein-and-vitamin supplement. We never show a
// band below these.
export const KCAL_FLOOR: Record<Sex, number> = { F: 1200, M: 1800 };

// Protein, grams per kg of the basis weight. Advisory: 1.2 to 1.6 g/kg
// during active loss, floor never below 0.4 to 0.5, avoid sustained 2.0+.
// Delphi: 1.2 to 1.5 g/kg actual weight, maintenance at or above 0.8.
export const PROTEIN_G_PER_KG = { floor: 0.8, goal: 1.3, stretch: 1.6 };
// With a measured lean mass the Advisory prefers 1.5 g/kg of fat-free mass.
export const PROTEIN_G_PER_KG_LEAN = { floor: 1.2, goal: 1.5, stretch: 1.8 };
// Sustained intake at or above 2 g/kg of actual weight is what the
// Advisory says to avoid; the stretch tier is capped under it.
export const PROTEIN_CAP_G_PER_KG_ACTUAL = 1.95;
// Above this BMI the Advisory says actual weight overestimates need; use an
// adjusted weight instead.
export const ADJUSTED_WEIGHT_BMI = 35;

// The deficit under estimated burn. Delphi steps down 500 kcal/day; Murphy
// & Koehler find lean gains already blunted near 500, so the target sits at
// 600 and the band floor at 750 under burn, the ceiling 250 under.
export const DEFICIT = { floor: 750, target: 600, ceiling: 250 };

// Activity factor on resting energy, by lifting days a week. Conservative
// on purpose: an overestimated burn produces a band the user cannot reach.
export function activityFactor(liftingDays = 0): number {
  if (liftingDays >= 3) return 1.5;
  if (liftingDays >= 1) return 1.4;
  return 1.3;
}

export function bmiOf(weightLb: number, heightIn: number): number {
  const kg = weightLb / LB_PER_KG;
  const m = heightIn * 0.0254;
  return kg / (m * m);
}

// Devine: men 50 kg + 2.3 kg per inch over 5 ft; women 45.5 kg + 2.3 kg.
export function idealWeightKg(sex: Sex, heightIn: number): number {
  const base = sex === 'M' ? 50 : 45.5;
  return base + 2.3 * Math.max(0, heightIn - 60);
}

// Adjusted body weight: ideal plus 40% of the excess, the usual clinical
// correction when actual weight overstates lean tissue.
export function adjustedWeightKg(actualKg: number, idealKg: number): number {
  return idealKg + 0.4 * (actualKg - idealKg);
}

// Mifflin-St Jeor resting energy, kcal/day.
export function restingEnergy(weightLb: number, heightIn: number, age: number, sex: Sex): number {
  const kg = weightLb / LB_PER_KG;
  const cm = heightIn * 2.54;
  const base = 10 * kg + 6.25 * cm - 5 * age;
  return sex === 'M' ? base + 5 : base - 161;
}

const round5 = (n: number) => Math.round(n / 5) * 5;
const round50 = (n: number) => Math.round(n / 50) * 50;

export function proteinTiers(input: TargetInput): { tiers: ProteinTiers; basis: Targets['proteinBasis']; bmi: number | null } {
  const actualKg = input.weightLb / LB_PER_KG;
  const bmi = input.heightIn ? bmiOf(input.weightLb, input.heightIn) : null;
  let basis: Targets['proteinBasis'] = 'actual';
  let raw: ProteinTiers;

  if (input.leanMassLb && input.leanMassLb > 0) {
    const leanKg = input.leanMassLb / LB_PER_KG;
    basis = 'lean';
    raw = { floor: leanKg * PROTEIN_G_PER_KG_LEAN.floor, goal: leanKg * PROTEIN_G_PER_KG_LEAN.goal, stretch: leanKg * PROTEIN_G_PER_KG_LEAN.stretch };
  } else {
    let basisKg = actualKg;
    if (bmi !== null && bmi >= ADJUSTED_WEIGHT_BMI && input.sex && input.heightIn) {
      basisKg = adjustedWeightKg(actualKg, idealWeightKg(input.sex, input.heightIn));
      basis = 'adjusted';
    }
    raw = { floor: basisKg * PROTEIN_G_PER_KG.floor, goal: basisKg * PROTEIN_G_PER_KG.goal, stretch: basisKg * PROTEIN_G_PER_KG.stretch };
  }

  const cap = actualKg * PROTEIN_CAP_G_PER_KG_ACTUAL;
  const stretch = Math.min(raw.stretch, cap);
  const goal = Math.min(raw.goal, stretch);
  const floor = Math.min(raw.floor, goal);
  return { tiers: { floor: round5(floor), goal: round5(goal), stretch: round5(stretch) }, basis, bmi };
}

export function kcalBand(input: TargetInput): { band: KcalBand; burn: number } | null {
  if (!input.heightIn || !input.sex || input.age === undefined) return null;
  const burn = restingEnergy(input.weightLb, input.heightIn, input.age, input.sex) * activityFactor(input.liftingDays);
  const sexFloor = KCAL_FLOOR[input.sex];
  const floor = Math.max(round50(burn - DEFICIT.floor), sexFloor);
  const target = Math.max(round50(burn - DEFICIT.target), floor);
  const ceiling = Math.max(round50(burn - DEFICIT.ceiling), target);
  return { band: { floor, target, ceiling }, burn: Math.round(burn) };
}

export function targets(input: TargetInput): Targets {
  const p = proteinTiers(input);
  const k = kcalBand(input);
  const paceLb = k ? ((k.burn - k.band.target) * 7) / KCAL_PER_LB : null;
  return {
    protein: p.tiers,
    proteinBasis: p.basis,
    bmi: p.bmi === null ? null : Math.round(p.bmi * 10) / 10,
    kcal: k?.band ?? null,
    burn: k?.burn ?? null,
    paceLbPerWeek: paceLb === null ? null : Math.round(paceLb * 10) / 10,
    pacePctPerWeek: paceLb === null ? null : Math.round((paceLb / input.weightLb) * 1000) / 10,
  };
}

// The plain-English "why" behind each number, for the "why" reply.
export function explainTargets(t: Targets, input: TargetInput): string {
  const lines: string[] = [];
  const basisText = t.proteinBasis === 'lean'
    ? 'your lean mass at 1.2 / 1.5 / 1.8 g per kg'
    : t.proteinBasis === 'adjusted'
      ? 'an adjusted bodyweight (ideal weight plus 40% of the rest, used above BMI 35) at 0.8 / 1.3 / 1.6 g per kg'
      : 'your bodyweight at 0.8 / 1.3 / 1.6 g per kg';
  lines.push(`Protein ${t.protein.floor} / ${t.protein.goal} / ${t.protein.stretch} g: from ${basisText}. The 2025 obesity-society advisory and the 2025 Delphi consensus put active-loss intake at 1.2 to 1.6 g per kg; the stretch is capped below 2 g per kg of bodyweight.`);
  if (t.kcal && t.burn) {
    lines.push(`Calories ${t.kcal.floor} to ${t.kcal.ceiling}, aim near ${t.kcal.target}: your estimated daily burn is about ${t.burn} (Mifflin-St Jeor resting energy times an activity factor for ${input.liftingDays ?? 0} lifting days). The target is 600 under that, the floor 750 under, never below ${KCAL_FLOOR[input.sex ?? 'F']} for ${input.sex === 'M' ? 'men' : 'women'}, the ceiling 250 under. A deficit past 500 to 750 blunts lean gains from lifting.`);
    lines.push(`Pace: about ${t.paceLbPerWeek} lb a week (${t.pacePctPerWeek}% of bodyweight) from food alone, judged on the weekly average. The medication adds to that early and slows for everyone later.`);
  } else {
    lines.push('Calories: the band needs your height, age and sex. It appears once those are in.');
  }
  return lines.join('\n\n');
}
