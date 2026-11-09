import { useEffect, useRef, useState } from 'react'

interface Props {
  /** A whole number, 0 or more. */
  value: number
}

const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]

/**
 * A number whose digits roll like an arena scoreboard: each digit is a strip of 0-9 that slides to its
 * new value, and the number glows briefly when it changes. Screen readers get the plain number; with
 * reduced motion the digits just switch (see `.odo-strip` in index.css).
 */
export default function Odometer({ value }: Props) {
  const text = String(Math.max(0, Math.round(value)))
  const [hot, setHot] = useState(false)
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    setHot(true)
    const id = window.setTimeout(() => setHot(false), 900)
    return () => window.clearTimeout(id)
  }, [text])
  return (
    <span className={hot ? 'odo odo-hot' : 'odo'}>
      <span className="odo-text">{text}</span>
      <span className="odo-digits" aria-hidden="true">
        {/* Counted from the right, so a digit keeps its column when the number grows a place. */}
        {[...text].map((d, i) => (
          <span className="odo-col" key={text.length - i}>
            <span className="odo-strip" style={{ transform: `translateY(${-Number(d)}em)` }}>
              {DIGITS.map((n) => (
                <span key={n}>{n}</span>
              ))}
            </span>
          </span>
        ))}
      </span>
    </span>
  )
}
