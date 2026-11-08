import { useLayoutEffect } from 'react'
import type { RefObject } from 'react'

/**
 * The smallest the content is shrunk to. A window so small that this is reached cannot show the dialog
 * legibly anyway; the dialogs clip rather than scroll, so the floor is low enough to keep everything on screen
 * in any window a person could realistically use.
 */
export const MIN_FIT = 0.15

/**
 * The scale that makes content of `contentW` x `contentH` fit a box of `boxW` x `boxH` with `pad` of free space all
 * round (never above 1). `pad` is for content with no room of its own; content that carries its own padding passes 0.
 */
export function fitScale(boxW: number, boxH: number, contentW: number, contentH: number, pad: number): number {
  const sizes = [boxW, boxH, contentW, contentH]
  if (sizes.some((v) => !Number.isFinite(v) || v <= 0)) return 1 // not laid out (or a test): leave it alone
  const k = Math.min(1, (boxH - 2 * pad) / contentH, (boxW - 2 * pad) / contentW)
  return Number.isFinite(k) ? Math.max(MIN_FIT, k) : 1
}

/**
 * Keeps `content` inside `box` by scaling it down when the window is too small, so a dialog never needs
 * scrolling. It sets the CSS variable --fit (1 = natural size) on the content, which uses it in a transform.
 * The size it measures is the layout size, which a transform does not change, so scaling cannot feed back.
 * `pad` is the free space to keep around content that has none of its own (the card); content with its own padding (the face-off) passes 0.
 */
export function useFit(box: RefObject<HTMLElement | null>, content: RefObject<HTMLElement | null>, pad = 16): void {
  useLayoutEffect(() => {
    const b = box.current
    const c = content.current
    if (!b || !c) return
    // The layout size (offsetWidth/Height), not scrollWidth/Height: scroll sizes also count things an entrance
    // animation has moved off screen for a moment, and nothing would re-measure once it ends. The dialogs lay
    // themselves out to the window's width; only the height needs shrinking.
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
