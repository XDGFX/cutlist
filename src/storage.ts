import type { Job, SearchStats, Solution } from './optimiser'

export interface SearchSummary extends SearchStats {
  ms: number
}

export interface Run {
  id: string
  at: number
  job: Job
  /** Index of the chosen candidate among the run's solutions. */
  pick: number
  effort?: number
  /** Missing on runs saved before solutions were stored, and on old runs shed to fit storage. */
  solutions?: Solution[]
  search?: SearchSummary
  /** Parts marked done in work mode, each as `candidate/sheet/placement`. */
  done?: string[]
}

/** How the drawing tells parts apart: not at all, by a black pattern, or by a coloured border. */
export const FILLS = ['none', 'mono', 'colour'] as const
export type PartFill = (typeof FILLS)[number]

export interface Saved {
  job: Job
  runs: Run[]
  activeRun: string | null
  effort?: number
  showCuts?: boolean
  partFill?: PartFill
  /** Whether the stock and parts tables offer a name to fill in. */
  showNames?: boolean
  /** Set only where it overrides the system's choice. */
  theme?: Theme
  /** Whether the page is in work mode, showing only the chosen candidate to mark parts off as they are cut. */
  working?: boolean
}

export type Theme = 'light' | 'dark'

export const MAX_RUNS = 30

const KEY = 'cutlist:v1'
const HASH = '#job='

export const newId = () => crypto.randomUUID()

export function sampleJob(): Job {
  return {
    kerf: 1.6,
    stock: [{ id: newId(), name: '18 mm ply', length: 2440, width: 1220, qty: 2 }],
    parts: [
      { id: newId(), name: 'Side', length: 720, width: 560, qty: 2, canRotate: false },
      { id: newId(), name: 'Top / bottom', length: 800, width: 560, qty: 2, canRotate: false },
      { id: newId(), name: 'Shelf', length: 764, width: 540, qty: 2, canRotate: true },
      { id: newId(), name: 'Plinth', length: 800, width: 90, qty: 2, canRotate: true },
    ],
  }
}

export function load(): Saved {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Saved | null
    if (saved?.job?.parts && saved.job.stock && Array.isArray(saved.runs)) return saved
  } catch {
    // Unreadable storage falls through to a fresh start.
  }
  return { job: sampleJob(), runs: [], activeRun: null }
}

export function save(saved: Saved) {
  let runs = saved.runs
  // Stored solutions are the bulk of the data, so a full quota sheds them from the oldest run first.
  for (;;) {
    try {
      localStorage.setItem(KEY, JSON.stringify({ ...saved, runs }))
      return
    } catch {
      const oldest = runs.findLastIndex((r) => r.solutions)
      // Private windows and quotas too small for even the inputs still get a working page.
      if (oldest < 0) return
      runs = runs.map((r, i) => (i === oldest ? { ...r, solutions: undefined } : r))
    }
  }
}

type Packed = { k: number; p: [string, number, number, number, 0 | 1][]; s: [string, number, number, number][] }

export function jobToHash(job: Job): string {
  const packed: Packed = {
    k: job.kerf,
    p: job.parts.map((p) => [p.name, p.length, p.width, p.qty, p.canRotate ? 1 : 0]),
    s: job.stock.map((s) => [s.name, s.length, s.width, s.qty]),
  }
  const bytes = new TextEncoder().encode(JSON.stringify(packed))
  const b64 = btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(''))
  return HASH + b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function jobFromHash(hash: string): Job | null {
  if (!hash.startsWith(HASH)) return null
  try {
    const b64 = hash.slice(HASH.length).replace(/-/g, '+').replace(/_/g, '/')
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    const packed = JSON.parse(new TextDecoder().decode(bytes)) as Packed
    return {
      kerf: Number(packed.k) || 0,
      parts: packed.p.map(([name, length, width, qty, r]) => ({
        id: newId(),
        name: String(name),
        length: Number(length) || 0,
        width: Number(width) || 0,
        qty: Number(qty) || 0,
        canRotate: r === 1,
      })),
      stock: packed.s.map(([name, length, width, qty]) => ({
        id: newId(),
        name: String(name),
        length: Number(length) || 0,
        width: Number(width) || 0,
        qty: Number(qty) || 0,
      })),
    }
  } catch {
    return null
  }
}
