import { useId } from 'react'

/** The Hoops Log mark: an orange basketball with dark seams. Drawn here, not taken from anywhere. */
export default function Logo({ size = 34 }: { size?: number }) {
  const id = useId()
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id={`${id}-ball`} cx="36%" cy="30%" r="80%">
          <stop offset="0" stopColor="#ffb27a" />
          <stop offset="0.55" stopColor="#ff7a2f" />
          <stop offset="1" stopColor="#d9561a" />
        </radialGradient>
        <clipPath id={`${id}-clip`}>
          <circle cx="24" cy="24" r="21" />
        </clipPath>
      </defs>
      <circle cx="24" cy="24" r="21" fill={`url(#${id}-ball)`} />
      <g clipPath={`url(#${id}-clip)`} fill="none" stroke="#1a0e06" strokeWidth="2.2" strokeLinecap="round">
        <path d="M3 24H45" />
        <path d="M24 3V45" />
        <path d="M9.5 8C17.5 15.5 17.5 32.5 9.5 40" />
        <path d="M38.5 8C30.5 15.5 30.5 32.5 38.5 40" />
      </g>
      <circle cx="24" cy="24" r="21" fill="none" stroke="#1a0e06" strokeWidth="2.2" />
    </svg>
  )
}
