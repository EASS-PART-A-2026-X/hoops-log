import { useEffect, useRef } from 'react'
import type { CardProfile } from './court/cardData'
import { FACE_OFF_MS, faceOffRows, rowWinner } from './court/faceoff'
import ShotCard from './ShotCard'

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
  const rows = faceOffRows(you, them)

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    button.current?.focus()
    const timer = window.setTimeout(onClose, FACE_OFF_MS)
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopImmediatePropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('keydown', onKey, true)
      opener?.focus?.()
    }
  }, [onClose])

  return (
    <div className="faceoff" role="dialog" aria-modal="true" aria-label={`Face-off: ${you.name} against ${them.name}`} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
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
  )
}

