/** The title's easter egg: waves of highlight that sweep every character and field on the page. */

type Unit = { x: number; y: number; shuffled: number; range?: Range; field?: HTMLElement }
type Wave = { start: number; order: (unit: Unit) => number }

const NAME = 'flourish'
const WAVES = 4
/** Milliseconds between waves, for a wave to cross the page, and for a unit to stay lit. */
const GAP = 350
const CROSSING = 900
const HOLD = 280

/** Ways for a wave to cross the page: each places a unit between 0, lit first, and 1, lit last. */
const ORDERS: Wave['order'][] = [
  (unit) => unit.x,
  (unit) => 1 - unit.x,
  (unit) => unit.y,
  (unit) => 1 - unit.y,
  (unit) => (unit.x + unit.y) / 2,
  (unit) => (1 - unit.x + unit.y) / 2,
  // Rippling out from the title.
  (unit) => Math.hypot(unit.x - 0.5, unit.y) / Math.hypot(0.5, 1),
  (unit) => unit.shuffled,
]

let waves: Wave[] = []
let units: Unit[] = []

function collect(): Unit[] {
  const found: Unit[] = []
  const onScreen = (rect: DOMRect) => rect.width > 0 && rect.bottom > 0 && rect.top < innerHeight
  const place = (rect: DOMRect) => ({
    x: (rect.left + rect.width / 2) / innerWidth,
    y: (rect.top + rect.height / 2) / innerHeight,
    shuffled: Math.random(),
  })
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) {
    const text = walker.currentNode as Text
    // The title runs its own flourish.
    if (!text.data.trim() || text.parentElement?.closest('h1')) continue
    const whole = new Range()
    whole.selectNodeContents(text)
    if (!onScreen(whole.getBoundingClientRect())) continue
    for (let i = 0; i < text.length; i++) {
      if (!text.data[i].trim()) continue
      const range = new Range()
      range.setStart(text, i)
      range.setEnd(text, i + 1)
      found.push({ ...place(range.getBoundingClientRect()), range })
    }
  }
  // What a field holds is not text on the page, so a field lights as a whole.
  for (const field of document.querySelectorAll<HTMLElement>('input, select, textarea')) {
    const rect = field.getBoundingClientRect()
    if (onScreen(rect)) found.push({ ...place(rect), field })
  }
  return found
}

function tick(now: number) {
  waves = waves.filter((wave) => now < wave.start + CROSSING + HOLD)
  const highlight = new Highlight()
  for (const unit of units) {
    const over = waves.filter((wave) => {
      const since = now - wave.start - wave.order(unit) * CROSSING
      return since >= 0 && since < HOLD
    })
    // Waves that overlap cancel out, as the flourishes on the title do.
    const lit = over.length % 2 === 1
    if (unit.field) unit.field.toggleAttribute('data-lit', lit)
    else if (lit) highlight.add(unit.range!)
  }
  CSS.highlights.set(NAME, highlight)
  if (waves.length) return requestAnimationFrame(tick)
  CSS.highlights.delete(NAME)
  units = []
}

export function flourishPage() {
  if (!('highlights' in CSS) || matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const running = waves.length > 0
  const now = performance.now()
  for (let i = 0; i < WAVES; i++) {
    waves.push({ start: now + i * GAP, order: ORDERS[Math.floor(Math.random() * ORDERS.length)] })
  }
  if (running) return
  units = collect()
  requestAnimationFrame(tick)
}
