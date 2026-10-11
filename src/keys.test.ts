import { describe, expect, it } from 'vitest'
import { asksToCalculate, enterTo, neighbour, stepTo, type Press } from './keys'

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
