// @vitest-environment jsdom
import { useRef } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { MIN_FIT, fitScale, useFit } from './useFit'

afterEach(cleanup)

describe('fitScale', () => {
  it('leaves content that already fits alone', () => {
    expect(fitScale(1000, 800, 400, 500, 16)).toBe(1)
  })

  it('shrinks content that is too tall, leaving the padding free', () => {
    expect(fitScale(1000, 600, 400, 1000, 20)).toBeCloseTo(0.56)
  })

  it('shrinks content that is too wide', () => {
    expect(fitScale(400, 900, 800, 300, 0)).toBeCloseTo(0.5)
  })

  it('takes the smaller of the two', () => {
    expect(fitScale(400, 300, 800, 600, 0)).toBeCloseTo(0.5)
  })

  it('never goes below the smallest scale, and ignores a box that is not laid out', () => {
    expect(fitScale(1000, 100, 400, 1000, 0)).toBe(MIN_FIT)
    expect(fitScale(0, 0, 400, 500, 16)).toBe(1)
    expect(fitScale(1000, 800, 0, 0, 16)).toBe(1)
  })
})

describe('useFit', () => {
  function Probe() {
    const box = useRef<HTMLDivElement>(null)
    const content = useRef<HTMLDivElement>(null)
    useFit(box, content, 10)
    return (
      <div ref={box} data-testid="box">
        <div ref={content} data-testid="content" />
      </div>
    )
  }

  it('sets --fit on the content from the measured sizes', () => {
    const proto = HTMLElement.prototype
    const saved = { cw: Object.getOwnPropertyDescriptor(Element.prototype, 'clientHeight'), oh: Object.getOwnPropertyDescriptor(proto, 'offsetHeight') }
    // Sizes are looked up per element, so give the box and the content their own.
    Object.defineProperty(Element.prototype, 'clientWidth', { configurable: true, get() { return this.dataset?.testid === 'box' ? 500 : 0 } })
    Object.defineProperty(Element.prototype, 'clientHeight', { configurable: true, get() { return this.dataset?.testid === 'box' ? 410 : 0 } })
    Object.defineProperty(proto, 'offsetWidth', { configurable: true, get() { return this.dataset?.testid === 'content' ? 300 : 0 } })
    Object.defineProperty(proto, 'offsetHeight', { configurable: true, get() { return this.dataset?.testid === 'content' ? 780 : 0 } })
    try {
      const { getByTestId } = render(<Probe />)
      // (410 - 20) / 780 = 0.5
      expect(getByTestId('content').style.getPropertyValue('--fit')).toBe('0.5')
    } finally {
      if (saved.cw) Object.defineProperty(Element.prototype, 'clientHeight', saved.cw)
      else delete (Element.prototype as unknown as Record<string, unknown>).clientHeight
      delete (Element.prototype as unknown as Record<string, unknown>).clientWidth
      delete (proto as unknown as Record<string, unknown>).offsetWidth
      delete (proto as unknown as Record<string, unknown>).offsetHeight
    }
  })

  it('is 1 in an environment with no layout', () => {
    const { getByTestId } = render(<Probe />)
    expect(getByTestId('content').style.getPropertyValue('--fit')).toBe('1')
  })
})
