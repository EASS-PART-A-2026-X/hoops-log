import { describe, expect, it } from 'vitest'
import { deletedText } from './notices'
import { tabTarget } from './focusTrap'

describe('deletedText', () => {
  it('names the shot', () => {
    expect(deletedText(7)).toBe('Deleted shot #7.')
  })
})

describe('tabTarget', () => {
  const items = ['a', 'b', 'c']
  it('wraps at the ends', () => {
    expect(tabTarget(items, 'c', true, false)).toBe('a')
    expect(tabTarget(items, 'a', true, true)).toBe('c')
  })
  it('leaves Tab alone in the middle', () => {
    expect(tabTarget(items, 'b', true, false)).toBeNull()
    expect(tabTarget(items, 'b', true, true)).toBeNull()
    expect(tabTarget(items, 'a', true, false)).toBeNull()
  })
  it('pulls focus from outside into the drawer', () => {
    expect(tabTarget(items, null, false, false)).toBe('a')
    expect(tabTarget(items, null, false, true)).toBe('c')
  })
  it('does nothing without focusable items', () => {
    expect(tabTarget([], null, false, false)).toBeNull()
  })
})
