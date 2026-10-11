/** The parts of a key press that decide what it means. */
export interface Press {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
  isComposing: boolean
}

/** Whether a key press asks for a calculation: Enter with Ctrl, or with Cmd on a Mac. */
export const asksToCalculate = (e: Press) =>
  e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && !e.isComposing

/**
 * Where Enter moves to from row `at` of a table with `rows` rows: a row's index, or `'add'` for a
 * new row below the last. Null leaves the key to the browser.
 */
export function enterTo(e: Press, at: number, rows: number): number | 'add' | null {
  if (e.key !== 'Enter' || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return null
  if (e.shiftKey) return at > 0 ? at - 1 : null
  return at + 1 < rows ? at + 1 : 'add'
}

/** Where an arrow, Home or End moves to from place `at` in a list of `count`, stopping at the ends. */
export function stepTo(key: string, at: number, count: number): number | null {
  if (key === 'ArrowDown') return Math.min(at + 1, count - 1)
  if (key === 'ArrowUp') return Math.max(at - 1, 0)
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  return null
}

/** The row that takes focus when one is removed: the one that moves into its place, else the one before. */
export function neighbour(ids: string[], removed: string): string | null {
  const at = ids.indexOf(removed)
  return ids[at + 1] ?? ids[at - 1] ?? null
}
