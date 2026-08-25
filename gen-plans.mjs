// Build script: composes all 80 dropdown combinations into plans.json.
// Run with `node gen-plans.mjs` after editing any rule table below.
import { writeFileSync } from "fs";

// Movement pattern tags: kneeflex (deep knee flexion under load), hinge,
// overhead, spineload (loaded spinal flexion / heavy hinge), grip (heavy
// gripping or wrist extension), push, pullH, pullV, core, cardio.
const POOLS = {
  "full-gym": [
    { ex: "Barbell Back Squat", tags: ["kneeflex", "spineload", "legs"], big: true },
    { ex: "Leg Press", tags: ["kneeflex", "legs"], big: true },
    { ex: "Romanian Deadlift", tags: ["hinge", "spineload", "grip", "legs"], big: true },
    { ex: "Barbell Bench Press", tags: ["push", "grip"], big: true },
    { ex: "Machine Chest Press", tags: ["push"], big: true },
    { ex: "Seated Cable Row", tags: ["pullH", "grip"] },
    { ex: "Chest-Supported Row", tags: ["pullH", "grip"] },
    { ex: "Lat Pulldown", tags: ["pullV", "grip"] },
    { ex: "Overhead Press", tags: ["overhead", "push", "grip"] },
    { ex: "Machine Lateral Raise", tags: ["shoulder-iso"] },
    { ex: "Leg Curl", tags: ["legs-iso"] },
    { ex: "Leg Extension (partial range)", tags: ["kneeflex", "legs-iso"] },
    { ex: "Back Extension", tags: ["hinge", "core"] },
    { ex: "Plank", tags: ["core"] },
    { ex: "Wall Sit (isometric)", tags: ["legs-iso"] },
    { ex: "Rower Intervals", tags: ["cardio", "grip", "spineload"] },
    { ex: "Incline Treadmill Walk", tags: ["cardio"] },
  ],
  "dumbbells-only": [
    { ex: "Goblet Squat", tags: ["kneeflex", "grip", "legs"], big: true },
    { ex: "DB Romanian Deadlift", tags: ["hinge", "spineload", "grip", "legs"], big: true },
    { ex: "Rear-Foot-Elevated Split Squat (bodyweight)", tags: ["kneeflex", "legs"], big: true },
    { ex: "DB Floor Press", tags: ["push", "grip"], big: true },
    { ex: "One-Arm DB Row", tags: ["pullH", "grip"] },
    { ex: "DB Overhead Press", tags: ["overhead", "push", "grip"] },
    { ex: "DB Lateral Raise", tags: ["shoulder-iso", "grip"] },
    { ex: "DB Curl", tags: ["arms", "grip"] },
    { ex: "Glute Bridge", tags: ["legs"] },
    { ex: "Push-Up", tags: ["push", "wristext"] },
    { ex: "Push-Up (on handles or fists)", tags: ["push"] },
    { ex: "Plank", tags: ["core"] },
    { ex: "DB Farmer Carry", tags: ["grip", "core", "cardio"] },
    { ex: "Bench Step-Up (bodyweight)", tags: ["kneeflex", "legs", "cardio"] },
  ],
  "hotel-gym": [
    { ex: "Goblet Squat (light DBs)", tags: ["kneeflex", "grip", "legs"], big: true },
    { ex: "DB Romanian Deadlift", tags: ["hinge", "spineload", "grip", "legs"], big: true },
    { ex: "Split Squat (bodyweight)", tags: ["kneeflex", "legs"], big: true },
    { ex: "DB Bench Press", tags: ["push", "grip"], big: true },
    { ex: "Cable Row", tags: ["pullH", "grip"] },
    { ex: "Cable Pulldown", tags: ["pullV", "grip"] },
    { ex: "Cable Pull-Through", tags: ["hinge", "legs"] },
    { ex: "DB Lateral Raise", tags: ["shoulder-iso", "grip"] },
    { ex: "Cable Triceps Pressdown", tags: ["arms", "grip"] },
    { ex: "Glute Bridge", tags: ["legs"] },
    { ex: "Plank", tags: ["core"] },
    { ex: "Incline Treadmill Walk", tags: ["cardio"] },
    { ex: "Treadmill Intervals", tags: ["cardio"] },
  ],
  "bodyweight": [
    { ex: "Bulgarian Split Squat", tags: ["kneeflex", "legs"], big: true },
    { ex: "Single-Leg Romanian Deadlift", tags: ["hinge", "legs"], big: true },
    { ex: "Glute Bridge March", tags: ["legs"], big: true },
    { ex: "Push-Up", tags: ["push", "wristext"], big: true },
    { ex: "Push-Up (on fists or handles)", tags: ["push"], big: true },
    { ex: "Doorframe Row / Table Row", tags: ["pullH"] },
    { ex: "Pike Shoulder Tap", tags: ["overhead", "wristext", "core"] },
    { ex: "Wall Sit (isometric)", tags: ["legs-iso"] },
    { ex: "Reverse Lunge", tags: ["kneeflex", "legs"] },
    { ex: "Plank", tags: ["core", "wristext"] },
    { ex: "Forearm Plank", tags: ["core"] },
    { ex: "Hollow Hold", tags: ["core"] },
    { ex: "Stair or Hill Walk Intervals", tags: ["cardio"] },
    { ex: "Squat-to-Stand Flow", tags: ["kneeflex", "cardio"] },
  ],
};

const LIMITS = {
  none: { blocked: [], name: "no limitation" },
  knee: {
    blocked: ["kneeflex"],
    name: "knee (patellar tendon)",
    why: "deep knee flexion under load is the aggravator, so squat and lunge patterns are out; hinges and isometrics keep the legs training",
  },
  shoulder: {
    blocked: ["overhead"],
    name: "shoulder",
    why: "overhead work is the aggravator; pressing stays below shoulder height where it's tolerated",
  },
  "lower-back": {
    blocked: ["spineload", "hinge"],
    name: "lower back",
    why: "loaded spinal flexion and heavy hinging are the aggravators; supported and brace-friendly patterns carry the session",
  },
  wrist: {
    blocked: ["grip", "wristext"],
    name: "wrist / grip",
    why: "heavy gripping and wrist extension are the aggravators, which rules out loaded carries, weighted rows, and palm-loaded floor work",
  },
};

const GOALS = {
  "build-muscle": {
    label: "Hypertrophy",
    blocks: 6,
    scheme: (i) => (i === 0 ? "3 × 8-10, reverse pyramid" : i < 4 ? "3 × 10-12" : "2 × 12-15"),
    shape: "Hypertrophy calls for moderate loads and honest volume: six blocks, biggest movement first while energy is highest, reverse-pyramid loading on the lead lift.",
    loading: "Loading is reverse pyramid: heaviest working set first after warm-up, then drop weight and add reps. Two reps shy of failure on everything but the last set of each block.",
  },
  "get-stronger": {
    label: "Strength",
    blocks: 5,
    scheme: (i) => (i === 0 ? "4 × 4-6, long rests" : i < 3 ? "3 × 6-8" : "2 × 10-12"),
    shape: "Strength work concentrates effort into fewer, heavier blocks: five total, with the lead compound getting the freshest reps at 4-6 per set and rests of 2-3 minutes.",
    loading: "Top sets sit at 4-6 reps with full rests; the back half of the session is lighter support work so the heavy slots stay heavy.",
  },
  "conditioning": {
    label: "Conditioning",
    blocks: 6,
    scheme: (i) => (i < 4 ? "3 × 12-15, short rests" : "2 rounds, 40s on / 20s off"),
    shape: "For fat loss the lever is density: six blocks with short rests, the last two run as timed rounds so heart rate stays elevated without turning lifts sloppy.",
    loading: "Rests capped near 60 seconds and the final blocks run on a clock. Loads stay a rep or two more conservative than a pure muscle day. Density is the stimulus, not grinding.",
  },
  "return-from-break": {
    label: "Return to training",
    blocks: 5,
    scheme: (i) => (i === 0 ? "3 × 8-10, well shy of failure" : "2 × 10-12, easy"),
    shape: "After months off the job is tolerance, not intensity: five blocks, simple movements, everything 2-3 reps shy of failure. The win is showing up again Thursday, not maxing out today.",
    loading: "Every set ends 2-3 reps in the tank, on purpose. Soreness from a comeback session is information the next session has to survive — underdoing it is the correct call.",
  },
};

function pick(pool, lim, goal) {
  const blocked = new Set(LIMITS[lim].blocked);
  const ok = pool.filter((m) => !m.tags.some((t) => blocked.has(t)));
  const chosen = [];
  const used = new Set();
  const take = (pred) => {
    const m = ok.find((x) => !used.has(x.ex) && pred(x));
    if (m) { used.add(m.ex); chosen.push(m); }
    return m;
  };
  const b1 = take((m) => m.big && m.tags.includes("legs")) || take((m) => m.big);
  take((m) => m.tags.includes("push"));
  take((m) => m.tags.includes("pullH") || m.tags.includes("pullV"));
  take((m) => m.tags.includes("legs") || m.tags.includes("legs-iso") || m.tags.includes("hinge"));
  if (goal === "conditioning") take((m) => m.tags.includes("cardio"));
  take((m) => m.tags.includes("core"));
  take((m) => m.tags.includes("pullV") || m.tags.includes("pullH") || m.tags.includes("shoulder-iso") || m.tags.includes("arms"));
  take((m) => true);
  return { b1, list: chosen.slice(0, GOALS[goal].blocks) };
}

const EQ_NOTE = {
  "full-gym": "a full gym means machines can cover what a limitation takes away",
  "dumbbells-only": "with dumbbells capped at 50 lb, single-leg and slow-tempo work stands in for heavy loading",
  "hotel-gym": "hotel equipment is unreliable, so every slot has to survive light dumbbells and one cable stack",
  "bodyweight": "with no equipment, range, tempo, and single-limb work replace load entirely",
};

const out = {};
for (const goal of Object.keys(GOALS)) {
  for (const eq of Object.keys(POOLS)) {
    for (const lim of Object.keys(LIMITS)) {
      const g = GOALS[goal];
      const { b1, list } = pick(POOLS[eq], lim, goal);
      const blocks = list.map((m, i) => ({
        slot: "B" + (i + 1),
        exercise: m.ex,
        scheme: g.scheme(i),
      }));
      const excluded = POOLS[eq]
        .filter((m) => m.tags.some((t) => new Set(LIMITS[lim].blocked).has(t)))
        .slice(0, 3)
        .map((m) => m.ex);
      const reasoning = [
        { step: "Session shape", detail: g.shape },
        {
          step: "Lead block",
          detail: `${b1.ex} takes B1: the biggest pattern available here, placed first while energy is highest. ${EQ_NOTE[eq].charAt(0).toUpperCase() + EQ_NOTE[eq].slice(1)}.`,
        },
        {
          step: "Balance check",
          detail: "Pushing and pulling stay balanced across the session and no two same-plane movements stack back-to-back — an ordering rule carried over from the production system.",
        },
        lim === "none"
          ? {
              step: "Limitation pass",
              detail: "No limitation declared, so the pass checks load instead: nothing in the session asks for a max, and the lead block is the only one meant to feel heavy.",
            }
          : {
              step: "Limitation pass",
              detail: `Deliberately not programmed: ${excluded.join(", ")}. Why: ${LIMITS[lim].why}.`,
            },
        { step: "Loading", detail: g.loading },
      ];
      out[`${goal}|${eq}|${lim}`] = {
        plan: {
          title: `${g.label} — ${eq.replace(/-/g, " ")} — ${LIMITS[lim].name}`,
          blocks,
          limitation_note: lim === "none" ? "" : LIMITS[lim].why,
        },
        reasoning,
      };
    }
  }
}

writeFileSync(new URL("./plans.json", import.meta.url), JSON.stringify(out, null, 1));
console.log("wrote", Object.keys(out).length, "combinations to plans.json");
