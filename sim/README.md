# The simulated users

Six personas run weeks of life against the coach, every coach message is
checked against the invariants, and a transcript per persona lands in
`sim/out/`. Read the transcripts the way a user would; the invariants catch
what must never happen, the transcripts show what is merely bad.

```
npx tsx sim/run.ts                 # the whole cast, 4 weeks, in process, scripted personas, no model
WEEKS=2 npx tsx sim/run.ts dana    # one persona, two weeks
SIM_BASE=https://glp1-coach-staging.<sub>.workers.dev SIM_SECRET=<ADMIN_SECRET> npx tsx sim/run.ts
                                   # against staging through /sim/*, with the real meal estimator
PERSONA_MODEL=1 ANTHROPIC_API_KEY=... npx tsx sim/run.ts
                                   # a model plays each persona from its sheet and answers the
                                   # three feedback questions at the end of every week
```

`evals/sim-check.ts` runs the cast for two weeks in CI and fails on any
invariant violation.

## The cast (`personas.ts`)

| id | who | what they test |
|---|---|---|
| dana | 46, Zepbound, new to the gym, 2 days | the happy path: onboarding, small meals, the band, the first plans |
| marcus | 34, Wegovy, 4-day split, lifts heavier than told | the progression rule under an impatient lifter |
| linda | 58, the pill, no gym, short answers, ignores half | the zero-lifting path, the check-in, a nausea question |
| priya | 41, Mounjaro, corrects every meal | corrections, shortcuts, `/today`, `/week` |
| tom | 52, Zepbound 10 mg, barely eats, trains anyway | the under-eating safety wording, low-energy check-ins |
| chaos | a tester | nonsense, dose questions, bare numbers, `delete me` loops, unknown commands |

## The invariants (`invariants.ts`)

No empty message; no leaked `undefined` or `NaN`; nothing that says hold,
stay or step about a dose; no dose instruction without the prescriber; no
medical claim; nothing over 1,500 characters; never more model calls in a
day than the cap.

## What the first runs found (11/8/26)

- A person who typed meals while a day-one question was pending got the
  same retry forever. Now two misses set the question aside for the day.
- A person who only ever logged meals was never asked for height, age or
  time zone, so never got a calorie band or the evening send in their
  evening. The day's question now rides on a logged meal.
- A late answer to a question that a meal had displaced was read as food.
  Now "Thursday" later that day still sets the shot day.
- The plan followed any reported load, so one typo (1800 for 180) would
  have become next week's prescription. A jump past 1.5× the working
  weight is now held and confirmed first.
- A week of a few hundred calories with no band yet read as "a touch
  slow". Under 1,000 a day is now the safety wording whoever the user is.
- The "I could not read that" reply offered a "yes" that would have logged
  an empty meal; and the prescriber summary's example carried a dose
  number. Both reworded.

## What the second read found (11/8/26, Matt: "how do you remove friction")

- "I could not read shake" seven times for Dana. Now an unknown one-word
  meal gets: tell me what's in it once and I'll log it and make it a
  shortcut. A readable one-word meal gets: want this word to mean this
  every time? Reply "save".
- Linda, on the pill, was asked her shot day nineteen days running. A pill
  now means no shot day. Any question ignored three times stops being asked.
- Marcus said "skip" to a question a meal had displaced and was told it was
  not food. "skip" now counts late, like an answer.
- Priya's "remove the rice" on a rice-free day got the whole day's list
  back. Now one line: "No rice in today's meals."
- The chaos tester's "9 9" was read as food. Two numbers out of range now
  get "1 to 5, please."
- The rest-day message repeated its instruction line 108 times across the
  cast. After two answered check-ins the line is just "Stomach and energy
  today, 1 to 5?"
- A single non-answer word to a fresh question ("whenever") got a trip to
  the food model. A short list of such words gets the retry instead.
- An answer to a question came back with the day's protein bar under it.
  Now only food gets the bar.
- The under-floor recap said the same thing in two sentences. Once now.
- Every ask of a question carried its parenthetical reason. The reason
  rides on the first ask only.
