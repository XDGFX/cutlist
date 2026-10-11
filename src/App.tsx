import { useEffect, useMemo, useRef, useState } from 'react'
import {
  EFFORTS,
  optimise,
  type Cut,
  type Job,
  type Layout,
  type Part,
  type SearchStats,
  type Solution,
  type StockSheet,
} from './optimiser'
import type { SearchRequest, Update } from './search.worker'
import { jobFromHash, jobToHash, load, MAX_RUNS, newId, sampleJob, save, type Run, type Saved } from './storage'

const mm = (n: number) => String(+n.toFixed(1))
const m2 = (n: number) => (n / 1e6).toFixed(2)
const count = (n: number) => n.toLocaleString('en-GB')
const duration = (ms: number) => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`)

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
  // Bumped when a search ends so the summary line replays its highlight.
  const [finished, setFinished] = useState(0)
  const worker = useRef<Worker | null>(null)
  const { job, runs } = state
  const effort = Math.min(state.effort ?? 0, EFFORTS.length - 1)
  const showCuts = state.showCuts ?? true
  const showFences = state.showFences ?? true

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

  const setJob = (patch: Partial<Job>) => setState((s) => ({ ...s, job: { ...s.job, ...patch } }))

  const setPart = (id: string, patch: Partial<Part>) =>
    setJob({ parts: job.parts.map((p) => (p.id === id ? { ...p, ...patch } : p)) })
  const setStock = (id: string, patch: Partial<StockSheet>) =>
    setJob({ stock: job.stock.map((s) => (s.id === id ? { ...s, ...patch } : s)) })

  const calculate = () => {
    if (worker.current) return
    const searched = structuredClone(job)
    const started = performance.now()
    const w = new Worker(new URL('./search.worker.ts', import.meta.url), { type: 'module' })
    worker.current = w
    setSearching({ stats: { tried: 0, total: 0, improvements: 0, lastImprovedAt: 0 }, best: null, ms: 0 })

    w.onmessage = ({ data }: MessageEvent<Update>) => {
      const ms = performance.now() - started
      if (data.type === 'progress') {
        setSearching({ stats: data.stats, best: data.solutions[0] ?? null, ms })
        return
      }
      w.terminate()
      worker.current = null
      setSearching(null)
      setFinished((n) => n + 1)
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

  const pick = (index: number) =>
    setState((s) => ({ ...s, runs: s.runs.map((r) => (r.id === s.activeRun ? { ...r, pick: index } : r)) }))

  const removeRun = (id: string) =>
    setState((s) => {
      const left = s.runs.filter((r) => r.id !== id)
      return { ...s, runs: left, activeRun: s.activeRun === id ? (left[0]?.id ?? null) : s.activeRun }
    })

  const copyLink = async () => {
    history.replaceState(null, '', jobToHash(job))
    await navigator.clipboard?.writeText(location.href).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="app">
      <aside className="inputs">
        <header>
          <h1>Cutlist</h1>
          <p>Guillotine cut layouts for sheet goods. All dimensions in millimetres.</p>
        </header>

        <section>
          <h2>Stock sheets</h2>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Length</th>
                <th>Width</th>
                <th>Qty</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {job.stock.map((s) => (
                <tr key={s.id}>
                  <td>
                    <input value={s.name} onChange={(e) => setStock(s.id, { name: e.target.value })} />
                  </td>
                  <Num value={s.length} onChange={(length) => setStock(s.id, { length })} />
                  <Num value={s.width} onChange={(width) => setStock(s.id, { width })} />
                  <Num value={s.qty} onChange={(qty) => setStock(s.id, { qty })} />
                  <td>
                    <button
                      className="ghost"
                      aria-label={`Remove ${s.name}`}
                      onClick={() => setJob({ stock: job.stock.filter((x) => x.id !== s.id) })}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button
            onClick={() =>
              setJob({ stock: [...job.stock, { id: newId(), name: 'Sheet', length: 2440, width: 1220, qty: 1 }] })
            }
          >
            + Stock sheet
          </button>
        </section>

        <section>
          <h2>Parts</h2>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Length</th>
                <th>Width</th>
                <th>Qty</th>
                <th title="Allow the part to be turned 90°. Untick to keep the grain along the sheet's length.">Rotate</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {job.parts.map((p) => (
                <tr key={p.id}>
                  <td>
                    <input value={p.name} onChange={(e) => setPart(p.id, { name: e.target.value })} />
                  </td>
                  <Num value={p.length} onChange={(length) => setPart(p.id, { length })} />
                  <Num value={p.width} onChange={(width) => setPart(p.id, { width })} />
                  <Num value={p.qty} onChange={(qty) => setPart(p.id, { qty })} />
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`${p.name} can rotate`}
                      checked={p.canRotate}
                      onChange={(e) => setPart(p.id, { canRotate: e.target.checked })}
                    />
                  </td>
                  <td>
                    <button
                      className="ghost"
                      aria-label={`Remove ${p.name}`}
                      onClick={() => setJob({ parts: job.parts.filter((x) => x.id !== p.id) })}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button
            onClick={() =>
              setJob({
                parts: [
                  ...job.parts,
                  { id: newId(), name: `Part ${job.parts.length + 1}`, length: 0, width: 0, qty: 1, canRotate: true },
                ],
              })
            }
          >
            + Part
          </button>
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
              Effort: <strong>{EFFORTS[effort].name}</strong>
            </span>
            <input
              type="range"
              min="0"
              max={EFFORTS.length - 1}
              step="1"
              value={effort}
              onChange={(e) => setState((s) => ({ ...s, effort: e.target.valueAsNumber }))}
            />
          </label>
          <button className="primary" onClick={calculate} disabled={searching !== null}>
            {searching ? 'Searching…' : 'Calculate'}
          </button>
        </section>

        <section className="checks">
          <label>
            <input
              type="checkbox"
              checked={showCuts}
              onChange={(e) => setState((s) => ({ ...s, showCuts: e.target.checked }))}
            />
            Number the cuts on the drawing
          </label>
          <label>
            <input
              type="checkbox"
              checked={showFences}
              onChange={(e) => setState((s) => ({ ...s, showFences: e.target.checked }))}
            />
            Show fence distances on the drawing
          </label>
        </section>

        <section className="row">
          <button onClick={copyLink}>{copied ? 'Link copied' : 'Copy link to this job'}</button>
          <button onClick={() => setJob(sampleJob())}>Load example</button>
        </section>
      </aside>

      <main>
        {runs.length > 0 && (
          <nav className="chips" aria-label="History">
            <h2>History</h2>
            {runs.map((r) => (
              <span key={r.id} className={r.id === run?.id ? 'chip active' : 'chip'}>
                <button onClick={() => setState((s) => ({ ...s, activeRun: r.id }))}>
                  {time(r.at)} · {r.job.parts.reduce((n, p) => n + p.qty, 0)} parts
                  {r.effort ? ` · ${EFFORTS[r.effort].name}` : ''}
                </button>
                <button className="ghost" aria-label={`Delete run from ${time(r.at)}`} onClick={() => removeRun(r.id)}>
                  ×
                </button>
              </span>
            ))}
          </nav>
        )}

        {searching && (
          <section className="progress" aria-live="polite">
            <progress value={searching.stats.tried} max={searching.stats.total || 1} />
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
            <button onClick={stop}>Stop and keep the best so far</button>
          </section>
        )}

        {!run && !searching && <p className="empty">Enter stock sheets and parts, then press Calculate.</p>}

        {run && stale && (
          <p className="notice">
            The inputs have changed since this run.{' '}
            <button onClick={calculate}>Recalculate</button>{' '}
            <button onClick={() => setJob(structuredClone(run.job))}>Restore this run's inputs</button>
          </p>
        )}

        {run && solution && (
          <>
            {run.search && (
              <p key={finished} className="summary">
                Tried <strong>{count(run.search.tried)}</strong> layouts in {duration(run.search.ms)} at{' '}
                {EFFORTS[run.effort ?? 0].name} effort · {run.search.improvements} improvements, the last at layout{' '}
                {count(run.search.lastImprovedAt)}
                {run.search.tried < run.search.total && ' · stopped early'}
              </p>
            )}
            <nav className="chips" aria-label="Candidates">
              <h2>Options</h2>
              {solutions.map((s, i) => (
                <span key={i} className={s === solution ? 'chip active' : 'chip'} title={s.strategy}>
                  <button onClick={() => pick(i)}>
                    {String.fromCharCode(65 + i)} · {s.stats.sheets} {s.stats.sheets === 1 ? 'sheet' : 'sheets'} ·{' '}
                    {largestOffcut(s)} · {s.stats.cuts} cuts
                    {s.stats.stacked ? ` · ⚠ ${s.stats.stacked} stacked` : ''}
                  </button>
                </span>
              ))}
            </nav>

            <dl className="stats">
              <Stat label="Sheets used" value={String(solution.stats.sheets)} />
              <Stat label="Parts placed" value={String(solution.stats.placed)} />
              <Stat label="Used" value={`${m2(solution.stats.usedArea)} m²`} />
              <Stat label="Waste" value={`${m2(solution.stats.wasteArea)} m² (${solution.stats.wastePct.toFixed(1)}%)`} />
              <Stat label="Cuts" value={String(solution.stats.cuts)} />
              <Stat label="Cut length" value={`${(solution.stats.cutLength / 1000).toFixed(2)} m`} />
              <Stat label="Stacked sizes" value={String(solution.stats.stacked ?? '–')} />
            </dl>

            {solution.stats.stacked > 0 && (
              <p className="notice warn">
                {solution.stats.stacked} part {solution.stats.stacked === 1 ? 'size is' : 'sizes are'} whatever remains
                between other cuts, so cutting errors add up there. They are marked ⚠ in the cutting order.
              </p>
            )}

            {solution.unplaced.length > 0 && (
              <p className="notice warn">
                Not enough stock for: {solution.unplaced.map((u) => `${u.qty} × ${u.name}`).join(', ')}.
              </p>
            )}

            {solution.layouts.map((layout, i) => (
              <Sheet
                key={i}
                index={i}
                layout={layout}
                partIds={run.job.parts.map((p) => p.id)}
                showCuts={showCuts}
                showFences={showFences}
                kerf={run.job.kerf}
              />
            ))}
          </>
        )}
      </main>
    </div>
  )
}

function Num({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <td>
      <input type="number" min="0" value={value || ''} onChange={(e) => onChange(e.target.valueAsNumber || 0)} />
    </td>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
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

function Sheet({
  layout,
  index,
  partIds,
  showCuts,
  showFences,
  kerf,
}: {
  layout: Layout
  index: number
  partIds: string[]
  showCuts: boolean
  showFences: boolean
  kerf: number
}) {
  // Runs saved before the cutting order existed have none.
  const sequence = layout.sequence ?? []
  const badge = layout.length / 125
  const maxFont = layout.length / 45
  const minFont = layout.length / 170
  const used = layout.placements.reduce((a, p) => a + p.w * p.h, 0)
  const colour = (partId: string) => `hsl(${(partIds.indexOf(partId) * 137.5 + 28) % 360} 60% 74%)`

  const key = new Map<string, { partId: string; name: string; size: string; count: number }>()
  for (const p of layout.placements) {
    const size = `${mm(Math.max(p.w, p.h))} × ${mm(Math.min(p.w, p.h))}`
    const entry = key.get(p.partId) ?? { partId: p.partId, name: p.name, size, count: 0 }
    entry.count++
    key.set(p.partId, entry)
  }

  const label = (wanted: string[], x: number, y: number, w: number, h: number, className: string) => {
    const sizeOf = (lines: string[], across: number, down: number) =>
      Math.min(
        maxFont,
        (across * 0.92) / (Math.max(...lines.map((l) => l.length)) * 0.6),
        (down * 0.8) / (lines.length * 1.2),
      )
    // Narrow pieces get everything on one line, and tall ones get the text turned to run up them.
    const [size, lines, turned] = [wanted, [wanted.join(' ')]]
      .flatMap((ls) => [
        [sizeOf(ls, w, h), ls, false] as const,
        [sizeOf(ls, h, w), ls, true] as const,
      ])
      .reduce((best, option) => (option[0] > best[0] ? option : best))
    if (size < minFont) return null
    const [cx, cy] = [x + w / 2, y + h / 2]
    const top = cy - ((lines.length - 1) * size * 1.2) / 2
    return (
      <g transform={turned ? `rotate(-90 ${cx} ${cy})` : undefined}>
        {lines.map((line, i) => (
          <text key={i} className={className} x={cx} y={top + i * size * 1.2} fontSize={size}>
            {line}
          </text>
        ))}
      </g>
    )
  }

  return (
    <figure className="sheet">
      <figcaption>
        <strong>
          Sheet {index + 1}: {layout.stockName}
        </strong>{' '}
        {mm(layout.length)} × {mm(layout.width)} · {((used / (layout.length * layout.width)) * 100).toFixed(0)}% used ·{' '}
        {layout.cuts} cuts
      </figcaption>
      <svg viewBox={`0 0 ${layout.length} ${layout.width}`} role="img" aria-label={`Layout of sheet ${index + 1}`}>
        <rect className="board" width={layout.length} height={layout.width} />
        {layout.offcuts.map((o, i) => (
          <g key={`o${i}`}>
            <rect className="offcut" x={o.x} y={o.y} width={o.w} height={o.h} />
            {label([`${mm(o.w)} × ${mm(o.h)}`], o.x, o.y, o.w, o.h, 'offcut-label')}
          </g>
        ))}
        {layout.placements.map((p, i) => (
          <g key={`p${i}`}>
            <title>{`${p.name}: ${mm(p.w)} × ${mm(p.h)}`}</title>
            <rect className="part" x={p.x} y={p.y} width={p.w} height={p.h} fill={colour(p.partId)} />
            {label([p.name, `${mm(p.w)} × ${mm(p.h)}`], p.x, p.y, p.w, p.h, 'part-label')}
          </g>
        ))}
        {(showCuts || showFences) &&
          sequence.map((c, i) => {
            const length = c.x2 - c.x1 + c.y2 - c.y1
            const at = (t: number) => [c.x1 + (c.x2 - c.x1) * t, c.y1 + (c.y2 - c.y1) * t]
            // Staggered so that badges on neighbouring cuts do not pile up, and kept towards one
            // end of the cut, away from the part labels in the middle.
            const along = 0.12 + 0.3 * ((i * 0.618) % 1)
            const [x, y] = at(along)
            // The fence arrow sits just past the badge so the two do not cover each other.
            const [fx, fy] = at(along + Math.min(2.4 * badge, length * 0.2) / length)
            return (
              <g key={`c${i}`} className={c.remainder.length ? 'cut stacked' : 'cut'}>
                <line x1={c.x1} y1={c.y1} x2={c.x2} y2={c.y2} />
                {showFences && <Fence cut={c} x={fx} y={fy} kerf={kerf} size={badge} />}
                {showCuts && (
                  <>
                    <circle cx={x} cy={y} r={badge} />
                    <text x={x} y={y} fontSize={badge * 1.2}>
                      {i + 1}
                    </text>
                  </>
                )}
              </g>
            )
          })}
      </svg>
      <ul className="key">
        {[...key.values()].map((k) => (
          <li key={k.partId}>
            <span className="swatch" style={{ background: colour(k.partId) }} />
            {k.count} × {k.name} <span className="size">{k.size}</span>
          </li>
        ))}
      </ul>
      {layout.offcuts.length > 0 && (
        <p className="offcuts">Offcuts: {layout.offcuts.map((o) => `${mm(o.w)} × ${mm(o.h)}`).join(', ')}</p>
      )}
      {sequence.length > 0 && (
        <details className="sequence" open>
          <summary>Cutting order ({sequence.length} cuts)</summary>
          <ol>
            {sequence.map((c, i) => (
              <li key={i} className={c.remainder.length ? 'stacked' : undefined}>
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
