import type { Mood } from './lines'

interface Props {
  mood: Mood
  talking: boolean
}

/**
 * A cartoon bust of the coach, drawn here in SVG (no photos, no official art): a fan-made character inspired
 * by Deni Avdija, in the app's colours. Mood changes the brows and the smile; `talking` moves the mouth.
 */
export default function DeniAvatar({ mood, talking }: Props) {
  const skin = '#c68a5d'
  const shade = '#a9714a'
  const hair = '#1b130e'
  const brow = (side: -1 | 1) => {
    // Hmm: the far brow goes up and the near one flattens. Hype: both lift. Otherwise level.
    const lift = mood === 'hype' ? -5 : mood === 'hmm' && side === 1 ? -6 : 0
    const x = side === -1 ? 41 : 66
    return <path d={`M${x} ${40 + lift} q7 ${mood === 'hmm' && side === -1 ? 1 : -3} 13 0`} fill="none" stroke={hair} strokeWidth="3" strokeLinecap="round" />
  }
  return (
    <svg className={`deni deni-${mood}${talking ? ' talking' : ''}`} viewBox="0 0 120 120" aria-hidden="true" focusable="false">
      {/* Shoulders in a dark jersey with an orange collar. */}
      <path d="M6 120 Q10 92 42 86 H78 Q110 92 114 120 Z" fill="#17233b" />
      <path d="M44 86 Q60 104 76 86 L72 84 Q60 96 48 84 Z" fill="#ff7a2f" />
      <rect x="51" y="74" width="18" height="16" rx="6" fill={shade} />
      {/* Ears, head, hair. */}
      <circle cx="36" cy="54" r="5" fill={shade} />
      <circle cx="84" cy="54" r="5" fill={shade} />
      <ellipse cx="60" cy="52" rx="24" ry="28" fill={skin} />
      <g fill={hair}>
        <circle cx="42" cy="30" r="9" />
        <circle cx="52" cy="24" r="10" />
        <circle cx="64" cy="23" r="10" />
        <circle cx="75" cy="29" r="9" />
        <circle cx="37" cy="40" r="6" />
        <circle cx="83" cy="40" r="6" />
        <ellipse cx="60" cy="34" rx="22" ry="9" />
      </g>
      {/* Stubble along the jaw. */}
      <path d="M37 56 Q40 80 60 81 Q80 80 83 56 Q78 70 60 71 Q42 70 37 56Z" fill={hair} opacity="0.55" />
      {/* Eyes blink together. */}
      <g className="deni-eyes">
        <ellipse cx="48" cy="50" rx="4.5" ry="5" fill="#fff" />
        <ellipse cx="72" cy="50" rx="4.5" ry="5" fill="#fff" />
        <circle cx="49" cy="51" r="2.6" fill={hair} />
        <circle cx="73" cy="51" r="2.6" fill={hair} />
      </g>
      {brow(-1)}
      {brow(1)}
      <path d="M60 54 q-3 8 0 10 q3 1 4 -1" fill="none" stroke={shade} strokeWidth="2" strokeLinecap="round" />
      {/* Mouth: open and moving while talking, otherwise by mood. */}
      {talking ? (
        <ellipse className="deni-mouth" cx="60" cy="72" rx="7" ry="5" fill="#4a1f1a" />
      ) : mood === 'hype' ? (
        <path d="M49 67 Q60 82 71 67 Z" fill="#4a1f1a" stroke={hair} strokeWidth="1.5" strokeLinejoin="round" />
      ) : mood === 'hmm' ? (
        <path d="M52 72 Q60 70 68 73" fill="none" stroke={hair} strokeWidth="3" strokeLinecap="round" />
      ) : (
        <path d="M50 69 Q60 77 70 69" fill="none" stroke={hair} strokeWidth="3" strokeLinecap="round" />
      )}
    </svg>
  )
}
