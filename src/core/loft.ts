import type { Node3, Panel, Rod, Vec3 } from './types'
import { uid } from './idb'

// 放样与几何生成（纯数据，不依赖 three）
// 管状物：Catmull-Rom 样条 + 平行运输标架，避免 Frenet 标架在直段翻转

export interface CurvePoint { p: Vec3; tangent: Vec3 }

function vsub(a: Vec3, b: Vec3): Vec3 { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z } }
function vadd(a: Vec3, b: Vec3): Vec3 { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z } }
function vscale(a: Vec3, s: number): Vec3 { return { x: a.x * s, y: a.y * s, z: a.z * s } }
function vdot(a: Vec3, b: Vec3): number { return a.x * b.x + a.y * b.y + a.z * b.z }
function vcross(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }
}
function vnorm(a: Vec3): Vec3 {
  const l = Math.hypot(a.x, a.y, a.z) || 1
  return { x: a.x / l, y: a.y / l, z: a.z / l }
}

// 向心参数化 Catmull-Rom，输出指定数量采样点；端点复制保证曲线经过首尾控制点
export function sampleCurve(control: Vec3[], samples: number): CurvePoint[] {
  if (control.length < 2) return control.map((p) => ({ p: { ...p }, tangent: { x: 1, y: 0, z: 0 } }))
  const pts = [control[0], ...control, control[control.length - 1]]
  // 每段 [i, i+1] 用向心参数 alpha=0.5，段内局部参数 u∈[0,1]
  const segT: number[] = [0]
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y, pts[i].z - pts[i - 1].z)
    segT.push(segT[i - 1] + Math.max(d, 1e-6) ** 0.5)
  }
  const safe = (d: number) => (Math.abs(d) < 1e-12 ? 1e-12 : d)
  const cr = (i: number, u: number): Vec3 => {
    const p0 = pts[i - 1], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2]
    const t0 = segT[i - 1], t1 = segT[i], t2 = segT[i + 1], t3 = segT[i + 2]
    const tt = t1 + u * (t2 - t1)
    const a1 = vadd(vscale(p0, (t1 - tt) / safe(t1 - t0)), vscale(p1, (tt - t0) / safe(t1 - t0)))
    const a2 = vadd(vscale(p1, (t2 - tt) / safe(t2 - t1)), vscale(p2, (tt - t1) / safe(t2 - t1)))
    const a3 = vadd(vscale(p2, (t3 - tt) / safe(t3 - t2)), vscale(p3, (tt - t2) / safe(t3 - t2)))
    const b1 = vadd(vscale(a1, (t2 - tt) / safe(t2 - t0)), vscale(a2, (tt - t0) / safe(t2 - t0)))
    const b2 = vadd(vscale(a2, (t3 - tt) / safe(t3 - t1)), vscale(a3, (tt - t1) / safe(t3 - t1)))
    return vadd(vscale(b1, (t2 - tt) / safe(t2 - t1)), vscale(b2, (tt - t1) / safe(t2 - t1)))
  }
  // 有效段：i=1..pts.length-3，共 control.length-1 段
  const segCount = control.length - 1
  const out: CurvePoint[] = []
  for (let k = 0; k < samples; k++) {
    const f = Math.min(segCount, (k / (samples - 1)) * segCount)
    const i = Math.min(segCount - 1, Math.floor(f)) + 1
    // 末采样点 u 必须精确为 1，保证曲线终止于最后一个控制点
    const u = k === samples - 1 ? 1 : f - Math.floor(f)
    const p = cr(i, u)
    const pa = cr(i, Math.max(0, u - 1e-4))
    const pb = cr(i, Math.min(1, u + 1e-4))
    out.push({ p, tangent: vnorm(vsub(pb, pa)) })
  }
  return out
}

export interface LoftOptions {
  rings: number
  radial: number
  radiusFn: (t: number) => number
  // 截面椭圆压扁系数（y 方向）
  flattenY?: number
}

export interface LoftResult {
  // rings × radial 个环点
  ringPoints: Vec3[][]
  positions: Float32Array
  anchorNode: string[]
}

// 管状放样，同时产出环点（可直接当骨架节点）与蒙布三角网格
export function loftTube(curve: CurvePoint[], opts: LoftOptions): LoftResult {
  const flattenY = opts.flattenY ?? 1
  const ringPoints: Vec3[][] = []
  let normal: Vec3 = { x: 0, y: 1, z: 0 }
  if (Math.abs(vdot(normal, curve[0].tangent)) > 0.9) normal = { x: 1, y: 0, z: 0 }
  normal = vnorm(vsub(normal, vscale(curve[0].tangent, vdot(normal, curve[0].tangent))))

  for (let i = 0; i < curve.length; i++) {
    const { p, tangent } = curve[i]
    if (i > 0) {
      // 平行运输：把上一法线投影到当前切平面
      normal = vnorm(vsub(normal, vscale(tangent, vdot(normal, tangent))))
    }
    const binormal = vcross(tangent, normal)
    const r = opts.radiusFn(i / (curve.length - 1))
    const ring: Vec3[] = []
    for (let j = 0; j < opts.radial; j++) {
      const ang = (j / opts.radial) * Math.PI * 2
      const c = Math.cos(ang), s = Math.sin(ang)
      const offset = vadd(vscale(normal, c * r * flattenY), vscale(binormal, s * r))
      ring.push(vadd(p, offset))
    }
    ringPoints.push(ring)
  }

  const positions: number[] = []
  const anchorNode: string[] = []
  for (let i = 0; i < ringPoints.length - 1; i++) {
    for (let j = 0; j < opts.radial; j++) {
      const j2 = (j + 1) % opts.radial
      const quad = [ringPoints[i][j], ringPoints[i][j2], ringPoints[i + 1][j2], ringPoints[i][j], ringPoints[i + 1][j2], ringPoints[i + 1][j]]
      for (const q of quad) {
        positions.push(q.x, q.y, q.z)
        anchorNode.push('')
      }
    }
  }
  return { ringPoints, positions: Float32Array.from(positions), anchorNode }
}

// 把放样环点转成骨架：每环一个节点 + 环内箍 + 纵向连杆
export function ringsToSkeleton(ringPoints: Vec3[][], diameterMm: number): { nodes: Node3[]; rods: Rod[] } {
  const nodes: Node3[] = []
  const rods: Rod[] = []
  const radial = ringPoints[0].length
  for (const ring of ringPoints) for (const p of ring) nodes.push({ id: uid('n'), p })
  const at = (i: number, j: number) => nodes[i * radial + (j % radial)].id
  for (let i = 0; i < ringPoints.length; i++) {
    for (let j = 0; j < radial; j++) rods.push({ id: uid('r'), a: at(i, j), b: at(i, j + 1), diameterMm })
  }
  for (let i = 0; i < ringPoints.length - 1; i++) {
    for (let j = 0; j < radial; j++) rods.push({ id: uid('r'), a: at(i, j), b: at(i + 1, j), diameterMm })
  }
  return { nodes, rods }
}

export interface GridOptions {
  cols: number
  rows: number
  width: number
  height: number
  center?: Vec3
  // 花瓣类曲面：每列纵向弯曲量
  cupMm?: number
}

// 平面/微曲四边形网格（荷叶、花瓣、衣片用），四角锚定到骨架节点
export function buildGridPanel(opts: GridOptions): { positions: Float32Array; anchorNode: string[]; corners: Vec3[] } {
  const center = opts.center ?? { x: 0, y: 0, z: 0 }
  const cup = opts.cupMm ?? 0
  const positions: number[] = []
  const anchorNode: string[] = []
  const corners: Vec3[] = []
  const at = (i: number, j: number) => {
    const u = i / opts.cols
    const v = j / opts.rows
    const x = center.x + (u - 0.5) * opts.width
    const y = center.y + (v - 0.5) * opts.height
    const z = center.z - cup * Math.sin(u * Math.PI) * Math.sin(v * Math.PI)
    return { x, y, z }
  }
  for (let i = 0; i <= opts.cols; i++) {
    for (let j = 0; j <= opts.rows; j++) {
      const p = at(i, j)
      if ((i === 0 || i === opts.cols) && (j === 0 || j === opts.rows)) corners.push(p)
    }
  }
  for (let i = 0; i < opts.cols; i++) {
    for (let j = 0; j < opts.rows; j++) {
      const quad = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j), at(i + 1, j + 1), at(i, j + 1)]
      for (const q of quad) {
        positions.push(q.x, q.y, q.z)
        const edgeU = i === 0 || i === opts.cols - 1
        const edgeV = j === 0 || j === opts.rows - 1
        anchorNode.push(edgeU && edgeV ? 'anchor' : '')
      }
    }
  }
  return { positions: Float32Array.from(positions), anchorNode, corners }
}

// 绸布下垂：从基准网格重新生成 positions，锚点（骨架处）垂度为 0
export function applySag(panel: Panel, sagMm: number): void {
  const base = panel.basePositions
  const pos = panel.positions
  pos.set(base)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (let i = 0; i < base.length; i += 3) {
    minX = Math.min(minX, base[i]); maxX = Math.max(maxX, base[i])
    minY = Math.min(minY, base[i + 1]); maxY = Math.max(maxY, base[i + 1])
  }
  const sx = Math.max(1, maxX - minX)
  const sy = Math.max(1, maxY - minY)
  for (let v = 0; v < base.length / 3; v++) {
    if (panel.anchorNode[v] === 'anchor') continue
    const u = (base[v * 3] - minX) / sx
    const w = (base[v * 3 + 1] - minY) / sy
    const fx = 4 * u * (1 - u)
    const fy = 4 * w * (1 - w)
    // 沿局部 -z 下垂；管状曲面法线差异由 scatter 补偿
    pos[v * 3 + 2] = base[v * 3 + 2] - sagMm * fx * fy
  }
  panel.sagMm = sagMm
}

// 球面经纬网格（人物头/身体用）
export function buildSpherePanel(center: Vec3, radius: number, lon: number, lat: number, flattenY = 1): {
  positions: Float32Array
  anchorNode: string[]
} {
  const positions: number[] = []
  const anchorNode: string[] = []
  for (let i = 0; i < lat; i++) {
    for (let j = 0; j < lon; j++) {
      const p = (phi: number, theta: number): Vec3 => ({
        x: center.x + radius * Math.sin(theta) * Math.cos(phi),
        y: center.y + radius * flattenY * Math.cos(theta),
        z: center.z + radius * Math.sin(theta) * Math.sin(phi)
      })
      const t0 = (i / lat) * Math.PI, t1 = ((i + 1) / lat) * Math.PI
      const p0 = (j / lon) * Math.PI * 2, p1 = ((j + 1) / lon) * Math.PI * 2
      const quad = [p(p0, t0), p(p1, t0), p(p1, t1), p(p0, t0), p(p1, t1), p(p0, t1)]
      for (const q of quad) {
        positions.push(q.x, q.y, q.z)
        anchorNode.push('')
      }
    }
  }
  return { positions: Float32Array.from(positions), anchorNode }
}

export function makePanel(partial: Partial<Panel> & { positions: Float32Array; anchorNode: string[] }): Panel {
  const positions = partial.positions
  return {
    id: uid('p'),
    basePositions: positions.slice(),
    paint: new Float32Array(positions.length / 3),
    paintColor: '#c0392b',
    color: '#e8443a',
    thicknessMm: 0.3,
    transmittance: 0.35,
    scatter: 0.25,
    sagMm: 0,
    ...partial,
    basePositions: partial.basePositions ?? positions.slice()
  }
}
