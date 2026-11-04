import { useState } from 'react'

interface Props {
  src: string
  /** Empty for a decorative image; the fallback is then hidden from screen readers too. */
  alt: string
  /** What to draw if the image cannot load, so no broken-image icon ever shows. */
  fallback: string
  className: string
  /** Extra class(es) for the fallback badge. */
  fallbackClassName: string
}

/** An image that falls back to a drawn badge. The failure is remembered per `src`, so a new image gets a fresh try. */
export default function FallbackImage({ src, alt, fallback, className, fallbackClassName }: Props) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  if (failedSrc === src) {
    const a11y = alt === '' ? { 'aria-hidden': true as const } : { role: 'img', 'aria-label': alt }
    return (
      <span className={`${className} ${fallbackClassName}`} {...a11y}>
        {fallback}
      </span>
    )
  }
  return <img className={className} src={src} alt={alt} loading="lazy" onError={() => setFailedSrc(src)} />
}
