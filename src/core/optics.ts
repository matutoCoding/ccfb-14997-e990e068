import type { EmitterInput, Panel, Vec3, BakeResult, LightItem } from './types'

// 透光物理模型（与手算口径保持一致）：
// 1. 点光源/灯珠为各向同性，发光强度 I = 光通量lm / 4π (cd)
// 2. 布面内表面照度 E = I / d² · |cosθ|，θ 为光线与布面法线夹角（布料双面受光取绝对值）
// 3. 透射照度 Eout = E · τ_eff，颜料处 τ_eff = τ · (1 - 0.85·paint)
// 4. 散射为独立后处理：相邻顶点照度按 scatter 系数混合，不改变 raw 值
// 5. 环境漏光 ambientLeakLux 直接叠加到散射结果，保证无灯区不为纯黑

export const LUX_REF = 100 // 显示映射参考：100lx 经 ACES 映射为中等亮度
const PAINT_BLOCK = 0.85

export function effectiveTransmittance(tau: number, paint: number): number {
  return tau * (1 - PAINT_BLOCK * paint)
}

// 单点照度（lx），供校验面板与手算逐点对比
export function pointIlluminance(lm: number, light: Vec3, surface: Vec3, normal: Vec3): number {
  const dx = light.x - surface.x
  const dy = light.y - surface.y
  const dz = light.z - surface.z
  const d2 = dx * dx + dy * dy + dz * dz
  if (d2 < 1) return 0
  const d = Math.sqrt(d2)
  const nl = Math.abs(dx * normal.x + dy * normal.y + dz * normal.z) / d
  return (lm / (4 * Math.PI)) / d2 * nl * 1e6 // mm→m: 1/d²(mm) ×1e6
}

// 灯位/灯带展开为离散发光珠
export function expandEmitters(lights: LightItem[]): EmitterInput[] {
  const out: EmitterInput[] = []
  for (const l of lights) {
    if (l.kind === 'point') {
      out.push({ id: l.id, p: l.p, lm: l.powerW * l.efficacyLmW, cctK: l.cctK })
      continue
    }
    const a = l.p
    const b = l.p2 ?? l.p
    const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z)
    const n = Math.max(1, Math.floor(len / Math.max(1, l.beadSpacingMm)) + 1)
    const lmPerBead = (l.powerW * l.efficacyLmW) / n
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0 : i / (n - 1)
      out.push({
        id: l.id,
        lm: lmPerBead,
        cctK: l.cctK,
        p: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t }
      })
    }
  }
  return out
}

// 色温(K)转线性 RGB，Tanner Helland 黑体近似
export function cctToRgb(kelvin: number): [number, number, number] {
  const t = kelvin / 100
  let r: number, g: number, b: number
  r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592)
  g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * Math.pow(t - 60, -0.0755148492)
  b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307
  const cl = (v: number) => Math.min(255, Math.max(0, v)) / 255
  // sRGB 近似转回线性
  const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))
  return [lin(cl(r)), lin(cl(g)), lin(cl(b))]
}

function vertexNormals(pos: Float32Array): Float32Array {
  const n = new Float32Array(pos.length)
  for (let i = 0; i < pos.length; i += 9) {
    const ax = pos[i], ay = pos[i + 1], az = pos[i + 2]
    const bx = pos[i + 3] - ax, by = pos[i + 4] - ay, bz = pos[i + 5] - az
    const cx = pos[i + 6] - ax, cy = pos[i + 7] - ay, cz = pos[i + 8] - az
    const nx = by * cz - bz * cy
    const ny = bz * cx - bx * cz
    const nz = bx * cy - by * cx
    for (let j = 0; j < 3; j++) {
      n[i + j * 3] += nx
      n[i + j * 3 + 1] += ny
      n[i + j * 3 + 2] += nz
    }
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1
    n[i] /= l; n[i + 1] /= l; n[i + 2] /= l
  }
  return n
}

// 相邻顶点一次混合（同一三角形内的顶点互为邻接，按全局顶点序号索引）
function scatterPass(lux: Float32Array, pos: Float32Array, factor: number): Float32Array {
  if (factor <= 0) return lux.slice()
  const vcount = pos.length / 3
  const adj = Array.from({ length: vcount }, () => new Set<number>())
  for (let base = 0; base < vcount; base += 3) {
    const tri = [base, base + 1, base + 2]
    for (const a of tri) for (const b of tri) if (a !== b) adj[a].add(b)
  }
  const out = new Float32Array(vcount)
  for (let i = 0; i < vcount; i++) {
    let sum = 0
    for (const j of adj[i]) sum += lux[j]
    const avg = adj[i].size ? sum / adj[i].size : lux[i]
    out[i] = lux[i] * (1 - factor) + avg * factor
  }
  return out
}

export interface BakeOptions {
  ambientLeakLux: number
  onProgress?: (ratio: number) => void
}

// 全段烘焙：返回每块布的 raw（手算口径）与 scattered（显示口径）
// 精确起见采用全量求和（无空间剔除），灯珠展开为 SoA 扁平数组保证热循环性能
export function bakeSegment(panels: Panel[], lights: LightItem[], opts: BakeOptions): BakeResult {
  const t0 = performance.now()
  const emitters = expandEmitters(lights)
  const raw: Float32Array[] = []
  const scattered: Float32Array[] = []
  if (!emitters.length) {
    for (const p of panels) {
      const z = new Float32Array(p.positions.length / 3)
      raw.push(z)
      scattered.push(z.map(() => opts.ambientLeakLux))
    }
    return { raw, scattered, emitterCount: 0, elapsedMs: performance.now() - t0 }
  }
  const eCount = emitters.length
  const ex = new Float64Array(eCount)
  const ey = new Float64Array(eCount)
  const ez = new Float64Array(eCount)
  const eK = new Float64Array(eCount) // lm/(4π)×1e6，预算常量
  for (let i = 0; i < eCount; i++) {
    ex[i] = emitters[i].p.x
    ey[i] = emitters[i].p.y
    ez[i] = emitters[i].p.z
    eK[i] = (emitters[i].lm / (4 * Math.PI)) * 1e6
  }

  panels.forEach((panel, pi) => {
    const pos = panel.positions
    const normals = vertexNormals(pos)
    const vcount = pos.length / 3
    const lux = new Float32Array(vcount)
    for (let v = 0; v < vcount; v++) {
      const px = pos[v * 3], py = pos[v * 3 + 1], pz = pos[v * 3 + 2]
      const nx = normals[v * 3], ny = normals[v * 3 + 1], nz = normals[v * 3 + 2]
      let acc = 0
      for (let e = 0; e < eCount; e++) {
        const dx = ex[e] - px, dy = ey[e] - py, dz = ez[e] - pz
        const d2 = dx * dx + dy * dy + dz * dz
        if (d2 < 1) continue
        const invD = 1 / Math.sqrt(d2)
        const cosT = Math.abs(dx * nx + dy * ny + dz * nz) * invD
        acc += (eK[e] * invD * invD) * cosT
      }
      const tau = effectiveTransmittance(panel.transmittance, panel.paint[v] ?? 0)
      lux[v] = acc * tau
    }
    raw.push(lux)
    const blured = scatterPass(lux, pos, panel.scatter)
    for (let i = 0; i < blured.length; i++) blured[i] += opts.ambientLeakLux
    scattered.push(blured)
    opts.onProgress?.((pi + 1) / panels.length)
  })

  return { raw, scattered, emitterCount: emitters.length, elapsedMs: performance.now() - t0 }
}

// ACES filmic 近似
function aces(v: number): number {
  const a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14
  return Math.min(1, Math.max(0, (v * (a * v + b)) / (v * (c * v + d) + e)))
}

// 照度+色温转显示颜色（线性空间，交给 three 渲染器输出变换）
export function luxToColor(lux: number, cct: [number, number, number], exposure: number): [number, number, number] {
  const v = (lux / LUX_REF) * exposure
  return [aces(v * cct[0]), aces(v * cct[1]), aces(v * cct[2])]
}

// 热力图色阶：暗蓝→青→绿→黄→红
const RAMP: [number, number, number][] = [
  [0.13, 0.2, 0.55],
  [0.15, 0.55, 0.85],
  [0.25, 0.75, 0.45],
  [0.95, 0.85, 0.3],
  [0.9, 0.3, 0.2]
]

export function heatColor(t: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, t)) * (RAMP.length - 1)
  const i = Math.min(RAMP.length - 2, Math.floor(x))
  const f = x - i
  const a = RAMP[i], b = RAMP[i + 1]
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]
}

// 对数归一化，避免热点把暗区压没
export function normalizeLog(lux: number, darkLux: number, hotLux: number): number {
  const lo = Math.log(Math.max(1e-3, darkLux))
  const hi = Math.log(Math.max(lo + 0.001, hotLux))
  return (Math.log(Math.max(1e-3, lux)) - lo) / (hi - lo)
}
