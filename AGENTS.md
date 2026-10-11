# Cutlist

Static React + TypeScript page that lays out rectangular parts on stock sheets with guillotine cuts.
Deployed to GitHub Pages by `.github/workflows/deploy.yml` on every push to `main`.

- Domain terms are in `GLOSSARY.md`. Use them in code and prose.
- `src/optimiser.ts` is pure and has no DOM or storage access. Keep it that way.
- A run stores its job, not its solutions: `optimise` must stay deterministic for a given job.

## Gates

- `npm test`
- `npm run build`
