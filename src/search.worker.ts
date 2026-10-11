import { createSearch, type Job, type SearchStats, type Solution } from './optimiser'

export type SearchRequest = { type: 'start'; job: Job; effort: number } | { type: 'stop' }
export type Update = { type: 'progress' | 'done'; stats: SearchStats; solutions: Solution[] }

/** How long to search between progress updates, in milliseconds. */
const SLICE = 50

let stopped = false

self.onmessage = async ({ data }: MessageEvent<SearchRequest>) => {
  if (data.type === 'stop') {
    stopped = true
    return
  }
  const search = createSearch(data.job, data.effort)
  while (!search.finished() && !stopped) {
    const until = performance.now() + SLICE
    while (!search.finished() && performance.now() < until) search.step(32)
    const update: Update = { type: 'progress', stats: search.stats(), solutions: search.solutions().slice(0, 1) }
    postMessage(update)
    // Yields so that a stop request can arrive.
    await new Promise((resolve) => setTimeout(resolve))
  }
  const done: Update = { type: 'done', stats: search.stats(), solutions: search.solutions() }
  postMessage(done)
}
