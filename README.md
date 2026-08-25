# Fitness Claude — public demo

Single-page demo of a personal AI training agent, for the story behind it see the page itself. Static HTML + one Vercel serverless function (`api/generate.js`) for the interactive generator.

## Deploy

```bash
vercel login          # one-time
vercel                # preview deploy
vercel --prod         # production
```

## Interactive generator setup (required for the "Try it" section)

1. Create an API key at console.anthropic.com (its own workspace recommended).
2. **Set a hard monthly spend limit on that workspace in the console** (Settings → Limits). This is the real backstop — do not skip it. $5–10 is plenty (Haiku 4.5, ~1 cent per generation).
3. Add the key to Vercel: `vercel env add ANTHROPIC_API_KEY` (Production + Preview).

Guardrails in code: dropdown-only inputs (no free text reaches the model), per-IP and per-instance hourly rate limits, `max_tokens` capped. The page shows a friendly message when any guard trips.

## Placeholders to fill before sharing

- `index.html` footer: LinkedIn URL.
- `index.html` eval section: three hand-written lines (marked with `[MATT — your prose here]`).
