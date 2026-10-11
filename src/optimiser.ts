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
/** Fixed so that a job always yields the same solutions. */
const SEED = 0x51ab
/** Randomised packs per job, scaled down as the part count grows. */
const SEARCH_WORK = 400_000
const MIN_ROUNDS = 100
const MAX_ROUNDS = 5000
/** How many distinct packings get their cuts worked out before the final ranking. */
const SHORTLIST = 400

interface Item {
  part: Part
  length: number
  width: number
}

type Sort = 'area' | 'longest side' | 'perimeter' | 'width'
type Fit = 'tightest area' | 'tightest side' | 'pack to one end' | 'pack to one edge'
type Split = 'short leftover' | 'long leftover' | 'rip first' | 'crosscut first' | 'mixed splits'
type StockOrder = 'largest stock first' | 'smallest stock first'

interface Strategy {
  sort: Sort
  fit: Fit
  split: Split
  stockOrder: StockOrder
  /** How far the sort order may be shuffled: 0 keeps it exact. */
  jitter: number
}

const SORT_KEY: Record<Sort, (i: Item) => number> = {
  area: (i) => i.length * i.width,
  'longest side': (i) => Math.max(i.length, i.width),
  perimeter: (i) => i.length + i.width,
  width: (i) => Math.min(i.length, i.width),
}

const SORTS = Object.keys(SORT_KEY) as Sort[]
const FITS: Fit[] = ['tightest area', 'tightest side', 'pack to one end', 'pack to one edge']
const FIXED_SPLITS: Split[] = ['short leftover', 'long leftover', 'rip first', 'crosscut first']
const SPLITS: Split[] = [...FIXED_SPLITS, 'mixed splits']
const STOCK_ORDERS: StockOrder[] = ['largest stock first', 'smallest stock first']
const JITTERS = [0.2, 0.6, 2]

type Rng = () => number

function mulberry32(seed: number): Rng {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface OpenSheet {
  stock: StockSheet
  placements: Placement[]
  free: Rect[]
  /** How far along the length and across the width the parts reach so far. */
  reachX: number
  reachY: number
}

/** Parts placed on sheets, before the cuts that free them are worked out. */
interface Packing {
  strategy: string
  sheets: OpenSheet[]
  unplaced: Unplaced[]
  unplacedQty: number
  stockArea: number
}

interface Candidate {
  index: number
  w: number
  h: number
  rotated: boolean
  score: [number, number]
}

function orientations(item: Item): { w: number; h: number; rotated: boolean }[] {
  const upright = { w: item.length, h: item.width, rotated: false }
  if (!item.part.canRotate || item.length === item.width) return [upright]
  return [upright, { w: item.width, h: item.length, rotated: true }]
}

function bestFit(sheet: OpenSheet, item: Item, fit: Fit): Candidate | null {
  let best: Candidate | null = null
  sheet.free.forEach((f, index) => {
    for (const o of orientations(item)) {
      if (o.w > f.w + EPS || o.h > f.h + EPS) continue
      const slack = f.w * f.h - o.w * o.h
      const score: [number, number] =
        fit === 'tightest area'
          ? [slack, 0]
          : fit === 'tightest side'
            ? [Math.min(f.w - o.w, f.h - o.h), slack]
            : fit === 'pack to one end'
              ? [Math.max(sheet.reachX, f.x + o.w), slack]
              : [Math.max(sheet.reachY, f.y + o.h), slack]
      if (!best || score[0] < best.score[0] || (score[0] === best.score[0] && score[1] < best.score[1]))
        best = { index, ...o, score }
    }
  })
  return best
}

function place(sheet: OpenSheet, item: Item, c: Candidate, split: Split, kerf: number, rng: Rng) {
  const [f] = sheet.free.splice(c.index, 1)
  sheet.placements.push({
    partId: item.part.id,
    name: item.part.name,
    x: f.x,
    y: f.y,
    w: c.w,
    h: c.h,
    rotated: c.rotated,
  })
  sheet.reachX = Math.max(sheet.reachX, f.x + c.w)
  sheet.reachY = Math.max(sheet.reachY, f.y + c.h)

  const spareW = f.w - c.w
  const spareH = f.h - c.h
  // "Rip" is a cut along the sheet's length, made before the crosscut that frees the part.
  const ripFirst =
    split === 'rip first' ||
    (split === 'short leftover' && spareW <= spareH) ||
    (split === 'long leftover' && spareW > spareH) ||
    (split === 'mixed splits' && rng() < 0.5)

  const right: Rect = { x: f.x + c.w + kerf, y: f.y, w: spareW - kerf, h: ripFirst ? c.h : f.h }
  const below: Rect = { x: f.x, y: f.y + c.h + kerf, w: ripFirst ? f.w : c.w, h: spareH - kerf }
  for (const r of [right, below]) if (r.w > EPS && r.h > EPS) sheet.free.push(r)
}

function pack(job: Job, s: Strategy, rng: Rng): Packing {
  const items: Item[] = job.parts
    .filter((p) => p.length > 0 && p.width > 0 && p.qty > 0)
    .flatMap((part) =>
      Array.from({ length: Math.floor(part.qty) }, () => ({
        part,
        length: part.length,
        width: part.width,
      })),
    )
  const keys = new Map(items.map((i) => [i, SORT_KEY[s.sort](i) * (1 + s.jitter * (rng() - 0.5))]))
  items.sort((a, b) => keys.get(b)! - keys.get(a)! || b.length * b.width - a.length * a.width)

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
      const c = bestFit(sheet, item, s.fit)
      if (c) {
        place(sheet, item, c, s.split, job.kerf, rng)
        done = true
        break
      }
    }
    if (done) continue

    for (const st of stock) {
      if (!remaining.get(st.id)) continue
      const sheet: OpenSheet = {
        stock: st,
        placements: [],
        free: [{ x: 0, y: 0, w: st.length, h: st.width }],
        reachX: 0,
        reachY: 0,
      }
      const c = bestFit(sheet, item, s.fit)
      if (!c) continue
      remaining.set(st.id, remaining.get(st.id)! - 1)
      sheets.push(sheet)
      place(sheet, item, c, s.split, job.kerf, rng)
      done = true
      break
    }
    if (done) continue

    const u = unplaced.get(item.part.id) ?? { partId: item.part.id, name: item.part.name, qty: 0 }
    u.qty++
    unplaced.set(item.part.id, u)
  }

  return {
    strategy: `${s.sort}${s.jitter ? ' (shuffled)' : ''} · ${s.fit} · ${s.split} · ${s.stockOrder}`,
    sheets,
    unplaced: [...unplaced.values()],
    unplacedQty: sum([...unplaced.values()], (u) => u.qty),
    stockArea: sum(sheets, (sh) => sh.stock.length * sh.stock.width),
  }
}

interface Cutting {
  offcuts: Rect[]
  cuts: number
  cutLength: number
}

/**
 * Works out guillotine cuts that free every part in a region, always taking the cut that
 * releases the largest empty piece so that the leftover stays in as few offcuts as possible.
 */
function cutUp(parts: Rect[], region: Rect, kerf: number, out: Cutting) {
  if (parts.length === 0) {
    if (region.w > EPS && region.h > EPS) out.offcuts.push(region)
    return
  }

  let best: { vertical: boolean; at: number; empty: number; length: number } | null = null
  for (const vertical of [true, false]) {
    const start = vertical ? region.x : region.y
    const size = vertical ? region.w : region.h
    const length = vertical ? region.h : region.w
    const lo = (p: Rect) => (vertical ? p.x : p.y)
    const hi = (p: Rect) => (vertical ? p.x + p.w : p.y + p.h)

    // The blade takes [at, at + kerf], so it sits just after one part or just before another.
    const positions = new Set(parts.flatMap((p) => [hi(p), lo(p) - kerf]))
    for (const at of positions) {
      if (at <= start + EPS || at >= start + size - EPS) continue
      if (parts.some((p) => hi(p) > at + EPS && lo(p) < at + kerf - EPS)) continue
      const before = parts.some((p) => hi(p) <= at + EPS)
      const after = parts.some((p) => lo(p) >= at + kerf - EPS)
      const empty = !before ? (at - start) * length : !after ? Math.max(0, start + size - at - kerf) * length : 0
      if (!best || empty > best.empty || (empty === best.empty && length > best.length))
        best = { vertical, at, empty, length }
    }
  }
  // A part that fills its region needs no further cut.
  if (!best) return

  out.cuts++
  out.cutLength += best.length
  const { vertical, at } = best
  const first: Rect = vertical ? { ...region, w: at - region.x } : { ...region, h: at - region.y }
  const second: Rect = vertical
    ? { ...region, x: at + kerf, w: region.x + region.w - at - kerf }
    : { ...region, y: at + kerf, h: region.y + region.h - at - kerf }
  const inFirst = (p: Rect) => (vertical ? p.x + p.w : p.y + p.h) <= at + EPS
  cutUp(parts.filter(inFirst), first, kerf, out)
  cutUp(
    parts.filter((p) => !inFirst(p)),
    second,
    kerf,
    out,
  )
}

function finish(packing: Packing, kerf: number): Solution {
  const layouts: Layout[] = packing.sheets.map(({ stock, placements }) => {
    const cutting: Cutting = { offcuts: [], cuts: 0, cutLength: 0 }
    cutUp(placements, { x: 0, y: 0, w: stock.length, h: stock.width }, kerf, cutting)
    return {
      stockId: stock.id,
      stockName: stock.name,
      length: stock.length,
      width: stock.width,
      placements,
      offcuts: cutting.offcuts
        .filter((r) => Math.min(r.w, r.h) >= MIN_OFFCUT_SIDE)
        .sort((a, b) => b.w * b.h - a.w * a.h),
      cuts: cutting.cuts,
      cutLength: cutting.cutLength,
    }
  })

  const usedArea = sum(layouts, (l) => sum(l.placements, (p) => p.w * p.h))
  const { stockArea } = packing
  return {
    strategy: packing.strategy,
    layouts,
    unplaced: packing.unplaced,
    stats: {
      sheets: layouts.length,
      placed: sum(layouts, (l) => l.placements.length),
      unplaced: packing.unplacedQty,
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

/** Higher when the same leftover area sits in fewer, larger offcuts. */
function consolidation(s: Solution): number {
  return sum(s.layouts, (l) => sum(l.offcuts, (r) => (r.w * r.h) ** 2))
}

function signature(p: Packing): string {
  return p.sheets
    .map(
      (sh) =>
        `${sh.stock.id}:` +
        sh.placements
          .map((pl) => `${pl.partId}@${pl.x},${pl.y},${pl.w},${pl.h}`)
          .sort()
          .join(';'),
    )
    .sort()
    .join('|')
}

/** Solutions that leave the same main offcut on each sheet are one option; the best of them is kept. */
function mainOffcuts(s: Solution): string {
  return s.layouts
    .map((l) => `${l.stockId}:` + l.offcuts.slice(0, 1).map((r) => `${r.w.toFixed(1)}x${r.h.toFixed(1)}`).join())
    .sort()
    .join('|')
}

function stockUse(a: Packing, b: Packing): number {
  return a.unplacedQty - b.unplacedQty || a.stockArea - b.stockArea || a.sheets.length - b.sheets.length
}

/** Best first: fewest parts left over, least stock consumed, then the most reusable leftover. */
function rank(a: Solution, b: Solution): number {
  return (
    a.stats.unplaced - b.stats.unplaced ||
    a.stats.stockArea - b.stats.stockArea ||
    a.stats.sheets - b.stats.sheets ||
    consolidation(b) - consolidation(a) ||
    a.stats.cuts - b.stats.cuts
  )
}

/** Distinct candidate solutions for a job, best first. Deterministic for a given job. */
export function optimise(job: Job): Solution[] {
  const rng = mulberry32(SEED)
  const pick = <T>(xs: T[]) => xs[Math.floor(rng() * xs.length)]
  const packings = new Map<string, Packing>()
  const consider = (s: Strategy) => {
    const packing = pack(job, s, rng)
    const sig = signature(packing)
    if (!packings.has(sig)) packings.set(sig, packing)
  }

  for (const sort of SORTS)
    for (const fit of FITS)
      for (const split of FIXED_SPLITS)
        for (const stockOrder of STOCK_ORDERS) consider({ sort, fit, split, stockOrder, jitter: 0 })

  const count = sum(job.parts, (p) => Math.max(0, Math.floor(p.qty)))
  const rounds = Math.min(MAX_ROUNDS, Math.max(MIN_ROUNDS, Math.floor(SEARCH_WORK / (count * count || 1))))
  for (let i = 0; i < rounds; i++)
    consider({
      sort: pick(SORTS),
      fit: pick(FITS),
      split: pick(SPLITS),
      stockOrder: pick(STOCK_ORDERS),
      jitter: pick(JITTERS),
    })

  const seen = new Set<string>()
  return [...packings.values()]
    .sort(stockUse)
    .slice(0, SHORTLIST)
    .map((p) => finish(p, job.kerf))
    .sort(rank)
    .filter((s) => {
      const key = mainOffcuts(s)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, MAX_CANDIDATES)
}
