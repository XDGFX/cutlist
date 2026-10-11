import type { Layout, Rect } from './optimiser'

export const mm = (n: number) => String(+n.toFixed(1))
export const dims = (r: Rect) => `${mm(r.w)} × ${mm(r.h)}`
/** A part's label, which is its size alone where names are hidden. */
export const partLabel = (p: { name: string } & Rect, named = true) => (named ? [p.name, dims(p)] : [dims(p)])
/** The label for `count` of the same part. */
export const countLabel = (count: number, p: { name: string } & Rect, named = true) => [
  named ? `${count} × ${p.name}` : `${count} off`,
  dims(p),
]

/** The width of a character, the height of a line and the clearance round a label, in font sizes. */
export const CHAR = 0.6
const LINE = 1.2
const MARGIN = 0.4
/** The tallest a detail may be drawn, in font sizes. */
export const DETAIL_HEIGHT = 60
/** The narrowest a part may be drawn in a detail, in font sizes. */
const PART_WIDTH = 1.5
/** How many times the area of its small parts a piece may be and still be the detail's region. */
export const PIECE_SPARE = 3
/** The fewest small parts worth a detail of their own. */
export const DETAIL_PARTS = 2

/** One way to set a label, with the room it takes. */
export interface Setting {
  lines: string[]
  turned: boolean
  w: number
  h: number
}

/** The ways to set a label, most wanted first: on two lines then one, upright then turned to run up a tall piece. */
function settings(wanted: string[], font: number): Setting[] {
  return [false, true].flatMap((turned) =>
    [wanted, [wanted.join(' ')]].map((lines) => {
      const across = (Math.max(...lines.map((l) => l.length)) * CHAR + MARGIN) * font
      const down = (lines.length * LINE + MARGIN) * font
      return { lines, turned, w: turned ? down : across, h: turned ? across : down }
    }),
  )
}

export const fit = (wanted: string[], box: Rect, font: number) =>
  settings(wanted, font).find((s) => s.w <= box.w && s.h <= box.h)

/** The room a run keeps clear at the start of the cuts between its parts for their numbers, in font sizes. */
const CUT_ROOM = 1.5
const spare = (u: Run, font: number) => {
  const room = u.parts.length > 1 ? CUT_ROOM * font : 0
  return u.across ? { w: 0, h: room } : { w: room, h: 0 }
}

/** Where a run's label goes: all of the run but the room kept for the numbers of its cuts. */
export const labelRoom = (u: Run, font: number): Rect => {
  const s = spare(u, font)
  return { x: u.box.x + s.w, y: u.box.y + s.h, w: u.box.w - s.w, h: u.box.h - s.h }
}

/** Whether every part of a run holds its own label at this font size, as it may in a detail, which is wanted over one for the lot. */
export const eachHolds = (u: Run, parts: ({ name: string } & Rect)[], font: number, named = true) =>
  u.parts.every((i) => fit(partLabel(parts[i], named), parts[i], font))

/** The least enlargement at which a run holds its label. */
const enlargement = (u: Run, font: number) => {
  const s = spare(u, font)
  return Math.min(...settings(u.label, font).map((l) => Math.max((l.w + s.w) / u.box.w, (l.h + s.h) / u.box.h)))
}

export const clip = (a: Rect, b: Rect): Rect | null => {
  const [x, y] = [Math.max(a.x, b.x), Math.max(a.y, b.y)]
  const [w, h] = [Math.min(a.x + a.w, b.x + b.w) - x, Math.min(a.y + a.h, b.y + b.h) - y]
  return w > 0 && h > 0 ? { x, y, w, h } : null
}

const between = (v: number, min: number, max: number) => Math.min(Math.max(v, min), Math.max(min, max))

const EPS = 0.01
const holds = (outer: Rect, inner: Rect) =>
  inner.x >= outer.x - EPS &&
  inner.y >= outer.y - EPS &&
  inner.x + inner.w <= outer.x + outer.w + EPS &&
  inner.y + inner.h <= outer.y + outer.h + EPS

/** Every piece the cutting order makes on its way, from the whole sheet down. */
export function pieces(layout: Layout, kerf: number): Rect[] {
  const made: Rect[] = [{ x: 0, y: 0, w: layout.length, h: layout.width }]
  const same = (a: number, b: number) => Math.abs(a - b) < EPS
  // Runs saved before the cutting order existed have none.
  for (const c of layout.sequence ?? []) {
    // A cut runs from edge to edge of the piece it divides, which is the smallest it spans.
    const cut = made
      .filter((p) =>
        c.rip
          ? same(c.x1, p.x) && same(c.x2, p.x + p.w) && c.y1 > p.y && c.y1 < p.y + p.h
          : same(c.y1, p.y) && same(c.y2, p.y + p.h) && c.x1 > p.x && c.x1 < p.x + p.w,
      )
      .reduce<Rect | null>((least, p) => (least && least.w * least.h <= p.w * p.h ? least : p), null)
    if (!cut) continue
    made.push(
      c.rip
        ? { ...cut, h: c.y1 - kerf / 2 - cut.y }
        : { ...cut, w: c.x1 - kerf / 2 - cut.x },
      c.rip
        ? { ...cut, y: c.y1 + kerf / 2, h: cut.y + cut.h - c.y1 - kerf / 2 }
        : { ...cut, x: c.x1 + kerf / 2, w: cut.x + cut.w - c.x1 - kerf / 2 },
    )
  }
  return made
}

const near = (a: Rect, b: Rect, reach: number) =>
  a.x - reach < b.x + b.w && b.x - reach < a.x + a.w && a.y - reach < b.y + b.h && b.y - reach < a.y + a.h

/** Small parts that share one label: a part alone, or the same part repeated side by side or end to end. */
export interface Run {
  parts: number[]
  box: Rect
  label: string[]
  /** Whether its parts lie side by side, so that the cuts between them run up and down. */
  across: boolean
}

export interface Leader {
  text: string
  /** The placements the label names, and the point each of its lines starts from. */
  parts: number[]
  points: Point[]
  /** The line the label sits on, with the span of its rule. */
  y: number
  from: number
  to: number
  textX: number
  anchor: 'start' | 'end'
}

export interface Point {
  x: number
  y: number
}

export interface Detail {
  letter: string
  parts: number[]
  /** What the detail is of: a piece the cutting order makes, or else just the parts. */
  piece: Rect
  /** The part of the sheet that is enlarged: the piece and a margin round it. */
  region: Rect
  /** Where the enlargement is drawn, below the sheet. */
  frame: Rect
  /** Sheet millimetres per pixel inside the frame. */
  px: number
  title: string
  /** The box the title sits in, on the frame's top edge. */
  tab: Rect
  /** The line from the region to the frame, in upright and level stretches. */
  arm: Point[]
}

export interface Labels {
  /** Placements too small to hold their label where they lie on the sheet. */
  small: Set<number>
  /** Runs of the same small part, each labelled once across all of it wherever that fits. */
  runs: Run[]
  leaders: Leader[]
  details: Detail[]
  /** Room needed above and below the sheet. */
  gutter: { top: number; bottom: number }
}

/**
 * Decides how each part of a layout gets its label when text is `text` pixels high and the sheet is
 * drawn at `px` millimetres to the pixel. A part that cannot hold its label gets a leader to the
 * margin, and a crowd of them gets a detail. Labels leave out the name unless `named`.
 */
export function planLabels(layout: Layout, px: number, text: number, kerf: number, named = true): Labels {
  const font = text * px
  const parts = layout.placements
  const small = parts.flatMap((p, i) => (fit(partLabel(p, named), p, font) ? [] : [i]))

  // Small parts are labelled in units: one alone, or a run of the same part side by side or end to
  // end, which takes one label for the lot.
  const follows = (a: number, b: number, across: boolean) => {
    const [p, q] = [parts[a], parts[b]]
    const same = (m: number, n: number) => Math.abs(m - n) < 0.05
    return (
      p.partId === q.partId &&
      same(p.w, q.w) &&
      same(p.h, q.h) &&
      (across ? same(p.y, q.y) && same(q.x, p.x + p.w + kerf) : same(p.x, q.x) && same(q.y, p.y + p.h + kerf))
    )
  }
  const free = new Set(small)
  const units: Run[] = []
  for (const i of [...small].sort((a, b) => parts[a].y - parts[b].y || parts[a].x - parts[b].x)) {
    if (!free.has(i)) continue
    const run = [true, false]
      .map((across) => {
        const found = [i]
        for (let next; (next = [...free].find((j) => follows(found[found.length - 1], j, across))) !== undefined; ) found.push(next)
        return found
      })
      .reduce((longest, found) => (found.length > longest.length ? found : longest))
    run.forEach((n) => free.delete(n))
    const [first, last] = [parts[run[0]], parts[run[run.length - 1]]]
    units.push({
      parts: run,
      box: { x: first.x, y: first.y, w: last.x + last.w - first.x, h: last.y + last.h - first.y },
      label: run.length > 1 ? countLabel(run.length, first, named) : partLabel(first, named),
      across: last.x > first.x,
    })
  }
  const runs = units.filter((u) => u.parts.length > 1)
  // A run may hold across all of it the label that none of its parts can; the rest need help.
  const loose = units.filter((u) => !fit(u.label, labelRoom(u, font), font))

  const made = pieces(layout, kerf)
  /** The detail that would show these units, if it is small enough to use and clear of the `others`. */
  const crowd = (wanted: Run[], others: Rect[]) => {
    const boxes = wanted.map((u) => u.box)
    const [x, y] = [Math.min(...boxes.map((b) => b.x)), Math.min(...boxes.map((b) => b.y))]
    const span = { x, y, w: Math.max(...boxes.map((b) => b.x + b.w)) - x, h: Math.max(...boxes.map((b) => b.y + b.h)) - y }
    // The whole piece they are cut from once the cuts before it are made, which reads as a small
    // sheet of its own. Where that is too big to enlarge, just the parts themselves.
    const piece = made.filter((p) => holds(p, span)).reduce((least, p) => (p.w * p.h < least.w * least.h ? p : least))
    // A piece much bigger than what it is wanted for would be a detail of mostly something else.
    const roomy = piece.w * piece.h > PIECE_SPARE * span.w * span.h
    for (const box of roomy ? [span] : [piece, span]) {
      if (others.some((o) => clip(box, o))) continue
      const members = loose.filter((u) => holds(box, u.box))
      // Enough for every label, and for each part to be wide enough to number the cuts either
      // side of it. A little over, so that no label is a hair from not fitting.
      const narrowest = Math.min(...members.flatMap((u) => u.parts.map((i) => Math.min(parts[i].w, parts[i].h))))
      const zoom = Math.max((PART_WIDTH * font) / narrowest, ...members.map((u) => enlargement(u, font))) * 1.1
      // The margin runs past the edge of the sheet too, so that the edge shows as one.
      const pad = kerf / 2 + (font * 0.75) / zoom
      const region = { x: box.x - pad, y: box.y - pad, w: box.w + pad * 2, h: box.h + pad * 2 }
      if (region.w * zoom <= layout.length && region.h * zoom <= DETAIL_HEIGHT * font) return { members, region, piece: box, zoom }
    }
    return null
  }
  // Each unit joins the first crowd beside it that stays usable with it in, so a stretch of them
  // too long for one detail is shared between several. A unit too long for any is left out.
  const crowds: NonNullable<ReturnType<typeof crowd>>[] = []
  for (const u of [...loose].sort((a, b) => a.box.x - b.box.x || a.box.y - b.box.y)) {
    if (crowds.some((c) => c.members.includes(u))) continue
    const taken = (but?: (typeof crowds)[number]) => crowds.filter((c) => c !== but).map((c) => c.piece)
    const grown = crowds
      .filter((c) => c.members.some((m) => near(m.box, u.box, font)))
      .map((c) => ({ c, with: crowd([...c.members, u], taken(c)) }))
      .find((g) => g.with)
    if (grown) crowds[crowds.indexOf(grown.c)] = grown.with!
    else {
      const alone = crowd([u], taken())
      if (alone) crowds.push(alone)
    }
  }
  const count = (c: (typeof crowds)[number]) => c.members.reduce((n, u) => n + u.parts.length, 0)
  const shown = crowds.filter((c) => count(c) >= DETAIL_PARTS)
  // Two details side by side each give up the margin between them, so that neither shows the other's parts.
  for (const a of shown)
    for (const b of shown) {
      if (a === b || !clip(a.region, b.region)) continue
      if (a.piece.x + a.piece.w <= b.piece.x) {
        const mid = (a.piece.x + a.piece.w + b.piece.x) / 2
        a.region = { ...a.region, w: mid - a.region.x }
        b.region = { ...b.region, x: mid, w: b.region.x + b.region.w - mid }
      } else if (a.piece.y + a.piece.h <= b.piece.y) {
        const mid = (a.piece.y + a.piece.h + b.piece.y) / 2
        a.region = { ...a.region, h: mid - a.region.y }
        b.region = { ...b.region, y: mid, h: b.region.y + b.region.h - mid }
      }
    }
  const detailed = new Set(shown.flatMap((c) => c.members))

  // Far enough from the sheet that a leader's rule is not taken for another edge.
  const [rowH, gap] = [font * 1.5, font * 1.25]
  const rows = { top: [] as Leader[], bottom: [] as Leader[] }
  for (const u of loose) {
    if (detailed.has(u)) continue
    const b = u.box
    const edge = b.y < layout.width - (b.y + b.h) ? 'top' : 'bottom'
    const text = u.label.join(' ')
    let leader = rows[edge].find((l) => l.text === text)
    if (!leader) rows[edge].push((leader = { text, parts: [], points: [], y: 0, from: 0, to: 0, textX: 0, anchor: 'start' }))
    const inset = Math.min(b.h / 2, font * 0.6)
    leader.parts.push(...u.parts)
    leader.points.push({ x: b.x + b.w / 2, y: edge === 'top' ? b.y + inset : b.y + b.h - inset })
  }
  const leaders: Leader[] = []
  const placed = { top: 0, bottom: 0 }
  for (const edge of ['top', 'bottom'] as const) {
    const waiting = rows[edge]
    // Rows fill from the sheet outwards. The lines of every leader still waiting pass through the
    // row being filled, so it goes to the label that sits clear of them, on whichever side does.
    for (let r = 0; waiting.length; r++) {
      const { l, right, lo, hi } = waiting
        .flatMap((l) => {
          const xs = l.points.map((m) => m.x)
          const [lo, hi] = [Math.min(...xs), Math.max(...xs)]
          const wide = (l.text.length * CHAR + 1) * font
          const lines = waiting.filter((o) => o !== l).flatMap((o) => o.points.map((m) => m.x))
          return [true, false].map((right) => {
            const [from, to] = right ? [hi, hi + wide] : [lo - wide, lo]
            const struck = lines.some((x) => x > from && x < to)
            const off = from < 0 || to > layout.length
            return { l, right, lo, hi, cost: +struck * 1000 + +off * 100 + lines.filter((x) => x > lo && x < hi).length }
          })
        })
        .reduce((best, option) => (option.cost < best.cost ? option : best))
      waiting.splice(waiting.indexOf(l), 1)
      placed[edge]++
      l.y = edge === 'top' ? -(gap + (r + 0.5) * rowH) : layout.width + gap + (r + 0.5) * rowH
      l.from = right ? lo : lo - font * 0.4
      l.to = right ? hi + font * 0.4 : hi
      l.textX = right ? hi + font * 0.7 : lo - font * 0.7
      l.anchor = right ? 'start' : 'end'
      leaders.push(l)
    }
  }
  const under = (edge: 'top' | 'bottom') => (placed[edge] ? gap + placed[edge] * rowH : 0)

  // Details go in rows below the leaders, each as near under its region as the others allow.
  // The gap above each row leaves room for arms to run along it.
  const lane = font * 1.5
  const place = (order: typeof shown) => {
    let [top, across, tallest] = [layout.width + under('bottom') + lane, 0, 0]
    const details = order.map(({ members, region, piece, zoom }, n): Detail => {
    const [w, h] = [region.w * zoom, region.h * zoom]
    const letter = String.fromCharCode(65 + n)
    const title = `Detail ${letter} ×${mm(zoom)}`
    const tab = (title.length * CHAR + 1) * font
    // A narrow detail still takes the room its title needs.
    const wide = Math.max(w, tab)
    if (layout.length - wide < across) [top, across, tallest] = [top + tallest + lane, 0, 0]
    const [x, y] = [between(region.x + region.w / 2 - w / 2, across, layout.length - wide), top + rowH]
    across = x + wide + font
    tallest = Math.max(tallest, rowH + h)
    return {
      letter,
      parts: members.flatMap((u) => u.parts),
      piece,
      region,
      frame: { x, y, w, h },
      px: px / zoom,
      title,
      tab: { x, y: y - rowH, w: tab, h: rowH },
      arm: [],
    }
  })
    return { details, bottom: details.length ? top + tallest + gap - layout.width : under('bottom') }
  }

  // What an arm should not run over: every label and leader, then the other details and arms.
  const thick = font * 0.3
  const leg = (a: Point, b: Point): Rect => ({
    x: Math.min(a.x, b.x) - thick / 2,
    y: Math.min(a.y, b.y) - thick / 2,
    w: Math.abs(b.x - a.x) + thick,
    h: Math.abs(b.y - a.y) + thick,
  })
  const legs = (route: Point[]) => route.slice(1).map((p, i) => leg(route[i], p))
  const held = (wanted: string[], r: Rect): Rect[] => {
    const s = fit(wanted, r, font)
    return s ? [{ x: r.x + (r.w - s.w) / 2, y: r.y + (r.h - s.h) / 2, w: s.w, h: s.h }] : []
  }
  const solid: Rect[] = [
    ...parts.flatMap((p) => held(partLabel(p, named), p)),
    ...layout.offcuts.flatMap((o) => held([dims(o)], o)),
    ...runs.flatMap((u) => held(u.label, labelRoom(u, font))),
    ...leaders.flatMap((l) => {
      const wide = l.text.length * CHAR * font
      return [
        { x: l.anchor === 'start' ? l.textX : l.textX - wide, y: l.y - font * 0.6, w: wide, h: font * 1.2 },
        ...l.points.map((m) => leg(m, { x: m.x, y: l.y })),
        leg({ x: l.from, y: l.y }, { x: l.to, y: l.y }),
      ]
    }),
  ]
  // The edges an arm would be mistaken for if it ran along them.
  const shapes = [...parts, ...layout.offcuts]
  const beside = font * 0.4
  const upright = shapes.flatMap((r) => [r.x, r.x + r.w].map((x) => ({ x: x - beside, y: r.y, w: beside * 2, h: r.h })))
  const level = shapes.flatMap((r) => [r.y, r.y + r.h].map((y) => ({ x: r.x, y: y - beside, w: r.w, h: beside * 2 })))

  /** The details set out in this order from the left, with their arms and what the arms cost. */
  const arrange = (order: typeof shown) => {
    const { details, bottom } = place(order)
    const drawn = [...solid]
    let cost = 0
    for (const d of details) {
      const arm = routeArm({
        length: layout.length,
        depth: layout.width + bottom,
        step: font * 0.5,
        from: d.region,
        // It arrives on top of the title's tab, or of the frame beside it.
        onto: (x) =>
          x < d.frame.x || x > d.frame.x + Math.max(d.frame.w, d.tab.w) ? null : x < d.tab.x + d.tab.w ? d.tab.y : d.frame.y,
        blocked: [...drawn, d.frame, d.tab, ...details.filter((o) => o !== d).flatMap((o) => [o.region, o.frame, o.tab])],
        filled: parts.filter((_, i) => !small.includes(i)),
        upright,
        level,
      })
      d.arm = arm.path
      cost += arm.cost
      drawn.push(...legs(d.arm))
    }
    return { details, bottom, cost }
  }
  // Regions one above another can take their details in either order; whichever keeps the arms
  // clearer of each other wins.
  const column = (c: (typeof shown)[number]) => Math.round(c.region.x / (font * 4))
  const { details, bottom } = (shown.length > 1 ? [1, -1] : [1])
    .map((lower) => arrange([...shown].sort((a, b) => column(a) - column(b) || lower * (b.region.y - a.region.y))))
    .reduce((best, option) => (option.cost < best.cost ? option : best))

  return { small: new Set(small), runs, leaders, details, gutter: { top: under('top'), bottom } }
}

/** What a step of an arm costs beyond its length: over something drawn, along an edge, across one, round a corner. */
const OVER = 200
const ALONG = 5
const ACROSS = 4
const TURN = 8
/** And over a part with a fill, where blank offcut or margin would show it better. */
const FILLED = 2
/** Down, right, up and left. */
const WAYS = [
  [0, 1],
  [1, 0],
  [0, -1],
  [-1, 0],
]

/**
 * The clearest way from the edge of `from` down onto a detail, in upright and level stretches: the
 * cheapest path over a grid of `step`, where `onto` gives the height to land at for an `x`.
 */
function routeArm(o: {
  length: number
  depth: number
  step: number
  from: Rect
  onto: (x: number) => number | null
  blocked: Rect[]
  filled: Rect[]
  upright: Rect[]
  level: Rect[]
}): { path: Point[]; cost: number } {
  const { step, from } = o
  const [cols, rows] = [Math.floor(o.length / step) + 1, Math.floor(o.depth / step) + 1]
  const [over, upright, level] = [new Uint8Array(cols * rows), new Uint8Array(cols * rows), new Uint8Array(cols * rows)]
  // Anything within half a step of a grid point counts, so that nothing thin slips between them.
  const paint = (r: Rect, cells: Uint8Array) => {
    const [c0, c1] = [Math.max(0, Math.ceil(r.x / step - 0.5)), Math.min(cols - 1, Math.floor((r.x + r.w) / step + 0.5))]
    const [r0, r1] = [Math.max(0, Math.ceil(r.y / step - 0.5)), Math.min(rows - 1, Math.floor((r.y + r.h) / step + 0.5))]
    for (let row = r0; row <= r1; row++) cells.fill(1, row * cols + c0, row * cols + c1 + 1)
  }
  for (const b of [...o.blocked, from]) paint(b, over)
  const filled = new Uint8Array(cols * rows)
  for (const f of o.filled) paint(f, filled)
  for (const u of o.upright) paint(u, upright)
  for (const l of o.level) paint(l, level)
  // How many edges lie between each grid point and the next one right of it, and below it.
  const [rightward, downward] = [new Uint8Array(cols * rows), new Uint8Array(cols * rows)]
  const span = (lo: number, size: number, count: number) => [Math.max(0, Math.ceil(lo / step)), Math.min(count - 1, Math.floor((lo + size) / step))]
  for (const u of o.upright) {
    const col = Math.floor((u.x + u.w / 2) / step)
    const [r0, r1] = span(u.y, u.h, rows)
    if (col >= 0 && col < cols) for (let row = r0; row <= r1; row++) rightward[row * cols + col]++
  }
  for (const l of o.level) {
    const row = Math.floor((l.y + l.h / 2) / step)
    const [c0, c1] = span(l.x, l.w, cols)
    if (row >= 0 && row < rows) for (let col = c0; col <= c1; col++) downward[row * cols + col]++
  }

  const cost = new Float64Array(cols * rows * 4).fill(Infinity)
  const before = new Int32Array(cols * rows * 4).fill(-1)
  const heap: [number, number][] = []
  const push = (at: number, state: number) => {
    let i = heap.push([at, state]) - 1
    for (let up = (i - 1) >> 1; i > 0 && heap[up][0] > at; i = up, up = (i - 1) >> 1) [heap[i], heap[up]] = [heap[up], heap[i]]
  }
  const pop = () => {
    const first = heap[0]
    const last = heap.pop()!
    if (heap.length) {
      heap[0] = last
      for (let i = 0; ; ) {
        const [l, r] = [i * 2 + 1, i * 2 + 2]
        let least = i
        if (l < heap.length && heap[l][0] < heap[least][0]) least = l
        if (r < heap.length && heap[r][0] < heap[least][0]) least = r
        if (least === i) break
        ;[heap[i], heap[least]] = [heap[least], heap[i]]
        i = least
      }
    }
    return first
  }

  // An arm sets out square to the edge of the region it leaves.
  const inside = (lo: number, size: number, count: number) => {
    const found = Array.from({ length: count }, (_, i) => i).filter((i) => i * step > lo && i * step < lo + size)
    return found.length ? found : [Math.min(count - 1, Math.round((lo + size / 2) / step))]
  }
  const begin = (col: number, row: number, way: number) => {
    if (col < 0 || col >= cols || row < 0 || row >= rows) return
    const state = (row * cols + col) * 4 + way
    cost[state] = over[row * cols + col] * OVER
    push(cost[state], state)
  }
  for (const col of inside(from.x, from.w, cols)) {
    begin(col, Math.floor((from.y + from.h) / step) + 1, 0)
    begin(col, Math.ceil(from.y / step) - 1, 2)
  }
  for (const row of inside(from.y, from.h, rows)) {
    begin(Math.floor((from.x + from.w) / step) + 1, row, 1)
    begin(Math.ceil(from.x / step) - 1, row, 3)
  }

  while (heap.length) {
    const [at, state] = pop()
    if (at > cost[state]) continue
    const [cell, way] = [state >> 2, state & 3]
    const [col, row] = [cell % cols, Math.floor(cell / cols)]
    const land = way === 0 ? o.onto(col * step) : null
    if (land !== null && row * step < land && (row + 1) * step >= land) {
      const path: number[] = []
      for (let s = state; s >= 0; s = before[s]) path.unshift(s)
      const spot = (s: number) => ({ x: ((s >> 2) % cols) * step, y: Math.floor((s >> 2) / cols) * step })
      const first = spot(path[0])
      const start = [
        { x: first.x, y: from.y + from.h },
        { x: from.x + from.w, y: first.y },
        { x: first.x, y: from.y },
        { x: from.x, y: first.y },
      ][path[0] & 3]
      const corners = path.slice(1).flatMap((s, i) => ((s & 3) === (path[i] & 3) ? [] : [spot(path[i])]))
      return { path: [start, ...corners, { x: col * step, y: land }], cost: at }
    }
    WAYS.forEach(([dx, dy], next) => {
      const [c, r] = [col + dx, row + dy]
      if (next === (way + 2) % 4 || c < 0 || c >= cols || r < 0 || r >= rows) return
      const to = r * cols + c
      const edges = [downward[cell], rightward[cell], downward[to], rightward[to]][next]
      const reached =
        at + 1 + (next === way ? 0 : TURN) + over[to] * OVER + (next % 2 ? level : upright)[to] * ALONG + edges * ACROSS + filled[to] * FILLED
      if (reached >= cost[to * 4 + next]) return
      cost[to * 4 + next] = reached
      before[to * 4 + next] = state
      push(reached, to * 4 + next)
    })
  }
  // Nothing to land on, which a detail's own frame rules out.
  const middle = from.x + from.w / 2
  return { path: [{ x: middle, y: from.y + from.h }, { x: middle, y: o.depth }], cost: Infinity }
}
