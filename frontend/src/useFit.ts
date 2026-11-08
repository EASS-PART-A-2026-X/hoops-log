import { useLayoutEffect } from 'react'
import type { RefObject } from 'react'

/** The smallest the content is shrunk to; below this it is better to scroll than to be unreadable. */
export const MIN_FIT = 0.3

/** The scale that makes content of `contentW` x `contentH` fit a box of `boxW` x `boxH` with `pad` all round (never above 1). */
export function fitScale(boxW: number, boxH: number, contentW: number, contentH: number, pad: number): number {
  if (boxW <= 0 || boxH <= 0 || contentW <= 0 || contentH <= 0) return 1 // not laid out (or a test): leave it alone
  const k = Math.min(1, (boxH - 2 * pad) / contentH, (boxW - 2 * pad) / contentW)
  return Math.max(MIN_FIT, k)
}

/**
 * Keeps `content` inside `box` by scaling it down when the window is too small, so a dialog never needs
 * scrolling. It sets the CSS variable --fit (1 = natural size) on the content, which uses it in a transform.
 * The size it measures is the layout size, which a transform does not change, so scaling cannot feed back.
 */
export function useFit(box: RefObject<HTMLElement | null>, content: RefObject<HTMLElement | null>, pad = 16): void {
  useLayoutEffect(() => {
    const b = box.current
    const c = content.current
    if (!b || !c) return
    const fit = () => c.style.setProperty('--fit', String(fitScale(b.clientWidth, b.clientHeight, c.offsetWidth, c.offsetHeight, pad)))
    fit()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', fit)
      return () => window.removeEventListener('resize', fit)
    }
    const observer = new ResizeObserver(fit)
    observer.observe(b)
    observer.observe(c)
    return () => observer.disconnect()
  }, [box, content, pad])
}
