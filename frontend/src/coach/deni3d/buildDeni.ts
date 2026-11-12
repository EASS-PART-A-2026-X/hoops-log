/**
 * Builds the 3D coach out of simple shapes (no model file to download): a tall forward with short dark hair,
 * a trimmed beard and heavy brows, in a black Portland-style number 8 kit, dribbling a ball. A stylised
 * fan-made figure inspired by Deni Avdija, not a scan of him. Metres, feet on y = 0, facing +Z.
 */
import * as THREE from 'three'
import { BALL_R } from './pose'
import { KIT, drawBall, drawJersey, drawShadow } from './textures'

export interface DeniRig {
  root: THREE.Group
  body: THREE.Group
  head: THREE.Group
  mouth: THREE.Mesh
  eyes: THREE.Group
  brows: THREE.Group
  rShoulder: THREE.Group
  rElbow: THREE.Group
  lShoulder: THREE.Group
  lElbow: THREE.Group
  ball: THREE.Mesh
  ballShadow: THREE.Mesh
}

/** The arm he wears the black compression sleeve on. Change this one word to move it. */
export const SLEEVE_ARM: 'right' | 'left' = 'right'
export const SHOULDER_Y = 1.63
const UPPER_ARM = 0.34

/** A point on the head (an ellipsoid), from angles: `theta` down from the crown, `phi` round from his right ear. */
function onHead(theta: number, phi: number, grow = 1): THREE.Vector3 {
  return new THREE.Vector3(-HEAD.rx * Math.cos(phi) * Math.sin(theta), HEAD.ry * Math.cos(theta), HEAD.rz * Math.sin(phi) * Math.sin(theta)).multiplyScalar(grow)
}
const HEAD = { rx: 0.106, ry: 0.138, rz: 0.118, y: 0.135 }
/** The hair sits tilted back, so the hairline is high over the forehead and low on the neck. */
const HAIR_TILT = -0.34

export function buildDeni(maxAnisotropy: number): DeniRig {
  const mat = (color: string, roughness = 0.65) => new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 })
  const skin = mat(KIT.skin, 0.55)
  const skinShade = mat(KIT.skinShade, 0.6)
  const hair = mat(KIT.hair, 0.95)
  const fade = mat('#33271f', 0.95)
  const black = mat(KIT.black, 0.7)
  const red = mat(KIT.red, 0.6)
  const white = mat(KIT.white, 0.6)
  const mesh = (geo: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, material)
    m.position.set(x, y, z)
    return m
  }

  const root = new THREE.Group()
  const body = new THREE.Group()
  root.add(body)

  // ----- legs, socks, shoes -----
  for (const side of [-1, 1]) {
    const x = side * 0.125
    // Thigh and calf overlap at the knee, so the leg reads as one limb and not as a jointed doll.
    body.add(mesh(new THREE.CapsuleGeometry(0.104, 0.26, 6, 16), skin, x, 0.83, 0))
    const calf = mesh(new THREE.CapsuleGeometry(0.08, 0.28, 6, 16), skin, x, 0.38, -0.008)
    calf.scale.z = 1.1
    body.add(calf)
    body.add(mesh(new THREE.CylinderGeometry(0.074, 0.062, 0.13, 16), white, x, 0.17, 0))
    const upper = mesh(new THREE.CapsuleGeometry(0.058, 0.17, 6, 14), white, x, 0.075, 0.05)
    upper.rotation.x = Math.PI / 2
    upper.scale.set(1, 1, 0.85)
    body.add(upper)
    body.add(mesh(new THREE.BoxGeometry(0.118, 0.035, 0.3), black, x, 0.018, 0.055))
    body.add(mesh(new THREE.BoxGeometry(0.121, 0.03, 0.12), red, x, 0.062, 0.135))
    // Shorts leg, with a stripe down the outside.
    body.add(mesh(new THREE.CylinderGeometry(0.122, 0.138, 0.44, 20), black, x, 0.9, 0))
    body.add(mesh(new THREE.BoxGeometry(0.012, 0.4, 0.05), red, x + side * 0.129, 0.9, 0))
    body.add(mesh(new THREE.BoxGeometry(0.012, 0.4, 0.014), white, x + side * 0.129, 0.9, 0.036))
  }
  const hips = mesh(new THREE.CylinderGeometry(0.2, 0.245, 0.17, 24), black, 0, 1.08, 0)
  hips.scale.z = 0.72
  body.add(hips)
  const band = mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.03, 24), red, 0, 1.165, 0)
  band.scale.z = 0.72
  body.add(band)

  // ----- torso in the jersey -----
  const profile = [
    [0.185, 1.08],
    [0.196, 1.2],
    [0.212, 1.35],
    [0.236, 1.5],
    [0.246, 1.6],
    [0.2, 1.68],
    [0.12, 1.725],
    [0.07, 1.745],
  ].map(([r, y]) => new THREE.Vector2(r!, y!))
  const jerseyTex = new THREE.CanvasTexture(drawJersey())
  jerseyTex.colorSpace = THREE.SRGBColorSpace
  jerseyTex.wrapS = THREE.RepeatWrapping
  jerseyTex.anisotropy = maxAnisotropy
  // The seam goes on his back (phi starts there), so the middle of the texture is the chest.
  const torso = mesh(new THREE.LatheGeometry(profile, 40, Math.PI, Math.PI * 2), new THREE.MeshStandardMaterial({ map: jerseyTex, roughness: 0.75 }))
  torso.scale.z = 0.72
  body.add(torso)
  body.add(mesh(new THREE.CylinderGeometry(0.064, 0.074, 0.12, 16), skin, 0, 1.775, 0))

  // ----- arms: shoulder -> upper arm -> elbow -> forearm -> hand -----
  const arm = (side: number) => {
    const shoulder = new THREE.Group()
    shoulder.position.set(side * 0.258, SHOULDER_Y, 0)
    shoulder.add(mesh(new THREE.SphereGeometry(0.074, 16, 12), skin))
    // The upper arm runs into the shoulder and the elbow, so no joint shows.
    shoulder.add(mesh(new THREE.CapsuleGeometry(0.06, UPPER_ARM - 0.06, 6, 14), skin, 0, -UPPER_ARM / 2, 0))
    const elbow = new THREE.Group()
    elbow.position.y = -UPPER_ARM
    elbow.add(mesh(new THREE.SphereGeometry(0.056, 14, 10), skin))
    elbow.add(mesh(new THREE.CylinderGeometry(0.055, 0.04, 0.27, 14), skin, 0, -0.14, 0))
    const hand = mesh(new THREE.SphereGeometry(0.058, 14, 10), skin, 0, -0.325, 0)
    hand.scale.set(0.8, 1.15, 0.5)
    elbow.add(hand)
    shoulder.add(elbow)
    if ((side === -1) === (SLEEVE_ARM === 'right')) {
      // A black compression sleeve from the upper arm to just short of the wrist, with a thin red band at the top.
      const fabric = mat(KIT.black, 0.92)
      shoulder.add(mesh(new THREE.CylinderGeometry(0.0655, 0.0655, 0.14, 18), fabric, 0, -UPPER_ARM + 0.07, 0))
      shoulder.add(mesh(new THREE.CylinderGeometry(0.0675, 0.0675, 0.012, 18), red, 0, -UPPER_ARM + 0.14, 0))
      elbow.add(mesh(new THREE.SphereGeometry(0.0615, 14, 10), fabric))
      elbow.add(mesh(new THREE.CylinderGeometry(0.0605, 0.0445, 0.25, 18), fabric, 0, -0.13, 0))
    }
    body.add(shoulder)
    return { shoulder, elbow }
  }
  const right = arm(-1)
  const left = arm(1)

  // ----- head -----
  const head = new THREE.Group()
  head.position.set(0, 1.81, 0)
  head.scale.setScalar(1.16)
  body.add(head)
  const face = new THREE.Group()
  face.position.y = HEAD.y
  head.add(face)
  const skull = mesh(new THREE.SphereGeometry(1, 32, 24), skin)
  skull.scale.set(HEAD.rx, HEAD.ry, HEAD.rz)
  face.add(skull)
  for (const side of [-1, 1]) {
    const ear = mesh(new THREE.SphereGeometry(0.028, 12, 10), skinShade, side * 0.105, -0.005, -0.008)
    ear.scale.set(0.45, 1, 0.75)
    face.add(ear)
  }
  const nose = mesh(new THREE.SphereGeometry(0.02, 12, 10), skinShade, 0, -0.018, 0.116)
  nose.scale.set(0.85, 1.35, 1.1)
  face.add(nose)

  // Hair: a short faded layer round the sides and back, a darker top, and curls on it.
  const shell = (material: THREE.Material, grow: number, phiStart: number, phiLength: number, thetaStart: number, thetaLength: number) => {
    const m = mesh(new THREE.SphereGeometry(1, 32, 16, phiStart, phiLength, thetaStart, thetaLength), material)
    m.scale.set(HEAD.rx * grow, HEAD.ry * grow, HEAD.rz * grow)
    return m
  }
  const hairGroup = new THREE.Group()
  hairGroup.rotation.x = HAIR_TILT
  face.add(hairGroup)
  hairGroup.add(shell(fade, 1.02, Math.PI / 2 + 1.0, Math.PI * 2 - 2.0, 0, Math.PI * 0.56))
  hairGroup.add(shell(hair, 1.05, 0, Math.PI * 2, 0, Math.PI * 0.41))
  const CURLS = 110
  const curls = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), hair, CURLS)
  const dummy = new THREE.Object3D()
  for (let i = 0; i < CURLS; i++) {
    const theta = Math.acos(1 - ((i + 0.5) / CURLS) * (1 - Math.cos(Math.PI * 0.39)))
    const phi = i * 2.39996
    dummy.position.copy(onHead(theta, phi, 1.07))
    // Bigger on top and toward the front, like hair pushed up and forward.
    const front = Math.max(0, Math.sin(phi) * Math.sin(theta))
    dummy.scale.setScalar(0.017 + 0.007 * ((i * 7) % 5) / 4 + 0.008 * front)
    dummy.rotation.set(i, i * 2, i * 3)
    dummy.updateMatrix()
    curls.setMatrixAt(i, dummy.matrix)
  }
  hairGroup.add(curls)

  // Beard: a trimmed shell over the jaw and upper lip, open at the mouth.
  const beardMat = mat('#241a15', 1)
  face.add(shell(beardMat, 1.02, Math.PI / 2 - 1.62, 3.24, Math.PI * 0.655, Math.PI * 0.345))
  const moustache = mesh(new THREE.CapsuleGeometry(0.0085, 0.04, 4, 10), beardMat, 0, -0.046, 0.112)
  moustache.rotation.z = Math.PI / 2
  face.add(moustache)
  const lips = mesh(new THREE.SphereGeometry(0.03, 16, 10), mat('#a8695a', 0.5), 0, -0.064, 0.105)
  lips.scale.set(1, 0.36, 0.45)
  face.add(lips)
  const mouth = mesh(new THREE.SphereGeometry(0.024, 16, 10), mat('#2a0f0d', 0.9), 0, -0.066, 0.109)
  mouth.scale.set(1, 0.05, 0.4)
  face.add(mouth)

  // Eyes (they close by squashing), and heavy brows.
  const eyes = new THREE.Group()
  const brows = new THREE.Group()
  for (const side of [-1, 1]) {
    const eye = new THREE.Group()
    eye.position.set(side * 0.041, 0.016, 0.097)
    const white1 = mesh(new THREE.SphereGeometry(0.0165, 14, 10), mat('#f6f1ea', 0.3))
    white1.scale.z = 0.55
    eye.add(white1)
    eye.add(mesh(new THREE.SphereGeometry(0.0085, 12, 8), mat('#2b1c12', 0.3), 0, 0, 0.0075))
    eyes.add(eye)
    const brow = mesh(new THREE.CapsuleGeometry(0.0078, 0.034, 4, 10), hair, side * 0.042, 0.046, 0.104)
    brow.rotation.z = Math.PI / 2 + side * 0.16
    brow.rotation.y = side * 0.32
    brows.add(brow)
  }
  face.add(eyes)
  face.add(brows)

  // ----- the ball and its shadow -----
  const ballTex = new THREE.CanvasTexture(drawBall())
  ballTex.colorSpace = THREE.SRGBColorSpace
  const ball = mesh(new THREE.SphereGeometry(BALL_R, 32, 20), new THREE.MeshStandardMaterial({ map: ballTex, roughness: 0.8 }))
  root.add(ball)
  const shadowTex = new THREE.CanvasTexture(drawShadow())
  const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false })
  const flat = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)
  const bodyShadow = mesh(flat, shadowMat, 0, 0.004, 0.02)
  bodyShadow.scale.set(0.95, 1, 0.7)
  root.add(bodyShadow)
  const ballShadow = mesh(flat, shadowMat.clone(), 0, 0.005, 0)
  root.add(ballShadow)

  return { root, body, head, mouth, eyes, brows, rShoulder: right.shoulder, rElbow: right.elbow, lShoulder: left.shoulder, lElbow: left.elbow, ball, ballShadow }
}
