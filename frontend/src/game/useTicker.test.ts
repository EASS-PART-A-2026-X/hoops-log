// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTicker } from './useTicker'

function stubMotion(reduced: boolean) {
  vi.stubGlobal('matchMedia', () => ({ matches: reduced, addEventListener() {}, removeEventListener() {} }))
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('useTicker', () => {
  it('starts at its target', () => {
    stubMotion(false)
    expect(renderHook(() => useTicker(40)).result.current).toBe(40)
  })

  it('counts to a new target and ends exactly on it', () => {
    stubMotion(false)
    const { result, rerender } = renderHook(({ v }) => useTicker(v, 600), { initialProps: { v: 0 } })
    rerender({ v: 80 })
    act(() => void vi.advanceTimersByTime(250))
    expect(result.current).toBeGreaterThan(0)
    expect(result.current).toBeLessThan(80)
    act(() => void vi.advanceTimersByTime(800))
    expect(result.current).toBe(80)
  })

  it('jumps straight to the target with reduced motion', () => {
    stubMotion(true)
    const { result, rerender } = renderHook(({ v }) => useTicker(v), { initialProps: { v: 0 } })
    rerender({ v: 80 })
    expect(result.current).toBe(80)
  })
})
