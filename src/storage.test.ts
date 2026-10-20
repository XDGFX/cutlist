import { describe, expect, it } from 'vitest'
import { jobToHash, linkFromHash, sampleJob } from './storage'

const withoutIds = <T extends { id: string }>(rows: T[]) => rows.map(({ id: _, ...row }) => row)

describe('links', () => {
  it('carry the job, with no result unless one is given', () => {
    const job = sampleJob()
    const link = linkFromHash(jobToHash(job))!
    expect(link.result).toBeUndefined()
    expect(link.job.kerf).toBe(job.kerf)
    expect(withoutIds(link.job.parts)).toEqual(withoutIds(job.parts))
    expect(withoutIds(link.job.stock)).toEqual(withoutIds(job.stock))
  })

  it('carry the effort, chosen candidate and engine of a result', () => {
    const link = linkFromHash(jobToHash(sampleJob(), { effort: 2, pick: 3, engine: 4 }))!
    expect(link.result).toEqual({ effort: 2, pick: 3, engine: 4 })
  })

  it('are not read from another fragment', () => {
    expect(linkFromHash('#results')).toBeNull()
  })
})
