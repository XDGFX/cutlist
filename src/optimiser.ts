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

export interface Cut {
  /** True for a cut along the sheet's length, false for one across it. */
  rip: boolean
  x1: number
  y1: number
  x2: number
  y2: number
  /** Distance to set between the reference edge of the piece and the blade. */
  fence: number
  /** True when that distance is measured from the piece's far edge: its right or bottom as drawn. */
  far: boolean
  /** Names of the parts whose dimension this cut sets. */
  sizes: string[]
  /** Names of the parts on the other side that are left as whatever remains. */
  remainder: string[]
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
  /** The cuts in the order to make them. */
  sequence: Cut[]
  /** How many part dimensions are a remainder rather than set by their own cut. */
  stacked: number
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
  stacked: number
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
/**
 * Sizes the lowest effort to about a twentieth of a second on a typical laptop, whatever the part
 * count: a try costs roughly TRY_COST + TRY_COST_PER_ITEM per item, in microseconds.
 */
const SEARCH_WORK = 50_000
const TRY_COST = 10
const TRY_COST_PER_ITEM = 1.2
const MIN_ROUNDS = 100
/** Share of the later rounds spent on fresh random plans rather than on evolving the best ones. */
const FRESH = 0.15
/** How many of the best solutions are bred from. */
const ELITE = 8
const POOL_MAX = 64
const POOL_KEEP = 32
/** How many times per sheet the cut sequencer may try two orders and keep the better. */
const LOOKAHEAD = 6

/** Search effort levels: each tries `scale` times as many layouts as the first. */
export const EFFORTS = [
  { name: 'Instant', scale: 1 },
  { name: 'Quick', scale: 8 },
  { name: 'Thorough', scale: 40 },
  { name: 'Deep', scale: 120 },
  { name: 'Insane', scale: 280 },
] as const

export interface SearchStats {
  tried: number
  total: number
  /** How many times a better best solution turned up, and at which try the last one did. */
  improvements: number
  lastImprovedAt: number
}

export interface Search {
  step(rounds: number): void
  finished(): boolean
  stats(): SearchStats
  /** Distinct candidate solutions found so far, best first. */
  solutions(): Solution[]
}

interface Item {
  part: Part
  length: number
  width: number
}

type Sort = 'area' | 'longest side' | 'perimeter' | 'width'
type Fit = 'tightest area' | 'tightest side' | 'pack to one end' | 'pack to one edge'
type Split = 'short leftover' | 'long leftover' | 'rip first' | 'crosscut first'
type StockOrder = 'largest stock first' | 'smallest stock first'

/** Everything that decides one packing. Indexed arrays line up with the job's items. */
interface Plan {
  origin: string
  /** Placement priority: the highest goes first. */
  keys: number[]
  /** Forced split direction and orientation per item; null leaves it to the rules. */
  rip: (boolean | null)[]
  turn: (boolean | null)[]
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
const FITS: Fit[] = ['tightest area', 'tightest side', 'pack to one end', 'pack to one edge']
const SPLITS: Split[] = ['short leftover', 'long leftover', 'rip first', 'crosscut first']
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

function orientations(item: Item, turn: boolean | null): { w: number; h: number; rotated: boolean }[] {
  const upright = { w: item.length, h: item.width, rotated: false }
  if (!item.part.canRotate || item.length === item.width) return [upright]
  const turned = { w: item.width, h: item.length, rotated: true }
  return turn === null ? [upright, turned] : [turn ? turned : upright]
}

function bestFit(sheet: OpenSheet, item: Item, fit: Fit, turn: boolean | null): Candidate | null {
  let best: Candidate | null = null
  sheet.free.forEach((f, index) => {
    for (const o of orientations(item, turn)) {
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

function place(sheet: OpenSheet, item: Item, c: Candidate, rip: boolean | null, split: Split, kerf: number) {
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
    rip ??
    (split === 'rip first' ||
      (split === 'short leftover' && spareW <= spareH) ||
      (split === 'long leftover' && spareW > spareH))

  const right: Rect = { x: f.x + c.w + kerf, y: f.y, w: spareW - kerf, h: ripFirst ? c.h : f.h }
  const below: Rect = { x: f.x, y: f.y + c.h + kerf, w: ripFirst ? f.w : c.w, h: spareH - kerf }
  for (const r of [right, below]) if (r.w > EPS && r.h > EPS) sheet.free.push(r)
}

function pack(job: Job, items: Item[], plan: Plan): Packing {
  const order = items
    .map((_, i) => i)
    .sort(
      (a, b) =>
        plan.keys[b] - plan.keys[a] || items[b].length * items[b].width - items[a].length * items[a].width,
    )

  const stock = job.stock
    .filter((st) => st.length > 0 && st.width > 0 && st.qty > 0)
    .sort((a, b) =>
      plan.stockOrder === 'largest stock first'
        ? b.length * b.width - a.length * a.width
        : a.length * a.width - b.length * b.width,
    )
  const remaining = new Map(stock.map((st) => [st.id, Math.floor(st.qty)]))

  const sheets: OpenSheet[] = []
  const unplaced = new Map<string, Unplaced>()

  for (const i of order) {
    const item = items[i]
    const tryPlace = (turn: boolean | null): boolean => {
      for (const sheet of sheets) {
        const c = bestFit(sheet, item, plan.fit, turn)
        if (!c) continue
        place(sheet, item, c, plan.rip[i], plan.split, job.kerf)
        return true
      }
      for (const st of stock) {
        if (!remaining.get(st.id)) continue
        const sheet: OpenSheet = {
          stock: st,
          placements: [],
          free: [{ x: 0, y: 0, w: st.length, h: st.width }],
          reachX: 0,
          reachY: 0,
        }
        const c = bestFit(sheet, item, plan.fit, turn)
        if (!c) continue
        remaining.set(st.id, remaining.get(st.id)! - 1)
        sheets.push(sheet)
        place(sheet, item, c, plan.rip[i], plan.split, job.kerf)
        return true
      }
      return false
    }
    // A forced orientation that fits nowhere gives way rather than losing the part.
    if (tryPlace(plan.turn[i]) || (plan.turn[i] !== null && tryPlace(null))) continue

    const u = unplaced.get(item.part.id) ?? { partId: item.part.id, name: item.part.name, qty: 0 }
    u.qty++
    unplaced.set(item.part.id, u)
  }

  return {
    strategy: `${plan.origin} · ${plan.fit} · ${plan.split} · ${plan.stockOrder}`,
    sheets,
    unplaced: [...unplaced.values()],
    unplacedQty: sum([...unplaced.values()], (u) => u.qty),
    stockArea: sum(sheets, (sh) => sh.stock.length * sh.stock.width),
  }
}

interface Cutting {
  offcuts: Rect[]
  sequence: Cut[]
  stacked: number
}

/**
 * A possible next cut. Kind 0 sizes parts off one edge of the piece, 1 only frees an empty piece,
 * 2 only separates groups of parts, and 3 is an exact fit on both sides, which leaves a remainder.
 */
interface Option {
  vertical: boolean
  at: number
  kind: number
  empty: number
  length: number
}

/** Higher when the same leftover area sits in fewer, larger offcuts. */
function worth(offcuts: Rect[]): number {
  return sum(offcuts, (r) => (Math.min(r.w, r.h) >= MIN_OFFCUT_SIDE ? (r.w * r.h) ** 2 : 0))
}

/**
 * Works out guillotine cuts that free every part in a region, in the order to make them.
 *
 * In safe mode it takes cuts that size parts directly off an edge first and leaves freeing the
 * leftover until it can no longer turn a run of parts into an exact fit, so that accumulated
 * error ends up in the offcut. Otherwise it always frees the largest empty piece first.
 */
function cutUp(parts: Placement[], region: Rect, kerf: number, safe: boolean, lookahead: { left: number }): Cutting {
  if (parts.length === 0)
    return { offcuts: region.w > EPS && region.h > EPS ? [region] : [], sequence: [], stacked: 0 }

  const best: (Option | undefined)[] = []
  for (const vertical of [true, false]) {
    const start = vertical ? region.x : region.y
    const end = start + (vertical ? region.w : region.h)
    const length = vertical ? region.h : region.w

    // The blade takes [at, at + kerf], so it sits just after one part or just before another.
    const positions = new Set<number>()
    for (const p of parts) {
      const lo = vertical ? p.x : p.y
      positions.add(lo + (vertical ? p.w : p.h))
      positions.add(lo - kerf)
    }
    for (const at of positions) {
      if (at <= start + EPS || at >= end - EPS) continue
      let before = 0
      let after = 0
      let spanBefore = false
      let spanAfter = false
      let blocked = false
      for (const p of parts) {
        const lo = vertical ? p.x : p.y
        const hi = lo + (vertical ? p.w : p.h)
        if (hi <= at + EPS) {
          before++
          if (lo <= start + EPS && hi >= at - EPS) spanBefore = true
        } else if (lo >= at + kerf - EPS) {
          after++
          if (lo <= at + kerf + EPS && hi >= end - EPS) spanAfter = true
        } else {
          blocked = true
          break
        }
      }
      if (blocked) continue

      const empty = !before ? (at - start) * length : !after ? Math.max(0, end - at - kerf) * length : 0
      const kind = !safe ? 0 : spanBefore && spanAfter ? 3 : spanBefore || spanAfter ? 0 : !before || !after ? 1 : 2
      const held = best[kind]
      if (!held || empty > held.empty || (empty === held.empty && length > held.length))
        best[kind] = { vertical, at, kind, empty, length }
    }
  }

  const make = ({ vertical, at }: Option): Cutting => {
    const first: Rect = vertical ? { ...region, w: at - region.x } : { ...region, h: at - region.y }
    const second: Rect = vertical
      ? { ...region, x: at + kerf, w: region.x + region.w - at - kerf }
      : { ...region, y: at + kerf, h: region.y + region.h - at - kerf }
    const inFirst = (p: Rect) => (vertical ? p.x + p.w : p.y + p.h) <= at + EPS
    const exactFit = (piece: Rect) => (p: Rect) => (vertical ? p.w >= piece.w - EPS : p.h >= piece.h - EPS)
    const partsFirst = parts.filter(inFirst)
    const partsSecond = parts.filter((p) => !inFirst(p))
    const sizedFirst = partsFirst.filter(exactFit(first))
    const sizedSecond = partsSecond.filter(exactFit(second))

    // The fence is set off one side only, so when both sides are an exact fit the smaller group
    // is whatever is left over.
    const far = sizedSecond.length > sizedFirst.length
    const remainder = sizedFirst.length && sizedSecond.length ? (far ? sizedFirst : sizedSecond) : []
    const names = (ps: Placement[]) => [...new Set(ps.map((p) => p.name))]
    const mid = at + kerf / 2
    const cut: Cut = {
      rip: !vertical,
      x1: vertical ? mid : region.x,
      y1: vertical ? region.y : mid,
      x2: vertical ? mid : region.x + region.w,
      y2: vertical ? region.y + region.h : mid,
      fence: vertical ? (far ? second.w : first.w) : far ? second.h : first.h,
      far,
      sizes: names(far ? sizedSecond : sizedFirst),
      remainder: names(remainder),
    }

    const a = cutUp(partsFirst, first, kerf, safe, lookahead)
    const b = cutUp(partsSecond, second, kerf, safe, lookahead)
    return {
      offcuts: [...a.offcuts, ...b.offcuts],
      sequence: [cut, ...a.sequence, ...b.sequence],
      stacked: remainder.length + a.stacked + b.stacked,
    }
  }

  const [sizing, freeing, separating, exact] = best
  if (sizing) return make(sizing)
  // Freeing the leftover first keeps it in one piece but can leave an exact fit behind, so while
  // the budget lasts both orders are tried.
  if (freeing && separating && lookahead.left > 0) {
    lookahead.left--
    const a = make(freeing)
    const b = make(separating)
    const order =
      a.stacked - b.stacked || worth(b.offcuts) - worth(a.offcuts) || a.sequence.length - b.sequence.length
    return order <= 0 ? a : b
  }
  const next = separating ?? freeing ?? exact
  // A part that fills its region needs no further cut.
  return next ? make(next) : { offcuts: [], sequence: [], stacked: 0 }
}

function finish(packing: Packing, kerf: number, safe: boolean): Solution {
  const layouts: Layout[] = packing.sheets.map(({ stock, placements }) => {
    const cutting = cutUp(placements, { x: 0, y: 0, w: stock.length, h: stock.width }, kerf, safe, { left: LOOKAHEAD })
    return {
      stockId: stock.id,
      stockName: stock.name,
      length: stock.length,
      width: stock.width,
      placements,
      offcuts: cutting.offcuts
        .filter((r) => Math.min(r.w, r.h) >= MIN_OFFCUT_SIDE)
        .sort((a, b) => b.w * b.h - a.w * a.h),
      cuts: cutting.sequence.length,
      cutLength: sum(cutting.sequence, (c) => c.x2 - c.x1 + c.y2 - c.y1),
      sequence: cutting.sequence,
      stacked: cutting.stacked,
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
      stacked: sum(layouts, (l) => l.stacked),
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

/** Solutions that leave the same main offcut on each sheet are one option; the best of them is kept. */
function mainOffcuts(s: Solution): string {
  return s.layouts
    .map((l) => `${l.stockId}:` + l.offcuts.slice(0, 1).map((r) => `${r.w.toFixed(1)}x${r.h.toFixed(1)}`).join())
    .sort()
    .join('|')
}

/**
 * Best first: fewest parts left over, least stock consumed, then (in safe mode) fewest remainder
 * dimensions, then the most reusable leftover.
 */
export function compareSolutions(a: Solution, b: Solution, safe = true): number {
  return (
    a.stats.unplaced - b.stats.unplaced ||
    a.stats.stockArea - b.stats.stockArea ||
    a.stats.sheets - b.stats.sheets ||
    (safe ? a.stats.stacked - b.stats.stacked : 0) ||
    consolidation(b) - consolidation(a) ||
    a.stats.cuts - b.stats.cuts
  )
}

interface Entry {
  solution: Solution
  plan: Plan
}

/**
 * A search that can be advanced a few tries at a time. It runs the fixed heuristics, then random
 * plans, then evolves the best plans found. Deterministic for a given job and effort, however
 * the tries are batched.
 */
export function createSearch(job: Job, effort = 0, safe = true): Search {
  const compare = (a: Solution, b: Solution) => compareSolutions(a, b, safe)
  const rng = mulberry32(SEED)
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rng() * xs.length)]

  const items: Item[] = job.parts
    .filter((p) => p.length > 0 && p.width > 0 && p.qty > 0)
    .flatMap((part) =>
      Array.from({ length: Math.floor(part.qty) }, () => ({ part, length: part.length, width: part.width })),
    )
  const n = items.length
  const unforced = items.map(() => null)

  const fixed: Plan[] = SORTS.flatMap((sort) =>
    FITS.flatMap((fit) =>
      SPLITS.flatMap((split) =>
        STOCK_ORDERS.map((stockOrder) => ({
          origin: sort,
          keys: items.map(SORT_KEY[sort]),
          rip: unforced,
          turn: unforced,
          fit,
          split,
          stockOrder,
        })),
      ),
    ),
  )
  const base = n ? Math.max(MIN_ROUNDS, Math.floor(SEARCH_WORK / (TRY_COST + TRY_COST_PER_ITEM * n))) : 0
  const randomUntil = fixed.length + base
  const total = fixed.length + base * EFFORTS[effort].scale

  const pool = new Map<string, Entry>()
  let elite: Entry[] = []
  let eliteStale = false
  let best: Solution | null = null
  let tried = 0
  let improvements = 0
  let lastImprovedAt = 0

  const ranked = () => [...pool.values()].sort((a, b) => compare(a.solution, b.solution))

  const randomPlan = (): Plan => {
    const sort = pick(SORTS)
    const jitter = pick(JITTERS)
    const mixed = rng() < 0.2
    return {
      origin: `${sort} (shuffled)`,
      keys: items.map((i) => SORT_KEY[sort](i) * (1 + jitter * (rng() - 0.5))),
      rip: mixed ? items.map(() => rng() < 0.5) : unforced,
      turn: unforced,
      fit: pick(FITS),
      split: pick(SPLITS),
      stockOrder: pick(STOCK_ORDERS),
    }
  }

  const mutate = (parent: Plan): Plan => {
    const child = { ...parent, origin: 'evolved', keys: [...parent.keys], rip: [...parent.rip], turn: [...parent.turn] }
    for (let changes = 1 + Math.floor(rng() * 3); changes > 0; changes--) {
      const i = Math.floor(rng() * n)
      const j = Math.floor(rng() * n)
      const kind = rng()
      if (kind < 0.3) [child.keys[i], child.keys[j]] = [child.keys[j], child.keys[i]]
      // Moves item i to sit next to item j in the order.
      else if (kind < 0.45) child.keys[i] = child.keys[j] * (1 + 0.01 * (rng() - 0.5))
      else if (kind < 0.65) child.rip[i] = pick([true, false, null])
      else if (kind < 0.85) child.turn[i] = pick([true, false, null])
      else if (kind < 0.95) child.fit = pick(FITS)
      else child.split = pick(SPLITS)
    }
    return child
  }

  const consider = (plan: Plan) => {
    tried++
    const packing = pack(job, items, plan)
    // Working out the cuts is the expensive part, so skip packings that already use more stock.
    if (
      best &&
      pool.size >= MAX_CANDIDATES &&
      (packing.unplacedQty - best.stats.unplaced ||
        packing.stockArea - best.stats.stockArea ||
        packing.sheets.length - best.stats.sheets) > 0
    )
      return

    const solution = finish(packing, job.kerf, safe)
    const key = mainOffcuts(solution)
    const held = pool.get(key)
    if (held && compare(solution, held.solution) >= 0) return
    pool.set(key, { solution, plan })
    eliteStale = true
    if (!best || compare(solution, best) < 0) {
      best = solution
      improvements++
      lastImprovedAt = tried
    }
    if (pool.size > POOL_MAX) {
      const keep = ranked().slice(0, POOL_KEEP)
      pool.clear()
      for (const entry of keep) pool.set(mainOffcuts(entry.solution), entry)
    }
  }

  return {
    step(rounds) {
      for (let i = 0; i < rounds && tried < total; i++) {
        if (tried < fixed.length) consider(fixed[tried])
        else if (tried < randomUntil || rng() < FRESH) consider(randomPlan())
        else {
          if (eliteStale) {
            elite = ranked().slice(0, ELITE)
            eliteStale = false
          }
          consider(mutate(pick(elite).plan))
        }
      }
    },
    finished: () => tried >= total,
    stats: () => ({ tried, total, improvements, lastImprovedAt }),
    solutions: () =>
      ranked()
        .slice(0, MAX_CANDIDATES)
        .map((entry) => entry.solution),
  }
}

/** Distinct candidate solutions for a job, best first. */
export function optimise(job: Job, effort = 0, safe = true): Solution[] {
  const search = createSearch(job, effort, safe)
  while (!search.finished()) search.step(1024)
  return search.solutions()
}
