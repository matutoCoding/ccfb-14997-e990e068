import * as THREE from 'three'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'
import type { LightItem, Node3, Panel, Segment, Vec3 } from '../core/types'
import { bakeSegment, type BakeResult } from '../core/optics'
import { uid } from '../core/idb'
import { createScene, type SceneBase, v3 } from './scene'
import { buildLightGizmos, buildNodeMesh, buildPanelMesh, buildRodMesh, buildSuggestionMarkers, disposeGroup, type PanelColorOpts, type PanelViewMode } from './meshes'
import { applySag } from '../core/loft'

export type EditorTool = 'select' | 'add-node' | 'connect' | 'add-light' | 'paint' | 'add-strip'
export type EditorMode = 'skeleton' | 'fabric' | 'light'

export interface EditorConfig {
  mode: EditorMode
  ambientLeakLux: number
  exposure: number
  darkLux: number
  hotLux: number
  onSelect?: (kind: string, id: string | null) => void
  onChange?: () => void
}

const GROUND_Y = 0

export class Editor3D {
  readonly base: SceneBase
  segment: Segment
  cfg: EditorConfig
  tool: EditorTool = 'select'
  viewMode: PanelViewMode = 'fabric'
  selectedNodeId: string | null = null
  selectedPanelId: string | null = null
  selectedLightId: string | null = null
  private modelGroup = new THREE.Group()
  private transform: TransformControls
  private raycaster = new THREE.Raycaster()
  private pointer = new THREE.Vector2()
  private connectFirst: string | null = null
  private paintBrush = 120
  private paintValue = 0.8
  private rodDiameter = 4
  private saveTimer: number | undefined
  private proxies: THREE.Object3D[] = []
  bake: BakeResult | null = null
  suggestionPoints: Vec3[] = []
  private paintPointerDown = false

  constructor(container: HTMLElement, segment: Segment, cfg: EditorConfig) {
    this.segment = segment
    this.cfg = cfg
    this.base = createScene(container)
    this.base.scene.add(this.modelGroup)

    this.transform = new TransformControls(this.base.camera, this.base.renderer.domElement)
    // 骨架扎制只需要平移，禁用旋转/缩放手柄避免误操作
    this.transform.setMode('translate')
    this.transform.setSize(0.9)
    this.transform.addEventListener('dragging-changed', (e) => {
      const dragging = e.value as boolean
      this.base.controls.enabled = !dragging
      if (!dragging) {
        // 松手时统一重建一次，拖拽期间保持代理存活
        this.scheduleSave()
        this.rebuild()
        this.restoreProxy()
      }
    })
    this.transform.addEventListener('objectChange', () => this.commitTransform())
    // r169 的 TransformControls 本身继承 Object3D，可直接加入场景
    this.base.scene.add(this.transform as unknown as THREE.Object3D)

    this.base.renderer.domElement.addEventListener('pointerdown', this.onPointerDown)
    this.base.renderer.domElement.addEventListener('pointermove', this.onPointerMove)
    this.base.renderer.domElement.addEventListener('pointerup', this.onPointerUp)
    this.rebuild()
    this.base.resetCamera()
    Editor3D.active.add(this)
  }

  setTool(tool: EditorTool): void {
    this.tool = tool
    this.connectFirst = null
  }

  setViewMode(mode: PanelViewMode): void {
    this.viewMode = mode
    this.rebuild()
  }

  setRodDiameter(d: number): void { this.rodDiameter = d }
  setPaintBrush(mm: number): void { this.paintBrush = mm }
  setPaintValue(v: number): void { this.paintValue = v }

  // 数据直接在内存段对象上修改，这里只负责防抖落库
  private scheduleSave(): void {
    window.clearTimeout(this.saveTimer)
    this.saveTimer = window.setTimeout(() => this.cfg.onChange?.(), 800)
  }

  private updatePointer(e: PointerEvent): void {
    const rect = this.base.renderer.domElement.getBoundingClientRect()
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
  }

  private intersect(): THREE.Intersection[] {
    this.raycaster.setFromCamera(this.pointer, this.base.camera)
    return this.raycaster.intersectObjects(this.modelGroup.children, true)
  }

  private findNodeHit(): { node: Node3; point: THREE.Vector3 } | null {
    const hits = this.intersect()
    for (const hit of hits) {
      if (hit.object.userData.kind === 'nodes' && hit.instanceId !== undefined) {
        const node = this.segment.nodes[hit.instanceId]
        if (node) return { node, point: hit.point }
      }
    }
    return null
  }

  private groundPoint(): Vec3 {
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -GROUND_Y)
    const out = new THREE.Vector3()
    this.raycaster.ray.intersectPlane(plane, out)
    if (!out.length()) out.copy(this.base.controls.target)
    return { x: out.x, y: GROUND_Y, z: out.z }
  }

  private onPointerDown = (e: PointerEvent): void => {
    this.updatePointer(e)
    if (e.button !== 0) return
    if (this.tool === 'paint') {
      this.paintPointerDown = true
      this.applyPaint()
      return
    }
    if (this.tool === 'add-node') {
      const p = this.groundPoint()
      const node: Node3 = { id: uid('n'), p }
      this.segment.nodes.push(node)
      this.scheduleSave()
      this.rebuild()
      this.selectNode(node.id)
      return
    }
    const nodeHit = this.findNodeHit()
    if (this.tool === 'connect') {
      if (nodeHit) {
        if (!this.connectFirst) {
          this.connectFirst = nodeHit.node.id
          this.selectNode(nodeHit.node.id)
        } else if (this.connectFirst !== nodeHit.node.id) {
          const rod = { id: uid('r'), a: this.connectFirst, b: nodeHit.node.id, diameterMm: this.rodDiameter }
          this.segment.rods.push(rod)
          this.connectFirst = null
          this.scheduleSave()
          this.rebuild()
        }
      }
      return
    }
    if (this.tool === 'add-light' || this.tool === 'add-strip') {
      this.spawnLight()
      return
    }
    // select 模式：节点优先，其次面板/灯
    if (nodeHit) {
      this.selectNode(nodeHit.node.id)
      return
    }
    const hits = this.intersect()
    for (const hit of hits) {
      const panelId = hit.object.userData.panelId as string | undefined
      if (panelId) {
        this.selectedPanelId = panelId
        this.selectedLightId = null
        this.cfg.onSelect?.('panel', panelId)
        this.rebuild()
        return
      }
      const lightId = hit.object.userData.lightId as string | undefined
      if (lightId) {
        this.selectedLightId = lightId
        this.selectedNodeId = null
        this.transform.detach()
        this.cfg.onSelect?.('light', lightId)
        return
      }
    }
    this.selectedNodeId = null
    this.selectedPanelId = null
    this.selectedLightId = null
    this.detachProxies()
    this.cfg.onSelect?.('none', null)
    this.rebuild()
  }

  private onPointerMove = (e: PointerEvent): void => {
    this.updatePointer(e)
    if (this.tool === 'paint' && this.paintPointerDown) this.applyPaint()
  }

  private onPointerUp = (): void => {
    this.paintPointerDown = false
  }

  private detachProxies(): void {
    this.transform.detach()
    for (const p of this.proxies) p.removeFromParent()
    this.proxies = []
  }

  private selectNode(id: string): void {
    this.detachProxies()
    this.selectedNodeId = id
    this.selectedPanelId = null
    this.selectedLightId = null
    this.cfg.onSelect?.('node', id)
    this.rebuild()
    const node = this.segment.nodes.find((n) => n.id === id)
    if (node) {
      const proxy = new THREE.Object3D()
      proxy.position.copy(v3(node.p))
      proxy.userData.nodeId = id
      this.base.scene.add(proxy)
      this.proxies.push(proxy)
      this.transform.attach(proxy)
    }
  }

  // 灯光编辑时由页面调用：把当前选中灯挂到 TransformControls
  attachSelectedLight(): void {
    const light = this.segment.lights.find((l) => l.id === this.selectedLightId)
    if (!light) return
    this.detachProxies()
    const proxy = new THREE.Object3D()
    proxy.position.copy(v3(light.p))
    proxy.userData.lightId = light.id
    proxy.userData.lastPos = { ...light.p }
    this.base.scene.add(proxy)
    this.proxies.push(proxy)
    this.transform.attach(proxy)
  }

  private commitTransform(): void {
    const obj = this.transform.object
    // rebuild 会 detach 旧代理，过期事件直接忽略
    if (!obj || !this.proxies.includes(obj)) return
    const nodeId = obj.userData.nodeId as string | undefined
    const lightId = obj.userData.lightId as string | undefined
    const p = obj.position
    if (nodeId) {
      const n = this.segment.nodes.find((x) => x.id === nodeId)
      if (n) n.p = { x: p.x, y: p.y, z: p.z }
    } else if (lightId) {
      const l = this.segment.lights.find((x) => x.id === lightId)
      if (l) {
        const last = obj.userData.lastPos as Vec3 | undefined
        const prev = last ?? l.p
        const delta = { x: p.x - prev.x, y: p.y - prev.y, z: p.z - prev.z }
        if (l.p2) l.p2 = { x: l.p2.x + delta.x, y: l.p2.y + delta.y, z: l.p2.z + delta.z }
        l.p = { x: p.x, y: p.y, z: p.z }
        obj.userData.lastPos = { ...l.p }
      }
    }
    // 拖拽过程中只更新数据，不重建场景
  }

  // 重建后按当前选中对象重新挂代理，保持 TransformControls 不中断
  private restoreProxy(): void {
    if (this.selectedNodeId) this.selectNode(this.selectedNodeId)
    else if (this.selectedLightId) this.attachSelectedLight()
  }

  private spawnLight(): void {
    const hits = this.intersect()
    const target = hits[0]?.point ?? new THREE.Vector3()
    const strip = this.tool === 'add-strip'
    const light: LightItem = {
      id: uid('l'),
      kind: strip ? 'strip' : 'point',
      name: strip ? `灯带 ${this.segment.lights.filter((l) => l.kind === 'strip').length + 1}` : `点光源 ${this.segment.lights.filter((l) => l.kind === 'point').length + 1}`,
      p: { x: target.x, y: Math.max(120, target.y), z: target.z },
      p2: strip ? { x: target.x + 600, y: Math.max(120, target.y), z: target.z } : undefined,
      powerW: strip ? 12 : 5,
      cctK: 3000,
      beadSpacingMm: 50,
      efficacyLmW: 90
    }
    this.segment.lights.push(light)
    this.selectedLightId = light.id
    this.cfg.onSelect?.('light', light.id)
    this.scheduleSave()
    this.rebuild()
  }

  private applyPaint(): void {
    if (!this.selectedPanelId) return
    const panel = this.segment.panels.find((p) => p.id === this.selectedPanelId)
    if (!panel) return
    this.raycaster.setFromCamera(this.pointer, this.base.camera)
    const meshes: THREE.Object3D[] = []
    this.modelGroup.traverse((o) => { if (o.userData.panelId === panel.id) meshes.push(o) })
    const hit = this.raycaster.intersectObjects(meshes, false)[0]
    if (!hit) return
    const pos = panel.positions
    let changed = false
    for (let v = 0; v < pos.length / 3; v++) {
      const d = Math.hypot(pos[v * 3] - hit.point.x, pos[v * 3 + 1] - hit.point.y, pos[v * 3 + 2] - hit.point.z)
      if (d < this.paintBrush) {
        const falloff = 1 - d / this.paintBrush
        panel.paint[v] = Math.min(1, panel.paint[v] + this.paintValue * falloff * 0.35)
        changed = true
      }
    }
    if (changed) {
      // 涂抹过程只防抖落库，停笔 200ms 后重建一次显示
      window.clearTimeout(this.saveTimer)
      this.saveTimer = window.setTimeout(() => {
        this.rebuild()
        this.cfg.onChange?.()
      }, 200)
    }
  }

  erasePaint(): void {
    const panel = this.segment.panels.find((p) => p.id === this.selectedPanelId)
    if (!panel) return
    panel.paint.fill(0)
    this.cfg.onChange?.()
    this.rebuild()
  }

  // 重新构建整个模型组（数据量在几万面级别，全量重建仍可保持交互流畅）
  rebuild(): void {
    disposeGroup(this.modelGroup)
    this.modelGroup.clear()
    const s = this.segment
    if (s.nodes.length) {
      const highlight = new Set<string>()
      if (this.selectedNodeId) highlight.add(this.selectedNodeId)
      if (this.connectFirst) highlight.add(this.connectFirst)
      this.modelGroup.add(buildRodMesh(s.rods, s.nodes))
      this.modelGroup.add(buildNodeMesh(s.nodes, highlight))
    }
    const scatteredByPanel = new Map<string, Float32Array>()
    if (this.bake) s.panels.forEach((p, i) => scatteredByPanel.set(p.id, this.bake!.scattered[i]))
    const colorOpts: PanelColorOpts = {
      mode: this.viewMode,
      scatteredByPanel,
      darkLux: this.cfg.darkLux,
      hotLux: this.cfg.hotLux,
      exposure: this.cfg.exposure,
      lights: s.lights
    }
    for (const p of s.panels) {
      const mesh = buildPanelMesh(p, colorOpts)
      if (p.id === this.selectedPanelId) {
        const wire = new THREE.Mesh(
          mesh.geometry,
          new THREE.MeshBasicMaterial({ color: 0xd98a3d, wireframe: true, transparent: true, opacity: 0.35 })
        )
        wire.userData.panelId = p.id
        mesh.add(wire)
      }
      this.modelGroup.add(mesh)
    }
    this.modelGroup.add(buildLightGizmos(s.lights))
    if (this.suggestionPoints.length) this.modelGroup.add(buildSuggestionMarkers(this.suggestionPoints))
  }

  runBake(): BakeResult {
    this.bake = bakeSegment(this.segment.panels, this.segment.lights, {
      ambientLeakLux: this.cfg.ambientLeakLux
    })
    this.rebuild()
    return this.bake
  }

  setSuggestions(points: Vec3[]): void {
    this.suggestionPoints = points
    this.rebuild()
  }

  // 面板下垂调整：始终从基准位置重建，保证可重复
  applyPanelSag(panel: Panel, sagMm: number): void {
    applySag(panel, sagMm)
    this.cfg.onChange?.()
    this.rebuild()
  }

  deleteSelected(): void {
    if (this.selectedNodeId) {
      this.segment.rods = this.segment.rods.filter((r) => r.a !== this.selectedNodeId && r.b !== this.selectedNodeId)
      this.segment.nodes = this.segment.nodes.filter((n) => n.id !== this.selectedNodeId)
      this.selectedNodeId = null
    } else if (this.selectedLightId) {
      this.segment.lights = this.segment.lights.filter((l) => l.id !== this.selectedLightId)
      this.selectedLightId = null
    }
    this.detachProxies()
    this.cfg.onChange?.()
    this.rebuild()
  }

  flushSave(): void {
    window.clearTimeout(this.saveTimer)
    this.cfg.onChange?.()
  }

  // 全局活动实例登记，路由切换时统一回收 WebGL 资源
  private static active: Set<Editor3D> = new Set()

  static disposeAll(): void {
    for (const ed of Editor3D.active) ed.dispose()
    Editor3D.active.clear()
  }

  dispose(): void {
    window.clearTimeout(this.saveTimer)
    this.base.renderer.domElement.removeEventListener('pointerdown', this.onPointerDown)
    this.base.renderer.domElement.removeEventListener('pointermove', this.onPointerMove)
    this.base.renderer.domElement.removeEventListener('pointerup', this.onPointerUp)
    this.detachProxies()
    this.transform.dispose()
    this.base.dispose()
    Editor3D.active.delete(this)
  }
}
