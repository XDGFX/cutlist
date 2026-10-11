import { describe, expect, it } from 'vitest'
import { CHAR, clip, DETAIL_HEIGHT, DETAIL_PARTS, dims, eachHolds, fit, labelRoom, partLabel, PIECE_SPARE, planLabels } from './labels'
import type { Cut, Layout, Placement } from './optimiser'

const TEXT = 16
const KERF = 3

const placed = (name: string, x: number, y: number, w: number, h: number): Placement => ({
  partId: name,
  name,
  rotated: false,
  x,
  y,
  w,
  h,
})

const layout = (placements: Placement[]): Layout => ({
  stockId: 's',
  stockName: 'sheet',
  length: 2400,
  width: 1200,
  placements,
  offcuts: [],
  cuts: 0,
  cutLength: 0,
  sequence: [],
  stacked: 0,
  fenceMoves: 0,
  narrowFirst: 0,
})

/** A row of `count` of the same part side by side from the sheet's top left corner. */
const row = (name: string, count: number, w: number, h: number) =>
  Array.from({ length: count }, (_, i) => placed(name, i * (w + KERF), 0, w, h))

/** The same row, but of `count` different parts of one size. */
const assorted = (name: string, count: number, w: number, h: number) =>
  row(name, count, w, h).map((p, i) => ({ ...p, partId: `${name}${i}` }))

describe('planLabels', () => {
  it('leaves a sheet alone when every part holds its label', () => {
    const plan = planLabels(layout(row('side', 3, 600, 400)), 2, TEXT, KERF)

    expect(plan.small.size).toBe(0)
    expect(plan.leaders).toEqual([])
    expect(plan.details).toEqual([])
    expect(plan.gutter).toEqual({ top: 0, bottom: 0 })
  })

  it('finds the same part small or not by how large the sheet is drawn', () => {
    const shelves = layout(row('shelf', 2, 110, 1200))

    expect(planLabels(shelves, 1, TEXT, KERF).small.size).toBe(0)
    expect(planLabels(shelves, 8, TEXT, KERF).small.size).toBe(2)
  })

  it('gives parts too small for a label one leader between them, in the margin', () => {
    const rails = layout([placed('rail', 0, 0, 30, 1200), placed('rail', 1000, 0, 30, 1200), placed('top', 100, 0, 800, 600)])

    const plan = planLabels(rails, 2, TEXT, KERF)

    expect([...plan.small]).toEqual([0, 1])
    expect(plan.leaders).toHaveLength(1)
    expect(plan.leaders[0].parts).toEqual([0, 1])
    expect(plan.leaders[0].points.map((p) => p.x)).toEqual([15, 1015])
    expect(plan.leaders[0].y).toBeGreaterThan(rails.width)
    expect(plan.gutter.bottom).toBeGreaterThan(0)
  })

  it('enlarges a crowd of small parts in a detail where each holds its label', () => {
    const blocks = layout(assorted('block', DETAIL_PARTS, 40, 60))
    const px = 2.5

    const plan = planLabels(blocks, px, TEXT, KERF)

    expect(plan.runs).toEqual([])
    expect(plan.leaders).toEqual([])
    expect(plan.details).toHaveLength(1)
    const [detail] = plan.details
    expect(detail.parts).toEqual(blocks.placements.map((_, i) => i))
    for (const i of detail.parts) {
      const part = blocks.placements[i]
      expect(fit(partLabel(part), part, TEXT * px)).toBeUndefined()
      expect(fit(partLabel(part), part, TEXT * detail.px)).toBeDefined()
    }
    expect(detail.frame.y).toBeGreaterThan(blocks.width)
    expect(plan.gutter.bottom).toBeGreaterThanOrEqual(detail.frame.y + detail.frame.h - blocks.width)
    // The blocks lie in the sheet's corner, and the margin round them runs past its edges.
    expect(detail.region.x).toBeLessThan(0)
    expect(detail.region.y).toBeLessThan(0)
  })

  it('labels a run of the same small part once across all of it, where that fits', () => {
    const blocks = layout(row('block', 5, 60, 60))

    const plan = planLabels(blocks, 1, TEXT, KERF)

    expect(plan.small.size).toBe(5)
    expect(plan.runs.map((r) => r.parts)).toEqual([[0, 1, 2, 3, 4]])
    expect(plan.runs[0].box).toEqual({ x: 0, y: 0, w: 5 * 60 + 4 * KERF, h: 60 })
    expect(fit(plan.runs[0].label, labelRoom(plan.runs[0], TEXT), TEXT)).toBeDefined()
    expect(plan.leaders).toEqual([])
    expect(plan.details).toEqual([])
  })

  it('labels each part of a row by its size alone where names are hidden and that fits', () => {
    const fronts = layout(row('drawer front', 3, 100, 100))

    const named = planLabels(fronts, 1, TEXT, KERF)
    const unnamed = planLabels(fronts, 1, TEXT, KERF, false)

    expect(named.runs.map((r) => r.parts)).toEqual([[0, 1, 2]])
    expect(unnamed.small.size).toBe(0)
    expect(unnamed.runs).toEqual([])
  })

  it('leaves the name out of a run and a leader where names are hidden', () => {
    const blocks = planLabels(layout(row('block', 5, 60, 60)), 1, TEXT, KERF, false)
    const rails = planLabels(layout([placed('rail', 0, 0, 30, 1200), placed('stile', 1000, 0, 30, 1200)]), 2, TEXT, KERF, false)

    expect(blocks.runs.map((r) => r.parts)).toEqual([[0, 1, 2, 3, 4]])
    expect(blocks.runs[0].label.join(' ')).not.toContain('block')
    expect(blocks.runs[0].label.join(' ')).toContain('5')
    expect(blocks.runs[0].label.join(' ')).toContain(dims({ x: 0, y: 0, w: 60, h: 60 }))
    // Parts of one size are told apart only by their names, so without them they share a label.
    expect(rails.leaders.map((l) => l.text)).toEqual([dims({ x: 0, y: 0, w: 30, h: 1200 })])
    expect(rails.leaders[0].parts).toEqual([0, 1])
  })

  it('finds that each part of a run holds its own label once drawn large enough', () => {
    const blocks = layout(row('block', 5, 60, 60))
    const [run] = planLabels(blocks, 1, TEXT, KERF).runs

    expect(eachHolds(run, blocks.placements, TEXT)).toBe(false)
    expect(eachHolds(run, blocks.placements, TEXT / 2)).toBe(true)
  })

  it('enlarges a run only as far as its one label needs', () => {
    const px = 2.5
    const [alike] = planLabels(layout(row('block', 4, 40, 60)), px, TEXT, KERF).details
    const [unalike] = planLabels(layout(assorted('block', 4, 40, 60)), px, TEXT, KERF).details

    expect(alike.parts).toEqual([0, 1, 2, 3])
    expect(alike.px).toBeGreaterThan(unalike.px)
  })

  it('keeps to leaders for a crowd whose detail would be too tall to use', () => {
    const rails = layout(assorted('rail', DETAIL_PARTS, 20, 1200))
    const px = 2.5

    const plan = planLabels(rails, px, TEXT, KERF)

    // A rail needs more than three times the size to hold its label, and at three it is already too long.
    expect(fit(partLabel(rails.placements[0]), rails.placements[0], (TEXT * px) / 3)).toBeUndefined()
    expect((3 * rails.width) / px).toBeGreaterThan(DETAIL_HEIGHT * TEXT)
    expect(plan.details).toEqual([])
    expect(plan.leaders.flatMap((l) => l.parts)).toHaveLength(DETAIL_PARTS)
  })

  describe('the arm from a region to its detail', () => {
    const px = 2.5
    const blocks = row('block', 3, 40, 60).map((b) => ({ ...b, x: b.x + 140 }))
    // A part right under the blocks, whose label lies on the straight way down to the detail.
    const under = placed('side', 0, 63, 400, 1100)
    const crowded = layout([...blocks, under])
    const stretches = (arm: { x: number; y: number }[]) => arm.slice(1).map((p, i) => [arm[i], p] as const)

    it('runs in upright and level stretches from the edge of the region onto the detail', () => {
      const [detail] = planLabels(crowded, px, TEXT, KERF).details
      const { region, frame, tab, arm } = detail
      const [first, last] = [arm[0], arm[arm.length - 1]]

      for (const [a, b] of stretches(arm)) expect(a.x === b.x || a.y === b.y).toBe(true)
      expect(
        first.y === region.y + region.h || first.y === region.y || first.x === region.x || first.x === region.x + region.w,
      ).toBe(true)
      expect([frame.y, tab.y]).toContain(last.y)
      expect(last.x).toBeGreaterThanOrEqual(frame.x)
      expect(last.x).toBeLessThanOrEqual(frame.x + Math.max(frame.w, tab.w))
    })

    it('goes round a label that lies on the straight way down', () => {
      const [detail] = planLabels(crowded, px, TEXT, KERF).details
      const held = fit(partLabel(under), under, TEXT * px)!
      const label = { x: under.x + (under.w - held.w) / 2, y: under.y + (under.h - held.h) / 2, w: held.w, h: held.h }

      // The region lies wholly above the label, so the straight way down would cross it.
      expect(detail.region.x).toBeGreaterThan(label.x)
      expect(detail.region.x + detail.region.w).toBeLessThan(label.x + label.w)
      for (const [a, b] of stretches(detail.arm)) {
        const crosses =
          Math.min(a.x, b.x) < label.x + label.w &&
          Math.max(a.x, b.x) > label.x &&
          Math.min(a.y, b.y) < label.y + label.h &&
          Math.max(a.y, b.y) > label.y
        expect(crosses).toBe(false)
      }
    })

    it('keeps the arms of regions one above another from crossing', () => {
      const stacked = layout([...blocks, ...blocks.map((b) => ({ ...b, y: 600 }))])

      const [one, two] = planLabels(stacked, px, TEXT, KERF).details
      const crossings = stretches(one.arm).flatMap(([a, b]) =>
        stretches(two.arm).filter(
          ([c, d]) =>
            Math.min(a.x, b.x) <= Math.max(c.x, d.x) &&
            Math.max(a.x, b.x) >= Math.min(c.x, d.x) &&
            Math.min(a.y, b.y) <= Math.max(c.y, d.y) &&
            Math.max(a.y, b.y) >= Math.min(c.y, d.y),
        ),
      )

      expect(crossings).toEqual([])
    })
  })

  it('enlarges the whole piece a crowd is cut from, or just its parts where the piece is too big', () => {
    const cut = (rip: boolean, x1: number, y1: number, x2: number, y2: number): Cut => ({
      ...{ rip, x1, y1, x2, y2 },
      ...{ fence: 0, far: false, sizes: [], remainder: [] },
    })
    const blocks = row('block', 3, 40, 60).map((b) => ({ ...b, x: b.x + 2250 }))
    const span = { x: 2250, y: 0, w: 126, h: 60 }
    // A crosscut frees the right end of the sheet, then a rip frees its top corner with the blocks in.
    const corner = (h: number) => [cut(false, 2248.5, 0, 2248.5, 1200), cut(true, 2250, h + 1.5, 2400, h + 1.5)]
    const px = 2.5
    const piece = (sequence: Cut[]) => planLabels({ ...layout(blocks), sequence }, px, TEXT, KERF).details[0].piece

    const snug = planLabels({ ...layout(blocks), sequence: corner(100) }, px, TEXT, KERF).details[0]

    expect(snug.piece).toEqual({ x: 2250, y: 0, w: 150, h: 100 })
    expect(snug.region.x).toBeLessThan(snug.piece.x)
    expect(snug.region.y + snug.region.h).toBeGreaterThan(snug.piece.y + snug.piece.h)
    // A corner mostly of something else is passed over for just the parts.
    expect(150 * 600).toBeGreaterThan(PIECE_SPARE * span.w * span.h)
    expect(piece(corner(600))).toEqual(span)
    // With no cuts the only piece is the sheet.
    expect(piece([])).toEqual(span)
  })

  it('shares a run of small parts too long for one detail between several', () => {
    const run = layout(assorted('block', 40, 40, 60))
    const px = 2.5

    const { details } = planLabels(run, px, TEXT, KERF)

    expect(details.length).toBeGreaterThan(1)
    expect(details.flatMap((d) => d.parts).sort((a, b) => a - b)).toEqual(run.placements.map((_, i) => i))
    for (const d of details) expect(d.frame.x + d.frame.w).toBeLessThanOrEqual(run.length)
    // Neighbouring details give up the margin between them, so no two show the same stretch of sheet.
    for (const a of details) for (const b of details) if (a !== b) expect(clip(a.region, b.region)).toBeNull()
  })

  it('gives each detail room for its title beside the next', () => {
    const pairs = layout([...row('block', 2, 40, 60), ...row('peg', 2, 40, 60).map((p) => ({ ...p, x: p.x + 200 }))])
    const px = 2.5

    const [first, second] = planLabels(pairs, px, TEXT, KERF).details

    expect(second.frame.y).toBe(first.frame.y)
    expect(second.frame.x - first.frame.x).toBeGreaterThanOrEqual(first.title.length * CHAR * TEXT * px)
  })

  it("keeps a leader's label off the lines of the leaders further out", () => {
    const px = 2.5
    const strips = layout([placed('a', 100, 0, 30, 1200), placed('b', 250, 0, 30, 1200), placed('a', 400, 0, 30, 1200)])

    const { leaders } = planLabels(strips, px, TEXT, KERF)

    expect(leaders).toHaveLength(2)
    for (const l of leaders) {
      const wide = l.text.length * CHAR * TEXT * px
      const [from, to] = l.anchor === 'start' ? [l.textX, l.textX + wide] : [l.textX - wide, l.textX]
      const beyond = leaders.filter((o) => o.y > l.y).flatMap((o) => o.points.map((p) => p.x))
      expect(beyond.filter((x) => x > from && x < to)).toEqual([])
    }
  })

  it('labels every part exactly one way however large the sheet is drawn', () => {
    const mixed = layout([
      ...row('rail', 2, 30, 1200),
      placed('side', 100, 0, 600, 400),
      placed('cleat', 800, 0, 25, 300),
      ...row('block', 4, 40, 60).map((b) => ({ ...b, x: b.x + 1000, y: 700 })),
    ])

    for (const px of [0.5, 1, 2, 3, 5, 8]) {
      const plan = planLabels(mixed, px, TEXT, KERF)
      const led = plan.leaders.flatMap((l) => l.parts)
      const detailed = plan.details.flatMap((d) => d.parts)
      const across = plan.runs.filter((r) => fit(r.label, labelRoom(r, TEXT * px), TEXT * px)).flatMap((r) => r.parts)
      const ways = mixed.placements.map(
        (_, i) => +!plan.small.has(i) + [...led, ...detailed, ...across].filter((n) => n === i).length,
      )
      expect(ways, `at ${px} mm to the pixel`).toEqual(mixed.placements.map(() => 1))
    }
  })
})
