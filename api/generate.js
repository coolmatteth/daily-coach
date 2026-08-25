import Anthropic, {
  AnthropicError,
  APIConnectionError,
  APIError,
  AuthenticationError,
  RateLimitError,
} from "@anthropic-ai/sdk";
import { z } from "zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";

// Inputs are closed enums — no free text ever reaches the model, which is
// both the abuse story and the prompt-injection story for a public endpoint.
const GOALS = {
  "build-muscle": "build muscle (hypertrophy focus)",
  "get-stronger": "get stronger (strength focus, lower reps, longer rests)",
  "conditioning": "fat loss / conditioning (density, supersets, elevated heart rate)",
  "return-from-break": "returning after 3+ months off (rebuild tolerance before load)",
};
const EQUIPMENT = {
  "full-gym": "a full commercial gym (machines, cables, free weights)",
  "dumbbells-only": "dumbbells up to 50 lb and a bench only",
  "hotel-gym": "a hotel gym (light dumbbells, one cable stack, a treadmill)",
  "bodyweight": "no equipment at all (bodyweight only)",
};
const LIMITATIONS = {
  "none": "no current limitations",
  "knee": "a knee limitation (patellar tendon irritation — deep knee flexion under load is the aggravator)",
  "shoulder": "a shoulder limitation (overhead pressing is the aggravator; pressing below shoulder height is tolerated)",
  "lower-back": "a lower-back limitation (loaded spinal flexion and heavy hinging are the aggravators)",
  "wrist": "a wrist limitation (heavy gripping and wrist extension under load are the aggravators)",
};

const PlanSchema = z.object({
  reasoning: z
    .array(z.object({ step: z.string(), detail: z.string() }))
    .describe("4-6 decision steps, in the order the plan was actually reasoned out"),
  plan: z.object({
    title: z.string(),
    blocks: z.array(
      z.object({
        slot: z.string().describe("B1, B2, ..."),
        exercise: z.string(),
        scheme: z.string().describe('sets x reps, e.g. "3 x 8-10"'),
        note: z.string().describe("one short cue or an empty string"),
      })
    ),
    limitation_note: z.string().describe(
      "what was excluded or substituted because of the limitation and why; empty string if no limitation"
    ),
  }),
});

const SYSTEM = `You are the demo version of a production training agent. The real system programs one athlete's training daily from months of logged history in Notion; you program a single session from three dropdown inputs, applying the same rules.

Programming rules (from the production system):
- 5-7 blocks (B1-B7). B1 is the heaviest compound movement, placed first while energy is highest.
- Reverse pyramid loading: heaviest set first after warm-up, then reduce weight and add reps.
- Never stack three same-plane pulling or pushing movements; balance movement directions.
- A limitation is worked around, never ignored and never used as a reason to skip training: exclude the aggravating pattern, substitute a pattern the limitation tolerates, and keep training the rest at full intent.
- For a return-from-break goal, program tolerance before load: machines over free weights, 2-3 reps shy of failure, no grinding.

Reasoning requirements (the visible reasoning is the product):
- 4-6 steps in the true order of decisions: split/exercise selection logic first, then equipment fit, then the limitation pass, then loading scheme.
- Each step names a concrete trade-off or exclusion, not a platitude. "Chose B1 = goblet squat because the limitation rules out barbell back squats and the dumbbell cap is 50 lb" is the register.
- The limitation pass must name at least one exercise you deliberately did NOT program and why.

Tone: a coach who explains their thinking plainly. No hype, no emojis, no disclaimers about consulting doctors.`;

// Best-effort in-memory limiter (per warm serverless instance). The hard
// backstop for a public demo is the monthly spend cap set in the Anthropic
// console — this exists to stop casual hammering, not determined abuse.
const WINDOW_MS = 60 * 60 * 1000;
const PER_IP_LIMIT = 6;
const PER_INSTANCE_LIMIT = 40;
const hits = new Map();
let instanceHits = [];

function rateLimited(ip) {
  const now = Date.now();
  instanceHits = instanceHits.filter((t) => now - t < WINDOW_MS);
  if (instanceHits.length >= PER_INSTANCE_LIMIT) return true;
  const ipHits = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (ipHits.length >= PER_IP_LIMIT) return true;
  ipHits.push(now);
  hits.set(ip, ipHits);
  instanceHits.push(now);
  if (hits.size > 5000) hits.clear();
  return false;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }

  const { goal, equipment, limitation } = req.body ?? {};
  if (!GOALS[goal] || !EQUIPMENT[equipment] || !LIMITATIONS[limitation]) {
    return res.status(400).json({ error: "Pick all three options from the dropdowns." });
  }

  const ip = (req.headers["x-forwarded-for"] || "unknown").split(",")[0].trim();
  if (rateLimited(ip)) {
    return res.status(429).json({
      error: "Rate limit reached — the demo allows a few generations per hour. That guardrail is part of the demo.",
    });
  }

  try {
    const client = new Anthropic(); // throws if ANTHROPIC_API_KEY is unset
    const response = await client.beta.messages.parse({
      model: "claude-haiku-4-5",
      max_tokens: 2000,
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: `Program one session. Goal: ${GOALS[goal]}. Equipment: ${EQUIPMENT[equipment]}. Limitation: ${LIMITATIONS[limitation]}.`,
        },
      ],
      output_format: betaZodOutputFormat(PlanSchema),
    });

    if (!response.parsed) {
      return res.status(502).json({ error: "The model returned an unparseable plan. Try again." });
    }
    return res.status(200).json(response.parsed);
  } catch (err) {
    if (err instanceof RateLimitError) {
      return res.status(429).json({ error: "The API itself is rate-limited right now. Try again in a minute." });
    }
    if (err instanceof AuthenticationError) {
      return res.status(503).json({ error: "The demo's API key is unavailable — likely the monthly spend cap doing its job." });
    }
    if (err instanceof APIConnectionError) {
      return res.status(502).json({ error: "Could not reach the API. Try again." });
    }
    if (err instanceof APIError) {
      return res.status(502).json({ error: "Upstream API error. Try again." });
    }
    if (err instanceof AnthropicError) {
      return res.status(503).json({ error: "The demo's API key is not configured." });
    }
    console.error("generate failed:", err);
    return res.status(500).json({ error: "Unexpected error — the details are in the server log, not your browser." });
  }
}
