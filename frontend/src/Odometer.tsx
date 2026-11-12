import { useEffect, useRef, useState } from 'react'

interface Props {
  /** 0 or more, shown to one decimal place at most (47 or 47.4). Anything else (negative, NaN, infinite) shows 0. */
  value: number
}

const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]

/** The text shown for a value: one decimal at most, never negative, never "NaN". */
function odometerText(value: number): string {
  return String(Number.isFinite(value) ? Math.max(0, Math.round(value * 10) / 10) : 0)
}

/**
 * A number whose digits roll like an arena scoreboard: each digit is a strip of 0-9 that slides to its
 * new value, and the number glows briefly when it changes. Screen readers get the plain number; with
 * reduced motion the digits just switch (see `.odo-strip` in index.css).
 */
export default function Odometer({ value }: Props) {
  const text = odometerText(value)
  const [hot, setHot] = useState(false)
  // Counts the changes. The glow alternates between two identically drawn animations (`odo-hot-a`/`-b`), so a
  // change that lands while the glow is still running swaps the animation name and the glow restarts.
  const [pulse, setPulse] = useState(0)
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    setPulse((n) => n + 1)
    setHot(true)
    const id = window.setTimeout(() => setHot(false), 900)
    return () => window.clearTimeout(id)
  }, [text])
  return (
    <span className={hot ? `odo odo-hot ${pulse % 2 ? 'odo-hot-a' : 'odo-hot-b'}` : 'odo'}>
      <span className="odo-text">{text}</span>
      <span className="odo-digits" aria-hidden="true">
        {/* Counted from the right, so a digit keeps its column when the number grows a place. */}
        {[...text].map((d, i) =>
          d === '.' ? (
            <span className="odo-dot" key={text.length - i}>
              .
            </span>
          ) : (
            <span className="odo-col" key={text.length - i}>
              <span className="odo-strip" style={{ transform: `translateY(${-Number(d)}em)` }}>
                {DIGITS.map((n) => (
                  <span key={n}>{n}</span>
                ))}
              </span>
            </span>
          ),
        )}
      </span>
    </span>
  )
}
