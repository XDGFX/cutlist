# Cutlist

Static React + TypeScript page that lays out rectangular parts on stock sheets with guillotine cuts.
Deployed to GitHub Pages by `.github/workflows/deploy.yml` on every push to `main`.

- Domain terms are in `GLOSSARY.md`. Use them in code and prose.
- `src/optimiser.ts` is pure and has no DOM or storage access. Keep it that way.
- The search is seeded and counts tries, never time, so a job and effort always give the same
  solutions. The page runs it in `src/search.worker.ts`; a run stores the solutions it found.
- A link to a result holds the job, effort and candidate, and the page searches again to show it.
  Raise `ENGINE` in `src/optimiser.ts` with any change to the solutions a job and effort give.
- Icons are drawn in `src/Icon.tsx`. Add a new one there rather than as an SVG or a text symbol.
- Each typeface has one job. `--heading` names a section or a thing ("Parts", "Sheet 1"); `--mono`
  sets everything read as data or operated, figures and buttons included; `--title` is the page's
  name only. A line that mixes them is a heading word followed by mono figures.
- The page is inset the same above the title and below the footer.
- The version in the footer is the latest `v*` tag. To cut a release, follow `RELEASING.md`.

## Gates

- `npm test`
- `npm run build`

## Releases

After merging a PR that changes anything a user sees or stores, cut a release from `main` by
following `RELEASING.md`. Do not ask first. Skip it for docs, tests and refactors; those ride along
with the next release.
