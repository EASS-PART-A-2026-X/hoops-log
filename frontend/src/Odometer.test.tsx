// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import Odometer from './Odometer'

afterEach(cleanup)

const offsets = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>('.odo-strip')].map((s) => s.style.transform)

describe('Odometer', () => {
  it('gives screen readers the plain number and rolls each digit to its place', () => {
    const { container } = render(<Odometer value={47} />)
    expect(container.querySelector('.odo-text')!.textContent).toBe('47')
    expect(offsets(container)).toEqual(['translateY(-4em)', 'translateY(-7em)'])
    expect(container.querySelector('.odo-digits')!.getAttribute('aria-hidden')).toBe('true')
  })

  it('rolls the same digit columns to the new value, and glows once when it changes', () => {
    const { container, rerender } = render(<Odometer value={47} />)
    expect(container.querySelector('.odo-hot')).toBeNull()
    rerender(<Odometer value={52} />)
    expect(offsets(container)).toEqual(['translateY(-5em)', 'translateY(-2em)'])
    expect(container.querySelector('.odo-hot')).not.toBeNull()
  })

  it('adds a column when the number grows a place and never goes below zero', () => {
    const { container, rerender } = render(<Odometer value={9} />)
    rerender(<Odometer value={10} />)
    expect(offsets(container)).toHaveLength(2)
    rerender(<Odometer value={-3} />)
    expect(container.querySelector('.odo-text')!.textContent).toBe('0')
  })
})
