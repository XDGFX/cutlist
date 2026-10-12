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

/** A field's place in a table. */
export interface Cell {
  row: number
  col: number
}

const ARROWS: Record<string, Cell> = {
  ArrowUp: { row: -1, col: 0 },
  ArrowDown: { row: 1, col: 0 },
  ArrowLeft: { row: 0, col: -1 },
  ArrowRight: { row: 0, col: 1 },
}

/**
 * Where an arrow moves to from the field `at` in a table of `size`, staying put at an edge. Up and
 * down always move. Left and right move only from a `selected` field, whose whole value is selected
 * so there is no caret for them to move. Null leaves the key to the browser.
 */
export function arrowTo(e: Press, at: Cell, size: { rows: number; cols: number }, selected: boolean): Cell | null {
  const by = ARROWS[e.key]
  if (!by || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.isComposing) return null
  if (by.col && !selected) return null
  return {
    row: Math.min(Math.max(at.row + by.row, 0), size.rows - 1),
    col: Math.min(Math.max(at.col + by.col, 0), size.cols - 1),
  }
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
