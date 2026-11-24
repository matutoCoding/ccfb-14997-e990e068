import type { CutList, LightItem, Panel, Project, Segment } from './types'
import { circleArea, rodLengthMm, segmentBounds } from './structure'

// 下料单：钢丝按直径分档统计，焊点按每杆 2 端计，布料按三角网格面积，灯带按长度

function triangleArea(p: Float32Array, i: number): number {
  const ax = p[i], ay = p[i + 1], az = p[i + 2]
  const bx = p[i + 3], by = p[i + 4], bz = p[i + 5]
  const cx = p[i + 6], cy = p[i + 7], cz = p[i + 8]
  const ux = bx - ax, uy = by - ay, uz = bz - az
  const vx = cx - ax, vy = cy - ay, vz = cz - az
  const nx = uy * vz - uz * vy
  const ny = uz * vx - ux * vz
  const nz = ux * vy - uy * vx
  return Math.hypot(nx, ny, nz) / 2
}

function panelAreaM2(panel: Panel): number {
  let mm2 = 0
  for (let i = 0; i < panel.positions.length; i += 9) mm2 += triangleArea(panel.positions, i)
  return mm2 / 1e6
}

function lightStripLengthM(l: LightItem): number {
  if (l.kind !== 'strip' || !l.p2) return 0
  return Math.hypot(l.p2.x - l.p.x, l.p2.y - l.p.y, l.p2.z - l.p.z) / 1000
}

export function buildCutList(seg: Segment, project?: Project): CutList {
  const rodMap = new Map<number, { lengthM: number; count: number }>()
  let steelLengthM = 0
  let weldCount = 0
  for (const rod of seg.rods) {
    const Lm = rodLengthMm(rod, seg.nodes) / 1000
    steelLengthM += Lm
    weldCount += 2
    const bucket = rodMap.get(rod.diameterMm)
    if (bucket) { bucket.lengthM += Lm; bucket.count++ }
    else rodMap.set(rod.diameterMm, { lengthM: Lm, count: 1 })
  }

  let fabricAreaM2 = 0
  const panels = seg.panels.map((p) => {
    const areaM2 = panelAreaM2(p)
    fabricAreaM2 += areaM2
    return { id: p.id, areaM2, vertexCount: p.positions.length / 3 }
  })

  let stripLengthM = 0
  let totalPowerW = 0
  for (const l of seg.lights) {
    stripLengthM += lightStripLengthM(l)
    totalPowerW += l.powerW
  }

  // 重量：钢丝 + 绸布(0.12kg/m²) + 灯带(0.08kg/m) + 点光源(0.05kg/个)
  let steelWeight = 0
  for (const rod of seg.rods) {
    const Lmm = rodLengthMm(rod, seg.nodes)
    steelWeight += (circleArea(rod.diameterMm) * Lmm) / 1e9 * seg.steelDensityKgM3
  }
  const fabricWeight = fabricAreaM2 * 0.12
  const stripWeight = stripLengthM * 0.08
  const pointWeight = seg.lights.filter((l) => l.kind === 'point').length * 0.05
  const weightKg = steelWeight + fabricWeight + stripWeight + pointWeight

  const bounds = segmentBounds(seg)
  const t = project?.transportMax
  const overTransport = t
    ? bounds.size.x > t.x || bounds.size.y > t.y || bounds.size.z > t.z
    : false

  return {
    steelLengthM,
    weldCount,
    fabricAreaM2,
    stripLengthM,
    lightCount: seg.lights.length,
    totalPowerW,
    weightKg,
    bounds,
    overTransport,
    panels,
    rods: [...rodMap.entries()]
      .map(([diameterMm, v]) => ({ diameterMm, lengthM: v.lengthM, count: v.count }))
      .sort((a, b) => a.diameterMm - b.diameterMm)
  }
}

// 多段汇总（整组下料）
export function mergeCutLists(lists: CutList[], project?: Project): CutList {
  const merged: CutList = {
    steelLengthM: 0, weldCount: 0, fabricAreaM2: 0, stripLengthM: 0,
    lightCount: 0, totalPowerW: 0, weightKg: 0,
    bounds: {
      min: { x: Infinity, y: Infinity, z: Infinity },
      max: { x: -Infinity, y: -Infinity, z: -Infinity },
      size: { x: 0, y: 0, z: 0 }
    },
    overTransport: false,
    panels: [],
    rods: []
  }
  const rodMap = new Map<number, { lengthM: number; count: number }>()
  for (const c of lists) {
    merged.steelLengthM += c.steelLengthM
    merged.weldCount += c.weldCount
    merged.fabricAreaM2 += c.fabricAreaM2
    merged.stripLengthM += c.stripLengthM
    merged.lightCount += c.lightCount
    merged.totalPowerW += c.totalPowerW
    merged.weightKg += c.weightKg
    merged.panels.push(...c.panels)
    for (const r of c.rods) {
      const b = rodMap.get(r.diameterMm)
      if (b) { b.lengthM += r.lengthM; b.count += r.count }
      else rodMap.set(r.diameterMm, { ...r })
    }
    merged.bounds.min.x = Math.min(merged.bounds.min.x, c.bounds.min.x)
    merged.bounds.min.y = Math.min(merged.bounds.min.y, c.bounds.min.y)
    merged.bounds.min.z = Math.min(merged.bounds.min.z, c.bounds.min.z)
    merged.bounds.max.x = Math.max(merged.bounds.max.x, c.bounds.max.x)
    merged.bounds.max.y = Math.max(merged.bounds.max.y, c.bounds.max.y)
    merged.bounds.max.z = Math.max(merged.bounds.max.z, c.bounds.max.z)
  }
  merged.bounds.size = {
    x: merged.bounds.max.x - merged.bounds.min.x,
    y: merged.bounds.max.y - merged.bounds.min.y,
    z: merged.bounds.max.z - merged.bounds.min.z
  }
  merged.rods = [...rodMap.entries()]
    .map(([diameterMm, v]) => ({ diameterMm, ...v }))
    .sort((a, b) => a.diameterMm - b.diameterMm)
  if (project?.transportMax) {
    const t = project.transportMax
    merged.overTransport = merged.bounds.size.x > t.x || merged.bounds.size.y > t.y || merged.bounds.size.z > t.z
  }
  return merged
}
