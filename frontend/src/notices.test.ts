import { describe, expect, it } from 'vitest'
import { deletedText, shooterSwitchedText, withShooterSwitch } from './notices'
import { tabTarget } from './focusTrap'

describe('withShooterSwitch', () => {
  it('keeps the delete confirmation and adds the switch sentence', () => {
    expect(withShooterSwitch(deletedText(7), 'Noam', 'Alice')).toBe(
      'Deleted shot #7. Noam has no shots left, so the shots of Alice are shown.',
    )
  })
  it('is idempotent', () => {
    const once = withShooterSwitch(deletedText(7), 'Noam', 'Alice')
    expect(withShooterSwitch(once, 'Noam', 'Alice')).toBe(once)
  })
  it('replaces any other notice, or none', () => {
    const sentence = shooterSwitchedText('Noam', 'Alice')
    expect(withShooterSwitch(null, 'Noam', 'Alice')).toBe(sentence)
    expect(withShooterSwitch('Saved shot #3 for Bob.', 'Noam', 'Alice')).toBe(sentence)
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
