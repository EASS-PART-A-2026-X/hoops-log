// Floating sparks: fixed numbers, so the screen looks the same every time and tests do not depend on chance.
const SPARKS = Array.from({ length: 14 }, (_, i) => ({
  left: (i * 37) % 100,
  size: 3 + ((i * 7) % 6),
  delay: -((i * 13) % 11),
  dur: 7 + ((i * 5) % 8),
  blue: i % 3 === 0,
}))

/** The moving court floor, spotlights and sparks behind the title screen and the login screen. */
export default function TitleBackdrop() {
  return (
    <div className="t-bg" aria-hidden="true">
      <div className="t-sky" />
      <div className="t-beam b1" />
      <div className="t-beam b2" />
      <div className="t-beam b3" />
      <div className="t-floor">
        <div className="t-grid">
          <div />
        </div>
        <div className="t-key" />
        <div className="t-arc" />
      </div>
      <div className="t-rings">
        <i />
        <i />
        <i />
      </div>
      {SPARKS.map((s, i) => (
        <b
          key={i}
          className={s.blue ? 'spark blue' : 'spark'}
          style={{ left: `${s.left}%`, width: s.size, height: s.size, animationDelay: `${s.delay}s`, animationDuration: `${s.dur}s` }}
        />
      ))}
      <div className="t-scan" />
      <div className="t-vignette" />
    </div>
  )
}
