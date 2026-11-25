/** Under the top bar while the demo is on: says plainly that these shots are made up, and the way out. */
export default function DemoBanner({ onExit }: { onExit: () => void }) {
  return (
    <div className="demo-banner" role="status">
      <span className="demo-tag">DEMO</span>
      <span className="demo-text">
        Made-up shots, so you can see a full court. They are not yours, and nothing you do here is saved. Your own shots are untouched.
      </span>
      <button type="button" className="demo-exit" onClick={onExit}>
        EXIT DEMO
      </button>
    </div>
  )
}
