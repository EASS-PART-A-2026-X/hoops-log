import { useEffect, useState } from 'react'

/** A number that counts up or down to its new value, like a scoreboard. No movement when reduced motion is on. */
export function useTicker(target: number, ms = 600): number {
  const [shown, setShown] = useState(target)
  useEffect(() => {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduced || shown === target) {
      setShown(target)
      return
    }
    const from = shown
    const start = performance.now()
    let raf = 0
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / ms)
      setShown(Math.round(from + (target - from) * (1 - (1 - t) ** 3)))
      if (t < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
    // `shown` is only the starting point of this run.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [target, ms])
  return shown
}
