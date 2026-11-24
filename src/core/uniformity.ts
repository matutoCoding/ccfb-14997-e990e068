import type { BakeResult, Panel, PanelUniformity, LightItem, Vec3 } from './types'

// 按布面统计亮度均匀性：U = min/avg（工程常用口径），并标记暗区/光斑占比

export interface UniformityOptions {
  darkLux: number
  hotLux: number
}

export function panelUniformity(panel: Panel, lux: Float32Array): PanelUniformity {
  let min = Infinity
  let max = 0
  let sum = 0
  for (const v of lux) {
    min = Math.min(min, v)
    max = Math.max(max, v)
    sum += v
  }
  const avg = sum / Math.max(1, lux.length)
  return {
    panelId: panel.id,
    minLux: lux.length ? min : 0,
    maxLux: lux.length ? max : 0,
    avgLux: avg,
    uniformity: avg > 0 ? min / avg : 0,
    darkRatio: 0,
    hotRatio: 0
  }
}

// 带阈值的统计版本（阈值由调用方给定）
export function evaluatePanels(
  panels: Panel[],
  bake: BakeResult,
  opts: UniformityOptions
): PanelUniformity[] {
  return panels.map((p, i) => {
    const lux = bake.scattered[i] ?? new Float32Array(0)
    const base = panelUniformity(p, lux)
    let dark = 0
    let hot = 0
    for (const v of lux) {
      if (v < opts.darkLux) dark++
      if (v > opts.hotLux) hot++
    }
    base.darkRatio = dark / Math.max(1, lux.length)
    base.hotRatio = hot / Math.max(1, lux.length)
    return base
  })
}

export interface LightSuggestion {
  type: 'add' | 'move' | 'reduce'
  position: Vec3
  reason: string
}

// 自动灯位建议：暗区质心补灯 / 光斑附近灯珠外移
export function suggestLights(
  panels: Panel[],
  bake: BakeResult,
  lights: LightItem[],
  opts: UniformityOptions
): LightSuggestion[] {
  const out: LightSuggestion[] = []
  panels.forEach((panel, pi) => {
    const lux = bake.scattered[pi]
    if (!lux) return
    const pos = panel.positions
    let darkC: Vec3 = { x: 0, y: 0, z: 0 }
    let darkN = 0
    let hotC: Vec3 = { x: 0, y: 0, z: 0 }
    let hotN = 0
    for (let v = 0; v < lux.length; v++) {
      const target = lux[v] < opts.darkLux ? darkC : lux[v] > opts.hotLux ? hotC : null
      if (!target) continue
      target.x += pos[v * 3]; target.y += pos[v * 3 + 1]; target.z += pos[v * 3 + 2]
      if (target === darkC) darkN++
      else hotN++
    }
    if (darkN > lux.length * 0.08) {
      out.push({
        type: 'add',
        position: { x: darkC.x / darkN, y: darkC.y / darkN, z: darkC.z / darkN },
        reason: `面板 ${panel.id.slice(-4)} 有 ${(darkN / lux.length * 100).toFixed(0)}% 顶点低于 ${opts.darkLux}lx，建议在暗区质心内侧 80~150mm 补一盏灯`
      })
    }
    if (hotN > lux.length * 0.05 && lights.length) {
      // 找距热点最近的灯，沿"灯→热点"方向反向外移
      const hp = { x: hotC.x / hotN, y: hotC.y / hotN, z: hotC.z / hotN }
      let nearest = lights[0]
      let nd = Infinity
      for (const l of lights) {
        const d = (l.p.x - hp.x) ** 2 + (l.p.y - hp.y) ** 2 + (l.p.z - hp.z) ** 2
        if (d < nd) { nd = d; nearest = l }
      }
      const d = Math.sqrt(nd) || 1
      out.push({
        type: 'move',
        position: {
          x: nearest.p.x - ((hp.x - nearest.p.x) / d) * 120,
          y: nearest.p.y - ((hp.y - nearest.p.y) / d) * 120,
          z: nearest.p.z - ((hp.z - nearest.p.z) / d) * 120
        },
        reason: `面板 ${panel.id.slice(-4)} 出现光斑（>${opts.hotLux}lx），建议将「${nearest.name}」背离布面外移约 120mm`
      })
    }
  })
  return out.slice(0, 8)
}
