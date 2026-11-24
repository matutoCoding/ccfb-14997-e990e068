import type { LanternGroup, LightItem, Node3, Panel, Rod, Segment, Vec3 } from '../core/types'
import { uid } from '../core/idb'
import { loftTube, makePanel, ringsToSkeleton, sampleCurve } from '../core/loft'

// 龙身半径曲线：头大尾细，沿全长 t∈[0,1]
function dragonRadius(t: number): number {
  if (t < 0.18) return 520 + (680 - 520) * (t / 0.18)
  if (t < 0.72) return 680 - (680 - 380) * ((t - 0.18) / 0.54)
  return 380 - (380 - 90) * ((t - 0.72) / 0.28)
}

function dragonCurve(): Vec3[] {
  // 正弦摆动的龙身，15m 长、起伏 1.6m
  const pts: Vec3[] = []
  for (let i = 0; i <= 9; i++) {
    const t = i / 9
    pts.push({
      x: -7200 + t * 14400,
      y: 1500 + Math.sin(t * Math.PI * 2.2) * 850,
      z: Math.sin(t * Math.PI * 3.1) * 1300
    })
  }
  return pts
}

interface TubeSegSpec {
  t0: number
  t1: number
  rings: number
  radial: number
  name: string
  color: string
  tau: number
}

function buildTubeSegment(groupId: string, spec: TubeSegSpec, curve: Vec3[]): Segment {
  const sampled = sampleCurve(curve, 60).filter((_, i, arr) => {
    const t = i / (arr.length - 1)
    return t >= spec.t0 - 1e-6 && t <= spec.t1 + 1e-6
  })
  const local = sampled.length < 4 ? sampleCurve(curve, 60) : sampled
  const tOffset = spec.t0
  const span = spec.t1 - spec.t0
  const loft = loftTube(local, {
    rings: local.length,
    radial: spec.radial,
    radiusFn: (u) => dragonRadius(tOffset + u * span)
  })
  const skel = ringsToSkeleton(loft.ringPoints.filter((_, i) => i % 4 === 0), 5)
  const panel = makePanel({
    positions: loft.positions,
    anchorNode: loft.anchorNode,
    color: spec.color,
    transmittance: spec.tau,
    scatter: 0.3,
    thicknessMm: 0.32
  })

  // 沿管轴布置灯带：在管内偏下位置走两条
  const lights: LightItem[] = []
  const ringStep = Math.max(1, Math.floor(local.length / 4))
  for (let r = 0; r < local.length - 1; r += ringStep) {
    const a = local[r].p
    const b = local[Math.min(local.length - 1, r + ringStep)].p
    lights.push({
      id: uid('l'),
      kind: 'strip',
      name: `灯带 ${lights.length + 1}`,
      p: { x: a.x, y: a.y - 120, z: a.z },
      p2: { x: b.x, y: b.y - 120, z: b.z },
      powerW: 14,
      cctK: 2700,
      beadSpacingMm: 50,
      efficacyLmW: 95
    })
  }

  return {
    id: uid('seg'),
    groupId,
    name: spec.name,
    nodes: skel.nodes,
    rods: skel.rods,
    panels: [panel],
    lights,
    steelDensityKgM3: 7850,
    updatedAt: Date.now()
  }
}

// 龙头：短粗管 + 两根锥形龙角（小管放样）
function buildDragonHead(groupId: string, curve: Vec3[]): Segment {
  const headCurve = sampleCurve(curve, 60).slice(0, 8)
  const loft = loftTube(headCurve, {
    rings: headCurve.length,
    radial: 20,
    radiusFn: (u) => 700 + u * 140
  })
  const skel = ringsToSkeleton(loft.ringPoints, 6)
  const nodes: Node3[] = [...skel.nodes]
  const rods: Rod[] = [...skel.rods]
  const panels: Panel[] = [
    makePanel({
      positions: loft.positions,
      anchorNode: loft.anchorNode,
      color: '#c9302c',
      transmittance: 0.3,
      scatter: 0.32,
      thicknessMm: 0.35
    })
  ]

  // 龙角：从头部环点向上伸出的曲线小管
  const baseRing = loft.ringPoints[2]
  for (const side of [-1, 1]) {
    const base = baseRing[Math.floor(baseRing.length * (side > 0 ? 0.25 : 0.75))]
    const hornCurve: Vec3[] = [
      base,
      { x: base.x + 200, y: base.y + 700, z: base.z + side * 260 },
      { x: base.x + 420, y: base.y + 1350, z: base.z + side * 420 }
    ]
    const horn = loftTube(sampleCurve(hornCurve, 12), {
      rings: 12,
      radial: 10,
      radiusFn: (u) => 90 * (1 - u) + 24
    })
    panels.push(makePanel({
      positions: horn.positions,
      anchorNode: horn.anchorNode,
      color: '#e8b34b',
      transmittance: 0.22,
      scatter: 0.2
    }))
    const hs = ringsToSkeleton(horn.ringPoints.filter((_, i) => i % 3 === 0), 4)
    nodes.push(...hs.nodes)
    rods.push(...hs.rods)
  }

  const headCenter = headCurve[4].p
  const lights: LightItem[] = [
    {
      id: uid('l'), kind: 'point', name: '龙头主灯',
      p: { x: headCenter.x, y: headCenter.y, z: headCenter.z },
      powerW: 18, cctK: 3000, beadSpacingMm: 50, efficacyLmW: 95
    },
    {
      id: uid('l'), kind: 'point', name: '龙眼灯',
      p: { x: headCenter.x + 250, y: headCenter.y + 180, z: headCenter.z },
      powerW: 6, cctK: 4000, beadSpacingMm: 50, efficacyLmW: 100
    }
  ]

  return {
    id: uid('seg'),
    groupId,
    name: '龙头段',
    nodes, rods, panels, lights,
    steelDensityKgM3: 7850,
    updatedAt: Date.now()
  }
}

export function buildDragonGroup(): { group: LanternGroup; segments: Segment[] } {
  const group: LanternGroup = {
    id: uid('grp'),
    projectId: '',
    name: '腾龙·十五米',
    kind: 'dragon',
    segmentIds: [],
    createdAt: Date.now()
  }
  const curve = dragonCurve()
  const segments = [
    buildDragonHead(group.id, curve),
    buildTubeSegment(group.id, { t0: 0.12, t1: 0.55, rings: 40, radial: 24, name: '龙身前段', color: '#d1452f', tau: 0.32 }, curve),
    buildTubeSegment(group.id, { t0: 0.55, t1: 1, rings: 40, radial: 24, name: '龙身后段', color: '#b93628', tau: 0.3 }, curve)
  ]
  group.segmentIds = segments.map((s) => s.id)
  return { group, segments }
}
