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
    expect(fitScale(1000, 10, 400, 1000, 0)).toBe(MIN_FIT)
    expect(fitScale(0, 0, 400, 500, 16)).toBe(1)
    expect(fitScale(1000, 800, 0, 0, 16)).toBe(1)
  })

  it('does not let a missing or broken size through as NaN', () => {
    expect(fitScale(Number.NaN, 800, 400, 500, 16)).toBe(1)
    expect(fitScale(1000, 800, undefined as unknown as number, 500, 16)).toBe(1)
    expect(fitScale(1000, 800, 400, Number.POSITIVE_INFINITY, 16)).toBe(1)
  })

  it('content that brings its own padding passes 0 and is left alone when it fits', () => {
    // A face-off as wide as its window and 840 px tall in an 860 px window: no shrink at all.
    expect(fitScale(1440, 860, 1440, 840, 0)).toBe(1)
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

  /** Replace layout getters for the test and put back exactly what was there (or remove what was not). */
  function withLayout(sizes: { box: [number, number]; content: [number, number] }, run: () => void) {
    const targets: [object, string][] = [
      [Element.prototype, 'clientWidth'],
      [Element.prototype, 'clientHeight'],
      [HTMLElement.prototype, 'offsetWidth'],
      [HTMLElement.prototype, 'offsetHeight'],
    ]
    const original = targets.map(([obj, name]) => Object.getOwnPropertyDescriptor(obj, name))
    const idOf = (el: Element) => (el as HTMLElement).dataset.testid
    const value = (name: string, el: Element): number => {
      const box = idOf(el) === 'box'
      const content = idOf(el) === 'content'
      if (name === 'clientWidth') return box ? sizes.box[0] : 0
      if (name === 'clientHeight') return box ? sizes.box[1] : 0
      if (name === 'offsetWidth') return content ? sizes.content[0] : 0
      if (name === 'offsetHeight') return content ? sizes.content[1] : 0
      return 0
    }
    targets.forEach(([obj, name]) =>
      Object.defineProperty(obj, name, {
        configurable: true,
        get(this: Element) {
          return value(name, this)
        },
      }),
    )
    try {
      run()
    } finally {
      targets.forEach(([obj, name], i) => {
        const was = original[i]
        if (was) Object.defineProperty(obj, name, was)
        else delete (obj as Record<string, unknown>)[name]
      })
    }
  }

  it('sets --fit on the content from the measured sizes', () => {
    withLayout({ box: [500, 410], content: [300, 780] }, () => {
      const { getByTestId } = render(<Probe />)
      // (410 - 20) / 780 = 0.5
      expect(getByTestId('content').style.getPropertyValue('--fit')).toBe('0.5')
    })
  })

  it('leaves the layout getters as they were', () => {
    const before = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth')
    withLayout({ box: [500, 410], content: [300, 780] }, () => {
      render(<Probe />)
    })
    expect(Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth')).toEqual(before)
  })

  it('is 1 in an environment with no layout', () => {
    const { getByTestId } = render(<Probe />)
    expect(getByTestId('content').style.getPropertyValue('--fit')).toBe('1')
  })
})
