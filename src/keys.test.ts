import { describe, expect, it } from 'vitest'
import { arrowTo, asksToCalculate, enterTo, neighbour, stepTo, type Press } from './keys'

const press = (over: Partial<Press>): Press => ({
  key: 'Enter',
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  isComposing: false,
  ...over,
})

describe('asksToCalculate', () => {
  it('takes Enter with Ctrl or with Cmd', () => {
    expect(asksToCalculate(press({ ctrlKey: true }))).toBe(true)
    expect(asksToCalculate(press({ metaKey: true }))).toBe(true)
  })

  it('leaves Enter alone, and other keys with Ctrl', () => {
    expect(asksToCalculate(press({}))).toBe(false)
    expect(asksToCalculate(press({ key: 'c', ctrlKey: true }))).toBe(false)
  })

  it('leaves an Enter that is confirming composed text', () => {
    expect(asksToCalculate(press({ ctrlKey: true, isComposing: true }))).toBe(false)
  })
})

describe('enterTo', () => {
  it('moves down a row', () => {
    expect(enterTo(press({}), 0, 3)).toBe(1)
  })

  it('adds a row from the last one', () => {
    expect(enterTo(press({}), 2, 3)).toBe('add')
  })

  it('moves up with Shift, and stays put on the first row', () => {
    expect(enterTo(press({ shiftKey: true }), 2, 3)).toBe(1)
    expect(enterTo(press({ shiftKey: true }), 0, 3)).toBeNull()
  })

  it('leaves Enter to the calculate shortcut when Ctrl or Cmd is held', () => {
    expect(enterTo(press({ ctrlKey: true }), 0, 3)).toBeNull()
    expect(enterTo(press({ metaKey: true }), 0, 3)).toBeNull()
  })

  it('leaves an Enter that is confirming composed text', () => {
    expect(enterTo(press({ isComposing: true }), 0, 3)).toBeNull()
  })

  it('leaves other keys', () => {
    expect(enterTo(press({ key: 'Tab' }), 0, 3)).toBeNull()
  })
})

describe('stepTo', () => {
  it('moves one place and stops at the ends', () => {
    expect(stepTo('ArrowDown', 1, 3)).toBe(2)
    expect(stepTo('ArrowDown', 2, 3)).toBe(2)
    expect(stepTo('ArrowUp', 1, 3)).toBe(0)
    expect(stepTo('ArrowUp', 0, 3)).toBe(0)
  })

  it('jumps to either end', () => {
    expect(stepTo('Home', 2, 3)).toBe(0)
    expect(stepTo('End', 0, 3)).toBe(2)
  })

  it('leaves other keys', () => {
    expect(stepTo('ArrowLeft', 1, 3)).toBeNull()
  })
})

describe('arrowTo', () => {
  const size = { rows: 3, cols: 3 }
  const arrow = (key: string, over: Partial<Press> = {}) => press({ key, ...over })

  it('moves up and down a row whether or not the field is selected', () => {
    for (const selected of [true, false]) {
      expect(arrowTo(arrow('ArrowDown'), { row: 1, col: 2 }, size, selected)).toEqual({ row: 2, col: 2 })
      expect(arrowTo(arrow('ArrowUp'), { row: 1, col: 2 }, size, selected)).toEqual({ row: 0, col: 2 })
    }
  })

  it('moves left and right along a row from a selected field', () => {
    expect(arrowTo(arrow('ArrowRight'), { row: 1, col: 1 }, size, true)).toEqual({ row: 1, col: 2 })
    expect(arrowTo(arrow('ArrowLeft'), { row: 1, col: 1 }, size, true)).toEqual({ row: 1, col: 0 })
  })

  it('leaves left and right to the caret in a field being edited', () => {
    expect(arrowTo(arrow('ArrowRight'), { row: 1, col: 1 }, size, false)).toBeNull()
    expect(arrowTo(arrow('ArrowLeft'), { row: 1, col: 1 }, size, false)).toBeNull()
  })

  it('stays put at the edges of the table', () => {
    expect(arrowTo(arrow('ArrowUp'), { row: 0, col: 1 }, size, false)).toEqual({ row: 0, col: 1 })
    expect(arrowTo(arrow('ArrowDown'), { row: 2, col: 1 }, size, false)).toEqual({ row: 2, col: 1 })
    expect(arrowTo(arrow('ArrowLeft'), { row: 1, col: 0 }, size, true)).toEqual({ row: 1, col: 0 })
    expect(arrowTo(arrow('ArrowRight'), { row: 1, col: 2 }, size, true)).toEqual({ row: 1, col: 2 })
  })

  it('leaves an arrow held with another key', () => {
    for (const held of ['ctrlKey', 'metaKey', 'altKey', 'shiftKey', 'isComposing'] as const)
      expect(arrowTo(arrow('ArrowDown', { [held]: true }), { row: 1, col: 1 }, size, true)).toBeNull()
  })

  it('leaves other keys', () => {
    expect(arrowTo(arrow('Home'), { row: 1, col: 1 }, size, true)).toBeNull()
  })
})

describe('neighbour', () => {
  it('is the row that moves into the gap', () => {
    expect(neighbour(['a', 'b', 'c'], 'b')).toBe('c')
  })

  it('is the row before when the last one goes', () => {
    expect(neighbour(['a', 'b', 'c'], 'c')).toBe('b')
  })

  it('is nothing when the only row goes', () => {
    expect(neighbour(['a'], 'a')).toBeNull()
  })
})
