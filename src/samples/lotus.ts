import type { LanternGroup, LightItem, Node3, Panel, Rod, Segment, Vec3 } from '../core/types'
import { uid } from '../core/idb'
import { buildGridPanel, makePanel } from '../core/loft'

// 大荷花：三层花瓣（每层 8/10/12 片）+ 荷叶，整体直径约 6m
// 花瓣用带 cup 弯曲的四边形网格，绕 Y 轴旋转分布

function rotateY(p: Vec3, ang: number): Vec3 {
  const c = Math.cos(ang), s = Math.sin(ang)
  return { x: p.x * c + p.z * s, y: p.y, z: -p.x * s + p.z * c }
}

interface PetalLayer {
  count: number
  radius: number
  height: number
  width: number
  tilt: number
  color: string
  tau: number
}

const LAYERS: PetalLayer[] = [
  { count: 12, radius: 2200, height: 900, width: 1100, tilt: 1.05, color: '#e88aa8', tau: 0.38 },
  { count: 10, radius: 1500, height: 1400, width: 1000, tilt: 0.72, color: '#f2a6bd', tau: 0.36 },
  { count: 8, radius: 850, height: 1750, width: 850, tilt: 0.38, color: '#f7c6d4', tau: 0.34 }
]

function buildPetalPanel(layer: PetalLayer, index: number, angle: number): { panel: Panel; tip: Vec3 } {
  const grid = buildGridPanel({
    cols: 8,
    rows: 10,
    width: layer.width,
    height: layer.height,
    cupMm: 260,
    center: { x: 0, y: layer.height / 2, z: 0 }
  })
  // 倾斜（绕 X 轴外展）后绕 Y 旋转到对应方位
  const tilt = layer.tilt
  const ct = Math.cos(tilt), st = Math.sin(tilt)
  const pos = grid.positions
  for (let i = 0; i < pos.length; i += 3) {
    const y0 = pos[i + 1] - layer.height / 2
    const z0 = pos[i + 2]
    const y1 = y0 * ct - z0 * st + layer.height / 2
    const z1 = y0 * st + z0 * ct
    const p = rotateY({ x: pos[i] + layer.radius, y: y1 + 350, z: z1 }, angle)
    pos[i] = p.x; pos[i + 1] = p.y; pos[i + 2] = p.z
  }
  const tipCount = 3
  const tipIdx = (grid.anchorNode.length - tipCount * 3)
  const tip: Vec3 = { x: pos[tipIdx], y: pos[tipIdx + 1], z: pos[tipIdx + 2] }
  const panel = makePanel({
    positions: pos,
    anchorNode: grid.anchorNode,
    color: layer.color,
    transmittance: layer.tau,
    scatter: 0.28,
    thicknessMm: 0.28
  })
  void index
  return { panel, tip }
}

// 荷叶：水平大网格，中心下沉呈碟形
function buildLeaf(): Panel {
  const grid = buildGridPanel({ cols: 16, rows: 16, width: 5200, height: 5200, cupMm: 500, center: { x: 0, y: 220, z: 0 } })
  return makePanel({
    positions: grid.positions,
    anchorNode: grid.anchorNode,
    color: '#3f7d4e',
    transmittance: 0.18,
    scatter: 0.35,
    thicknessMm: 0.4
  })
}

export function buildLotusGroup(): { group: LanternGroup; segments: Segment[] } {
  const group: LanternGroup = {
    id: uid('grp'), projectId: '', name: '盛世荷花·六米', kind: 'lotus',
    segmentIds: [], createdAt: Date.now()
  }
  const panels: Panel[] = [buildLeaf()]
  const lights: LightItem[] = []
  const nodes: Node3[] = []
  const rods: Rod[] = []

  // 沿花瓣边缘取骨架节点：每瓣两侧各一根定型钢丝 + 中心主骨
  const petalRib = (tip: Vec3, root: Vec3, diameterMm: number) => {
    const a = nodes.push({ id: uid('n'), p: root }) - 1
    const mid = { x: (root.x + tip.x) / 2, y: (root.y + tip.y) / 2 + 120, z: (root.z + tip.z) / 2 }
    const b = nodes.push({ id: uid('n'), p: mid }) - 1
    const c = nodes.push({ id: uid('n'), p: tip }) - 1
    rods.push({ id: uid('r'), a: nodes[a].id, b: nodes[b].id, diameterMm })
    rods.push({ id: uid('r'), a: nodes[b].id, b: nodes[c].id, diameterMm })
  }

  LAYERS.forEach((layer, li) => {
    for (let i = 0; i < layer.count; i++) {
      const angle = (i / layer.count) * Math.PI * 2 + li * 0.26
      const { panel, tip } = buildPetalPanel(layer, i, angle)
      panels.push(panel)
      // 花根在中心地面附近，主骨沿花瓣中线走到尖端
      const root: Vec3 = { x: Math.cos(angle) * layer.radius * 0.4, y: 350, z: Math.sin(angle) * layer.radius * 0.4 }
      petalRib(tip, root, li === 0 ? 5 : 4)
      // 每瓣之间放一盏暖白点光，贴近花芯
      if (i % 2 === 0) {
        const r = layer.radius * 0.55
        lights.push({
          id: uid('l'),
          kind: 'point',
          name: `花蕊灯 L${li + 1}-${i / 2 + 1}`,
          p: { x: Math.cos(angle) * r, y: 700 + li * 350, z: Math.sin(angle) * r },
          powerW: 7,
          cctK: 2850,
          beadSpacingMm: 50,
          efficacyLmW: 95
        })
      }
    }
  })
  // 花芯环形灯带
  lights.push({
    id: uid('l'), kind: 'strip', name: '花芯环带',
    p: { x: 700, y: 600, z: 0 },
    p2: { x: -700, y: 600, z: 0 },
    powerW: 20, cctK: 3000, beadSpacingMm: 40, efficacyLmW: 100
  })

  const segment: Segment = {
    id: uid('seg'),
    groupId: group.id,
    name: '荷花整朵（含荷叶）',
    nodes,
    rods,
    panels,
    lights,
    steelDensityKgM3: 7850,
    updatedAt: Date.now()
  }
  group.segmentIds = [segment.id]
  return { group, segments: [segment] }
}
