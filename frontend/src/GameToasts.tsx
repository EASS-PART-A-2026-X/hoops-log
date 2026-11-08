import type { GameToast } from './game/useCelebrations'

/** Level-up banners and trophy toasts, stacked at the top of the page. */
export default function GameToasts({ toasts, onDismiss }: { toasts: GameToast[]; onDismiss: (id: number) => void }) {
  return (
    <div className="game-toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`game-toast kind-${t.kind}`}>
          <span className="game-toast-icon" aria-hidden="true">
            {t.kind === 'level' ? '▲' : '★'}
          </span>
          <span className="game-toast-text">
            <strong>{t.title}</strong>
            <span>{t.sub}</span>
          </span>
          <button type="button" className="game-toast-close" onClick={() => onDismiss(t.id)}>
            <span aria-hidden="true">✕</span>
            <span className="sr-only">Dismiss</span>
          </button>
        </div>
      ))}
    </div>
  )
}
