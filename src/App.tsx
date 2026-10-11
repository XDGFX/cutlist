import { useEffect, useMemo, useState } from 'react'
import { optimise, type Job, type Layout, type Part, type Solution, type StockSheet } from './optimiser'
import { jobFromHash, jobToHash, load, MAX_RUNS, newId, sampleJob, save, type Run, type Saved } from './storage'

const mm = (n: number) => String(+n.toFixed(1))
const m2 = (n: number) => (n / 1e6).toFixed(2)
const time = (at: number) =>
  new Date(at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

const sameJob = (a: Job, b: Job) => JSON.stringify(a) === JSON.stringify(b)

function initial(): Saved {
  const saved = load()
  // A link to the job already open is a reload, not an incoming share.
  const shared = location.hash === jobToHash(saved.job) ? null : jobFromHash(location.hash)
  return shared ? { ...saved, job: shared, activeRun: null } : saved
}

export function App() {
  const [state, setState] = useState(initial)
  const [copied, setCopied] = useState(false)
  const { job, runs } = state

  useEffect(() => save(state), [state])

  const run = runs.find((r) => r.id === state.activeRun) ?? null
  const solutions = useMemo(() => (run ? optimise(run.job) : []), [run?.job])
  const solution = solutions[Math.min(run?.pick ?? 0, solutions.length - 1)] as Solution | undefined
  const stale = run !== null && !sameJob(run.job, job)

  const setJob = (patch: Partial<Job>) => setState((s) => ({ ...s, job: { ...s.job, ...patch } }))

  const setPart = (id: string, patch: Partial<Part>) =>
    setJob({ parts: job.parts.map((p) => (p.id === id ? { ...p, ...patch } : p)) })
  const setStock = (id: string, patch: Partial<StockSheet>) =>
    setJob({ stock: job.stock.map((s) => (s.id === id ? { ...s, ...patch } : s)) })

  const calculate = () =>
    setState((s) => {
      const latest = s.runs[0]
      if (latest && sameJob(latest.job, s.job)) return { ...s, activeRun: latest.id }
      const next: Run = { id: newId(), at: Date.now(), job: structuredClone(s.job), pick: 0 }
      return { ...s, runs: [next, ...s.runs].slice(0, MAX_RUNS), activeRun: next.id }
    })

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
          <button className="primary" onClick={calculate}>
            Calculate
          </button>
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
                </button>
                <button className="ghost" aria-label={`Delete run from ${time(r.at)}`} onClick={() => removeRun(r.id)}>
                  ×
                </button>
              </span>
            ))}
          </nav>
        )}

        {!run && <p className="empty">Enter stock sheets and parts, then press Calculate.</p>}

        {run && stale && (
          <p className="notice">
            The inputs have changed since this run.{' '}
            <button onClick={calculate}>Recalculate</button>{' '}
            <button onClick={() => setJob(structuredClone(run.job))}>Restore this run's inputs</button>
          </p>
        )}

        {run && solution && (
          <>
            <nav className="chips" aria-label="Candidates">
              <h2>Options</h2>
              {solutions.map((s, i) => (
                <span key={i} className={s === solution ? 'chip active' : 'chip'} title={s.strategy}>
                  <button onClick={() => pick(i)}>
                    {String.fromCharCode(65 + i)} · {s.stats.sheets} {s.stats.sheets === 1 ? 'sheet' : 'sheets'} ·{' '}
                    {s.stats.wastePct.toFixed(0)}% waste · {s.stats.cuts} cuts
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
            </dl>

            {solution.unplaced.length > 0 && (
              <p className="notice warn">
                Not enough stock for: {solution.unplaced.map((u) => `${u.qty} × ${u.name}`).join(', ')}.
              </p>
            )}

            {solution.layouts.map((layout, i) => (
              <Sheet key={i} index={i} layout={layout} partIds={run.job.parts.map((p) => p.id)} />
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

function Sheet({ layout, index, partIds }: { layout: Layout; index: number; partIds: string[] }) {
  const maxFont = layout.length / 45
  const minFont = layout.length / 140
  const used = layout.placements.reduce((a, p) => a + p.w * p.h, 0)

  const label = (lines: string[], x: number, y: number, w: number, h: number, className: string) => {
    const longest = Math.max(...lines.map((l) => l.length))
    const fit = (across: number, down: number) =>
      Math.min(maxFont, (across * 0.92) / (longest * 0.6), (down * 0.8) / (lines.length * 1.2))
    // Tall, narrow pieces read better with the text turned to run up them.
    const turned = fit(h, w) > fit(w, h)
    const size = turned ? fit(h, w) : fit(w, h)
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
            <rect
              className="part"
              x={p.x}
              y={p.y}
              width={p.w}
              height={p.h}
              fill={`hsl(${(partIds.indexOf(p.partId) * 47 + 28) % 360} 60% 74%)`}
            />
            {label([p.name, `${mm(p.w)} × ${mm(p.h)}`], p.x, p.y, p.w, p.h, 'part-label')}
          </g>
        ))}
      </svg>
      {layout.offcuts.length > 0 && (
        <p className="offcuts">Offcuts: {layout.offcuts.map((o) => `${mm(o.w)} × ${mm(o.h)}`).join(', ')}</p>
      )}
    </figure>
  )
}
