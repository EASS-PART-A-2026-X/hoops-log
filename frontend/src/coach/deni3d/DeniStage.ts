/**
 * The small 3D stage the coach stands on: its own renderer, lights and camera, made when the dialog opens and
 * thrown away when it closes, so the rest of the app pays nothing for it. It draws only while the page is
 * visible, and with reduced motion it draws single frames when something changes instead of animating.
 */
import * as THREE from 'three'
import type { Mood } from '../lines'
import { buildDeni } from './buildDeni'
import { loadDeniModel } from './DeniModel'
import type { DeniModel } from './DeniModel'
import type { DeniRig } from './buildDeni'
import { BALL_R, poseAt } from './pose'
import { KIT, drawFloor } from './textures'

/** The turn that brings his right palm from facing his body to facing the floor. */
const PALM_DOWN = Math.PI / 2

const FOV = 27
/** What the camera must keep in view: the figure with the jump and the raised arm, and his reach sideways. */
const VIEW_H = 2.95
const VIEW_W = 1.7
/** He stands in the upper part of the picture: the subtitle sits over the floor under his feet. */
const LOOK_Y = 0.86

export class DeniStage {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 50)
  private rig: DeniRig
  /** The realistic model, once its file has loaded. Until then (or if it cannot load) the drawn figure stands there. */
  private model: DeniModel | null = null
  private raf = 0
  private disposed = false
  private start = performance.now()
  private talking = false
  private mood: Mood = 'idle'
  private moodAt = 0
  private look = { x: 0, y: 0 }
  private lookNow = { x: 0, y: 0 }
  private yaw = 0
  private drag: { x: number; y: number; yaw: number } | null = null
  private resizeObserver: ResizeObserver
  private container: HTMLElement
  private reduced: boolean
  /** Told when the model has loaded (true), or could not (false: the drawn figure is shown instead). */
  onLoad: ((loaded: boolean) => void) | null = null
  /** Called when the visitor taps him (a press and release without dragging). */
  onPoke: (() => void) | null = null

  constructor(container: HTMLElement, reducedMotion: boolean) {
    this.container = container
    this.reduced = reducedMotion
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.1
    const canvas = this.renderer.domElement
    canvas.className = 'deni-canvas'
    canvas.setAttribute('aria-hidden', 'true')
    container.appendChild(canvas)

    this.rig = buildDeni(this.renderer.capabilities.getMaxAnisotropy())
    // Nothing of him is drawn until the model has loaded; the drawn figure only stands in if it cannot.
    this.rig.root.visible = false
    this.scene.add(this.rig.root)
    void this.loadModel()

    const floorTex = new THREE.CanvasTexture(drawFloor())
    floorTex.colorSpace = THREE.SRGBColorSpace
    const floor = new THREE.Mesh(new THREE.CircleGeometry(1.25, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.55, transparent: true }))
    this.scene.add(floor)

    // An arena feel with three lights: a warm key from the front, a red rim and a cool rim from behind.
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#2a1614', 1.0))
    const key = new THREE.DirectionalLight('#fff0df', 2.4)
    key.position.set(1.8, 3.6, 4)
    this.scene.add(key)
    const rimRed = new THREE.DirectionalLight(KIT.red, 3.2)
    rimRed.position.set(-3, 2.4, -2.6)
    this.scene.add(rimRed)
    const rimCool = new THREE.DirectionalLight('#a9c8ff', 1.8)
    rimCool.position.set(3, 3, -3)
    this.scene.add(rimCool)

    canvas.addEventListener('pointerdown', this.onDown)
    canvas.addEventListener('pointermove', this.onMove)
    canvas.addEventListener('pointerup', this.onUp)
    canvas.addEventListener('pointercancel', this.onUp)
    canvas.addEventListener('pointerleave', this.onLeave)
    document.addEventListener('visibilitychange', this.onVisibility)

    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(container)
    this.resize()
    this.loop()
  }

  private async loadModel(): Promise<void> {
    try {
      const model = await loadDeniModel(`${import.meta.env.BASE_URL}deni.glb`, this.renderer.capabilities.getMaxAnisotropy())
      if (this.disposed) return
      // He replaces the drawn body; the ball and the shadows stay (they live in the same root).
      this.rig.body.visible = false
      this.rig.root.visible = true
      this.rig.root.add(model.root)
      this.model = model
      this.onLoad?.(true)
      // He greets you when the dialog opens (or reacts to what he is already feeling).
      if (!this.reduced) model.react(this.mood === 'hype' || this.mood === 'hmm' ? this.mood : 'greet')
      this.requestFrame()
    } catch {
      // No file, or a bad one: the drawn figure stands in.
      if (this.disposed) return
      this.rig.root.visible = true
      this.onLoad?.(false)
      this.requestFrame()
    }
  }

  setTalking(on: boolean): void {
    this.talking = on
    this.requestFrame()
  }

  setMood(mood: Mood): void {
    this.mood = mood
    this.moodAt = this.seconds()
    // A recorded reaction for the moods that have one (with reduced motion he does not move).
    if (!this.reduced && (mood === 'hype' || mood === 'hmm')) this.model?.react(mood)
    this.requestFrame()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    cancelAnimationFrame(this.raf)
    this.resizeObserver.disconnect()
    document.removeEventListener('visibilitychange', this.onVisibility)
    const canvas = this.renderer.domElement
    canvas.removeEventListener('pointerdown', this.onDown)
    canvas.removeEventListener('pointermove', this.onMove)
    canvas.removeEventListener('pointerup', this.onUp)
    canvas.removeEventListener('pointercancel', this.onUp)
    canvas.removeEventListener('pointerleave', this.onLeave)
    this.scene.traverse((obj) => {
      const o = obj as THREE.Mesh
      if (o.geometry) o.geometry.dispose()
      const m = o.material as THREE.Material | THREE.Material[] | undefined
      for (const material of Array.isArray(m) ? m : m ? [m] : []) {
        // Every texture the material holds (colour map, bump map, ...), not only the colour map.
        for (const value of Object.values(material)) {
          if (value instanceof THREE.Texture) value.dispose()
        }
        material.dispose()
      }
      if ((obj as THREE.InstancedMesh).isInstancedMesh) (obj as THREE.InstancedMesh).dispose()
    })
    this.renderer.dispose()
    this.renderer.forceContextLoss()
    canvas.remove()
  }

  private seconds(): number {
    return (performance.now() - this.start) / 1000
  }

  private resize(): void {
    const w = Math.max(1, this.container.clientWidth)
    const h = Math.max(1, this.container.clientHeight)
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    // Far enough to fit his height, and his width when the stage is narrow.
    const half = Math.tan(THREE.MathUtils.degToRad(FOV / 2))
    const distance = Math.max(VIEW_H / 2 / half, VIEW_W / 2 / (half * this.camera.aspect))
    this.camera.position.set(0, LOOK_Y + 0.25, distance)
    this.camera.lookAt(0, LOOK_Y + 0.08, 0)
    this.camera.updateProjectionMatrix()
    this.requestFrame()
  }

  /** With reduced motion nothing loops: ask for one frame after a change. */
  private requestFrame(): void {
    if (!this.reduced || this.disposed) return
    cancelAnimationFrame(this.raf)
    this.raf = requestAnimationFrame(() => this.draw())
  }

  private loop = (): void => {
    if (this.disposed) return
    if (this.reduced) {
      this.draw()
      return
    }
    this.raf = requestAnimationFrame(this.loop)
    if (document.hidden) return
    this.draw()
  }

  private draw(): void {
    if (this.disposed) return
    const t = this.seconds()
    // The head eases toward the pointer instead of snapping to it.
    const ease = this.reduced ? 1 : 0.08
    this.lookNow.x += (this.look.x - this.lookNow.x) * ease
    this.lookNow.y += (this.look.y - this.lookNow.y) * ease
    const p = poseAt({ t, talking: this.talking, mood: this.mood, moodAge: t - this.moodAt, look: this.lookNow, reduced: this.reduced })
    const r = this.rig
    r.root.rotation.y = this.yaw
    // With the recorded model the ball follows his hand; the drawn figure's ball is the pose's.
    const placed = this.model?.apply(p, this.reduced ? 0 : t)
    const ball = placed ? { x: placed.ball.x, y: placed.ball.y, z: placed.ball.z, spin: p.ball.spin } : p.ball
    r.body.position.y = p.rootY
    r.body.rotation.z = p.lean
    r.body.scale.set(1 + 0.004 * p.breathe, 1, 1 + 0.012 * p.breathe)
    r.head.rotation.set(p.headPitch, p.headYaw, p.headRoll)
    r.mouth.scale.y = 0.05 + 0.75 * p.mouth
    r.eyes.scale.y = Math.max(0.08, p.eyes)
    r.brows.position.y = 0.008 * p.brows
    r.rShoulder.rotation.set(-p.rShoulder, 0, -0.1)
    r.rElbow.rotation.x = -p.rElbow
    // The palm turns down onto the ball (roll about the hand's own length first, then the wrist bends).
    r.rHand.rotation.set(-p.rWrist, PALM_DOWN, 0)
    r.lShoulder.rotation.set(-p.lShoulder, 0, p.lShoulderOut)
    r.lElbow.rotation.x = -p.lElbow
    r.ball.position.set(ball.x, ball.y, ball.z)
    r.ball.rotation.x = ball.spin
    // The ball's shadow tightens and darkens as the ball nears the floor.
    const height = Math.min(1, (ball.y - BALL_R) / 0.9)
    const size = 0.3 + 0.25 * height
    r.ballShadow.position.set(ball.x, 0.005, ball.z)
    r.ballShadow.scale.set(size, 1, size)
    ;(r.ballShadow.material as THREE.MeshBasicMaterial).opacity = 0.85 - 0.5 * height
    this.renderer.render(this.scene, this.camera)
  }

  // Drag turns him round (to see the name and number on his back); moving without a button makes him look at the pointer.
  private onDown = (e: PointerEvent): void => {
    this.drag = { x: e.clientX, y: e.clientY, yaw: this.yaw }
    this.renderer.domElement.setPointerCapture(e.pointerId)
  }
  private onMove = (e: PointerEvent): void => {
    const rect = this.renderer.domElement.getBoundingClientRect()
    if (this.drag) {
      this.yaw = this.drag.yaw + ((e.clientX - this.drag.x) / Math.max(1, rect.width)) * Math.PI * 2
    } else {
      this.look.x = ((e.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1
      this.look.y = ((e.clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1
    }
    this.requestFrame()
  }
  private onUp = (e: PointerEvent): void => {
    // A tap, not a turn or a scroll: barely any movement, in any direction, since the press.
    if (this.drag && e.type === 'pointerup' && Math.hypot(e.clientX - this.drag.x, e.clientY - this.drag.y) < 5) this.onPoke?.()
    this.drag = null
    if (this.renderer.domElement.hasPointerCapture(e.pointerId)) this.renderer.domElement.releasePointerCapture(e.pointerId)
  }
  private onLeave = (): void => {
    if (this.drag) return
    this.look.x = 0
    this.look.y = 0
    this.requestFrame()
  }
  private onVisibility = (): void => {
    this.requestFrame()
  }
}
