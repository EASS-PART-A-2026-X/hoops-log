// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearToken, currentToken, getToken, notifySessionEnded, onSessionEnded, setToken } from './session'

function memoryStorage() {
  const data = new Map<string, string>()
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, String(v)),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
  }
}

beforeEach(() => {
  Object.defineProperty(window, 'localStorage', { value: memoryStorage(), configurable: true })
})
afterEach(() => {
  clearToken()
})

describe('the stored token', () => {
  it('starts empty, then keeps what is set until it is cleared', () => {
    expect(getToken()).toBeNull()
    expect(currentToken()).toBeNull()
    setToken('abc')
    expect(getToken()).toBe('abc')
    expect(window.localStorage.getItem('hoops-token')).toBe('abc')
    expect(currentToken()).toBe('abc')
    clearToken()
    expect(getToken()).toBeNull()
    expect(currentToken()).toBeNull()
  })

  it('still works for this tab when the browser blocks storage', () => {
    const blocked = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
      removeItem: () => {
        throw new Error('blocked')
      },
    }
    Object.defineProperty(window, 'localStorage', { value: blocked, configurable: true })
    expect(getToken()).toBeNull()
    setToken('in-memory')
    expect(currentToken()).toBe('in-memory')
    clearToken() // must not throw either
    expect(currentToken()).toBeNull()
  })
})

describe('the session-ended signal', () => {
  it('tells every listener, and stops after unsubscribing', () => {
    const one = vi.fn()
    const two = vi.fn()
    const stopOne = onSessionEnded(one)
    const stopTwo = onSessionEnded(two)
    notifySessionEnded()
    expect(one).toHaveBeenCalledTimes(1)
    expect(two).toHaveBeenCalledTimes(1)
    stopOne()
    notifySessionEnded()
    expect(one).toHaveBeenCalledTimes(1)
    expect(two).toHaveBeenCalledTimes(2)
    stopTwo()
  })

  it('a listener that unsubscribes itself does not skip the next one', () => {
    const calls: string[] = []
    const stop = onSessionEnded(() => {
      calls.push('first')
      stop()
    })
    const stopSecond = onSessionEnded(() => calls.push('second'))
    notifySessionEnded()
    expect(calls).toEqual(['first', 'second'])
    stopSecond()
  })
})
