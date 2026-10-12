import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'
import { clip, countLabel, dims, eachHolds, fit, labelRoom, mm, partLabel, planLabels, type Detail } from './labels'
import {
  EFFORTS,
  optimise,
  type Cut,
  type Job,
  type Layout,
  type Part,
  type Placement,
  type Rect,
  type SearchStats,
  type Solution,
  type StockSheet,
} from './optimiser'
import { flourishPage } from './flourish'
import { Icon } from './Icon'
import { asksToCalculate, enterTo, neighbour, stepTo } from './keys'
import type { SearchRequest, Update } from './search.worker'
import {
  FILLS,
  jobFromHash,
  jobToHash,
  load,
  MAX_RUNS,
  newId,
  sampleJob,
  save,
  type PartFill,
  type Run,
  type Saved,
  type Theme,
} from './storage'

const count = (n: number) => n.toLocaleString('en-GB')
const duration = (ms: number) => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`)
const total = (items: { qty: number }[]) => items.reduce((n, i) => n + i.qty, 0)
/** Where the pointer is on a sheet drawing, in millimetres from its top left corner. */
let pointer: { x: number; y: number } | null = null
const watching = new Set<() => void>()
// Kept outside React state so that moving the pointer redraws the readout and not the drawings.
const setPointer = (to: typeof pointer) => {
  pointer = to
  watching.forEach((notify) => notify())
}
const watch = (notify: () => void) => {
  watching.add(notify)
  return () => void watching.delete(notify)
}

const DARK = matchMedia('(prefers-color-scheme: dark)')
const watchSystem = (notify: () => void) => {
  DARK.addEventListener('change', notify)
  return () => DARK.removeEventListener('change', notify)
}
/** The theme the system asks for, which the page follows unless the masthead's switch overrides it. */
const useSystemTheme = (): Theme => useSyncExternalStore(watchSystem, () => (DARK.matches ? 'dark' : 'light'))

/** Line colours for parts, chosen to stay distinct from one another, including for colour-blind readers. */
const INKS = ['#0072b2', '#d55e00', '#009e73', '#cc79a7', 'var(--ink)', '#56b4e9', '#e69f00', '#777']

const bird = (t: number, x: number, y: number) =>
  `M${t * x},${t * y} q${t * 0.1},${-t * 0.2} ${t * 0.25},${t * 0.02} q${t * 0.12},${-t * 0.22} ${t * 0.27},${-t * 0.04}`

/** Marks that tell parts apart without colour: a tile's side in units of t, then one tile drawn. */
const MOTIFS: [number, (t: number) => ReactNode][] = [
  [1, (t) => <path d={`M0,${t} L${t},0`} />],
  [
    1,
    (t) => (
      <>
        <circle className="solid" cx={t * 0.25} cy={t * 0.25} r={t * 0.06} />
        <circle className="solid" cx={t * 0.75} cy={t * 0.75} r={t * 0.06} />
      </>
    ),
  ],
  [1.5, (t) => <path d={bird(t, 0.1, 0.4) + bird(t, 0.85, 1.15)} />],
  [1, (t) => <path d={`M0,${t / 2} q${t / 4},${-t * 0.35} ${t / 2},0 t${t / 2},0`} />],
  [1, (t) => <circle cx={t / 2} cy={t / 2} r={t * 0.27} />],
  [
    1,
    (t) => (
      <path
        d={[0.25, 0.75]
          .map((c) => `M${t * (c - 0.13)},${t * c} h${t * 0.26} M${t * c},${t * (c - 0.13)} v${t * 0.26}`)
          .join(' ')}
      />
    ),
  ],
  [1, (t) => <path d={`M${t / 2},0 V${t}`} />],
  [1, (t) => <path d={`M${t * 0.3},${t * 0.68} L${t * 0.5},${t * 0.32} L${t * 0.7},${t * 0.68} Z`} />],
  [
    1,
    (t) => (
      <path d={`M${t * 0.1},${t * 0.25} h${t * 0.45} M${t * 0.6},${t * 0.75} h${t * 0.45} M${-t * 0.4},${t * 0.75} h${t * 0.45}`} />
    ),
  ],
  [1, (t) => <path d={`M${t * 0.5},${t * 0.22} L${t * 0.78},${t * 0.5} L${t * 0.5},${t * 0.78} L${t * 0.22},${t * 0.5} Z`} />],
]

/** How long the inputs must rest before the URL is rewritten, in milliseconds. */
const URL_DELAY = 300

interface Searching {
  stats: SearchStats
  best: Solution | null
  ms: number
}
const time = (at: number) =>
  new Date(at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

const sameJob = (a: Job, b: Job) => JSON.stringify(a) === JSON.stringify(b)

function largestOffcut(s: Solution): string {
  const [largest] = s.layouts.flatMap((l) => l.offcuts).sort((a, b) => b.w * b.h - a.w * a.h)
  return largest ? `${largest.w.toFixed(0)} × ${largest.h.toFixed(0)} offcut` : 'no offcut'
}

/** The figures a candidate is chosen on, as one line. */
const figures = (s: Solution) =>
  `${s.stats.sheets} ${s.stats.sheets === 1 ? 'sheet' : 'sheets'}, ${s.stats.wastePct.toFixed(1)}% waste` +
  (s.stats.stacked ? `, ⚠ ${s.stats.stacked} stacked` : '')
const moves = (s: Solution) =>
  `${s.stats.cuts} cuts` + (s.stats.fenceMoves === undefined ? '' : `, ${s.stats.fenceMoves} fence moves`)
const short = (s: Solution) => s.unplaced.map((u) => `${u.qty} × ${u.name}`).join(', ')

/** What a finished search is announced as to a screen reader. */
function announce(solutions: Solution[], stats: SearchStats): string {
  const [best] = solutions
  if (!best) return 'Search finished: no candidates.'
  return (
    `Search finished: ${solutions.length} ${solutions.length === 1 ? 'candidate' : 'candidates'}. Best: ${figures(best)}.` +
    (stats.tried < stats.total ? ' Stopped early.' : '') +
    (best.unplaced.length ? ` Not enough stock for: ${short(best)}.` : '')
  )
}

/** What a row is called aloud: its name, or its place in the table when it has none. */
const called = (name: string, kind: string, i: number) => name.trim() || `${kind} ${i + 1}`

const MAC = /Mac|iPhone|iPad/.test(navigator.platform)

/** The keys that calculate, as this platform writes them. */
const CalculateKeys = () =>
  MAC ? (
    <>
      <span className="cmd">⌘</span> Enter
    </>
  ) : (
    'Ctrl+Enter'
  )

const cell = (row: string, col: string) => `[data-row="${row}"] [data-col="${col}"]`

function focusOn(selector: string, select = false) {
  const control = document.querySelector<HTMLElement>(selector)
  control?.focus()
  if (select && control instanceof HTMLInputElement) control.select()
}

const solved = new Map<string, Solution[]>()

/** Runs normally carry their solutions; one saved without them is worked out again once per visit. */
function solve(run: Run): Solution[] {
  if (run.solutions) return run.solutions
  if (!solved.has(run.id)) solved.set(run.id, optimise(run.job))
  return solved.get(run.id)!
}

function initial(): Saved {
  const saved = load()
  // A link to the job already open is a reload, not an incoming share.
  const shared = location.hash === jobToHash(saved.job) ? null : jobFromHash(location.hash)
  return shared ? { ...saved, job: shared, activeRun: null } : saved
}

export function App() {
  const [state, setState] = useState(initial)
  const [copied, setCopied] = useState(false)
  const [searching, setSearching] = useState<Searching | null>(null)
  const [cleared, setCleared] = useState<{ stock?: StockSheet[]; parts?: Part[] }>({})
  const worker = useRef<Worker | null>(null)
  const { job, runs } = state
  const effort = Math.min(state.effort ?? 0, EFFORTS.length - 1)
  const showCuts = state.showCuts ?? false
  const partFill = state.partFill ?? 'mono'
  const showNames = state.showNames ?? false
  const system = useSystemTheme()
  const theme = state.theme ?? system
  useLayoutEffect(() => {
    if (state.theme) document.documentElement.dataset.theme = state.theme
    else delete document.documentElement.dataset.theme
  }, [state.theme])
  // An override that comes round to the system's choice is dropped, so the page follows it again.
  const switchTheme = () =>
    setState((s) => {
      const next = (s.theme ?? system) === 'dark' ? 'light' : 'dark'
      return { ...s, theme: next === system ? undefined : next }
    })
  /** The field a new row is entered from. */
  const firstCol = showNames ? 'name' : 'length'
  const [status, setStatus] = useState('')
  /** A control to focus once the next render has drawn it; `lost` only if focus went with a removed control. */
  const wanted = useRef<{ selector: string; select?: boolean; lost?: boolean } | null>(null)
  // A layout effect, because a passive one left over from the render before would run too early.
  useLayoutEffect(() => {
    const want = wanted.current
    wanted.current = null
    if (want && (!want.lost || document.activeElement === document.body)) focusOn(want.selector, want.select)
  })

  useEffect(() => save(state), [state])
  // Keeps the address bar a link to the job as it stands. Debounced because browsers limit how
  // often the URL may be rewritten.
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        history.replaceState(null, '', jobToHash(job))
      } catch {
        // A refused rewrite leaves the previous link in place.
      }
    }, URL_DELAY)
    return () => clearTimeout(timer)
  }, [job])
  useEffect(() => () => worker.current?.terminate(), [])

  const run = runs.find((r) => r.id === state.activeRun) ?? null
  const solutions = useMemo(() => (run ? solve(run) : []), [run?.id, run?.solutions])
  const solution = solutions[Math.min(run?.pick ?? 0, solutions.length - 1)] as Solution | undefined
  const stale = run !== null && !sameJob(run.job, job)
  /** Work mode needs a candidate to work from, and holds to it until it is left. */
  const working = (state.working ?? false) && solution !== undefined
  const setWorking = (on: boolean) => setState((s) => ({ ...s, working: on }))

  const setJob = (patch: Partial<Job>) => setState((s) => ({ ...s, job: { ...s.job, ...patch } }))

  const setPart = (id: string, patch: Partial<Part>) =>
    setJob({ parts: job.parts.map((p) => (p.id === id ? { ...p, ...patch } : p)) })
  const setStock = (id: string, patch: Partial<StockSheet>) =>
    setJob({ stock: job.stock.map((s) => (s.id === id ? { ...s, ...patch } : s)) })

  const addStock = () => {
    const id = newId()
    setJob({ stock: [...job.stock, { id, name: 'Sheet', length: 2440, width: 1220, qty: 1 }] })
    wanted.current = { selector: cell(id, firstCol), select: true }
  }
  const addPart = () => {
    const id = newId()
    setJob({
      parts: [...job.parts, { id, name: `Part ${job.parts.length + 1}`, length: 0, width: 0, qty: 1, canRotate: true }],
    })
    wanted.current = { selector: cell(id, firstCol), select: true }
  }
  const removeRow = (list: 'stock' | 'parts', id: string) => {
    const next = neighbour(
      job[list].map((r) => r.id),
      id,
    )
    wanted.current = { selector: next ? cell(next, 'remove') : `[data-add="${list}"]` }
    setJob(
      list === 'stock'
        ? { stock: job.stock.filter((s) => s.id !== id) }
        : { parts: job.parts.filter((p) => p.id !== id) },
    )
  }
  /** Enter in a table's field moves down its column, and adds a row from the last one. */
  const onEnter = (list: 'stock' | 'parts') => (e: ReactKeyboardEvent) => {
    const field = e.target as HTMLElement
    const col = field.dataset.col
    const row = field.closest<HTMLElement>('[data-row]')?.dataset.row
    if (!col || col === 'remove' || !row) return
    const ids = job[list].map((r) => r.id)
    const to = enterTo(e.nativeEvent, ids.indexOf(row), ids.length)
    if (to === null) return
    e.preventDefault()
    if (to === 'add') (list === 'stock' ? addStock : addPart)()
    else focusOn(cell(ids[to], col), true)
  }
  const clear = (list: 'stock' | 'parts') => {
    setCleared((c) => ({ ...c, [list]: job[list] }))
    setJob({ [list]: [] })
  }
  // A cleared list can be brought back only until something else is put in it.
  useEffect(() => {
    setCleared((c) => ({
      stock: job.stock.length ? undefined : c.stock,
      parts: job.parts.length ? undefined : c.parts,
    }))
  }, [job.stock.length, job.parts.length])

  const calculate = () => {
    if (worker.current) return
    const searched = structuredClone(job)
    const started = performance.now()
    const w = new Worker(new URL('./search.worker.ts', import.meta.url), { type: 'module' })
    worker.current = w
    setSearching({ stats: { tried: 0, total: 0, improvements: 0, lastImprovedAt: 0 }, best: null, ms: 0 })
    setStatus('Searching')

    w.onmessage = ({ data }: MessageEvent<Update>) => {
      const ms = performance.now() - started
      if (data.type === 'progress') {
        setSearching({ stats: data.stats, best: data.solutions[0] ?? null, ms })
        return
      }
      w.terminate()
      worker.current = null
      setSearching(null)
      setStatus(announce(data.solutions, data.stats))
      // The buttons that stop or repeat a search can go when it ends, and focus must not go with them.
      if (document.activeElement?.matches('[data-search]')) wanted.current = { selector: '#calculate', lost: true }
      setState((s) => {
        const result = { at: Date.now(), effort, solutions: data.solutions, search: { ...data.stats, ms } }
        const latest = s.runs[0]
        // Repeating the latest run refreshes it rather than adding a duplicate to history.
        if (latest && latest.effort === effort && sameJob(latest.job, searched))
          return { ...s, runs: [{ ...latest, ...result }, ...s.runs.slice(1)], activeRun: latest.id }
        const next: Run = { id: newId(), job: searched, pick: 0, ...result }
        return { ...s, runs: [next, ...s.runs].slice(0, MAX_RUNS), activeRun: next.id }
      })
    }
    w.postMessage({ type: 'start', job: searched, effort } satisfies SearchRequest)
  }

  const stop = () => worker.current?.postMessage({ type: 'stop' } satisfies SearchRequest)

  // Ctrl or Cmd with Enter calculates from anywhere, fields included.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!asksToCalculate(e) || working) return
      e.preventDefault()
      calculate()
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  })

  const pick = (index: number) =>
    setState((s) => ({ ...s, runs: s.runs.map((r) => (r.id === s.activeRun ? { ...r, pick: index } : r)) }))
  /** Home and End choose the first and last candidate; the arrows are the radio group's own. */
  const onCandidateKey = (e: ReactKeyboardEvent<HTMLElement>) => {
    const to = e.key === 'Home' || e.key === 'End' ? stepTo(e.key, 0, solutions.length) : null
    if (to === null) return
    e.preventDefault()
    pick(to)
    e.currentTarget.querySelectorAll('input')[to]?.focus()
  }
  const chosen = solution ? solutions.indexOf(solution) : 0
  /** Moves to the next or previous candidate, going round at the ends. */
  const step = (by: number) => pick((chosen + by + solutions.length) % solutions.length)
  // The arrow keys step through the candidates from anywhere, unless a field is using them. Inside
  // the radio group they are the group's own.
  useEffect(() => {
    if (solutions.length < 2 || working) return
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
      if (document.querySelector('dialog[open]')) return
      if (e.target instanceof Element && e.target.closest('input, select, textarea, [contenteditable]')) return
      if (e.key === 'ArrowLeft') step(-1)
      if (e.key === 'ArrowRight') step(1)
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [chosen, solutions.length, working])

  const doneKey = (sheet: number, part: number) => `${chosen}/${sheet}/${part}`
  const done = new Set(run?.done)
  const markDone = (sheet: number, part: number) => {
    const key = doneKey(sheet, part)
    setState((s) => ({
      ...s,
      runs: s.runs.map((r) =>
        r.id === s.activeRun
          ? { ...r, done: r.done?.includes(key) ? r.done.filter((k) => k !== key) : [...(r.done ?? []), key] }
          : r,
      ),
    }))
  }
  const clearDone = () =>
    setState((s) => ({
      ...s,
      runs: s.runs.map((r) =>
        r.id === s.activeRun ? { ...r, done: r.done?.filter((k) => !k.startsWith(`${chosen}/`)) } : r,
      ),
    }))
  const workSwitch = (
    <button
      className="work-switch"
      aria-pressed={working}
      title={working ? 'Leave work mode' : 'Work mode: just the drawings, to mark parts off as they are cut'}
      onClick={() => setWorking(!working)}
    >
      <Icon name="blade" /> Work
    </button>
  )
  const placed = solution?.layouts.reduce((n, l) => n + l.placements.length, 0) ?? 0
  const cut = solution?.layouts.reduce((n, l, i) => n + l.placements.filter((_, j) => done.has(doneKey(i, j))).length, 0) ?? 0

  const removeRun = (id: string) => {
    const next = neighbour(
      runs.map((r) => r.id),
      id,
    )
    wanted.current = { selector: next ? `[data-run="${next}"] .ghost` : '#calculate' }
    setState((s) => {
      const left = s.runs.filter((r) => r.id !== id)
      return { ...s, runs: left, activeRun: s.activeRun === id ? (left[0]?.id ?? null) : s.activeRun }
    })
  }

  const copyLink = async () => {
    history.replaceState(null, '', jobToHash(job))
    await navigator.clipboard?.writeText(location.href).catch(() => {})
    setCopied(true)
    setStatus('Link copied')
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className={working ? 'app working' : 'app'}>
      {/* Not a link to #results, because the address's fragment holds the job. */}
      <button className="skip" onClick={() => focusOn('#results')}>
        Skip to results
      </button>
      <header className="bar masthead">
        <Pointer axis="x" />
        <Title />
        <span className="tools">
          <Pointer axis="y" />
          <button
            className="theme"
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            onClick={switchTheme}
          >
            <Icon name={theme === 'dark' ? 'switch-down' : 'switch-up'} />
          </button>
        </span>
      </header>

      <aside className="inputs" aria-label="Job" hidden={working}>
        <section>
          <h2 id="stock">Stock sheets</h2>
          <table className={showNames ? undefined : 'unnamed'} aria-labelledby="stock">
            <thead>
              <tr>
                {showNames && <th>Name</th>}
                <th>Length</th>
                <th>Width</th>
                <th>Qty</th>
                <th />
                <th />
              </tr>
            </thead>
            <tbody onKeyDown={onEnter('stock')}>
              {job.stock.map((s, i) => {
                const name = called(s.name, 'Stock sheet', i)
                return (
                  <tr key={s.id} data-row={s.id}>
                    {showNames && (
                      <td>
                        <input
                          data-col="name"
                          aria-label={`Stock sheet ${i + 1} name`}
                          value={s.name}
                          onChange={(e) => setStock(s.id, { name: e.target.value })}
                        />
                      </td>
                    )}
                    <Num col="length" label={`${name} length`} value={s.length} onChange={(length) => setStock(s.id, { length })} />
                    <Num col="width" label={`${name} width`} value={s.width} onChange={(width) => setStock(s.id, { width })} />
                    <Num col="qty" label={`${name} quantity`} value={s.qty} onChange={(qty) => setStock(s.id, { qty })} />
                    <td />
                    <td>
                      <button
                        className="ghost"
                        data-col="remove"
                        aria-label={`Remove ${name}`}
                        onClick={() => removeRow('stock', s.id)}
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="actions">
            <button data-add="stock" onClick={addStock}>
              <Icon name="plus" /> Stock sheet
            </button>
            <ClearOrUndo items={job.stock} held={cleared.stock} onClear={() => clear('stock')} onUndo={() => setJob({ stock: cleared.stock })} />
          </div>
        </section>

        <section>
          <h2 id="parts">Parts</h2>
          <table className={showNames ? undefined : 'unnamed'} aria-labelledby="parts">
            <thead>
              <tr>
                {showNames && <th>Name</th>}
                <th>Length</th>
                <th>Width</th>
                <th>Qty</th>
                <th title={ROTATE_HELP}>Rotate</th>
                <th />
              </tr>
            </thead>
            <tbody onKeyDown={onEnter('parts')}>
              {job.parts.map((p, i) => {
                const name = called(p.name, 'Part', i)
                return (
                  <tr key={p.id} data-row={p.id}>
                    {showNames && (
                      <td>
                        <input
                          data-col="name"
                          aria-label={`Part ${i + 1} name`}
                          value={p.name}
                          onChange={(e) => setPart(p.id, { name: e.target.value })}
                        />
                      </td>
                    )}
                    <Num col="length" label={`${name} length`} value={p.length} onChange={(length) => setPart(p.id, { length })} />
                    <Num col="width" label={`${name} width`} value={p.width} onChange={(width) => setPart(p.id, { width })} />
                    <Num col="qty" label={`${name} quantity`} value={p.qty} onChange={(qty) => setPart(p.id, { qty })} />
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`${name} can rotate`}
                        aria-describedby="rotate-help"
                        checked={p.canRotate}
                        onChange={(e) => setPart(p.id, { canRotate: e.target.checked })}
                      />
                    </td>
                    <td>
                      <button
                        className="ghost"
                        data-col="remove"
                        aria-label={`Remove ${name}`}
                        onClick={() => removeRow('parts', p.id)}
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p id="rotate-help" className="unseen">
            {ROTATE_HELP}
          </p>
          <div className="actions">
            <button data-add="parts" onClick={addPart}>
              <Icon name="plus" /> Part
            </button>
            <ClearOrUndo items={job.parts} held={cleared.parts} onClear={() => clear('parts')} onUndo={() => setJob({ parts: cleared.parts })} />
          </div>
        </section>

        <section className="row">
          <label>
            Kerf
            <input
              type="number"
              min="0"
              step="0.1"
              value={job.kerf}
              onChange={(e) => setJob({ kerf: e.target.valueAsNumber || 0 })}
            />
          </label>
          <label className="effort">
            <span>
              Effort <strong>{EFFORTS[effort].name}</strong>
            </span>
            <input
              type="range"
              min="0"
              max={EFFORTS.length - 1}
              step="1"
              value={effort}
              aria-valuetext={EFFORTS[effort].name}
              onChange={(e) => setState((s) => ({ ...s, effort: e.target.valueAsNumber }))}
            />
          </label>
          <div className="go">
            {/* Not disabled while searching, so that it keeps the focus it was pressed with. */}
            <button
              id="calculate"
              className="primary"
              onClick={calculate}
              aria-disabled={searching !== null}
              aria-keyshortcuts="Control+Enter Meta+Enter"
            >
              {searching ? 'Searching…' : 'Calculate'}
              {!searching && <span className="hint"><CalculateKeys /></span>}
            </button>
            {searching && (
              <button data-search onClick={stop}>
                Stop
              </button>
            )}
          </div>
        </section>

        <section className="extras">
        <details className="fold">
          <summary>
            <FoldMark /> Options
          </summary>
          <section className="checks">
          <label>
            <input
              type="checkbox"
              checked={showNames}
              onChange={(e) => setState((s) => ({ ...s, showNames: e.target.checked }))}
            />
            Name the stock sheets and parts
          </label>
          <label>
            <input
              type="checkbox"
              checked={showCuts}
              onChange={(e) => setState((s) => ({ ...s, showCuts: e.target.checked }))}
            />
            Number the cuts on the drawing
          </label>
          <div className="fills">
            <span id="fill">Part fill</span>
            <div className="letters" role="radiogroup" aria-labelledby="fill">
              {FILLS.map((fill) => (
                <label key={fill}>
                  <input
                    type="radio"
                    name="fill"
                    checked={fill === partFill}
                    onChange={() => setState((s) => ({ ...s, partFill: fill }))}
                  />
                  <span>{fill}</span>
                </label>
              ))}
            </div>
          </div>
          </section>
        </details>

        {runs.length > 0 && (
          <details className="fold">
            <summary>
              <FoldMark /> History ({runs.length})
            </summary>
            <ul className="stack" aria-label="History">
              {runs.map((r) => (
                <li key={r.id} className="bar" data-run={r.id}>
                  <span>{time(r.at)}</span>
                  <button
                    className="pick"
                    aria-current={r.id === run?.id || undefined}
                    onClick={() => setState((s) => ({ ...s, activeRun: r.id }))}
                  >
                    {total(r.job.parts)} parts
                  </button>
                  <span>
                    {EFFORTS[r.effort ?? 0].name}
                    <button
                      className="ghost"
                      aria-label={`Delete run from ${time(r.at)}`}
                      onClick={() => removeRun(r.id)}
                    >
                      ×
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}

        <details className="fold">
          <summary>
            <FoldMark /> Keys
          </summary>
          <dl className="keys">
            <dt>Enter</dt>
            <dd>Next row, or a new row from the last</dd>
            <dt>Shift+Enter</dt>
            <dd>Previous row</dd>
            <dt><CalculateKeys /></dt>
            <dd>Calculate</dd>
            <dt>← →</dt>
            <dd>Previous or next candidate</dd>
            <dt>Home End</dt>
            <dd>First or last candidate, from the candidates</dd>
            <dt>↑ ↓</dt>
            <dd>Step through an open cutting order</dd>
          </dl>
        </details>

          <div className="row">
            <button onClick={copyLink}>{copied ? 'Link copied' : 'Copy link to this job'}</button>
            <button onClick={() => setJob(sampleJob())}>Load example</button>
          </div>
        </section>
      </aside>

      <main id="results" tabIndex={-1}>
        <h2 className="unseen">Results</h2>
        {/* Always here, because a screen reader only announces changes to a region it has already met. */}
        <p role="status" className="unseen">
          {status}
        </p>
        {searching && (
          <section className="progress">
            <div className="bar">
              <span>{count(searching.stats.tried)}</span>
              <span>
                <span className="dot">●</span> Searching
              </span>
              <span>{count(searching.stats.total)}</span>
            </div>
            <progress aria-label="Layouts tried" value={searching.stats.tried} max={searching.stats.total || 1} />
            <p>
              <strong>
                {count(searching.stats.tried)} of {count(searching.stats.total)}
              </strong>{' '}
              layouts tried in {duration(searching.ms)} ·{' '}
              {count(Math.round(searching.stats.tried / (searching.ms / 1000 || 1)))} per second ·{' '}
              {searching.stats.improvements} improvements, the last at layout {count(searching.stats.lastImprovedAt)}
            </p>
            {searching.best && (
              <p>
                Best so far: {searching.best.stats.sheets} {searching.best.stats.sheets === 1 ? 'sheet' : 'sheets'} ·{' '}
                {largestOffcut(searching.best)} · {searching.best.stats.cuts} cuts
              </p>
            )}
            <button data-search onClick={stop}>
              Stop and keep the best so far
            </button>
          </section>
        )}

        {!run && !searching && <p className="empty">Enter stock sheets and parts, then press Calculate.</p>}

        {run && stale && !working && (
          <p className="notice">
            The inputs have changed since this run.{' '}
            <button data-search onClick={calculate}>
              Recalculate
            </button>{' '}
            <button onClick={() => setJob(structuredClone(run.job))}>Restore this run's inputs</button>
          </p>
        )}

        {run && solution && (
          <>
            {working ? (
              <div className="bar chosen">
                <span>Candidate {String.fromCharCode(65 + chosen)}</span>
                <span>
                  {cut} of {placed} parts cut
                </span>
                <span className="work-tools">
                  {cut > 0 && <button onClick={clearDone}>Clear marks</button>}
                  {workSwitch}
                </span>
              </div>
            ) : (
            <div className="bar chosen">
              <div className="candidates">
                {solutions.length > 1 && (
                  <button title="Previous candidate (left arrow key)" aria-label="Previous candidate" onClick={() => step(-1)}>
                    ←
                  </button>
                )}
                {/* Radios, so that the arrow keys choose a candidate and the group is a single tab stop. */}
                <div className="letters" role="radiogroup" aria-label="Candidates" onKeyDown={onCandidateKey}>
                  {solutions.map((s, i) => {
                    const letter = String.fromCharCode(65 + i)
                    return (
                      <label key={i} title={`${figures(s)}, ${moves(s)}. ${s.strategy}`}>
                        <input
                          type="radio"
                          name="candidate"
                          aria-label={`${letter}: ${figures(s)}, ${moves(s)}`}
                          checked={s === solution}
                          onChange={() => pick(i)}
                        />
                        <span>{letter}</span>
                      </label>
                    )
                  })}
                </div>
                {solutions.length > 1 && (
                  <button title="Next candidate (right arrow key)" aria-label="Next candidate" onClick={() => step(1)}>
                    →
                  </button>
                )}
              </div>
              <span>{figures(solution)}</span>
              <span className="work-tools">
                {moves(solution)}
                {workSwitch}
              </span>
            </div>
            )}

            {solution.stats.stacked > 0 && (
              <p className="notice warn">
                {solution.stats.stacked} part {solution.stats.stacked === 1 ? 'size is' : 'sizes are'} whatever remains
                between other cuts, so cutting errors add up there. They are marked ⚠ in the cutting order.
              </p>
            )}

            {solution.unplaced.length > 0 && (
              <p className="notice warn">
                Not enough stock for: {short(solution)}.
              </p>
            )}

            {solution.layouts.map((layout, i) => (
              <Sheet
                key={i}
                index={i}
                layout={layout}
                partIds={run.job.parts.map((p) => p.id)}
                showCuts={showCuts}
                fill={partFill}
                kerf={run.job.kerf}
                named={showNames}
                done={working ? new Set(layout.placements.map((_, j) => j).filter((j) => done.has(doneKey(i, j)))) : undefined}
                onDone={(j) => markDone(i, j)}
              />
            ))}
            {run.search && !working && (
              <p className="summary">
                Tried {count(run.search.tried)} layouts in {duration(run.search.ms)} at {EFFORTS[run.effort ?? 0].name}{' '}
                effort · {run.search.improvements} improvements, the last at layout {count(run.search.lastImprovedAt)}
                {run.search.tried < run.search.total && ' · stopped early'}
              </p>
            )}
          </>
        )}
      </main>

      <footer className="bar colophon">
        <span className="links">
          <a href={`${REPO}/releases`}>{VERSION}</a>
          <a href={`${REPO}/blob/main/LICENSE`}>AGPL-3.0</a>
        </span>
        <span>
          Built by <Author /> in Australia <SouthernCross />
        </span>
        <span className="links loud">
          <a href="https://github.com/sponsors/XDGFX">
            <Icon name="heart" /> Donate
          </a>
          <a href={REPO}>
            <Icon name="code" /> Source
          </a>
        </span>
      </footer>
    </div>
  )
}

const REPO = 'https://github.com/XDGFX/cutlist'
/** The latest release and any commits since, which the deploy workflow reads from the tags. */
const VERSION: string = import.meta.env.VITE_VERSION || 'dev'

/** A plus on a closed fold and a minus on an open one; the stylesheet shows whichever applies. */
function FoldMark() {
  return (
    <>
      <Icon name="plus" />
      <Icon name="minus" />
    </>
  )
}

/** Empties a list, then offers to bring back what it held. */
function ClearOrUndo({ items, held, onClear, onUndo }: { items: unknown[]; held?: unknown[]; onClear: () => void; onUndo: () => void }) {
  if (items.length > 0)
    return (
      <button onClick={onClear}>
        <Icon name="bin" /> Clear
      </button>
    )
  if (!held) return null
  return (
    <button onClick={onUndo}>
      <Icon name="undo" /> Undo
    </button>
  )
}

/** The five stars as they sit on the flag, the fifth smaller than the rest. */
function SouthernCross() {
  return (
    <svg className="glyph cross" viewBox="0 0 11 14" width="11" height="14" aria-hidden="true">
      <rect x="5" y="0" width="2" height="2" />
      <rect x="1" y="5" width="2" height="2" />
      <rect x="8" y="3" width="2" height="2" />
      <rect x="6" y="7" width="1" height="1" />
      <rect x="5" y="12" width="2" height="2" />
    </svg>
  )
}

const ROTATE_HELP = "Allow the part to be turned 90°. Untick to keep the grain along the sheet's length."

function Num({ col, label, value, onChange }: { col: string; label: string; value: number; onChange: (n: number) => void }) {
  return (
    <td>
      <input
        type="number"
        min="0"
        data-col={col}
        aria-label={label}
        value={value || ''}
        onChange={(e) => onChange(e.target.valueAsNumber || 0)}
      />
    </td>
  )
}

const TITLE = 'Cutlist'
/** This many clicks on the title within this many milliseconds sets the whole page off. */
const SPAM_CLICKS = 5
const SPAM_WITHIN = 1500

/** Ways to order the letters of the title: each gives every letter its place in the queue. */
const ORDERS: ((n: number) => number[])[] = [
  (n) => Array.from({ length: n }, (_, i) => i),
  (n) => Array.from({ length: n }, (_, i) => n - 1 - i),
  (n) => Array.from({ length: n }, (_, i) => Math.abs(i - (n - 1) / 2)),
  (n) => Array.from({ length: n }, (_, i) => Math.min(i, n - 1 - i)),
  (n) => Array.from({ length: n }, (_, i) => (i % 2) * n + i),
  (n) => Array.from({ length: n }, () => Math.random()),
]

/** When each letter lights and for how long, in milliseconds, with a fresh order in and out. */
function flourish(n: number): { at: number; lit: number }[] {
  const pick = () => ORDERS[Math.floor(Math.random() * ORDERS.length)](n)
  const rank = (keys: number[]) => keys.map((key) => new Set(keys.filter((other) => other < key)).size)
  const step = 40 + Math.random() * 50
  const on = rank(pick())
  const off = rank(pick())
  const hold = (Math.max(...on) + 3) * step
  return on.map((place, i) => ({ at: place * step, lit: hold + (off[i] - place) * step }))
}

/** Which of `n` letters are lit, and a way to set a flourish off across them. */
function useFlourish(n: number): [boolean[], () => void] {
  const [lit, setLit] = useState(() => Array.from({ length: n }, () => false))
  // Every flourish flips its letters on and later off again, so overlapping flourishes cancel out.
  const flip = (i: number) => setLit((was) => was.map((on, j) => (j === i ? !on : on)))
  const play = () =>
    flourish(n).forEach((timing, i) => {
      setTimeout(flip, timing.at, i)
      setTimeout(flip, timing.at + timing.lit, i)
    })
  return [lit, play]
}

const AUTHOR = 'XDGFX'

/** The author's name, filled in, with a flourish that empties its letters under the pointer. */
function Author() {
  const [lit, play] = useFlourish(AUTHOR.length)
  return (
    <a className="by" href="https://github.com/XDGFX" aria-label={AUTHOR} onMouseEnter={play}>
      {[...AUTHOR].map((letter, i) => (
        <span key={i} aria-hidden className={lit[i] ? 'lit' : undefined}>
          {letter}
        </span>
      ))}
    </a>
  )
}

function Title() {
  const [lit, flourishTitle] = useFlourish(TITLE.length)
  const clicks = useRef<number[]>([])
  const play = () => {
    flourishTitle()
    const now = performance.now()
    clicks.current = [...clicks.current.filter((at) => now - at < SPAM_WITHIN), now]
    if (clicks.current.length < SPAM_CLICKS) return
    clicks.current = []
    flourishPage()
  }
  return (
    <h1 aria-label={TITLE} onClick={play}>
      {[...TITLE].map((letter, i) => (
        <span key={i} aria-hidden className={lit[i] ? 'lit' : undefined}>
          {letter}
        </span>
      ))}
    </h1>
  )
}

function Pointer({ axis }: { axis: 'x' | 'y' }) {
  const at = useSyncExternalStore(watch, () => pointer)
  // An empty slot keeps the title centred while the pointer is off the drawings.
  if (!at) return <span />
  return (
    <span title={`Pointer position on a sheet, in millimetres from its ${axis === 'x' ? 'left' : 'top'} edge`}>
      {axis.toUpperCase()}
      {Math.round(at[axis])}
    </span>
  )
}

/** A dimension arrow from the reference edge of the piece being cut to the near face of the blade. */
function Fence({ cut, x, y, kerf, size }: { cut: Cut; x: number; y: number; kerf: number; size: number }) {
  // Which way the reference edge lies from the blade, along the axis the fence is measured on.
  const dir = cut.far ? 1 : -1
  const face = (cut.rip ? cut.y1 : cut.x1) + (dir * kerf) / 2
  const edge = face + dir * cut.fence
  const head = size * 0.7
  const half = head * 0.4
  const arrowhead = (tip: number, towards: number) => {
    const base = tip - towards * head
    return cut.rip
      ? `${x},${tip} ${x - half},${base} ${x + half},${base}`
      : `${tip},${y} ${base},${y - half} ${base},${y + half}`
  }

  return (
    <g className="fence">
      {cut.rip ? <line x1={x} y1={edge} x2={x} y2={face} /> : <line x1={edge} y1={y} x2={face} y2={y} />}
      {cut.fence >= head * 3 && (
        <>
          <polygon points={arrowhead(face, -dir)} />
          <polygon points={arrowhead(edge, dir)} />
        </>
      )}
      {/* The figure sits by the blade end, beside the cut's number, clear of the part labels. */}
      <text
        x={cut.rip ? x + size * 0.7 : face + dir * size * 0.9}
        y={cut.rip ? face + dir * size * 1.1 : y - size * 1.1}
        fontSize={size * 1.3}
        strokeWidth={size * 0.4}
        style={{ textAnchor: cut.rip || dir > 0 ? 'start' : 'end' }}
      >
        {mm(cut.fence)}
      </text>
    </g>
  )
}

/** The size of a sheet's heading in pixels, which the labels on the sheet match. */
const HEADING = parseFloat(getComputedStyle(document.documentElement).fontSize) * 1.05

/** The width in pixels that fills are sized against, and how many mono motif tiles fit along it. */
const PATTERN = 900
const TILES = 45

/** The fill for one part, sized against `unit` so it looks the same however large a sheet is drawn. */
function Pattern({ id, part, fill, unit }: { id: string; part: number; fill: PartFill; unit: number }) {
  if (fill === 'mono') {
    const [side, draw] = MOTIFS[part % MOTIFS.length]
    const t = unit / TILES
    return (
      <pattern id={id} className="motif" patternUnits="userSpaceOnUse" width={t * side} height={t * side} strokeWidth={unit / 900}>
        {draw(t)}
      </pattern>
    )
  }
  const gap = unit / 110
  // Neighbouring parts lean opposite ways, and so does each further round of the inks.
  const lean = (part + Math.floor(part / INKS.length)) % 2 ? -45 : 45
  return (
    <pattern id={id} patternUnits="userSpaceOnUse" width={gap} height={gap} patternTransform={`rotate(${lean})`}>
      <line x1={0} y1={gap / 2} x2={gap} y2={gap / 2} stroke={INKS[part % INKS.length]} strokeWidth={unit / 450} />
    </pattern>
  )
}

/** A hatched border just inside a part's edge, leaving the middle clear for its label. */
function Band({
  x,
  y,
  w,
  h,
  unit,
  stroke,
  bare,
}: {
  x: number
  y: number
  w: number
  h: number
  unit: number
  stroke: string
  bare: boolean
}) {
  const full = unit / 65
  const short = Math.min(w, h)
  // A narrow part with no label inside is hatched right across, as its middle would be a sliver.
  const band = bare && short < full * 3 ? short / 2 : Math.min(full, short / 4)
  return (
    <rect
      className="band"
      x={x + band / 2}
      y={y + band / 2}
      width={w - band}
      height={h - band}
      strokeWidth={band}
      style={{ stroke }}
    />
  )
}

function Sheet({
  layout,
  index,
  partIds,
  showCuts,
  fill,
  kerf,
  named,
  done,
  onDone,
}: {
  layout: Layout
  index: number
  partIds: string[]
  showCuts: boolean
  fill: PartFill
  kerf: number
  named: boolean
  /** In work mode, the placements marked done; tapping a part marks or unmarks it. */
  done?: Set<number>
  onDone: (placement: number) => void
}) {
  const svg = useRef<SVGSVGElement>(null)
  // Sheet millimetres per screen pixel, so that text on a sheet is sized in pixels however large
  // the sheet is drawn.
  const [px, setPx] = useState(layout.length / 900)
  const measure = () => {
    const box = svg.current?.getBoundingClientRect()
    const view = svg.current?.viewBox.baseVal
    if (!box?.width || !box.height || !view) return
    const next = Math.max(view.width / box.width, view.height / box.height)
    setPx((was) => (Math.abs(next - was) / was > 0.005 ? next : was))
  }
  useLayoutEffect(measure)
  useEffect(() => {
    const watch = new ResizeObserver(measure)
    watch.observe(svg.current!)
    return () => watch.disconnect()
  }, [])
  // The cut whose fence distance shows on screen; print shows them all.
  const [hot, setHot] = useState<number | null>(null)
  const heat = (i: number) => ({
    onPointerEnter: () => setHot(i),
    onPointerLeave: () => setHot(null),
    // A tap has no hover to end, so it toggles.
    onClick: () => setHot((was) => (was === i ? null : i)),
  })
  // The cutting order is one tab stop, and this is the cut in it that Tab lands on.
  const [stop, setStop] = useState(0)
  const onCutKey = (e: ReactKeyboardEvent<HTMLLIElement>, i: number) => {
    const to = stepTo(e.key, i, sequence.length)
    if (to === null) return
    e.preventDefault()
    const cuts = e.currentTarget.parentElement?.children
    if (cuts?.[to] instanceof HTMLElement) cuts[to].focus()
  }
  const order = useRef<HTMLDetailsElement>(null)
  // The cutting order is folded on screen but is wanted on paper.
  useEffect(() => {
    let wasOpen = false
    const open = () => {
      wasOpen = order.current?.open ?? false
      if (order.current) order.current.open = true
    }
    const restore = () => {
      if (order.current) order.current.open = wasOpen
    }
    addEventListener('beforeprint', open)
    addEventListener('afterprint', restore)
    return () => {
      removeEventListener('beforeprint', open)
      removeEventListener('afterprint', restore)
    }
  }, [])
  // Runs saved before the cutting order existed have none.
  const sequence = layout.sequence ?? []
  const used = layout.placements.reduce((a, p) => a + p.w * p.h, 0)
  const font = HEADING * px
  const plan = useMemo(() => planLabels(layout, px, HEADING, kerf, named), [layout, px, kerf, named])
  const grouped = new Set(plan.runs.flatMap((r) => r.parts))
  const covers = (r: Rect, inner: Rect) => {
    const shared = clip(r, inner)
    return shared !== null && shared.w === inner.w && shared.h === inner.h
  }
  /** Where a cut's badge and fence arrow go, along the stretch of it that `view` shows. */
  const badgeBox = (x: number, y: number, badge: number) => ({ x: x - badge * 1.4, y: y - badge, w: badge * 2.8, h: badge * 2 })
  const mark = (c: Cut, i: number, badge: number, view?: Rect, taken: Rect[] = []) => {
    const [x1, y1, x2, y2] = view
      ? [Math.max(c.x1, view.x), Math.max(c.y1, view.y), Math.min(c.x2, view.x + view.w), Math.min(c.y2, view.y + view.h)]
      : [c.x1, c.y1, c.x2, c.y2]
    const length = x2 - x1 + y2 - y1 || 1
    const at = (t: number) => [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t]
    // Staggered so that badges on neighbouring cuts do not pile up, and kept towards one
    // end of the cut, away from the part labels in the middle. One that would cover a label
    // or another badge slides along its cut to the first clear spot.
    const wanted = 0.12 + 0.3 * ((i * 0.618) % 1)
    const clear = (t: number) => !taken.some((r) => clip(badgeBox(...(at(t) as [number, number]), badge), r))
    const along = [wanted, 0.08, 0.92, 0.2, 0.8, 0.32, 0.68, 0.5].find(clear) ?? wanted
    const [x, y] = at(along)
    // The fence arrow sits just past the badge so the two do not cover each other.
    const [fx, fy] = at(along + Math.min(2.4 * badge, length * 0.2) / length)
    return { x, y, fx, fy }
  }
  // The view each cut is numbered in: the sheet, or the detail its badge would land in, where
  // there is room for it.
  const home = sequence.map((c, i) => {
    const badge = font * 0.7
    const { x, y } = mark(c, i, badge)
    // A cut along the edge of a detail's piece is made before the piece exists, so it stays on the sheet.
    const edges = (d: Detail) =>
      c.rip
        ? c.y1 <= d.piece.y || c.y1 >= d.piece.y + d.piece.h
        : c.x1 <= d.piece.x || c.x1 >= d.piece.x + d.piece.w
    return plan.details.find((d) => !edges(d) && clip(badgeBox(x, y, badge), d.region))?.letter ?? ''
  })
  const gutter = plan.gutter.top + plan.gutter.bottom
  const tile = (PATTERN * px) / TILES
  const pattern = (view: string, partId: string) => `url(#fill-${index}${view}-${partIds.indexOf(partId)})`

  const key = new Map<string, { partId: string; part: Placement; count: number }>()
  for (const p of layout.placements) {
    // A part is keyed at the size it was entered at, whichever way it lies.
    const entry = key.get(p.partId) ?? { partId: p.partId, part: p.rotated ? { ...p, w: p.h, h: p.w } : p, count: 0 }
    entry.count++
    key.set(p.partId, entry)
  }

  /** The sheet as seen through `view`, with text and fills sized for `px` millimetres to the pixel. */
  const scene = (id: string, view: Rect, px: number, detail: boolean) => {
    const font = HEADING * px
    // Cut badges match the body text.
    const badge = font * 0.7
    const unit = PATTERN * px
    // What a cut's badge must keep off: on the sheet the regions shown in details, then every label.
    const taken: Rect[] = detail
      ? []
      : plan.details.flatMap((d) => [
          d.region,
          ...d.arm.slice(1).map((p, n) => {
            const from = d.arm[n]
            return {
              x: Math.min(from.x, p.x) - font * 0.3,
              y: Math.min(from.y, p.y) - font * 0.3,
              w: Math.abs(p.x - from.x) + font * 0.6,
              h: Math.abs(p.y - from.y) + font * 0.6,
            }
          }),
        ])
    const label = (wanted: string[], r: Rect, className: string, plate = false) => {
      const box = clip(r, view)
      const setting = box && fit(wanted, box, font)
      if (!setting) return null
      const [x, y] = [box.x + box.w / 2, box.y + box.h / 2]
      taken.push({ x: x - setting.w / 2, y: y - setting.h / 2, w: setting.w, h: setting.h })
      return <Label {...setting} x={x} y={y} font={font} className={className} plate={plate} />
    }
    // One label across a run of the same part, wherever all of the run shows and holds it, unless
    // the view is large enough for each part to hold its own.
    const split = plan.runs.filter((r) => eachHolds(r, layout.placements, font, named))
    const apart = new Set(split.flatMap((r) => r.parts))
    const across = plan.runs.map(
      (r, n) =>
        covers(view, r.box) &&
        !split.includes(r) && <g key={`r${n}`}>{label(r.label, labelRoom(r, font), 'part-label', true)}</g>,
    )
    return (
      <>
        {fill !== 'none' && (
          <defs>
            {[...key.keys()].map((partId) => (
              <Pattern
                key={partId}
                id={`fill-${index}${id}-${partIds.indexOf(partId)}`}
                part={partIds.indexOf(partId)}
                fill={fill}
                unit={unit}
              />
            ))}
          </defs>
        )}
        <rect className="board" width={layout.length} height={layout.width} />
        {layout.offcuts.map((o, i) => (
          <g key={`o${i}`}>
            <title>{`Offcut: ${dims(o)}`}</title>
            <rect className="offcut" x={o.x} y={o.y} width={o.w} height={o.h} />
            {(detail || !plan.details.some((d) => covers(d.region, o))) && label([dims(o)], o, 'offcut-label')}
          </g>
        ))}
        {layout.placements.map((p, i) => {
          // A part too small for its label is too small for a motif to tell it apart.
          const bare = !detail && plan.small.has(i)
          const marked = done?.has(i) ?? false
          return (
            <g
              key={`p${i}`}
              className={marked ? 'done' : undefined}
              {...(done && {
                role: 'checkbox',
                'aria-checked': marked,
                'aria-label': partLabel(p, named).join(': '),
                // A part drawn again in a detail is the same part, so the keyboard meets it once.
                tabIndex: detail ? -1 : 0,
                onClick: () => onDone(i),
                onKeyDown: (e: ReactKeyboardEvent) => {
                  if (e.key !== 'Enter' && e.key !== ' ') return
                  e.preventDefault()
                  onDone(i)
                },
              })}
            >
              <title>{partLabel(p, named).join(': ')}</title>
              <rect
                className="part"
                x={p.x}
                y={p.y}
                width={p.w}
                height={p.h}
                style={fill === 'mono' && !bare ? { fill: pattern(id, p.partId) } : undefined}
              />
              {fill === 'colour' && (
                <Band x={p.x} y={p.y} w={p.w} h={p.h} unit={unit} stroke={pattern(id, p.partId)} bare={bare} />
              )}
              {!bare && (!grouped.has(i) || apart.has(i)) && label(partLabel(p, named), p, 'part-label')}
              {marked && <Tick part={p} font={font} />}
            </g>
          )
        })}
        {/* A band reaches its part's edge, so the outlines go over every band. */}
        {fill === 'colour' &&
          layout.placements.map((p, i) => <rect key={`e${i}`} className="part edge" x={p.x} y={p.y} width={p.w} height={p.h} />)}
        {sequence.map((c, i) => {
          if (detail && !clip({ x: c.x1 - 1, y: c.y1 - 1, w: c.x2 - c.x1 + 2, h: c.y2 - c.y1 + 2 }, view)) return null
          const numbered = showCuts && home[i] === id
          const { x, y, fx, fy } = mark(c, i, badge, detail ? view : undefined, numbered ? taken : [])
          if (numbered) taken.push(badgeBox(x, y, badge))
          return (
            <g
              key={`c${i}`}
              className={`cut${c.remainder.length ? ' stacked' : ''}${hot === i ? ' hot' : ''}`}
              {...heat(i)}
            >
              <line x1={c.x1} y1={c.y1} x2={c.x2} y2={c.y2} />
              <Fence cut={c} x={fx} y={fy} kerf={kerf} size={badge} />
              {numbered && (
                <>
                  {/* A heavy stroke out of both sides of the badge, to show which way its cut runs. */}
                  {c.rip ? (
                    <line
                      className="way"
                      x1={Math.max(c.x1, x - badge * (1.6 + 0.4 * String(i + 1).length))}
                      y1={y}
                      x2={Math.min(c.x2, x + badge * (1.6 + 0.4 * String(i + 1).length))}
                      y2={y}
                    />
                  ) : (
                    <line className="way" x1={x} y1={Math.max(c.y1, y - badge * 2.1)} x2={x} y2={Math.min(c.y2, y + badge * 2.1)} />
                  )}
                  <rect
                    x={x - badge * (0.5 + 0.4 * String(i + 1).length)}
                    y={y - badge}
                    width={badge * (1 + 0.8 * String(i + 1).length)}
                    height={badge * 2}
                  />
                  <text x={x} y={y} fontSize={badge * 1.2}>
                    {i + 1}
                  </text>
                </>
              )}
            </g>
          )
        })}
        {across}
      </>
    )
  }

  return (
    <figure className="sheet">
      <figcaption className="bar">
        <h3>Sheet {index + 1}</h3>
        <span>
          {named && layout.stockName} {mm(layout.length)} × {mm(layout.width)}
        </span>
        <span>
          {done
            ? `${done.size} of ${layout.placements.length} cut`
            : `${((used / (layout.length * layout.width)) * 100).toFixed(0)}% used`}
        </span>
      </figcaption>
      <svg
        ref={svg}
        viewBox={`0 ${-plan.gutter.top} ${layout.length} ${layout.width + gutter}`}
        // The margin is extra to the height a sheet may take, so that labels there do not shrink it.
        style={{ maxHeight: `calc(75vh + ${gutter / px}px)` }}
        // In work mode its parts are controls, which an image would hide.
        role={done ? 'group' : 'img'}
        aria-label={`Layout of sheet ${index + 1}`}
        className={done ? `${fill} work` : fill}
        onPointerMove={(e) => {
          const toSheet = e.currentTarget.getScreenCTM()?.inverse()
          if (!toSheet) return
          const at = new DOMPoint(e.clientX, e.clientY).matrixTransform(toSheet)
          setPointer({
            x: Math.min(Math.max(at.x, 0), layout.length),
            y: Math.min(Math.max(at.y, 0), layout.width),
          })
        }}
        onPointerLeave={() => setPointer(null)}
      >
        {scene('', { x: 0, y: 0, w: layout.length, h: layout.width }, px, false)}
        {plan.leaders.map((l) => (
          <g key={`${l.y}`} className="leader">
            {l.points.map((m, n) => (
              <g key={n}>
                <line x1={m.x} y1={m.y} x2={m.x} y2={l.y} />
                <circle cx={m.x} cy={m.y} r={font * 0.17} />
              </g>
            ))}
            <line x1={l.from} y1={l.y} x2={l.to} y2={l.y} />
            <Label lines={[l.text]} x={l.textX} y={l.y} font={font} className="part-label" anchor={l.anchor} />
          </g>
        ))}
        {plan.details.map((d) => {
          const zoom = px / d.px
          return (
            <g key={d.letter} className="detail">
              <rect className="frame" x={d.region.x} y={d.region.y} width={d.region.w} height={d.region.h} />
              <polyline className="frame" points={d.arm.map((p) => `${p.x},${p.y}`).join(' ')} />
              <rect className="tab" x={d.tab.x} y={d.tab.y} width={d.tab.w} height={d.tab.h} />
              <Label
                lines={[d.title]}
                x={d.tab.x + font * 0.5}
                y={d.tab.y + d.tab.h / 2}
                font={font}
                className="tab-label"
                anchor="start"
              />
              <clipPath id={`detail-${index}${d.letter}`}>
                <rect x={d.frame.x} y={d.frame.y} width={d.frame.w} height={d.frame.h} />
              </clipPath>
              <g clipPath={`url(#detail-${index}${d.letter})`}>
                <g transform={`translate(${d.frame.x} ${d.frame.y}) scale(${zoom}) translate(${-d.region.x} ${-d.region.y})`}>
                  {scene(d.letter, d.region, d.px, true)}
                </g>
              </g>
              <rect className="frame" x={d.frame.x} y={d.frame.y} width={d.frame.w} height={d.frame.h} />
            </g>
          )
        })}
        {/* Last, so that no other detail's frame or arm covers a region's letter. */}
        {plan.details.map((d) => {
          const x = Math.min(Math.max(d.region.x, font * 0.7), layout.length - font * 0.7)
          const y = Math.min(Math.max(d.region.y, font * 0.7), layout.width - font * 0.7)
          return (
            <g key={d.letter}>
              <rect className="tab" x={x - font * 0.7} y={y - font * 0.7} width={font * 1.4} height={font * 1.4} />
              <Label lines={[d.letter]} x={x} y={y} font={font} className="tab-label" />
            </g>
          )
        })}
      </svg>
      <ul className="key">
        {[...key.values()].map((k) => (
          <li key={k.partId}>
            {fill !== 'none' && (
              <svg className="swatch" viewBox={`0 0 ${tile * 2.4} ${tile * 1.5}`} aria-hidden="true">
                <rect width={tile * 2.4} height={tile * 1.5} style={{ fill: pattern('', k.partId) }} />
              </svg>
            )}
            {named ? countLabel(k.count, k.part)[0] : countLabel(k.count, k.part, false).join(' ')}
          </li>
        ))}
      </ul>
      {sequence.length > 0 && (
        <details ref={order} className="sequence">
          <summary>
            <FoldMark /> Cutting order ({sequence.length} cuts)
          </summary>
          <ol>
            {sequence.map((c, i) => (
              <li
                key={i}
                className={`${c.remainder.length ? 'stacked' : ''}${hot === i ? ' hot' : ''}`}
                {...heat(i)}
                tabIndex={i === Math.min(stop, sequence.length - 1) ? 0 : -1}
                onKeyDown={(e) => onCutKey(e, i)}
                // Only focus from the keyboard marks the cut, so that a click still toggles it.
                onFocus={(e) => {
                  setStop(i)
                  if (e.currentTarget.matches(':focus-visible')) setHot(i)
                }}
                onBlur={() => setHot((was) => (was === i ? null : was))}
              >
                {c.rip ? 'Rip' : 'Crosscut'} at <strong>{mm(c.fence)}</strong> from the{' '}
                {c.rip ? (c.far ? 'bottom' : 'top') : c.far ? 'right' : 'left'}
                {c.sizes.length > 0 ? ` → ${c.sizes.join(', ')}` : ' → frees leftover'}
                {c.remainder.length > 0 && ` ⚠ ${c.remainder.join(', ')} is what remains`}
              </li>
            ))}
          </ol>
        </details>
      )}
    </figure>
  )
}

/** The mark on a part cut in work mode: a tick on a solid tab in its corner, at the size of a label. */
function Tick({ part, font }: { part: Rect; font: number }) {
  const side = Math.min(font * 1.6, part.w * 0.6, part.h * 0.6)
  const inset = Math.min(font * 0.4, (Math.min(part.w, part.h) - side) / 2)
  const [x, y] = [part.x + inset, part.y + inset]
  const at = (u: number, v: number) => `${x + side * u},${y + side * v}`
  return (
    <g className="tick">
      <rect x={x} y={y} width={side} height={side} />
      <polyline points={`${at(0.22, 0.52)} ${at(0.42, 0.72)} ${at(0.78, 0.3)}`} strokeWidth={side * 0.14} />
    </g>
  )
}

/** A label centred on a point, or starting or ending there when anchored. */
function Label({
  lines,
  turned,
  x,
  y,
  font,
  className,
  anchor,
  plate,
}: {
  lines: string[]
  turned?: boolean
  /** A blank ground behind the text, for a label that lies over lines. */
  plate?: boolean
  x: number
  y: number
  font: number
  className: string
  anchor?: 'start' | 'end'
}) {
  const top = y - ((lines.length - 1) * font * 1.2) / 2
  const [wide, tall] = [(Math.max(...lines.map((l) => l.length)) * 0.6 + 0.4) * font, lines.length * font * 1.2]
  return (
    <g transform={turned ? `rotate(-90 ${x} ${y})` : undefined}>
      {plate && <rect className="plate" x={x - wide / 2} y={y - tall / 2} width={wide} height={tall} />}
      {lines.map((line, i) => (
        <text
          key={i}
          className={className}
          x={x}
          y={top + i * font * 1.2}
          fontSize={font}
          strokeWidth={font * 0.3}
          style={anchor && { textAnchor: anchor }}
        >
          {line}
        </text>
      ))}
    </g>
  )
}
