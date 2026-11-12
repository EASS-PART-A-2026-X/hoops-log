/**
 * The drawn surfaces of the 3D coach: his jersey, the ball, the floor disc and the soft shadow. All painted on
 * canvases here (no image files, no official artwork): a fan-made black Portland-style kit with the diagonal
 * red and white sash and number 8.
 */
export const KIT = { black: '#0c0c0e', red: '#e03a3e', white: '#f4f4f2', skin: '#dcaa8a', skinShade: '#c18f70', hair: '#1c1512' }

const FONT = '"Barlow Condensed", Impact, "Arial Narrow", sans-serif'

function canvasOf(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return [c, c.getContext('2d')!]
}

/**
 * The jersey, wrapped once around the torso: the middle of the canvas is the chest, both edges meet on the back.
 * The top of the canvas is the neck. Skin is painted where the jersey is cut away (neck, V collar, arm holes).
 */
export function drawJersey(): HTMLCanvasElement {
  const W = 1024
  const H = 512
  const [c, g] = canvasOf(W, H)
  g.fillStyle = KIT.black
  g.fillRect(0, 0, W, H)

  // The sash: red and white stripes running down across the chest.
  g.save()
  g.translate(W / 2, 250)
  g.rotate(-0.42)
  const stripes: [number, number, string][] = [
    [-46, 30, KIT.red],
    [-12, 9, KIT.white],
    [1, 9, KIT.red],
    [14, 9, KIT.white],
    [27, 9, KIT.red],
  ]
  for (const [y, h, color] of stripes) {
    g.fillStyle = color
    g.fillRect(-230, y, 460, h)
  }
  g.fillStyle = KIT.white
  g.font = `italic 800 40px ${FONT}`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText('BLAZERS', -6, -78)
  g.restore()

  const number = (x: number, y: number, size: number) => {
    g.font = `800 ${size}px ${FONT}`
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.lineJoin = 'round'
    g.strokeStyle = KIT.black
    g.lineWidth = size * 0.16
    g.strokeText('8', x, y)
    g.strokeStyle = KIT.red
    g.lineWidth = size * 0.07
    g.strokeText('8', x, y)
    g.fillStyle = KIT.white
    g.fillText('8', x, y)
  }
  number(W / 2 + 56, 372, 150)

  // The back sits on the seam, so it is drawn at both edges.
  for (const x of [0, W]) {
    g.fillStyle = KIT.white
    g.font = `800 46px ${FONT}`
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText('AVDIJA', x, 168)
    number(x, 318, 190)
  }

  // Side panels under the arms.
  for (const x of [W / 4, (3 * W) / 4]) {
    g.fillStyle = KIT.red
    g.fillRect(x - 13, 170, 10, H)
    g.fillStyle = KIT.white
    g.fillRect(x + 3, 170, 5, H)
  }

  // Where there is no jersey: the neck, the V collar and the arm holes, each with a red and white trim.
  const cut = (path: () => void) => {
    path()
    g.lineJoin = 'round'
    g.strokeStyle = KIT.white
    g.lineWidth = 18
    g.stroke()
    path()
    g.strokeStyle = KIT.red
    g.lineWidth = 9
    g.stroke()
    path()
    g.fillStyle = KIT.skin
    g.fill()
  }
  cut(() => {
    g.beginPath()
    g.moveTo(-20, -20)
    g.lineTo(-20, 34)
    g.lineTo(W / 2 - 92, 34)
    g.lineTo(W / 2, 112)
    g.lineTo(W / 2 + 92, 34)
    g.lineTo(W + 20, 34)
    g.lineTo(W + 20, -20)
    g.closePath()
  })
  for (const x of [W / 4, (3 * W) / 4]) {
    cut(() => {
      g.beginPath()
      g.ellipse(x, 62, 74, 92, 0, 0, Math.PI * 2)
    })
  }
  return c
}

/** The ball's colour: a deep, slightly uneven orange with a fine grain. The seams are separate tubes (see buildDeni). */
export function drawBall(): HTMLCanvasElement {
  const W = 512
  const H = 256
  const [c, g] = canvasOf(W, H)
  const fade = g.createLinearGradient(0, 0, 0, H)
  fade.addColorStop(0, '#bf4f19')
  fade.addColorStop(0.5, '#d0601f')
  fade.addColorStop(1, '#b84714')
  g.fillStyle = fade
  g.fillRect(0, 0, W, H)
  let seed = 7
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = rand() > 0.5 ? 'rgba(0,0,0,0.06)' : 'rgba(255,190,130,0.07)'
    g.fillRect(rand() * W, rand() * H, 1.6, 1.6)
  }
  return c
}

/** The pebbled leather as a bump map: a grid of tiny dimples (lighter = higher). */
export function drawBallBump(): HTMLCanvasElement {
  const W = 512
  const H = 256
  const [c, g] = canvasOf(W, H)
  g.fillStyle = '#b4b4b4'
  g.fillRect(0, 0, W, H)
  for (let y = 0; y < H; y += 5) {
    for (let x = 0; x < W; x += 5) {
      const ox = (y / 5) % 2 ? 2.5 : 0
      g.fillStyle = '#5a5a5a'
      g.beginPath()
      g.arc(x + ox, y, 1.35, 0, Math.PI * 2)
      g.fill()
    }
  }
  return c
}

/** The disc he stands on: dark hardwood look with a red and a white ring. */
export function drawFloor(): HTMLCanvasElement {
  const S = 512
  const [c, g] = canvasOf(S, S)
  const glow = g.createRadialGradient(S / 2, S / 2, 20, S / 2, S / 2, S / 2)
  glow.addColorStop(0, '#3a2a22')
  glow.addColorStop(0.7, '#17110f')
  glow.addColorStop(1, '#0a0808')
  g.fillStyle = glow
  g.beginPath()
  g.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2)
  g.fill()
  g.strokeStyle = 'rgba(0,0,0,0.35)'
  g.lineWidth = 1.5
  for (let x = 16; x < S; x += 22) {
    g.beginPath()
    g.moveTo(x, 0)
    g.lineTo(x, S)
    g.stroke()
  }
  g.globalCompositeOperation = 'destination-in'
  g.beginPath()
  g.arc(S / 2, S / 2, S / 2 - 1, 0, Math.PI * 2)
  g.fill()
  g.globalCompositeOperation = 'source-over'
  g.strokeStyle = KIT.red
  g.lineWidth = 9
  g.beginPath()
  g.arc(S / 2, S / 2, S / 2 - 16, 0, Math.PI * 2)
  g.stroke()
  g.strokeStyle = KIT.white
  g.lineWidth = 3
  g.beginPath()
  g.arc(S / 2, S / 2, S / 2 - 30, 0, Math.PI * 2)
  g.stroke()
  return c
}

/** A soft round shadow to lay on the floor (real shadow maps would cost far more for no visible gain here). */
export function drawShadow(): HTMLCanvasElement {
  const S = 128
  const [c, g] = canvasOf(S, S)
  const fade = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2)
  fade.addColorStop(0, 'rgba(0,0,0,0.75)')
  fade.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = fade
  g.fillRect(0, 0, S, S)
  return c
}
