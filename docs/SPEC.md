# GLP-1 Coach spec (v2, November 2026)


I'm Matt. I built a private fitness coach for myself over the last few months: a Cloudflare Worker (plain TypeScript, no AI in the worker) that sits between scheduled Claude routines, Notion, Apple Health, and two Telegram bots (a training coach and a Food Log). Repo: `coolmatteth/fitness-agent` (private; it holds my medical details and stays private). I want to build a public, free version for people on GLP-1 drugs (Zepbound, Wegovy, Mounjaro, Ozempic, the new pills) who lift or want to start. Working name: GLP-1 Coach. Repo: `coolmatteth/daily-coach` (today a static marketing site for the private system; the worker goes beside it; nothing copied that has my data in it).

Your job in this chat: help me design and build the MVP, in small verified steps, as PRs I can read. Start by reading this whole brief, then propose the first three PRs. Ask me only what you cannot decide from this brief.

## Why this exists (the thesis)

Every fitness app assumes the problem is discipline. On a GLP-1 the problem is the opposite: appetite is the constraint. Most people on these drugs are worried about losing muscle (about a third say so in surveys) and most do not lift (under 40%). The two things a person controls, protein and lifting, are what moved the share of fat versus lean in the trials. Nobody hands those people a session, takes their numbers back, and tells them on Sunday how the week went.

The questions the product answers:

1. **Am I eating enough to keep my muscle?** Protein floor, goal and stretch, and a calorie band, computed from the user's own inputs with the formula named. Smaller meals, more of them. Eat when hungry; the log tells the truth; the weekly average is the verdict.
2. **Am I keeping my strength?** A plan arrives, the user replies with numbers, a weight steps up only once it was owned twice. A held number is a good session. Raising lifts in a deficit is a bonus, not the promise.
3. **What do I bring to my prescriber?** The user's own facts, in neutral words: weeks on this dose, side-effect days, protein and calorie weeks against the band, the 12-week weight trend. Never "hold," never "step." The prescriber decides.
4. **Is this normal?** Day-five hunger, the rough day after the shot, a slow month after a dose change, a stomach that will not take a full meal. A one-line daily check-in and a short guide that sets expectations in plain English.

## Who it is for, and who it is not for

For: someone on a GLP-1 who lifts, or who joined a gym because they read about muscle loss and does not know what to do there. The first plan is two days of full body on machines and dumbbells.

Not for: anyone who wants cardio programming, yoga, a meal plan, dose advice, or a chat companion. The home page says so.

## What's unique (the product; Noom's free companion already does the rest)

Noom, MyFitnessPal, Lilly and Novo all give away protein targets, photo meal logging, side-effect tips and workout videos. Do not compete on those. These four are not on the market:

- **One message a day, no app to learn.** The plan arrives. The user replies with numbers. Nothing to open.
- **Real loads, earned.** Not a video library. A weight goes up after it was owned twice, a heavier attempt is repeated once to confirm, one dip is noise, two drop it.
- **A verdict, not a dashboard.** One Sunday message: on track / a touch slow / off pace, why, and the prescriber summary.
- **An Athlete File per user that the coach rewrites every week.** The memory. Below.
- **Rules in code, not in the model.** The model estimates a meal and drafts a plan; code owns every number the user sees. A trust claim for the "how it's built" page, not a headline.

## The Athlete File (memory, same structure as mine, forty lines not a hundred thousand characters)

The coach's recommendations are only as good as what it remembers, and it remembers facts, not chat.

- **Logs**: every meal, set, weigh-in, check-in, shot and dose change in its own table, one row per user per event. The weight rules and the recap read from here.
- **The file**: a short plain-text profile per user, newest first. Targets and the formula behind them. Lifting days and equipment. Injuries and what to avoid ("left knee, no deep squats"). Shot day and drug. Preferences and shortcuts. Agreed rules. Anything the user tells the coach that matters goes in here as a dated line, the way `/note` feeds my History log today. `/me` prints it; the user corrects it in plain words.
- **The weekly rewrite**: Sunday's pass reads the week's logs and the file, writes the verdict, and updates the file ("knee held at 180," "protein goal 5 of 7, second week running," "dose stepped 10/30, expect a slow month"). Next week's plans are drafted from the file plus the last recap plus the logs. That is the whole context the model gets.
- **Not memory**: the conversation. No transcript is ever handed to the model as context. The user can tell the coach anything; the coach keeps what matters as a fact it can show them.

## Learnings from my own use (bake these in)

- I undercounted my protein by a third for months because I guessed a chicken breast at 20 g. It is about 60. A photo estimate with the portion stated ("about 6 oz") beats a database the user never opens. Barcodes do not matter for meat-case food.
- Three protein tiers and a calorie band, shown as one bar, worked. The numbers must be computed per user (next section), not copied from mine.
- The user eats when hungry. Never suggest meal slots. Record what happened.
- A step up at the same reps is a PR. During a no-PR phase, working weights hold. A heavier weight already done once may be repeated to confirm. These plus "owned twice before adding" made the weight code trustworthy.
- Effort counts, not load. A light set taken near failure is a real set. Soreness is not a reason to skip; inability to work hard is.
- Heart rate goes up on GLP-1s. If a resting number ever arrives, show the trend and "mention it to your prescriber." Never call a value abnormal.
- The day after the shot is the rough one; the day before is the hungry one. Mark both in the plan and the recap. Day-five hunger is the normal weekly cycle, not a dose signal.
- Telegram webhooks must be serialized or two fast messages lose a write. With many users, serialize per user, not per bot.
- Apple Health is out. Steps and workouts are typed or pasted if the user wants them. Do not block on it.
- Cloudflare KV free tier: never one key per record with list-plus-get reads. D1 for everything with a user in it.

## The math (every rule gets a dated plain-English comment naming its source)

- **Protein tiers**, grams per kg of actual bodyweight: floor 0.8, goal 1.2 to 1.5, stretch 1.6. Above BMI 35 use adjusted bodyweight. If the user supplies a lean-mass number, use 1.5 g/kg of lean mass for the goal. Cap the stretch so a sustained 2 g/kg is never shown. Per-meal 25 to 40 g is a practical note, not a target. (Sources: the 2025 four-society advisory, ACLM/ASN/OMA/TOS; the November 2025 Delphi consensus.)
- **Calorie band**: estimated burn from a named formula with age, sex, height, weight and activity. Target = burn minus 500 to 750, clamped at the sex floor (1,200 women, 1,800 men, never below 1,000 to 1,200). Ceiling = burn minus 250. A day at the floor after a hard session is normal; the weekly average is the verdict.
- **Pace**: in percent of bodyweight per week, with the expectation by drug stated once: most people lose 10 to 20% over six to twelve months, slower after a dose change, and everyone plateaus eventually. About one in ten do not respond; say so in the guide.
- **Weighing**: weekly by default, daily allowed, a 7-day average, a visible noise band of about 1% of bodyweight. A plateau is under 5% change over 12 weeks, never a flat fortnight. Body composition optional: a bioimpedance scale every few months if they have one, DXA yearly.
- **Weights**: owned twice before adding; a new weight repeated to confirm; one dip is noise, two drop it. Three generic guards on the plan: a block cap, one heavier attempt per session, repeat to confirm. My repair and verify rules (one athlete's program as regexes) are not ported.
- **Safety, worded without the number in the message**: a week averaging under the sex floor, or a 7-day average loss over 1.5 kg two weeks running, sends "below the range this coach is built for; a check-in with your prescriber or a dietitian may be helpful" plus a protein-and-vitamin nudge. The symptoms the drug labels say to report (persistent or severe stomach pain, inability to keep fluids down, a racing heart at rest) are quoted from the label and attributed to it. "You may have X" is never said.
- **Dose**: no hold, no stay, no step, no dose number, no date. The prescriber summary only, user-initiated or Sunday, built from logged facts plus one neutral sentence on what the label says the prescriber weighs (minimum interval, tolerability, response).

## Onboarding (three questions, then one at a time with its reason)

Day one, before the first plan: days a week you can lift (0 to 4), current weight, which medication (or "none / off it"). The first plan goes out that evening with exercises and no loads: "do what feels like 7 of 10, reply with the numbers." Those replies are the baseline.

Over the first week, in context, each with the reason it buys the user: shot day or "pill" (so the day after is marked), height and age and sex (for the calorie band), time zone (for the evening send), goal weight (optional), injuries and equipment (into the file). Never more than one question in a message. A user who ignores a question gets defaults and the file says so.

## MVP scope (free, no payments)

1. **Home page** (static, the existing site rewritten): who it is for, the four questions, three real screenshots (plan, correction, verdict), "Noom does this for free" answered in one paragraph, what it never does, how it's built, the guide, the waitlist email field, "Start free." Wellness wording only: "helps you keep protein up, train consistently and see your trends," never "prevents muscle loss."
2. **Sign-up**: the Telegram chat id is the identity. `/start` says it is software, not a person, and not medical advice. No passwords, no login widget. An email is collected once, for the SMS waitlist and nothing else.
3. **The Athlete File** and the logs in D1, `/me`, `/note`, `/delete me`.
4. **Food Log**: text or photo to protein and calories, corrections in plain words, shortcuts, `/today`, `/delete N`, `/undo`, `/week`. Guesses are asked about, never logged. Rebuilt clean from `src/food.ts` with a user dimension.
5. **Training bot**: two-, three- and four-day templates, full body first; loads from `progression.ts`; the user replies with numbers; the three generic guards.
6. **Daily check-in** on rest days: "stomach and energy today, 1 to 5?" Logged, shown in the recap, carried into the prescriber summary. Keyword replies quote the label.
7. **Weekly recap**: verdict, protein and calorie weeks, pace, lifts that moved, side-effect days, the prescriber summary, one sentence of what to change, and the Athlete File rewrite.
8. **The guide**: ten short pages, linked from the site and `/guide`. Day-five hunger. The rough day. Why a slow month after a step is not a stall. Eating when you cannot eat much. Coming back to the gym after a long gap. What the label says to report. Non-responders. Fear of eating is a flag, not a win.

Out of scope: Apple Health, Notion, payments, social, an iOS app, open-ended chat, a PR window or block schedule, hair and face questions beyond one guide paragraph.

## Stack

Cloudflare Workers (TypeScript), D1 for every table with a user in it, KV only for small state, the existing site for the home page, Telegram Bot API behind one message-transport interface (so SMS or WhatsApp is a configuration change, never a rewrite), Claude API (Sonnet, low effort, JSON schema output) for meal estimates and plan drafts only, plain code for every rule.

Budget: measure the real per-call cost in week one. Until then, cap each user at eight model calls a day; aliases, "yes," corrections and commands cost none. Per-IP and per-instance rate limits from `daily-coach/api/generate.js`. A hard monthly dollar cap in the console; when it is hit, the bot says so and keeps logging.

One repo, one worker, one `wrangler.toml` with staging and production, GitHub Actions deploy with typecheck and tests, staging routes every outbound message to an outbox, `/version` public.

## How we work

- Small PRs, each with tests for the plain-code rules, in the style of `fitness-agent/evals/*-check.ts`. I review the ones that change rules, wording the user sees, or deploy; you merge the rest once green.
- Every rule gets a plain-English comment with the reason and the source, dated.
- No medical claims. The app gives numbers and the user's own facts; the prescriber decides.
- Privacy: one row per user, deletable with `/delete me`, no sharing, no pixels, no analytics beyond counts. An email or a drug name typed by the user is health information; treat it that way.
- Explain any term you introduce the first time.

## First deliverable

A one-page plan with the first three PRs, then start on PR 1:

1. **Skeleton**: worker, D1, the transport interface with a Telegram implementation and a fake for tests, rate limits, the per-user quota table, the deploy pipeline and staging outbox copied from `fitness-agent/.github/workflows/deploy.yml`, `/version`.
2. **Onboarding math and the Athlete File**: `targets()` with every formula named; the `users`, `notes`, `weigh_ins` tables; `/me`, `/note`; the weigh-in smoother; the plateau rule; the safety thresholds by sex. Tests: a 230 lb woman and a 180 lb man, the BMI 35 switch, the floor clamp, the plateau on flat 12-week data versus noisy 3-week data, the rapid-loss trigger firing only on two weeks.
3. **Food Log**: the pure functions of `src/food.ts` over D1 by user, per-user serialization, the pending-guess draft, photo support, the recap reworded (no hold, stay or step). Tests: two users' writes do not interleave; a user over quota gets a plain refusal and no model call; a week under the floor produces the nudge and never a dose line; the recap text contains none of the three words.

PR 4 is the training bot. The waitlist page on the site comes before PR 1 and needs no worker.

## References (read for patterns, never copy my data)

**GitHub, `coolmatteth/fitness-agent` (private; attach read-only).** `CLAUDE.md` then `OPERATOR.md`. `docs/context/fitness-telegram-bot.md` for every decision and bug, newest first. `src/food.ts` (rebuild clean, keep the shape). `src/progression.ts` with `evals/progression-check.ts` and `evals/backtest.ts` (port as is). `src/history.ts` for the `/note` parser (the Athlete File's input). `src/shot.ts` for the shot-day marking. `src/telegram.ts` and the `/food/webhook` route for the serialized webhook. `.github/workflows/deploy.yml`. `prompts/` for the rules they encode, not the mechanism. Do not port `src/repair.ts`, `src/verify.ts`, `src/schedule.ts` or `src/prgate.ts`; they are one athlete's program.

**Notion (read-only, for shape only):** the Athlete File page for what a rulebook code can enforce looks like; the Food Log, Daily and History databases for their schemas. The public file is forty lines built from the user's own answers, not this.

**`coolmatteth/daily-coach`:** the current three-page site, its `api/generate.js` for the rate-limit recipe, nothing else.

**Live worker (public, no secret):** `https://matt-fitness-agent.fitnessclaude.workers.dev/version`, `/ops`, `/schedule?date=YYYY-MM-DD` for what a health check looks like as JSON.

---

## What changed from the October spec, and why

- **The user narrowed** from "everyone on a GLP-1" to people who lift or want to start. Noom's free companion shipped most of the broad feature list in June 2026; the lifting engine and the daily message are the parts nobody has.
- **The dose line is gone.** "Hold" and "step" are prompts recommending medical management under FDA's January 2026 general-wellness guidance. The prescriber summary replaces them. My private recap keeps its rule; it is mine, with my prescriber's number pending.
- **"Appetite returning = step" is gone.** Day-four-to-six hunger is the normal weekly cycle. The only response-based cue in the literature is under 5% loss over 12 weeks.
- **Weighing** moved from monthly to weekly with a 7-day average. The trial evidence says frequent weighing helps and does not hurt mood; the noise problem is solved by smoothing. Quarterly scans dropped; DXA yearly is the only society-stated interval.
- **Tiers and band are computed**, not copied. The October derivation did not line up (1.5 g/kg of my lean mass is my floor, not my goal). Per-user g/kg with the adjusted-weight rule above BMI 35, and a band from burn minus 500 to 750, clamped at the sex floor.
- **Safety thresholds** are sex-specific (1,200 women, 1,800 men) and the rate rule is 1.5 kg a week for two weeks, from the gallstone model the Delphi consensus adopts. The number stays in code and out of the message.
- **Budget** fixed: 60 calls a day at a cent each was twelve times the stated $0.05. Eight calls a day until measured.
- **Onboarding** is three questions and then one at a time with its reason. Eight in a row is a form, and users bounce.
- **The Athlete File is first-class.** Same structure as mine: logs, a short file, a weekly rewrite. Memory is facts the user can read, never a transcript.
- **The daily check-in is in.** GI side effects handled silently are the largest unserved pain in the market; a one-line check-in costs no model call and makes the prescriber summary useful.
- **Telegram stays first, behind an interface**, with an email collected for the SMS waitlist. Telegram reaches a few percent of US adults; the interface keeps the second channel a setting.
- **The training bot moved to PR 4.** The progression engine ports as is; the repair and verify guards do not.
