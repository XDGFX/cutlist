import { describe, expect, it } from 'vitest'
import {
  compareSolutions,
  createSearch,
  EFFORTS,
  MAX_CANDIDATES,
  MIN_OFFCUT_SIDE,
  optimise,
  type Job,
  type Part,
  type Solution,
  type StockSheet,
} from './optimiser'

const part = (over: Partial<Part>): Part => ({
  id: 'p',
  name: 'part',
  length: 100,
  width: 100,
  qty: 1,
  canRotate: true,
  ...over,
})

const sheet = (over: Partial<StockSheet>): StockSheet => ({
  id: 's',
  name: 'sheet',
  length: 1000,
  width: 500,
  qty: 1,
  ...over,
})

const cabinet: Job = {
  kerf: 3,
  stock: [sheet({ length: 2440, width: 1220, qty: 3 })],
  parts: [
    part({ id: 'side', length: 720, width: 560, qty: 4 }),
    part({ id: 'shelf', length: 564, width: 540, qty: 6 }),
    part({ id: 'back', length: 720, width: 600, qty: 2, canRotate: false }),
    part({ id: 'rail', length: 564, width: 100, qty: 8 }),
  ],
}

describe('optimise', () => {
  it('keeps every part on its sheet and at least a kerf away from its neighbours', () => {
    const solutions = optimise(cabinet)
    expect(solutions.length).toBeGreaterThan(0)
    for (const solution of solutions) {
      expect(solution.stats.unplaced).toBe(0)
      for (const layout of solution.layouts) {
        const ps = layout.placements
        for (const p of ps) {
          expect(p.x).toBeGreaterThanOrEqual(0)
          expect(p.y).toBeGreaterThanOrEqual(0)
          expect(p.x + p.w).toBeLessThanOrEqual(layout.length + 1e-6)
          expect(p.y + p.h).toBeLessThanOrEqual(layout.width + 1e-6)
        }
        for (let i = 0; i < ps.length; i++)
          for (let j = i + 1; j < ps.length; j++) {
            const [a, b] = [ps[i], ps[j]]
            const gapX = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w))
            const gapY = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h))
            expect(Math.max(gapX, gapY)).toBeGreaterThanOrEqual(cabinet.kerf - 1e-6)
          }
      }
    }
  })

  it('accounts for every requested part as either placed or unplaced', () => {
    const requested = cabinet.parts.reduce((n, p) => n + p.qty, 0)
    const short: Job = { ...cabinet, stock: [sheet({ length: 2440, width: 1220, qty: 1 })] }
    for (const job of [cabinet, short])
      for (const { stats } of optimise(job)) expect(stats.placed + stats.unplaced).toBe(requested)
    expect(optimise(short)[0].stats.unplaced).toBeGreaterThan(0)
  })

  it('loses the kerf between two parts that would otherwise fill the sheet', () => {
    const job = (kerf: number): Job => ({
      kerf,
      stock: [sheet({ length: 1000, width: 500, qty: 2 })],
      parts: [part({ length: 500, width: 500, qty: 2 })],
    })
    expect(optimise(job(0))[0].stats.sheets).toBe(1)
    expect(optimise(job(3))[0].stats.sheets).toBe(2)
  })

  it('only turns a part when it is allowed to rotate', () => {
    const job = (canRotate: boolean): Job => ({
      kerf: 0,
      stock: [sheet({ length: 1000, width: 500 })],
      parts: [part({ length: 300, width: 800, canRotate })],
    })
    const [fixed] = optimise(job(false))
    expect(fixed.unplaced).toEqual([{ partId: 'p', name: 'part', qty: 1 }])
    expect(fixed.layouts).toEqual([])

    const [turned] = optimise(job(true))
    expect(turned.layouts[0].placements[0]).toMatchObject({ w: 800, h: 300, rotated: true })
  })

  it('reports area, waste and cuts for a single part cut from a corner', () => {
    const [solution] = optimise({
      kerf: 0,
      stock: [sheet({ length: 1000, width: 500 })],
      parts: [part({ length: 400, width: 500, canRotate: false })],
    })
    expect(solution.stats).toMatchObject({
      sheets: 1,
      stockArea: 500_000,
      usedArea: 200_000,
      wasteArea: 300_000,
      wastePct: 60,
      cuts: 1,
      cutLength: 500,
    })
    expect(solution.layouts[0].offcuts).toEqual([{ x: 400, y: 0, w: 600, h: 500 }])
  })

  it('cuts an L-shaped leftover so that the larger piece comes off whole', () => {
    const [solution] = optimise({
      kerf: 0,
      stock: [sheet({ length: 1000, width: 500 })],
      parts: [part({ length: 400, width: 300, canRotate: false })],
    })
    expect(solution.layouts[0].offcuts).toEqual([
      { x: 400, y: 0, w: 600, h: 500 },
      { x: 0, y: 300, w: 400, h: 200 },
    ])
    expect(solution.stats).toMatchObject({ cuts: 2, cutLength: 900 })
  })

  it('consolidates the leftover to within 2% of a layout worked out by hand', () => {
    const strips: Job = {
      kerf: 1.6,
      stock: [sheet({ id: 'full', length: 2440, width: 1220 }), sheet({ id: 'spare', length: 700, width: 1220 })],
      parts: [
        part({ id: 'a', length: 30, width: 1605, qty: 2 }),
        part({ id: 'b', length: 110, width: 1219, qty: 2 }),
        part({ id: 'c', length: 110, width: 384, qty: 2 }),
        part({ id: 'd', length: 200, width: 590, qty: 1 }),
      ],
    }
    // By hand: both 1219 strips as columns at one end, everything else in a 200 deep row.
    const byHand = (2440 - 2 * (110 + strips.kerf)) * (1220 - 200 - strips.kerf)

    const [best] = optimise(strips)
    expect(best.stats).toMatchObject({ sheets: 1, unplaced: 0 })
    const [largest] = best.layouts[0].offcuts
    expect(largest.w * largest.h).toBeGreaterThanOrEqual(byHand * 0.98)
  })

  describe('cutting order', () => {
    // Two rips stacked across the width, with 100 spare beyond them.
    const stack: Job = {
      kerf: 0,
      stock: [sheet({ length: 1000, width: 600 })],
      parts: [part({ length: 1000, width: 250, qty: 2, canRotate: false })],
    }

    it('sizes each part off an edge and frees the leftover last', () => {
      const [solution] = optimise(stack)
      expect(solution.stats.stacked).toBe(0)
      expect(solution.layouts[0].sequence).toMatchObject([
        { rip: true, fence: 250, far: false, sizes: ['part'], remainder: [] },
        { rip: true, fence: 250, far: false, sizes: ['part'], remainder: [] },
      ])
      expect(solution.layouts[0].offcuts).toEqual([{ x: 0, y: 500, w: 1000, h: 100 }])
    })

    it('counts a remainder that no order can avoid', () => {
      const exact: Job = { ...stack, stock: [sheet({ length: 1000, width: 500 })] }
      const [solution] = optimise(exact)
      expect(solution.layouts[0].sequence).toMatchObject([{ fence: 250, sizes: ['part'], remainder: ['part'] }])
      expect(solution.stats.stacked).toBe(1)
    })

    it('ranks a layout with no remainders above one with a larger offcut', () => {
      const [clean] = optimise(stack)
      const roomier: Solution = {
        ...clean,
        layouts: clean.layouts.map((l) => ({ ...l, offcuts: [{ x: 0, y: 400, w: 1000, h: 200 }] })),
        stats: { ...clean.stats, stacked: 1 },
      }
      expect(compareSolutions(clean, roomier)).toBeLessThan(0)
    })
  })

  it('gives the same solutions every time for the same job', () => {
    expect(optimise(cabinet)).toEqual(optimise(cabinet))
  })

  it('gives the same solutions however the search is batched', () => {
    const search = createSearch(cabinet, 1)
    while (!search.finished()) search.step(7)
    expect(search.stats().tried).toBe(search.stats().total)
    expect(search.solutions()).toEqual(optimise(cabinet, 1))
  })

  it('tries more layouts at each effort level and never ends up with a worse best solution', () => {
    const results = EFFORTS.slice(0, 2).map((_, effort) => {
      const search = createSearch(cabinet, effort)
      while (!search.finished()) search.step(1024)
      return { total: search.stats().total, best: search.solutions()[0] }
    })
    for (let i = 1; i < results.length; i++) {
      expect(results[i].total).toBeGreaterThan(results[i - 1].total)
      expect(compareSolutions(results[i].best, results[i - 1].best)).toBeLessThanOrEqual(0)
    }
  })

  it('keeps the best solution found so far when the search is cut short', () => {
    const search = createSearch(cabinet, 1)
    search.step(200)
    expect(search.finished()).toBe(false)
    const [early] = search.solutions()
    expect(early.stats.unplaced).toBe(0)
    while (!search.finished()) search.step(1024)
    expect(compareSolutions(search.solutions()[0], early)).toBeLessThanOrEqual(0)
  })

  it('does not list a sliver as an offcut', () => {
    const sliver = MIN_OFFCUT_SIDE - 1
    const [solution] = optimise({
      kerf: 0,
      stock: [sheet({ length: 1000, width: 500 })],
      parts: [part({ length: 1000 - sliver, width: 500, canRotate: false })],
    })
    expect(solution.layouts[0].offcuts).toEqual([])
  })

  it('offers distinct candidates, capped, with the least stock consumed first', () => {
    const solutions = optimise(cabinet)
    expect(solutions.length).toBeGreaterThan(1)
    expect(solutions.length).toBeLessThanOrEqual(MAX_CANDIDATES)
    const areas = solutions.map((s) => s.stats.stockArea)
    expect(areas).toEqual([...areas].sort((a, b) => a - b))
    const shapes = solutions.map((s) => JSON.stringify(s.layouts.map((l) => l.placements)))
    expect(new Set(shapes).size).toBe(solutions.length)
  })
})
