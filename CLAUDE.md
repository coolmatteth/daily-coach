# daily-coach (GLP-1 Coach, experimental stage)

A free, public coach for people on GLP-1 drugs who lift or want to start:
a Cloudflare Worker (plain TypeScript; the model only estimates meals and
drafts plans, code owns every number) talking to users over Telegram, with
one D1 database. Matt is the builder; nobody else uses it yet.

## Read first
1. `docs/SPEC.md` — the product brief: thesis, the Athlete File, the math
   with its sources, onboarding, MVP scope, PR order. Every decision is in
   there with the reason. Change the spec when a decision changes.
2. This file — where things are and the rules of the road.

## The one rule that matters most
This is a separate product from `coolmatteth/fitness-agent` (Matt's private
coach). Nothing here touches that repo, its worker, its KV, its Notion, its
bot or its secrets. Read it for patterns; copy the progression engine when
PR 4 comes; never share code, data or infrastructure with it. Matt's system
is the advanced one; this is the experimental stage.

## Layout
- Two sites, two audiences (11/9/26). The repo root (`index.html`,
  `how-its-built.html`, `why.html`, `assets/*.html`, `api/generate.js`,
  `plans.json`, `vercel.json`) is Matt's recruiter site at
  dailycoach.fitness, restored exactly as it was before the product
  rewrite; the Vercel project `fitness-claude-demo` deploys it and
  `.vercelignore` keeps the worker and `site/` out. Do not touch it for
  product work.
- `site/` — the product site: the pitch, the waitlist form, how it's
  built, why. Its own Vercel project with root directory `site`, on the
  product's domain once Matt picks one. The form posts to the worker's
  `POST /waitlist` (`src/waitlist.ts`, D1 `waitlist` table; CORS allows
  the origins in `ALLOWED_ORIGINS`, add the product domain there); the
  worker URL is `data-waitlist` on `<html>` in `site/index.html`.
- `src/` — the worker.
  - `index.ts` routes. `GET /version` and `GET /health` are public.
    `POST /telegram/webhook` checks Telegram's secret header.
    `POST /telegram/setup` registers the webhook (admin secret).
    `/sim/*` exists only on staging: the simulated-user harness talks to
    the bot through it (admin secret).
  - `bot.ts` — `handleIncoming`: one message in, zero or more messages
    out, through a Transport. Pure of HTTP; the tests call it directly.
  - `transport.ts` — the message-transport interface. Telegram today;
    an outbox on staging (staging never texts anyone); a fake for tests.
    SMS or WhatsApp later is a new implementation, not a rewrite.
  - `store.ts` — the Store interface over D1, with an in-memory
    implementation for tests. Every table has a user in it.
  - `athlete.ts` — onboarding (three questions on day one, then one a
    day with its reason, "skip" declines) and the Athlete File: `/me`
    prints it, `/note` adds a dated line, `/forget N` removes one.
  - `targets.ts` — the math: protein tiers, calorie band, burn, pace,
    with the source of every number in a dated comment. `weighins.ts` —
    the 7-day average, the noise band, the 12-week plateau rule, the
    rapid-loss rule, and the safety wording (no number in the message).
  - `food.ts` — the Food Log's plain-code parts: totals, tiers, the bar,
    corrections in plain words, the 20-minute merge, shortcuts.
    `estimator.ts` — the one model call (reads a message or photo, names
    an action, JSON schema output) behind an interface; the system prompt
    is built per user from their file. `recap.ts` — the Sunday verdict and
    the prescriber summary; `FORBIDDEN_DOSE_WORDS` and a test guard the
    wording. `weekly.ts` — the Sunday pass the hourly cron runs: send the
    recap at 5 PM local and write one coach line into the file.
  - `progression.ts` — the weight rule, ported as-is from the private
    coach: owned twice in a row adds a step, a heavier weight done once is
    repeated to confirm, one dip is noise, two drop it, a layoff repeats.
    `plans.ts` — the template library (1 to 4 days, machines and dumbbells
    first), the block cap, one step per session, the plan text, parsing
    replies with numbers, the stomach/energy check-in. `training.ts` —
    history from the sets table, the plan for a day, recording a reply,
    the 6 PM evening send the hourly cron runs.
  - `quota.ts` — per-user daily model-call cap. `ratelimit.ts` — per-IP
    and per-instance limits on every POST. `clock.ts` — the test clock
    staging can move forward so a simulated week runs in minutes.
  - `telegram.ts` — the few Bot API calls we use.
- `sim/` — the simulated users: six personas, the invariants every coach
  message must pass, a transcript per persona in `sim/out/` (gitignored).
  `npx tsx sim/run.ts` runs the cast in process; with `SIM_BASE` and
  `SIM_SECRET` it runs against staging through `/sim/*`; with
  `PERSONA_MODEL=1` a model plays each persona and answers the three
  feedback questions weekly. `sim/README.md` has the cast and what the
  first runs found.
- `migrations/` — D1 schema, applied by the deploy workflow.
- `evals/` — plain-code checks, `npx tsx evals/<name>-check.ts`. CI runs
  all of them on every PR. Add one per PR.
- `.github/workflows/deploy.yml` — PR: typecheck + evals. Merge to
  `master`: migrations + deploy to staging → `/version` must show the
  commit → migrations + deploy to production.

## Rules of the road
- `npx tsc --noEmit` and the evals green before any push.
- Never prod first. Staging is `glp1-coach-staging`; its outbound messages
  land in the `outbox` table, never in Telegram.
- Every rule a user can feel gets a plain-English comment with the reason
  and the source, dated.
- No "hold", "stay" or "step" about a dose, anywhere a user can read it.
  The prescriber summary only. A test guards this once the recap exists.
- No medical claims. "Helps you keep protein up, train consistently and
  see your trends." Never "prevents muscle loss."
- One row per user, deletable with `/delete me`. No pixels, no analytics
  beyond counts. A drug name typed by a user is health information.
- Small PRs with tests. Matt reviews anything that changes a rule, wording
  the user sees, the deploy workflow, `wrangler.toml` or secrets.
- Never commit secrets. `.dev.vars` is gitignored.

## First deploy (one-time, on the PC, in this repo's folder)
```
npx wrangler login
npx wrangler d1 create glp1-coach            # paste the id into wrangler.toml [[d1_databases]]
npx wrangler d1 create glp1-coach-staging    # paste into [env.staging.d1_databases]
npx wrangler secret put ADMIN_SECRET --env staging
npx wrangler secret put ADMIN_SECRET
npx wrangler secret put TELEGRAM_BOT_TOKEN            # a NEW bot from @BotFather, not the private one
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
npx wrangler secret put ANTHROPIC_API_KEY --env staging   # its own key, with a monthly cap set in the console
npx wrangler secret put ANTHROPIC_API_KEY
```
Then in GitHub → Settings → Secrets and variables → Actions on THIS repo:
`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `STAGING_ADMIN_SECRET`,
and the variable `WORKERS_SUBDOMAIN` (the `<name>.workers.dev` part).
A merge to `master` then deploys. `GET /version` on either worker says
which commit is live.

## Status
PR 1 (skeleton): `/start`, `/version`, `/delete me`, the transport
interface, the sim routes, quota and rate limits, the deploy pipeline.
PR 2 (onboarding + Athlete File): the three day-one questions and the
one-a-day follow-ups, per-user targets with named formulas, `/me`,
`/note`, `/forget`, `/weight`, "why", the weigh-in rules.
PR 3 (Food Log): text or photo to protein and calories, corrections in
plain words, shortcuts, `/today`, `/week`, `/delete N`, `/undo`,
`/recap` with the prescriber summary, the Sunday pass, a per-user lock,
the model-call cap enforced. `/sim/weekly` runs the pass on staging.
PR 4 (training bot): templates by lifting days, the first session with
no loads ("pick 7 of 10"), loads from the progression engine, one step a
session, replies with numbers recorded as sets, `/plan`, the rest-day
check-in (`/checkin`, or two bare numbers), the 6 PM evening send, the
day-after-shot easier session. `/sim/evening` runs the send on staging.
PR 5 (simulated users): the cast, the invariants, the transcripts, and
six fixes the first runs found (see `sim/README.md`).
Site rewritten for the product with the waitlist; `POST /waitlist` on the
worker. The deploy workflow skips with a warning until the secrets exist.
Cloudflare setup done (11/9/26): both D1 databases exist and their ids are
in `wrangler.toml`; staging and production are deployed by hand at
`glp1-coach-staging.fitnessclaude.workers.dev` and
`glp1-coach.fitnessclaude.workers.dev` with `ADMIN_SECRET` and
`TELEGRAM_WEBHOOK_SECRET` set. The cast ran against live staging: zero
violations, and it found the per-IP rate limit covering the Telegram
webhook (fixed). `data-waitlist` points at production.
Next: `TELEGRAM_BOT_TOKEN` and `ANTHROPIC_API_KEY` on the workers (Matt, in
the dashboard), `POST /telegram/setup` to register the webhook, the cast
with the real model, then the GitHub Actions secrets so merges deploy.
