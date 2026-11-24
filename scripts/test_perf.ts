// 性能体量测试：模拟几万面龙身 + 数百灯珠的烘焙耗时
import { bakeSegment } from '../src/core/optics'
import { makePanel } from '../src/core/loft'
import type { LightItem, Panel } from '../src/core/types'

// 环形管网格：rings × radial 顶点，三角面数 ≈ rings×radial×2
function tubeGeometry(rings: number, radial: number, radius: number): Panel {
  const positions: number[] = []
  const anchorNode: string[] = []
  for (let i = 0; i < rings - 1; i++) {
    for (let j = 0; j < radial; j++) {
      const at = (ring: number, j2: number) => {
        const ang = (j2 / radial) * Math.PI * 2
        const x = (ring / rings) * 14000 - 7000
        const y = 1500 + Math.cos(ang) * radius
        const z = Math.sin(ang) * radius
        return [x, y, z]
      }
      const quad = [...at(i, j), ...at(i, j + 1), ...at(i + 1, j + 1), ...at(i, j), ...at(i + 1, j + 1), ...at(i + 1, j)]
      positions.push(...quad)
      for (let k = 0; k < 6; k++) anchorNode.push('')
    }
  }
  return makePanel({ positions: Float32Array.from(positions), anchorNode })
}

// 沿管轴每 200mm 一个灯珠，约 70 颗；再加 3 条灯带展开
const lights: LightItem[] = []
for (let i = 0; i < 3; i++) {
  lights.push({
    id: `strip${i}`, kind: 'strip', name: `灯带${i}`,
    p: { x: -6500, y: 1200 + i * 150, z: 0 },
    p2: { x: 6500, y: 1200 + i * 150, z: 0 },
    powerW: 120, cctK: 2800, beadSpacingMm: 200, efficacyLmW: 95
  })
}

const targets = [
  { rings: 120, radial: 24, label: '约 5500 面（分段规模）' },
  { rings: 260, radial: 40, label: '约 2 万面' },
  { rings: 400, radial: 48, label: '约 3.8 万面（整龙规模）' }
]

for (const t of targets) {
  const panel = tubeGeometry(t.rings, t.radial, 600)
  const triangles = panel.positions.length / 9
  const t0 = performance.now()
  const bake = bakeSegment([panel], lights, { ambientLeakLux: 3 })
  const ms = performance.now() - t0
  const nonZero = bake.raw[0].filter((v) => v > 0.01).length
  console.log(`${t.label}: 三角面=${triangles} 顶点=${panel.positions.length / 3} 灯珠=${bake.emitterCount} 烘焙=${ms.toFixed(0)}ms 受光顶点=${nonZero}`)
}
