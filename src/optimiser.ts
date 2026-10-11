export interface Part {
  id: string
  name: string
  length: number
  width: number
  qty: number
  canRotate: boolean
}

export interface StockSheet {
  id: string
  name: string
  length: number
  width: number
  qty: number
}

export interface Job {
  parts: Part[]
  stock: StockSheet[]
  kerf: number
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Placement extends Rect {
  partId: string
  name: string
  rotated: boolean
}

export interface Layout {
  stockId: string
  stockName: string
  length: number
  width: number
  placements: Placement[]
  offcuts: Rect[]
  cuts: number
  cutLength: number
}

export interface Unplaced {
  partId: string
  name: string
  qty: number
}

export interface Stats {
  sheets: number
  placed: number
  unplaced: number
  stockArea: number
  usedArea: number
  wasteArea: number
  wastePct: number
  cuts: number
  cutLength: number
}

export interface Solution {
  strategy: string
  layouts: Layout[]
  unplaced: Unplaced[]
  stats: Stats
}

/** A leftover narrower than this on either side is waste, not an offcut. */
export const MIN_OFFCUT_SIDE = 50
export const MAX_CANDIDATES = 6

const EPS = 1e-6

interface Item {
  part: Part
  length: number
  width: number
}

type Sort = 'area' | 'longest side' | 'perimeter' | 'width'
type Fit = 'tightest area' | 'tightest side'
type Split = 'short leftover' | 'long leftover' | 'rip first' | 'crosscut first'
type StockOrder = 'largest stock first' | 'smallest stock first'

interface Strategy {
  sort: Sort
  fit: Fit
  split: Split
  stockOrder: StockOrder
}

const SORT_KEY: Record<Sort, (i: Item) => number> = {
  area: (i) => i.length * i.width,
  'longest side': (i) => Math.max(i.length, i.width),
  perimeter: (i) => i.length + i.width,
  width: (i) => Math.min(i.length, i.width),
}

const SORTS = Object.keys(SORT_KEY) as Sort[]
const FITS: Fit[] = ['tightest area', 'tightest side']
const SPLITS: Split[] = ['short leftover', 'long leftover', 'rip first', 'crosscut first']
const STOCK_ORDERS: StockOrder[] = ['largest stock first', 'smallest stock first']

interface OpenSheet {
  layout: Layout
  free: Rect[]
}

interface Candidate {
  index: number
  w: number
  h: number
  rotated: boolean
  score: number
}

function orientations(item: Item): { w: number; h: number; rotated: boolean }[] {
  const upright = { w: item.length, h: item.width, rotated: false }
  if (!item.part.canRotate || item.length === item.width) return [upright]
  return [upright, { w: item.width, h: item.length, rotated: true }]
}

function bestFit(free: Rect[], item: Item, fit: Fit): Candidate | null {
  let best: Candidate | null = null
  free.forEach((f, index) => {
    for (const o of orientations(item)) {
      if (o.w > f.w + EPS || o.h > f.h + EPS) continue
      const score =
        fit === 'tightest area' ? f.w * f.h - o.w * o.h : Math.min(f.w - o.w, f.h - o.h)
      if (!best || score < best.score) best = { index, ...o, score }
    }
  })
  return best
}

function place(sheet: OpenSheet, item: Item, c: Candidate, split: Split, kerf: number) {
  const [f] = sheet.free.splice(c.index, 1)
  const { layout } = sheet
  layout.placements.push({
    partId: item.part.id,
    name: item.part.name,
    x: f.x,
    y: f.y,
    w: c.w,
    h: c.h,
    rotated: c.rotated,
  })

  const spareW = f.w - c.w
  const spareH = f.h - c.h
  // "Rip" is a cut along the sheet's length, made before the crosscut that frees the part.
  const ripFirst =
    split === 'rip first' ||
    (split === 'short leftover' && spareW <= spareH) ||
    (split === 'long leftover' && spareW > spareH)

  const right: Rect = { x: f.x + c.w + kerf, y: f.y, w: spareW - kerf, h: ripFirst ? c.h : f.h }
  const below: Rect = { x: f.x, y: f.y + c.h + kerf, w: ripFirst ? f.w : c.w, h: spareH - kerf }
  for (const r of [right, below]) if (r.w > EPS && r.h > EPS) sheet.free.push(r)

  if (spareH > EPS) {
    layout.cuts++
    layout.cutLength += ripFirst ? f.w : c.w
  }
  if (spareW > EPS) {
    layout.cuts++
    layout.cutLength += ripFirst ? c.h : f.h
  }
}

function pack(job: Job, s: Strategy): Solution {
  const items: Item[] = job.parts
    .filter((p) => p.length > 0 && p.width > 0 && p.qty > 0)
    .flatMap((part) =>
      Array.from({ length: Math.floor(part.qty) }, () => ({
        part,
        length: part.length,
        width: part.width,
      })),
    )
  const key = SORT_KEY[s.sort]
  items.sort((a, b) => key(b) - key(a) || b.length * b.width - a.length * a.width)

  const stock = job.stock
    .filter((st) => st.length > 0 && st.width > 0 && st.qty > 0)
    .sort((a, b) =>
      s.stockOrder === 'largest stock first'
        ? b.length * b.width - a.length * a.width
        : a.length * a.width - b.length * b.width,
    )
  const remaining = new Map(stock.map((st) => [st.id, Math.floor(st.qty)]))

  const sheets: OpenSheet[] = []
  const unplaced = new Map<string, Unplaced>()

  for (const item of items) {
    let done = false
    for (const sheet of sheets) {
      const c = bestFit(sheet.free, item, s.fit)
      if (c) {
        place(sheet, item, c, s.split, job.kerf)
        done = true
        break
      }
    }
    if (done) continue

    for (const st of stock) {
      if (!remaining.get(st.id)) continue
      const whole: Rect = { x: 0, y: 0, w: st.length, h: st.width }
      const c = bestFit([whole], item, s.fit)
      if (!c) continue
      remaining.set(st.id, remaining.get(st.id)! - 1)
      const sheet: OpenSheet = {
        free: [whole],
        layout: {
          stockId: st.id,
          stockName: st.name,
          length: st.length,
          width: st.width,
          placements: [],
          offcuts: [],
          cuts: 0,
          cutLength: 0,
        },
      }
      sheets.push(sheet)
      place(sheet, item, c, s.split, job.kerf)
      done = true
      break
    }
    if (done) continue

    const u = unplaced.get(item.part.id) ?? { partId: item.part.id, name: item.part.name, qty: 0 }
    u.qty++
    unplaced.set(item.part.id, u)
  }

  const layouts = sheets.map(({ layout, free }) => ({
    ...layout,
    offcuts: free
      .filter((r) => Math.min(r.w, r.h) >= MIN_OFFCUT_SIDE)
      .sort((a, b) => b.w * b.h - a.w * a.h),
  }))

  const stockArea = sum(layouts, (l) => l.length * l.width)
  const usedArea = sum(layouts, (l) => sum(l.placements, (p) => p.w * p.h))
  return {
    strategy: `${s.sort} · ${s.fit} · ${s.split} · ${s.stockOrder}`,
    layouts,
    unplaced: [...unplaced.values()],
    stats: {
      sheets: layouts.length,
      placed: sum(layouts, (l) => l.placements.length),
      unplaced: sum([...unplaced.values()], (u) => u.qty),
      stockArea,
      usedArea,
      wasteArea: stockArea - usedArea,
      wastePct: stockArea ? ((stockArea - usedArea) / stockArea) * 100 : 0,
      cuts: sum(layouts, (l) => l.cuts),
      cutLength: sum(layouts, (l) => l.cutLength),
    },
  }
}

function sum<T>(xs: T[], f: (x: T) => number): number {
  return xs.reduce((a, x) => a + f(x), 0)
}

function largestOffcut(s: Solution): number {
  return Math.max(0, ...s.layouts.flatMap((l) => l.offcuts.map((r) => r.w * r.h)))
}

function signature(s: Solution): string {
  return s.layouts
    .map(
      (l) =>
        `${l.stockId}:` +
        l.placements
          .map((p) => `${p.partId}@${p.x},${p.y},${p.w},${p.h}`)
          .sort()
          .join(';'),
    )
    .sort()
    .join('|')
}

/** Best first: fewest parts left over, least stock consumed, then the most reusable leftover. */
function rank(a: Solution, b: Solution): number {
  return (
    a.stats.unplaced - b.stats.unplaced ||
    a.stats.stockArea - b.stats.stockArea ||
    a.stats.sheets - b.stats.sheets ||
    largestOffcut(b) - largestOffcut(a) ||
    a.stats.cuts - b.stats.cuts
  )
}

/** Distinct candidate solutions for a job, best first. Deterministic for a given job. */
export function optimise(job: Job): Solution[] {
  const seen = new Set<string>()
  const solutions: Solution[] = []
  for (const sort of SORTS)
    for (const fit of FITS)
      for (const split of SPLITS)
        for (const stockOrder of STOCK_ORDERS) {
          const solution = pack(job, { sort, fit, split, stockOrder })
          const sig = signature(solution)
          if (seen.has(sig)) continue
          seen.add(sig)
          solutions.push(solution)
        }
  return solutions.sort(rank).slice(0, MAX_CANDIDATES)
}
