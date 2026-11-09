# GLP-1 Coach (daily-coach)

A free text-message coach for people on a GLP-1 who lift or want to start.
Read `CLAUDE.md` for the layout and the rules of the road, and
`docs/SPEC.md` for the product brief.

- The repo root is Matt's recruiter site (dailycoach.fitness, Vercel
  project `fitness-claude-demo`). The product site lives in `site/` and
  deploys as its own Vercel project (root directory `site`). Its waitlist
  form posts to the worker's `/waitlist` route via `data-waitlist` on
  `<html>` in `site/index.html`.
- The worker (`src/`) deploys on Cloudflare via `.github/workflows/deploy.yml`.
- `npm test` runs every check; `npx tsx sim/run.ts` runs the simulated users.
