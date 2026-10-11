# Cutlist

Static React + TypeScript page that lays out rectangular parts on stock sheets with guillotine cuts.
Deployed to GitHub Pages by `.github/workflows/deploy.yml` on every push to `main`.

- Domain terms are in `GLOSSARY.md`. Use them in code and prose.
- `src/optimiser.ts` is pure and has no DOM or storage access. Keep it that way.
- The search is seeded and counts tries, never time, so a job and effort always give the same
  solutions. The page runs it in `src/search.worker.ts`; a run stores the solutions it found.

## Gates

- `npm test`
- `npm run build`
