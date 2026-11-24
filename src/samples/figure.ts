import type { LanternGroup, LightItem, Node3, Panel, Rod, Segment, Vec3 } from '../core/types'
import { uid } from '../core/idb'
import { buildGridPanel, buildSpherePanel, makePanel } from '../core/loft'

// 人物灯：仕女造型，高约 3.6m，头/上身/裙/飘带四段
// 球体做头与上身，喇叭网格做裙，长曲网格做飘带

function buildSkirt(): Panel {
  const cols = 18
  const rows = 10
  const positions: number[] = []
  const anchorNode: string[] = []
  const at = (i: number, j: number): Vec3 => {
    const u = i / cols
    const v = j / rows
    const ang = u * Math.PI * 2
    const radius = 520 + v * 780 + Math.sin(ang * 6) * 60 * v
    const y = 1900 - v * 1650
    return { x: Math.cos(ang) * radius, y, z: Math.sin(ang) * radius }
  }
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const quad = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j), at(i + 1, j + 1), at(i, j + 1)]
      for (const q of quad) {
        positions.push(q.x, q.y, q.z)
        anchorNode.push(j === 0 ? 'anchor' : '')
      }
    }
  }
  return makePanel({
    positions: Float32Array.from(positions),
    anchorNode,
    color: '#3f6fb5',
    transmittance: 0.3,
    scatter: 0.3,
    thicknessMm: 0.32
  })
}

function buildRibbon(side: number): Panel {
  const cols = 14
  const rows = 3
  const positions: number[] = []
  const anchorNode: string[] = []
  const at = (i: number, j: number): Vec3 => {
    const u = i / cols
    const v = j / rows
    return {
      x: side * (450 + u * 1500),
      y: 2500 - u * 1300 + Math.sin(u * Math.PI * 2) * 220,
      z: (v - 0.5) * 260 + Math.cos(u * Math.PI * 2) * 180
    }
  }
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const quad = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j), at(i + 1, j + 1), at(i, j + 1)]
      for (const q of quad) {
        positions.push(q.x, q.y, q.z)
        anchorNode.push('')
      }
    }
  }
  return makePanel({
    positions: Float32Array.from(positions),
    anchorNode,
    color: '#d98a3d',
    transmittance: 0.42,
    scatter: 0.22,
    thicknessMm: 0.25
  })
}

function buildSleeve(side: number): Panel {
  const grid = buildGridPanel({
    cols: 6, rows: 8, width: 460, height: 1100, cupMm: 120,
    center: { x: side * 560, y: 2450, z: 0 }
  })
  return makePanel({
    positions: grid.positions,
    anchorNode: grid.anchorNode,
    color: '#e8e0d0',
    transmittance: 0.33,
    scatter: 0.28,
    thicknessMm: 0.3
  })
}

export function buildFigureGroup(): { group: LanternGroup; segments: Segment[] } {
  const group: LanternGroup = {
    id: uid('grp'), projectId: '', name: '仕女提灯·三米六', kind: 'figure',
    segmentIds: [], createdAt: Date.now()
  }

  const head = makePanel({
    ...buildSpherePanel({ x: 0, y: 3050, z: 0 }, 300, 18, 12, 1.12),
    color: '#f0d9c2', transmittance: 0.28, scatter: 0.3
  })
  const torso = makePanel({
    ...buildSpherePanel({ x: 0, y: 2350, z: 0 }, 620, 20, 12, 1.15),
    color: '#c8453f', transmittance: 0.3, scatter: 0.3
  })
  const panels = [head, torso, buildSkirt(), buildSleeve(1), buildSleeve(-1), buildRibbon(1), buildRibbon(-1)]

  // 骨架：中轴主骨 + 肩横杆 + 裙摆三道环箍 + 头部环
  const nodes: Node3[] = []
  const rods: Rod[] = []
  const addNode = (p: Vec3) => {
    const n = { id: uid('n'), p }
    nodes.push(n)
    return n.id
  }
  const link = (a: string, b: string, d = 5) => rods.push({ id: uid('r'), a, b, diameterMm: d })

  const spine: string[] = []
  for (let y = 250; y <= 3350; y += 350) spine.push(addNode({ x: 0, y, z: 0 }))
  for (let i = 0; i < spine.length - 1; i++) link(spine[i], spine[i + 1], 6)
  // 肩横杆
  const shoulderL = addNode({ x: -780, y: 2700, z: 0 })
  const shoulderR = addNode({ x: 780, y: 2700, z: 0 })
  link(shoulderL, spine[spine.length - 2], 5)
  link(shoulderR, spine[spine.length - 2], 5)
  // 裙摆环箍（8 边形 × 3 层）
  for (const y of [1400, 800, 280]) {
    const radius = y > 1000 ? 900 : y > 500 ? 1150 : 1320
    const ring: string[] = []
    for (let j = 0; j < 8; j++) {
      const ang = (j / 8) * Math.PI * 2
      ring.push(addNode({ x: Math.cos(ang) * radius, y, z: Math.sin(ang) * radius }))
    }
    for (let j = 0; j < 8; j++) link(ring[j], ring[(j + 1) % 8], 4)
  }
  // 头部环箍
  const headRing: string[] = []
  for (let j = 0; j < 8; j++) {
    const ang = (j / 8) * Math.PI * 2
    headRing.push(addNode({ x: Math.cos(ang) * 280, y: 3050, z: Math.sin(ang) * 280 }))
  }
  for (let j = 0; j < 8; j++) link(headRing[j], headRing[(j + 1) % 8], 3)

  // 颜料示例：裙摆下摆画一圈纹样，降低透光
  const skirt = panels[2]
  for (let v = 0; v < skirt.paint.length; v++) {
    const y = skirt.basePositions[v * 3 + 1]
    if (y < 700 && Math.sin(skirt.basePositions[v * 3] * 0.02) > 0.3) skirt.paint[v] = 0.9
  }
  skirt.paintColor = '#1d3f8a'

  const lights: LightItem[] = [
    { id: uid('l'), kind: 'point', name: '头部灯', p: { x: 0, y: 3050, z: 0 }, powerW: 6, cctK: 3200, beadSpacingMm: 50, efficacyLmW: 95 },
    { id: uid('l'), kind: 'point', name: '胸灯', p: { x: 0, y: 2400, z: 0 }, powerW: 10, cctK: 2900, beadSpacingMm: 50, efficacyLmW: 95 },
    { id: uid('l'), kind: 'point', name: '裙内灯1', p: { x: 260, y: 1200, z: 0 }, powerW: 8, cctK: 2800, beadSpacingMm: 50, efficacyLmW: 90 },
    { id: uid('l'), kind: 'point', name: '裙内灯2', p: { x: -260, y: 1200, z: 0 }, powerW: 8, cctK: 2800, beadSpacingMm: 50, efficacyLmW: 90 },
    {
      id: uid('l'), kind: 'strip', name: '裙摆环带',
      p: { x: 800, y: 350, z: 0 }, p2: { x: -800, y: 350, z: 0 },
      powerW: 16, cctK: 2700, beadSpacingMm: 45, efficacyLmW: 95
    }
  ]

  const segment: Segment = {
    id: uid('seg'),
    groupId: group.id,
    name: '仕女整体',
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
