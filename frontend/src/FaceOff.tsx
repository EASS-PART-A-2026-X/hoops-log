import { useEffect, useRef } from 'react'
import { tabTarget } from './focusTrap'
import type { CardProfile } from './court/cardData'
import { FACE_OFF_MS, faceOffRows, rowWinner } from './court/faceoff'
import ShotCard from './ShotCard'
import { useFit } from './useFit'

interface Props {
  you: CardProfile
  them: CardProfile
  /** The sentence from the comparison page: "X is ahead of Y: leading in 8 of 11 areas." */
  verdict: string
  onClose: () => void
}

const show = (v: number | null, unit: string) => (v === null ? '–' : `${v}${unit}`)

/**
 * The versus screen: two cards slide in from opposite sides, VS lands, the bars fill one by one and
 * the verdict appears. Plays once when a new pair is picked (the page decides), and any time from
 * the Face-off button. Clicking anywhere, Escape or the button closes it.
 */
export default function FaceOff({ you, them, verdict, onClose }: Props) {
  const button = useRef<HTMLButtonElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const fitRef = useRef<HTMLDivElement>(null)
  useFit(boxRef, fitRef)
  const rows = faceOffRows(you, them)
  // The latest onClose, so a parent that passes a new function every render does not restart the
  // timer or the focus handling below.
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  })

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    button.current?.focus()
    const timer = window.setTimeout(() => closeRef.current(), FACE_OFF_MS)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopImmediatePropagation()
        closeRef.current()
      } else if (e.key === 'Tab') {
        // The button is the only control: keep focus on it, also when focus is on the body.
        const items = button.current ? [button.current] : []
        const target = tabTarget(items, document.activeElement as HTMLElement | null, items.includes(document.activeElement as HTMLButtonElement), e.shiftKey)
        if (target) {
          e.preventDefault()
          target.focus()
        } else if (items.length > 0) e.preventDefault()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('keydown', onKey, true)
      opener?.focus?.()
    }
  }, [])

  return (
    <div className="faceoff" ref={boxRef} role="dialog" aria-modal="true" aria-label={`Face-off: ${you.name} against ${them.name}`} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="fo-fit" ref={fitRef}>
      <div className="fo-stage">
        <div className="fo-card left">
          <ShotCard profile={you} size="versus" tilt={false} />
        </div>
        <div className="fo-vs" aria-hidden="true">
          VS
        </div>
        <div className="fo-card right">
          <ShotCard profile={them} size="versus" tilt={false} />
        </div>
      </div>
      <div className="fo-rows">
        {rows.map((row, i) => {
          const winner = rowWinner(row)
          return (
            <div className="fo-row" key={row.label} style={{ '--i': i } as React.CSSProperties}>
              <strong className={winner === 'you' ? 'fo-val you win' : 'fo-val you'}>{show(row.you, row.unit)}</strong>
              <span className={winner === 'you' ? 'fo-bar left win' : 'fo-bar left'} aria-hidden="true">
                <span style={{ width: `${row.you === null ? 0 : Math.min(100, (row.you / row.max) * 100)}%` }} />
              </span>
              <span className="fo-label">{row.label}</span>
              <span className={winner === 'them' ? 'fo-bar right win' : 'fo-bar right'} aria-hidden="true">
                <span style={{ width: `${row.them === null ? 0 : Math.min(100, (row.them / row.max) * 100)}%` }} />
              </span>
              <strong className={winner === 'them' ? 'fo-val them win' : 'fo-val them'}>{show(row.them, row.unit)}</strong>
            </div>
          )
        })}
      </div>
      <p className="fo-verdict" role="status">
        {verdict}
      </p>
      <button type="button" className="btn primary" ref={button} onClick={onClose}>
        See the full comparison
      </button>
      </div>
    </div>
  )
}

