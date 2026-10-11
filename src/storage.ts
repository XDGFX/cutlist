import type { Job } from './optimiser'

export interface Run {
  id: string
  at: number
  job: Job
  /** Index of the chosen candidate among the job's solutions. */
  pick: number
}

export interface Saved {
  job: Job
  runs: Run[]
  activeRun: string | null
}

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
  try {
    localStorage.setItem(KEY, JSON.stringify(saved))
  } catch {
    // Private windows and full quotas still get a working page.
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
