import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

// 场景基座：渲染器、相机、轨道控制、地面网格、生命周期

export interface SceneBase {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  controls: OrbitControls
  frame: number
  resize: () => void
  dispose: () => void
  resetCamera: (box?: THREE.Box3) => void
}

export function createScene(container: HTMLElement, night = false): SceneBase {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio))
  renderer.setSize(container.clientWidth, container.clientHeight)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.NoToneMapping // 颜色在烘焙时已做 ACES
  container.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(night ? 0x05070d : 0x0d1017)
  if (!night) scene.fog = new THREE.Fog(0x0d1017, 12000, 30000)

  const camera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 30, 80000)
  camera.position.set(6000, 4500, 8000)

  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.maxDistance = 40000

  // 半球环境光（编辑器模式给未烘焙材质补光）
  const hemi = new THREE.HemisphereLight(0xbcc8e0, 0x1a1f2b, night ? 0.25 : 0.9)
  scene.add(hemi)
  const dir = new THREE.DirectionalLight(0xffffff, night ? 0.15 : 1.1)
  dir.position.set(5000, 9000, 4000)
  scene.add(dir)

  const grid = new THREE.GridHelper(20000, 40, night ? 0x243044 : 0x2c3648, night ? 0x171d29 : 0x1d2431)
  grid.position.y = -1
  scene.add(grid)

  const base: SceneBase = {
    renderer, scene, camera, controls,
    frame: 0,
    resize: () => {
      const w = container.clientWidth
      const h = container.clientHeight
      if (!w || !h) return
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
    },
    dispose: () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
      controls.dispose()
      renderer.dispose()
      renderer.domElement.remove()
      scene.traverse((o) => {
        const m = o as THREE.Mesh
        if (m.geometry) m.geometry.dispose()
        const mat = m.material as THREE.Material | THREE.Material[] | undefined
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose())
        else mat?.dispose()
      })
    },
    resetCamera: (box) => {
      const b = box ?? new THREE.Box3().setFromObject(scene)
      if (b.isEmpty()) { camera.position.set(6000, 4500, 8000); controls.target.set(0, 1000, 0); return }
      const center = b.getCenter(new THREE.Vector3())
      const size = b.getSize(new THREE.Vector3()).length()
      camera.position.copy(center).add(new THREE.Vector3(size * 0.55, size * 0.42, size * 0.7))
      controls.target.copy(center)
      controls.update()
    }
  }

  let frame = 0
  const loop = () => {
    frame = requestAnimationFrame(loop)
    controls.update()
    renderer.render(scene, camera)
    base.frame = frame
  }
  loop()

  const observer = new ResizeObserver(base.resize)
  observer.observe(container)
  return base
}

export function v3(p: { x: number; y: number; z: number }): THREE.Vector3 {
  return new THREE.Vector3(p.x, p.y, p.z)
}

// 非编辑器场景（如夜景预览）的回收登记，路由切换时统一执行
const cleanups = new Set<() => void>()

export function registerSceneCleanup(fn: () => void): void {
  cleanups.add(fn)
}

export function runSceneCleanups(): void {
  for (const fn of cleanups) fn()
  cleanups.clear()
}
