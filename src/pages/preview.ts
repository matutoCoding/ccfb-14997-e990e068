import * as THREE from 'three'
import { Reflector } from 'three/examples/jsm/objects/Reflector.js'
import { h } from '../core/dom'
import { fmt, toast } from '../core/dom'
import { go, parseHash } from '../core/router'
import { loadGroupContext, segmentTabs, type GroupContext } from './group_chrome'
import { createScene, registerSceneCleanup } from '../three/scene'
import { buildPanelMesh, buildRodMesh, buildNodeMesh } from '../three/meshes'
import { bakeSegment } from '../core/optics'

let cleanupFn: (() => void) | null = null

interface PreviewHandle {
  switchMode: (m: 'orbit' | 'walk') => void
  dispose: () => void
  emitterCount: number
  bakeMs: number
}

function buildPreview(container: HTMLElement, ctx: GroupContext): PreviewHandle {
  const base = createScene(container, true)
  const seg = ctx.segment
  const bake = bakeSegment(seg.panels, seg.lights, { ambientLeakLux: 2 })
  const scatteredByPanel = new Map(seg.panels.map((p, i) => [p.id, bake.scattered[i]]))

  const model = new THREE.Group()
  if (seg.nodes.length) {
    model.add(buildRodMesh(seg.rods, seg.nodes))
    model.add(buildNodeMesh(seg.nodes, new Set(), 18))
  }
  for (const p of seg.panels) {
    model.add(buildPanelMesh(p, {
      mode: 'lit', scatteredByPanel, darkLux: 10, hotLux: 120, exposure: 1, lights: seg.lights
    }))
  }
  base.scene.add(model)
  const box = new THREE.Box3().setFromObject(model)
  const center = box.getCenter(new THREE.Vector3())
  model.position.sub(center)
  model.position.y += -box.min.y + 40

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(40000, 40000),
    new THREE.MeshStandardMaterial({ color: 0x0c1018, roughness: 0.95 })
  )
  ground.rotation.x = -Math.PI / 2
  ground.position.y = -2
  base.scene.add(ground)

  const dpr = Math.min(2, window.devicePixelRatio)
  const water = new Reflector(new THREE.PlaneGeometry(26000, 9000), {
    clipBias: 0.003,
    textureWidth: Math.min(2048, container.clientWidth * dpr),
    textureHeight: Math.min(2048, container.clientHeight * dpr),
    color: 0x18242f
  })
  water.rotation.x = -Math.PI / 2
  water.position.set(0, -1, 7200)
  base.scene.add(water)

  // 灯柱点景
  for (let i = -3; i <= 3; i++) {
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(20, 20, 2600, 8),
      new THREE.MeshStandardMaterial({ color: 0x2a3242 })
    )
    pole.position.set(i * 2600, 1300, -4200)
    base.scene.add(pole)
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(90, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0xffd9a0 })
    )
    bulb.position.set(i * 2600, 2650, -4200)
    base.scene.add(bulb)
  }

  const orbitHome = () => base.resetCamera(new THREE.Box3().setFromObject(model))
  orbitHome()

  // 行走模式状态
  let mode: 'orbit' | 'walk' = 'orbit'
  const keys = new Set<string>()
  const yaw = { value: 0 }
  const EYE_HEIGHT = 1600
  const onKeyDown = (e: KeyboardEvent) => keys.add(e.key.toLowerCase())
  const onKeyUp = (e: KeyboardEvent) => keys.delete(e.key.toLowerCase())
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)

  // 行走模式下的鼠标拖拽环视
  let dragging = false
  let lastX = 0
  const onDown = (e: PointerEvent) => {
    if (mode !== 'walk') return
    dragging = true
    lastX = e.clientX
  }
  const onMove = (e: PointerEvent) => {
    if (!dragging || mode !== 'walk') return
    yaw.value -= (e.clientX - lastX) * 0.004
    lastX = e.clientX
  }
  const onUp = () => { dragging = false }
  base.renderer.domElement.addEventListener('pointerdown', onDown)
  base.renderer.domElement.addEventListener('pointermove', onMove)
  base.renderer.domElement.addEventListener('pointerup', onUp)

  let raf = 0
  const loop = () => {
    raf = requestAnimationFrame(loop)
    if (mode === 'walk') {
      const speed = 260
      const forward = new THREE.Vector3(-Math.sin(yaw.value), 0, -Math.cos(yaw.value))
      const right = new THREE.Vector3(Math.cos(yaw.value), 0, -Math.sin(yaw.value))
      if (keys.has('w')) base.camera.position.addScaledVector(forward, speed)
      if (keys.has('s')) base.camera.position.addScaledVector(forward, -speed)
      if (keys.has('a')) base.camera.position.addScaledVector(right, -speed * 0.7)
      if (keys.has('d')) base.camera.position.addScaledVector(right, speed * 0.7)
      base.camera.position.y = EYE_HEIGHT
      base.camera.lookAt(
        base.camera.position.x + forward.x * 1000,
        EYE_HEIGHT,
        base.camera.position.z + forward.z * 1000
      )
    }
  }
  loop()

  return {
    emitterCount: bake.emitterCount,
    bakeMs: bake.elapsedMs,
    switchMode: (m) => {
      mode = m
      base.controls.enabled = m === 'orbit'
      if (m === 'walk') {
        base.camera.position.set(0, EYE_HEIGHT, 9000)
        yaw.value = 0
        toast('行走模式：点击场景后 W/S 前进后退，A/D 横移，拖动鼠标转向')
      } else {
        orbitHome()
      }
    },
    dispose: () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      base.renderer.domElement.removeEventListener('pointerdown', onDown)
      base.renderer.domElement.removeEventListener('pointermove', onMove)
      base.renderer.domElement.removeEventListener('pointerup', onUp)
      base.dispose()
    }
  }
}

async function remount(groupId: string, segId?: string): Promise<void> {
  cleanupFn?.()
  cleanupFn = null
  const ctx = await loadGroupContext(groupId, segId ?? parseHash().query.seg)
  if (!ctx) { go('/'); return }
  const viewport = h('div', { class: 'viewport' })
  let handle: PreviewHandle | null = null
  const page = document.querySelector('.page')
  page?.replaceChildren(
    h('div', { class: 'toolbar' },
      h('span', { class: 'group-label' }, '夜景预览：'),
      h('button', { id: 'mode-orbit', class: 'active', onclick: () => { handle?.switchMode('orbit'); syncButtons('orbit') } }, '环绕观察'),
      h('button', { id: 'mode-walk', onclick: () => { handle?.switchMode('walk'); syncButtons('walk') } }, '地面行走'),
      h('span', { style: 'flex:1' }),
      h('span', { class: 'muted' }, '行走：W/S 前后 · A/D 横移 · 鼠标拖动转向，眼高 1.6m')
    ),
    h('div', { class: 'workspace' }, viewport, sidePanel(ctx))
  )
  function syncButtons(m: 'orbit' | 'walk'): void {
    document.getElementById('mode-orbit')?.classList.toggle('active', m === 'orbit')
    document.getElementById('mode-walk')?.classList.toggle('active', m === 'walk')
  }
  handle = buildPreview(viewport, ctx)
  cleanupFn = () => handle?.dispose()
  registerSceneCleanup(() => {
    handle?.dispose()
    handle = null
  })

  viewport.append(h('div', { class: 'hud' },
    h('div', {}, `烘焙发光珠 <b>${fmt(handle.emitterCount, 0)}</b> · 耗时 <b>${fmt(handle.bakeMs, 0)} ms</b>`),
    h('div', { class: 'dim' }, '水面为实时平面反射；布面颜色与灯光页共用同一套透光烘焙结果。')
  ))
}

function sidePanel(ctx: GroupContext): HTMLElement {
  return h('aside', { class: 'sidepanel' },
    h('section', {},
      h('h4', {}, '预览分段'),
      segmentTabs(ctx, 'preview', (segId) => void remount(ctx.group.id, segId))
    ),
    h('section', {},
      h('h4', {}, '说明'),
      h('p', { class: 'dim' }, '夜景模式压暗环境光，只保留灯组自发光与场地灯柱；水面使用 Reflector 实时反射灯组。'),
      h('p', { class: 'dim' }, '多段灯组在各分段之间切换查看，整组汇总去下料单页面。')
    ),
    h('section', {},
      h('button', { onclick: () => go(`/group/${ctx.group.id}/cutlist`) }, '查看下料单 →')
    )
  )
}

export function renderPreviewPage(groupId: string): HTMLElement {
  const root = h('div', { style: 'flex:1;display:flex;min-height:0' }, h('p', { class: 'muted' }, '夜景加载中…'))
  void remount(groupId)
  return root
}
