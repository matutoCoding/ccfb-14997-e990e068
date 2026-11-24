// 透光手算校验：不依赖浏览器/DOM，node --experimental-strip-types 直接运行
// 用法：pnpm test:optics
import { pointIlluminance, effectiveTransmittance, bakeSegment, expandEmitters } from '../src/core/optics'
import { makePanel } from '../src/core/loft'
import type { LightItem, Panel } from '../src/core/types'

function approx(a: number, b: number, tol = 1e-6): boolean {
  return Math.abs(a - b) <= tol * Math.max(1, Math.abs(b))
}

let failures = 0
function check(name: string, got: number, expect: number): void {
  const ok = approx(got, expect, 1e-4)
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: 计算=${got.toFixed(4)} 期望=${expect.toFixed(4)}`)
}

// 案例 1：单灯珠、布面正对 1000mm
// 5W × 90lm/W = 450lm；E = 450/(4π·1000²)×1e6
{
  const lm = 450
  const E = pointIlluminance(lm, { x: 0, y: 0, z: 1000 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 })
  const hand = (lm / (4 * Math.PI)) / (1000 ** 2) * 1e6
  check('案例1 正对 1m 内表面照度(lx)', E, hand)

  const tau = 0.35
  const eOut = E * effectiveTransmittance(tau, 0)
  check('案例1 透射照度(lx)', eOut, hand * tau)

  // 颜料浓度 0.8：τ_eff = 0.35×(1−0.85×0.8)
  const tauPainted = effectiveTransmittance(tau, 0.8)
  check('案例1 颜料区有效透光率', tauPainted, tau * (1 - 0.85 * 0.8))
}

// 案例 2：斜入射，光线与布面法线夹角 60°，cosθ=0.5
{
  const lm = 450
  const hand = (lm / (4 * Math.PI)) / (1000 ** 2) * 1e6
  // 光线方向 (0, sin60, cos60)，布面法线取 z 轴
  const light = { x: 0, y: 1000 * Math.sin(Math.PI / 3), z: 1000 * Math.cos(Math.PI / 3) }
  const E0 = pointIlluminance(lm, light, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 })
  check('案例2 60度入射角照度(lx)', E0, hand * 0.5)
  // 法线与光线同向时取满值（布料双面受光，cos 取绝对值）
  const nl = Math.hypot(light.y, light.z)
  const Efull = pointIlluminance(lm, light, { x: 0, y: 0, z: 0 }, { x: 0, y: light.y / nl, z: light.z / nl })
  check('案例2 法向对齐光线照度(lx)', Efull, hand)
}

// 案例 3：双灯叠加 = 单灯×2（两灯等距对称）
{
  const positions = new Float32Array([0, 0, 0, 100, 0, 0, 0, 100, 0])
  const panel: Panel = makePanel({ positions, anchorNode: ['', '', ''] })
  panel.transmittance = 0.4
  panel.scatter = 0
  const mkLight = (z: number): LightItem => ({
    id: `l${z}`, kind: 'point', name: 't', powerW: 5, cctK: 3000,
    beadSpacingMm: 50, efficacyLmW: 90,
    p: { x: 0, y: 0, z }
  })
  const single = bakeSegment([panel], [mkLight(1000)], { ambientLeakLux: 0 })
  const doubled = bakeSegment([panel], [mkLight(1000), mkLight(-1000)], { ambientLeakLux: 0 })
  check('案例3 双灯等距叠加首顶点(lx)', doubled.raw[0][0], single.raw[0][0] * 2)
}

// 案例 4：灯带离散珠数 = floor(L/间距)+1，每珠通量 = 总通量/珠数
{
  const strip: LightItem = {
    id: 's', kind: 'strip', name: 'strip', powerW: 12, cctK: 3000,
    beadSpacingMm: 50, efficacyLmW: 100,
    p: { x: 0, y: 0, z: 0 }, p2: { x: 1000, y: 0, z: 0 }
  }
  const emitters = expandEmitters([strip])
  check('案例4 灯珠数量', emitters.length, 21)
  const totalLm = emitters.reduce((s, e) => s + e.lm, 0)
  check('案例4 光通量守恒(lm)', totalLm, 12 * 100)
}

// 案例 5：烘焙 raw 与逐点手算完全一致（端到端）
{
  const positions = new Float32Array([0, 0, 0, 100, 0, 0, 0, 100, 0])
  const panel = makePanel({ positions, anchorNode: ['', '', ''] })
  panel.transmittance = 0.3
  panel.scatter = 0.15
  const light: LightItem = {
    id: 'l', kind: 'point', name: 't', powerW: 8, cctK: 2700,
    beadSpacingMm: 50, efficacyLmW: 95,
    p: { x: 300, y: 400, z: 500 }
  }
  const bake = bakeSegment([panel], [light], { ambientLeakLux: 0 })
  // 三角面法线 +z（顶点在 xy 平面）
  const hand = pointIlluminance(light.powerW * light.efficacyLmW, light.p, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }) * 0.3
  check('案例5 烘焙raw等于手算(lx)', bake.raw[0][0], hand)
  // 非索引网格三顶点照度不同，scatter=0.15 后首顶点 = 自身×0.85 + 邻域均值×0.15
  const arr = bake.raw[0]
  const neighborAvg = (arr[1] + arr[2]) / 2
  const expectedScatter = hand * 0.85 + neighborAvg * 0.15
  check('案例5 散射混合首顶点(lx)', bake.scattered[0][0], expectedScatter)
  // 环境漏光叠加
  const withAmbient = bakeSegment([panel], [light], { ambientLeakLux: 3 })
  check('案例5 环境漏光叠加(lx)', withAmbient.scattered[0][0], expectedScatter + 3)
}

console.log(failures ? `\n${failures} 项校验未通过` : '\n全部校验通过，系统烘焙口径与手算公式一致。')
process.exit(failures ? 1 : 0)
