# GLP-1 Coach (daily-coach)

A free text-message coach for people on a GLP-1 who lift or want to start.
Read `CLAUDE.md` for the layout and the rules of the road, and
`docs/SPEC.md` for the product brief.

- The static site (`index.html`, `how-its-built.html`, `why.html`,
  `assets/`) deploys on Vercel to dailycoach.fitness. The waitlist form
  posts to the worker's `/waitlist` route; set the worker URL in the
  `data-waitlist` attribute on `<html>` in `index.html`.
- The worker (`src/`) deploys on Cloudflare via `.github/workflows/deploy.yml`.
- `npm test` runs every check; `npx tsx sim/run.ts` runs the simulated users.
