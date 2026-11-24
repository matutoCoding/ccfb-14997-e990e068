import type { Node3, Rod, Segment, Vec3 } from './types'

// 结构粗算：钢丝按圆截面、两端简支梁模型
// 挠度 δ = 5·q·L⁴ / (384·E·I)，q 为均布自重线荷载(N/mm)

export const STEEL_E_MPA = 206000 // 弹性模量 MPa(N/mm²)

function dist(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}

export function rodLengthMm(rod: Rod, nodes: Node3[]): number {
  const a = nodes.find((n) => n.id === rod.a)
  const b = nodes.find((n) => n.id === rod.b)
  if (!a || !b) return 0
  return dist(a.p, b.p)
}

// 圆截面面积 mm²
export function circleArea(d: number): number {
  return Math.PI * (d / 2) ** 2
}

// 圆截面惯性矩 mm⁴
export function circleInertia(d: number): number {
  return (Math.PI * d ** 4) / 64
}

// 单根杆自重(kg)与简支挠度(mm)
export function rodStruct(rod: Rod, nodes: Node3[], densityKgM3: number) {
  const L = rodLengthMm(rod, nodes)
  const area = circleArea(rod.diameterMm)
  const I = circleInertia(rod.diameterMm)
  // 体积 mm³ → m³
  const weightKg = (area * L) / 1e9 * densityKgM3
  // 线荷载 N/mm：kg/m × g / 1000
  const q = ((weightKg / Math.max(L, 1)) * 1000 * 9.81) / 1000
  const deflectionMm = (5 * q * L ** 4) / (384 * STEEL_E_MPA * I)
  return { lengthMm: L, weightKg, deflectionMm }
}

export interface SegmentStruct {
  totalLengthM: number
  steelWeightKg: number
  maxDeflection: { rodId: string; mm: number; lengthMm: number; spanRatio: number } | null
  rodCount: number
}

export function segmentStruct(seg: Segment): SegmentStruct {
  let total = 0
  let weight = 0
  let max: SegmentStruct['maxDeflection'] = null
  for (const rod of seg.rods) {
    const r = rodStruct(rod, seg.nodes, seg.steelDensityKgM3)
    total += r.lengthMm
    weight += r.weightKg
    const spanRatio = r.deflectionMm / Math.max(1, r.lengthMm)
    if (!max || r.deflectionMm > max.mm) {
      max = { rodId: rod.id, mm: r.deflectionMm, lengthMm: r.lengthMm, spanRatio }
    }
  }
  return {
    totalLengthM: total / 1000,
    steelWeightKg: weight,
    maxDeflection: max,
    rodCount: seg.rods.length
  }
}

export function segmentBounds(seg: Segment): { min: Vec3; max: Vec3; size: Vec3 } {
  const min: Vec3 = { x: Infinity, y: Infinity, z: Infinity }
  const max: Vec3 = { x: -Infinity, y: -Infinity, z: -Infinity }
  const acc = (p: Vec3) => {
    min.x = Math.min(min.x, p.x); min.y = Math.min(min.y, p.y); min.z = Math.min(min.z, p.z)
    max.x = Math.max(max.x, p.x); max.y = Math.max(max.y, p.y); max.z = Math.max(max.z, p.z)
  }
  for (const n of seg.nodes) acc(n.p)
  for (const p of seg.panels) {
    for (let i = 0; i < p.positions.length; i += 3) {
      acc({ x: p.positions[i], y: p.positions[i + 1], z: p.positions[i + 2] })
    }
  }
  if (!Number.isFinite(min.x)) return { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 }, size: { x: 0, y: 0, z: 0 } }
  return { min, max, size: { x: max.x - min.x, y: max.y - min.y, z: max.z - min.z } }
}
