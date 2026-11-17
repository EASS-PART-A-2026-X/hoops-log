// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Odometer from './Odometer'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const textOf = (value: number) => {
  const { container, unmount } = render(<Odometer value={value} />)
  const text = container.querySelector('.odo-text')!.textContent
  unmount()
  return text
}

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

  it('shows one decimal place as given, so it matches the bar and the gap chip', () => {
    const { container } = render(<Odometer value={47.4} />)
    expect(container.querySelector('.odo-text')!.textContent).toBe('47.4')
    expect(container.querySelectorAll('.odo-strip')).toHaveLength(3)
    expect(container.querySelector('.odo-dot')!.textContent).toBe('.')
    expect(textOf(44.64)).toBe('44.6')
    expect(textOf(50)).toBe('50')
  })

  it('shows 0 for NaN, infinite and negative input', () => {
    for (const v of [NaN, Infinity, -Infinity, -3, -0.04]) expect(textOf(v)).toBe('0')
    const { container } = render(<Odometer value={NaN} />)
    expect(container.querySelector('.odo-text')!.textContent).toBe('0')
    expect(offsets(container)).toEqual(['translateY(0em)'])
  })

  it('clears the glow after 900 ms', () => {
    vi.useFakeTimers()
    const { container, rerender } = render(<Odometer value={47} />)
    rerender(<Odometer value={52} />)
    expect(container.querySelector('.odo-hot')).not.toBeNull()
    act(() => void vi.advanceTimersByTime(899))
    expect(container.querySelector('.odo-hot')).not.toBeNull()
    act(() => void vi.advanceTimersByTime(1))
    expect(container.querySelector('.odo-hot')).toBeNull()
  })

  it('restarts the glow when the value changes again mid-glow', () => {
    vi.useFakeTimers()
    const { container, rerender } = render(<Odometer value={47} />)
    rerender(<Odometer value={52} />)
    const first = container.querySelector('.odo')!.className
    act(() => void vi.advanceTimersByTime(400))
    rerender(<Odometer value={60} />)
    // A different animation name restarts the CSS animation.
    expect(container.querySelector('.odo')!.className).not.toBe(first)
    // The old 900 ms timer must not cut the new glow short.
    act(() => void vi.advanceTimersByTime(600))
    expect(container.querySelector('.odo-hot')).not.toBeNull()
    act(() => void vi.advanceTimersByTime(300))
    expect(container.querySelector('.odo-hot')).toBeNull()
  })

  // Reduced motion is CSS only (`@media (prefers-reduced-motion)` in index.css), which jsdom cannot evaluate: not tested here.
})
