import type { Mood } from './lines'

interface Props {
  mood: Mood
  talking: boolean
}

/**
 * The coach's bust, drawn here in SVG (no photos, no official art) to match the 3D figure in his dialog: the
 * same light tan skin, heavy brows, tight curly black hair with faded sides, a solid trimmed beard and the
 * black number 8 kit with the red sash. A fan-made character inspired by Deni Avdija. Mood changes the brows
 * and the mouth; `talking` moves the mouth.
 */
export default function DeniAvatar({ mood, talking }: Props) {
  const skin = '#dcaa8a'
  const shade = '#c18f70'
  const hair = '#1c1512'
  const fade = '#33271f'
  const red = '#e03a3e'
  const kit = '#0c0c0e'
  const brow = (side: -1 | 1) => {
    // Hype: both brows lift. Hmm: the far brow goes up. Otherwise they slant down toward the nose, heavy and serious.
    const lift = mood === 'hype' ? -4 : mood === 'hmm' && side === 1 ? -5 : 0
    const outer = 40 + lift
    const inner = 45.5 + (mood === 'hype' ? lift : 0)
    const [x1, x2] = side === -1 ? [41, 56] : [79, 64]
    return <path d={`M${x1} ${outer} L${x2} ${inner}`} fill="none" stroke={hair} strokeWidth="4.4" strokeLinecap="round" />
  }
  const curls = [
    [41, 38, 6],
    [46, 30, 7],
    [53, 25, 7.5],
    [61, 23, 7.5],
    [69, 25, 7.5],
    [75, 30, 7],
    [79, 38, 6],
    [50, 33, 7],
    [60, 31, 7.5],
    [70, 33, 7],
  ]
  return (
    <svg className={`deni deni-${mood}${talking ? ' talking' : ''}`} viewBox="0 0 120 120" aria-hidden="true" focusable="false">
      {/* Shoulders in the black kit: the red sash across the chest with a white stripe, a red V at the neck. */}
      <path d="M4 120 Q8 94 38 88 H82 Q112 94 116 120 Z" fill={kit} />
      <path d="M82 89 L22 120 H42 L84 99 Z" fill={red} />
      <path d="M84 99 L42 120 H47 L85 104 Z" fill="#f4f4f2" />
      {/* A long neck. */}
      <path d="M50 68 H70 V92 Q60 100 50 92 Z" fill={shade} />
      <path d="M44 88 L60 104 L76 88" fill="none" stroke={red} strokeWidth="2.6" strokeLinejoin="round" />
      {/* Ears and the head: narrow, with a square jaw. */}
      <ellipse cx="38.5" cy="52" rx="3.2" ry="5.4" fill={shade} />
      <ellipse cx="81.5" cy="52" rx="3.2" ry="5.4" fill={shade} />
      <path d="M39 44 Q39 24 60 24 Q81 24 81 44 V56 Q81 76 60 80 Q39 76 39 56 Z" fill={skin} />
      {/* Hair: faded sides, then a tight cap of curls pushed up and forward. */}
      <path d="M39 50 Q37 30 48 25 L47 44 Z" fill={fade} />
      <path d="M81 50 Q83 30 72 25 L73 44 Z" fill={fade} />
      <g fill={hair}>
        <ellipse cx="60" cy="33" rx="21" ry="9" />
        {curls.map(([cx, cy, r]) => (
          <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} />
        ))}
      </g>
      {/* The nose, then the beard: solid over the jaw, with a moustache and the lips open between them. */}
      <ellipse cx="60" cy="56" rx="4.2" ry="5.6" fill="#d39a78" />
      <path d="M39 57 Q42 63 49 65 Q60 67 71 65 Q78 63 81 57 V56 Q81 76 60 80 Q39 76 39 56 Z" fill="#241a15" />
      <ellipse cx="60" cy="62" rx="8" ry="2.6" fill="#241a15" />
      {/* Eyes blink together: small, under the heavy brows. */}
      <g className="deni-eyes">
        <ellipse cx="50" cy="49" rx="3" ry="2.8" fill="#f6f1ea" />
        <ellipse cx="70" cy="49" rx="3" ry="2.8" fill="#f6f1ea" />
        <circle cx="50.6" cy="49.4" r="1.7" fill="#2b1c12" />
        <circle cx="70.6" cy="49.4" r="1.7" fill="#2b1c12" />
      </g>
      {brow(-1)}
      {brow(1)}
      {/* Mouth: lips between moustache and beard; open and moving while talking, otherwise by mood. */}
      <ellipse cx="60" cy="66.5" rx="6" ry="2" fill="#a8695a" />
      {talking ? (
        <ellipse className="deni-mouth" cx="60" cy="67" rx="5" ry="3.6" fill="#2a0f0d" />
      ) : mood === 'hype' ? (
        <path d="M54 65.5 Q60 74 66 65.5 Z" fill="#2a0f0d" />
      ) : mood === 'hmm' ? (
        <path d="M55 67 Q60 65.5 65 67.5" fill="none" stroke="#2a0f0d" strokeWidth="1.4" strokeLinecap="round" />
      ) : (
        <path d="M54.5 66.4 Q60 69 65.5 66.4" fill="none" stroke="#2a0f0d" strokeWidth="1.2" strokeLinecap="round" />
      )}
    </svg>
  )
}
