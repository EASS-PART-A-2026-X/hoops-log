import { useEffect, useRef, useState } from 'react'
import { downloadCard } from './cardImage'
import type { CardProfile } from './court/cardData'
import ShotCard from './ShotCard'

interface Props {
  profile: CardProfile
  onClose: () => void
}

/** The card at full size, tilting with the pointer, with a button to save it as a picture. */
export default function CardDialog({ profile, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    // Remember who had focus, so it goes back there when the card closes.
    const opener = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    return () => opener?.focus?.()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopImmediatePropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  async function save() {
    setSaving(true)
    setMessage('')
    try {
      await downloadCard(profile)
      setMessage('Saved as a picture.')
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : 'Could not save the card.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card-dialog" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="card-dialog-body" role="dialog" aria-modal="true" aria-label={`Shot card of ${profile.name}`}>
        <ShotCard profile={profile} size="big" />
        <div className="card-dialog-actions">
          <button type="button" className="btn primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Download card'}
          </button>
          <button type="button" className="btn" ref={closeRef} onClick={onClose}>
            Close
          </button>
        </div>
        <p className="card-dialog-note" role="status" aria-live="polite">
          {message}
        </p>
      </div>
    </div>
  )
}
