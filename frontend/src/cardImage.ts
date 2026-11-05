import { RADAR_AXES, radarPoint, radarPolygon } from './court/cardData'
import type { CardProfile } from './court/cardData'
import { initials } from './court/players'

const W = 600
const H = 840

/** Rounded rectangle path (the canvas has roundRect, but older browsers do not). */
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/**
 * Draw the card as a picture. It is drawn again here (not copied from the page) so it always works:
 * the page's card shows a photo from another site, and a canvas that has drawn one cannot be saved.
 */
export async function drawCard(profile: CardProfile): Promise<HTMLCanvasElement> {
  // Wait for the display font, or the first download would use a fallback face.
  try {
    await document.fonts.load('700 64px "Barlow Condensed"')
  } catch {
    // no font loading: the fallback face is fine
  }
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('This browser cannot draw the card.')
  const accent = profile.kind === 'you' ? '#ff7a2f' : profile.teamColor ?? '#7fb0ff'
  const accentSoft = profile.kind === 'you' ? '#ff9a5c' : '#bcd8ff'
  const display = '"Barlow Condensed", system-ui, sans-serif'
  const body = '"Barlow", system-ui, sans-serif'

  const bg = ctx.createLinearGradient(0, 0, W, H)
  bg.addColorStop(0, '#162133')
  bg.addColorStop(1, '#0b0f14')
  roundRect(ctx, 6, 6, W - 12, H - 12, 36)
  ctx.fillStyle = bg
  ctx.fill()
  ctx.lineWidth = 6
  ctx.strokeStyle = accent
  ctx.stroke()

  // Rating and play style, top left.
  ctx.fillStyle = '#ffffff'
  ctx.textBaseline = 'alphabetic'
  ctx.font = `700 120px ${display}`
  ctx.fillText(profile.rating === null ? '–' : String(profile.rating), 44, 150)
  ctx.font = `600 22px ${body}`
  ctx.fillStyle = '#9ba9ba'
  ctx.fillText('Shooting rating', 48, 184)
  ctx.font = `700 34px ${display}`
  ctx.fillStyle = accentSoft
  ctx.fillText(profile.style, 44, 232)

  // Portrait badge, top right: initials (the photo is left out on purpose, see above).
  ctx.beginPath()
  ctx.arc(W - 120, 130, 72, 0, Math.PI * 2)
  ctx.fillStyle = profile.kind === 'you' ? '#2a1b12' : '#121923'
  ctx.fill()
  ctx.lineWidth = 4
  ctx.strokeStyle = accent
  ctx.stroke()
  ctx.fillStyle = profile.kind === 'you' ? accentSoft : '#ffffff'
  ctx.textAlign = 'center'
  ctx.font = `700 64px ${display}`
  ctx.fillText(initials(profile.name), W - 120, 152)

  // Name.
  ctx.textAlign = 'left'
  ctx.fillStyle = '#ffffff'
  ctx.font = `700 54px ${display}`
  ctx.fillText(profile.name, 44, 308, W - 88)
  ctx.fillStyle = '#9ba9ba'
  ctx.font = `500 24px ${body}`
  ctx.fillText(profile.subtitle, 46, 342)

  // Radar.
  const cx = W / 2
  const cy = 520
  const r = 130
  ctx.lineWidth = 1.5
  for (const f of [0.25, 0.5, 0.75, 1]) {
    ctx.beginPath()
    RADAR_AXES.forEach((_, i) => {
      const [x, y] = radarPoint(i, RADAR_AXES.length, f, cx, cy, r)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.closePath()
    ctx.strokeStyle = f === 1 ? '#3a4c63' : '#243040'
    ctx.stroke()
  }
  const poly = radarPolygon(profile.radar, cx, cy, r)
  ctx.beginPath()
  poly.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)))
  ctx.closePath()
  ctx.fillStyle = `${accent}66`
  ctx.fill()
  ctx.lineWidth = 3
  ctx.strokeStyle = accent
  ctx.stroke()
  ctx.font = `600 20px ${body}`
  ctx.fillStyle = '#c9d3df'
  ctx.textAlign = 'center'
  RADAR_AXES.forEach((axis, i) => {
    const [x, y] = radarPoint(i, RADAR_AXES.length, 1, cx, cy, r + 26)
    ctx.fillText(axis.label, x, y + 7)
  })

  // The three numbers along the bottom.
  const stats: [string, string][] = [
    ['Field goal', profile.fg === null ? '–' : `${profile.fg}%`],
    ['Three point', profile.three === null ? '–' : `${profile.three}%`],
    ['Threes', profile.threeShare === null ? '–' : `${profile.threeShare}%`],
  ]
  const boxW = 160
  stats.forEach(([label, value], i) => {
    const x = 44 + i * (boxW + 12)
    roundRect(ctx, x, 700, boxW, 84, 16)
    ctx.fillStyle = '#0b0f14'
    ctx.fill()
    ctx.lineWidth = 1.5
    ctx.strokeStyle = '#243040'
    ctx.stroke()
    ctx.textAlign = 'left'
    ctx.fillStyle = '#9ba9ba'
    ctx.font = `600 18px ${body}`
    ctx.fillText(label, x + 16, 728)
    ctx.fillStyle = '#ffffff'
    ctx.font = `700 40px ${display}`
    ctx.fillText(value, x + 16, 768)
  })
  ctx.textAlign = 'right'
  ctx.fillStyle = '#5a6b80'
  ctx.font = `500 16px ${body}`
  ctx.fillText(profile.estimated ? 'Zones estimated · Hoops Log' : `${profile.shots ?? 0} shots · Hoops Log`, W - 40, H - 22)
  return canvas
}

function fileName(profile: CardProfile): string {
  const slug = profile.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'card'
  return `hoops-log-card-${slug}.png`
}

/** Save the card as a PNG through the browser's download. Throws if the browser cannot make the picture. */
export async function downloadCard(profile: CardProfile): Promise<void> {
  const canvas = await drawCard(profile)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('This browser could not make the picture.')
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName(profile)
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
