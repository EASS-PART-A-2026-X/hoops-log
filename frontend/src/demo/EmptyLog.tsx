interface Props {
  onAdd: () => void
  onDemo: () => void
}

/** What a new account sees on the empty court: a way to start, a way to look around, and who the shots belong to. */
export default function EmptyLog({ onAdd, onDemo }: Props) {
  return (
    <div className="welcome" role="region" aria-label="Welcome">
      <p className="welcome-kicker">LEVEL 1 · ROOKIE</p>
      <h3>YOUR LOG IS EMPTY</h3>
      <p className="welcome-text">Log a shot and the court lights up. Want to see what it looks like first? Take the demo for a tour of a full court.</p>
      <div className="welcome-actions">
        <button type="button" className="welcome-go" onClick={onAdd}>
          ADD YOUR FIRST SHOT
        </button>
        <button type="button" className="welcome-demo" onClick={onDemo}>
          TRY THE DEMO
        </button>
      </div>
      <p className="welcome-note">
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="5" y="11" width="14" height="9" rx="2" />
          <path d="M8 11V8a4 4 0 018 0v3" />
        </svg>
        <span>The shots you add are only yours. They never go into the demo, and the demo&rsquo;s shots are never yours.</span>
      </p>
    </div>
  )
}
