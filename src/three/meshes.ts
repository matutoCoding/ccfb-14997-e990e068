import * as THREE from 'three'
import type { LightItem, Node3, Panel, Rod, Vec3 } from '../core/types'
import { cctToRgb, luxToColor, heatColor, normalizeLog } from '../core/optics'
import { v3 } from './scene'

// 骨架杆件：InstancedMesh 圆柱，按直径分档合并实例
export function buildRodMesh(rods: Rod[], nodes: Node3[]): THREE.InstancedMesh {
  const geo = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true)
  const mat = new THREE.MeshStandardMaterial({ color: 0x8a94a6, metalness: 0.7, roughness: 0.45 })
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, rods.length))
  const dummy = new THREE.Object3D()
  const up = new THREE.Vector3(0, 1, 0)
  const dir = new THREE.Vector3()
  const nodeMap = new Map(nodes.map((n) => [n.id, n]))
  rods.forEach((rod, i) => {
    const a = nodeMap.get(rod.a)
    const b = nodeMap.get(rod.b)
    if (!a || !b) return
    const va = v3(a.p), vb = v3(b.p)
    dir.subVectors(vb, va)
    const len = dir.length()
    dummy.position.copy(va).add(vb).multiplyScalar(0.5)
    dummy.quaternion.setFromUnitVectors(up, dir.normalize())
    dummy.scale.set(rod.diameterMm, len, rod.diameterMm)
    dummy.updateMatrix()
    mesh.setMatrixAt(i, dummy.matrix)
  })
  mesh.instanceMatrix.needsUpdate = true
  mesh.userData.kind = 'rods'
  return mesh
}

// 节点：InstancedMesh 小球，可选高亮集合
export function buildNodeMesh(nodes: Node3[], highlight = new Set<string>(), radius = 26): THREE.InstancedMesh {
  const geo = new THREE.SphereGeometry(1, 12, 10)
  const mat = new THREE.MeshStandardMaterial({ color: 0xd8dee9, metalness: 0.4, roughness: 0.5 })
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, nodes.length))
  const dummy = new THREE.Object3D()
  nodes.forEach((n, i) => {
    dummy.position.copy(v3(n.p))
    const s = highlight.has(n.id) ? radius * 1.5 : radius
    dummy.scale.setScalar(s)
    dummy.updateMatrix()
    mesh.setMatrixAt(i, dummy.matrix)
    mesh.setColorAt(i, new THREE.Color(highlight.has(n.id) ? 0xd98a3d : 0xd8dee9))
  })
  mesh.instanceMatrix.needsUpdate = true
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  mesh.userData.kind = 'nodes'
  return mesh
}

export type PanelViewMode = 'fabric' | 'lit' | 'heat'

export interface PanelColorOpts {
  mode: PanelViewMode
  // key 为 panel.id
  scatteredByPanel?: Map<string, Float32Array>
  darkLux: number
  hotLux: number
  exposure: number
  lights: LightItem[]
}

function panelBaseColor(panel: Panel): THREE.Color {
  return new THREE.Color(panel.color)
}

// 布面网格：BufferGeometry + 顶点色；颜料区在布料模式下混入颜料色
export function buildPanelMesh(panel: Panel, opts: PanelColorOpts): THREE.Mesh {
  const vcount = panel.positions.length / 3
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(panel.positions, 3))
  geo.computeVertexNormals()
  const colors = new Float32Array(panel.positions.length)
  const base = panelBaseColor(panel)
  const paintCol = new THREE.Color(panel.paintColor)
  // 多灯色温取功率加权平均
  let cct: [number, number, number] = [1, 0.85, 0.65]
  const totalW = opts.lights.reduce((s, l) => s + l.powerW, 0)
  if (totalW > 0) {
    let r = 0, g = 0, b = 0
    for (const l of opts.lights) {
      const [cr, cg, cb] = cctToRgb(l.cctK)
      const w = l.powerW / totalW
      r += cr * w; g += cg * w; b += cb * w
    }
    cct = [r, g, b]
  }
  const luxArr = opts.scatteredByPanel?.get(panel.id)
  void luxArr
  for (let v = 0; v < vcount; v++) {
    const paint = panel.paint[v] ?? 0
    let r: number, g: number, b: number
    if (opts.mode === 'lit' && luxArr) {
      const value = luxArr[v]
      ;[r, g, b] = luxToColor(value, cct, opts.exposure)
      // 颜料在点亮时降低亮度并轻微染色
      r = r * (1 - paint * 0.6) + paintCol.r * paint * 0.08
      g = g * (1 - paint * 0.6) + paintCol.g * paint * 0.08
      b = b * (1 - paint * 0.6) + paintCol.b * paint * 0.08
    } else if (opts.mode === 'heat' && luxArr) {
      ;[r, g, b] = heatColor(normalizeLog(luxArr[v], opts.darkLux, opts.hotLux))
    } else {
      r = base.r * (1 - paint) + paintCol.r * paint
      g = base.g * (1 - paint) + paintCol.g * paint
      b = base.b * (1 - paint) + paintCol.b * paint
    }
    colors[v * 3] = r
    colors[v * 3 + 1] = g
    colors[v * 3 + 2] = b
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  const lit = opts.mode === 'lit'
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    roughness: lit ? 1 : 0.85,
    metalness: 0,
    transparent: true,
    opacity: lit ? 1 : 0.96,
    // 点亮模式：顶点色直接作为自发光输出，不再受场景光照压暗
    emissive: lit ? new THREE.Color(0xffffff) : new THREE.Color(0x000000),
    emissiveIntensity: lit ? 1 : 0
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.userData.kind = 'panel'
  mesh.userData.panelId = panel.id
  return mesh
}

// 点光源：发光小球；灯带：发光圆柱 + 两端点
export function buildLightGizmos(lights: LightItem[]): THREE.Group {
  const group = new THREE.Group()
  group.userData.kind = 'lights'
  for (const l of lights) {
    const [r, g, b] = cctToRgb(l.cctK)
    const color = new THREE.Color(r, g, b)
    if (l.kind === 'point') {
      const s = new THREE.Mesh(
        new THREE.SphereGeometry(34, 14, 12),
        new THREE.MeshBasicMaterial({ color })
      )
      s.position.copy(v3(l.p))
      s.userData.lightId = l.id
      group.add(s)
    } else {
      const a = v3(l.p), bv = v3(l.p2 ?? l.p)
      const len = a.distanceTo(bv)
      const cyl = new THREE.Mesh(
        new THREE.CylinderGeometry(18, 18, Math.max(1, len), 10),
        new THREE.MeshBasicMaterial({ color })
      )
      cyl.position.copy(a).add(bv).multiplyScalar(0.5)
      cyl.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), bv.clone().sub(a).normalize())
      cyl.userData.lightId = l.id
      group.add(cyl)
    }
  }
  return group
}

// 灯位建议标记（虚线小球）
export function buildSuggestionMarkers(points: Vec3[]): THREE.Group {
  const group = new THREE.Group()
  const geo = new THREE.SphereGeometry(48, 14, 12)
  for (const p of points) {
    const m = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ color: 0x57a773, wireframe: true, transparent: true, opacity: 0.9 })
    )
    m.position.copy(v3(p))
    group.add(m)
  }
  return group
}

export function disposeGroup(group: THREE.Object3D): void {
  group.traverse((o) => {
    const m = o as THREE.Mesh
    if (m.geometry) m.geometry.dispose()
    const mat = m.material as THREE.Material | THREE.Material[] | undefined
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose())
    else mat?.dispose()
  })
}
