import { h } from '../core/dom'
import { fmt, toast } from '../core/dom'
import { go, parseHash } from '../core/router'
import { saveSegment } from '../core/store'
import { loadGroupContext, segmentTabs, type GroupContext } from './group_chrome'
import { Editor3D } from '../three/editor3d'
import { buildGridPanel, makePanel } from '../core/loft'
import { bakeSegment, pointIlluminance } from '../core/optics'
import { evaluatePanels } from '../core/uniformity'
import type { Panel } from '../core/types'

let editor: Editor3D | null = null
let currentCtx: GroupContext | null = null

function numberField(label: string, value: number, step: number, min: number, max: number, onInput: (v: number) => void): HTMLElement {
  const input = h('input', { type: 'number', value: String(value), step: String(step), min: String(min), max: String(max), oninput: () => onInput(Number(input.value)) }) as HTMLInputElement
  return h('label', { class: 'field' }, label, input)
}

function rangeField(label: string, value: number, step: number, min: number, max: number, onInput: (v: number) => void): HTMLElement {
  const val = h('span', { class: 'val num' }, String(value))
  const input = h('input', {
    type: 'range', value: String(value), step: String(step), min: String(min), max: String(max),
    oninput: () => { val.textContent = input.value; onInput(Number(input.value)) }
  }) as HTMLInputElement
  return h('label', { class: 'field' }, label, h('div', { class: 'row' }, input, val))
}

function panelInspector(panel: Panel, ctx: GroupContext): HTMLElement {
  const refresh = () => {
    void saveSegment(ctx.segment)
    editor?.rebuild()
  }
  return h('div', { class: 'col' },
    h('label', { class: 'field' }, '绸布颜色', h('input', {
      type: 'color', value: panel.color,
      oninput: (e: Event) => { panel.color = (e.target as HTMLInputElement).value; refresh() }
    })),
    numberField('厚度 (mm)', panel.thicknessMm, 0.05, 0.05, 2, (v) => { panel.thicknessMm = v; refresh() }),
    rangeField('透光率 τ', panel.transmittance, 0.01, 0.02, 0.9, (v) => { panel.transmittance = v; refresh() }),
    rangeField('散射系数', panel.scatter, 0.05, 0, 0.9, (v) => { panel.scatter = v; refresh() }),
    rangeField('布面下垂 (mm)', panel.sagMm, 10, 0, 400, (v) => editor?.applyPanelSag(panel, v)),
    h('label', { class: 'field' }, '颜料颜色', h('input', {
      type: 'color', value: panel.paintColor,
      oninput: (e: Event) => { panel.paintColor = (e.target as HTMLInputElement).value; refresh() }
    })),
    rangeField('画笔大小 (mm)', 120, 10, 30, 500, (v) => editor?.setPaintBrush(v)),
    rangeField('颜料浓度', 0.8, 0.05, 0.1, 1, (v) => editor?.setPaintValue(v)),
    h('button', { onclick: () => { editor?.erasePaint(); toast('颜料已擦除') } }, '擦除本块布颜料'),
    h('p', { class: 'dim' }, '选择「手绘」工具后在布面拖动涂抹；颜料区有效透光率 τ×(1−0.85×浓度)。')
  )
}

function sidePanel(ctx: GroupContext): HTMLElement {
  const seg = ctx.segment
  const selected = seg.panels.find((p) => p.id === editor?.selectedPanelId)
  const uniformity = editor?.bake
    ? evaluatePanels(seg.panels, editor.bake, { darkLux: 10, hotLux: 120 })
    : []

  return h('aside', { class: 'sidepanel' },
    h('section', {},
      h('h4', {}, '布面列表'),
      ...(seg.panels.length
        ? seg.panels.map((p, i) => h('button', {
          class: p.id === editor?.selectedPanelId ? 'active' : '',
          onclick: () => {
            if (editor) { editor.selectedPanelId = p.id; editor.setTool('paint'); editor.rebuild() }
            void rerenderSide()
          }
        }, `布面 ${i + 1} · ${fmt(p.positions.length / 3, 0)} 顶点`))
        : [h('p', { class: 'dim' }, '还没有布面，先在下方按骨架范围生成一块蒙布。')]),
      h('button', { class: 'primary', onclick: () => {
        const grid = buildGridPanel({ cols: 10, rows: 8, width: 2400, height: 1800, center: { x: 0, y: 1400, z: 0 } })
        seg.panels.push(makePanel({ positions: grid.positions, anchorNode: grid.anchorNode }))
        void saveSegment(seg)
        editor?.rebuild()
        toast('已添加矩形蒙布，可用下垂与材质参数调整')
        rerenderSide()
      } }, '添加矩形蒙布')
    ),
    h('section', {},
      h('h4', {}, '材质与手绘'),
      selected ? panelInspector(selected, ctx) : h('p', { class: 'dim' }, '在场景中点选一块布面，或从上方列表选择。')
    ),
    h('section', {},
      h('h4', {}, '亮度均匀性（上次烘焙）'),
      ...(uniformity.length
        ? uniformity.map((u) => h('div', { class: 'col', style: 'gap:4px' },
          h('div', { class: 'row', style: 'justify-content:space-between' },
            h('span', {}, `布面 ${u.panelId.slice(-4)}`),
            h('span', { class: `badge ${u.darkRatio > 0.2 ? 'bad' : u.hotRatio > 0.1 ? 'warn' : 'ok'}` },
              `U=${fmt(u.uniformity, 2)}`)),
          h('span', { class: 'dim num' },
            `min ${fmt(u.minLux, 1)} / avg ${fmt(u.avgLux, 1)} / max ${fmt(u.maxLux, 1)} lx · 暗区 ${fmt(u.darkRatio * 100, 0)}% 光斑 ${fmt(u.hotRatio * 100, 0)}%`)
        ))
        : [h('p', { class: 'dim' }, '点击工具栏「烘焙透光」后显示。')])
    ),
    h('section', {},
      h('h4', {}, '分段'),
      segmentTabs(ctx, 'fabric', (segId) => remount(ctx.group.id, segId))
    ),
    h('section', {},
      h('button', { onclick: () => go(`/group/${ctx.group.id}/light`) }, '下一步：灯光布置 →')
    )
  )
}

function rerenderSide(): void {
  if (!currentCtx) return
  const old = document.querySelector('.sidepanel')
  old?.replaceWith(sidePanel(currentCtx))
}

function verifyCard(ctx: GroupContext): HTMLElement {
  // 手算校验：取第一块布第一个顶点，展示与 pointIlluminance 完全同口径的逐项数值
  const panel = ctx.segment.panels[0]
  const light = ctx.segment.lights[0]
  if (!panel || !light) return h('p', { class: 'dim' }, '需要至少一块布和一盏灯才能做手算校验。')
  const i = 0
  const surface = { x: panel.positions[0], y: panel.positions[1], z: panel.positions[2] }
  const d = Math.hypot(light.p.x - surface.x, light.p.y - surface.y, light.p.z - surface.z)
  const lm = light.kind === 'point'
    ? light.powerW * light.efficacyLmW
    : light.powerW * light.efficacyLmW / Math.max(1, Math.floor(Math.hypot((light.p2?.x ?? 0) - light.p.x, (light.p2?.y ?? 0) - light.p.y, (light.p2?.z ?? 0) - light.p.z) / light.beadSpacingMm) + 1)
  const normal = { x: 0, y: 0, z: 1 }
  const eIn = pointIlluminance(lm, light.p, surface, normal)
  const tau = panel.transmittance * (1 - 0.85 * (panel.paint[i] ?? 0))
  return h('div', { class: 'card col' },
    h('h4', {}, '手算校验（布面首顶点 · 首盏灯）'),
    h('p', { class: 'dim num' },
      `灯珠光通量 Φ=${fmt(lm, 1)} lm · 灯布距 d=${fmt(d, 1)} mm · 入射角 cosθ=1（示意）`),
    h('p', { class: 'num' }, `内表面 E = Φ/(4πd²)×10⁶ = ${fmt(eIn, 2)} lx`),
    h('p', { class: 'num' }, `透射 Eout = E×τ_eff = ${fmt(eIn * tau, 2)} lx（τ_eff=${fmt(tau, 3)}）`),
    h('p', { class: 'dim' }, '多灯叠加时系统按同一公式逐灯珠求和，散射仅作为后处理，不影响该手算口径。')
  )
}

async function remount(groupId: string, segId?: string): Promise<void> {
  editor?.dispose()
  editor = null
  const ctx = await loadGroupContext(groupId, segId ?? parseHash().query.seg)
  if (!ctx) { go('/'); return }
  currentCtx = ctx
  const viewport = h('div', { class: 'viewport' })
  const root = h('div', { class: 'workspace' }, viewport, sidePanel(ctx))
  const page = document.querySelector('.page')
  page?.replaceChildren(
    h('div', { class: 'toolbar' },
      h('span', { class: 'group-label' }, '显示：'),
      ...(['fabric', 'lit', 'heat'] as const).map((m) => h('button', {
        id: `vm-${m}`,
        onclick: () => {
          editor?.setViewMode(m)
          document.querySelectorAll('.toolbar button').forEach((b) => b.classList.remove('active'))
          document.getElementById(`vm-${m}`)?.classList.add('active')
        }
      }, m === 'fabric' ? '布料原色' : m === 'lit' ? '点亮效果' : '热力图')),
      h('span', { style: 'flex:1' }),
      h('button', { class: 'primary', onclick: () => {
        const t0 = performance.now()
        const bake = bakeSegment(ctx.segment.panels, ctx.segment.lights, { ambientLeakLux: 3 })
        if (editor) { editor.bake = bake; editor.setViewMode(editor.viewMode === 'fabric' ? 'lit' : editor.viewMode); editor.rebuild() }
        toast(`烘焙完成：${bake.emitterCount} 个发光珠，耗时 ${fmt(performance.now() - t0, 0)} ms`)
        rerenderSide()
      } }, '烘焙透光')
    ),
    root
  )
  editor = new Editor3D(viewport, ctx.segment, {
    mode: 'fabric', ambientLeakLux: 3, exposure: 1, darkLux: 10, hotLux: 120,
    onSelect: () => rerenderSide(),
    onChange: () => void saveSegment(ctx.segment)
  })
  // 校验卡片放在视口右上
  const verify = verifyCard(ctx)
  verify.style.position = 'absolute'
  verify.style.right = '16px'
  verify.style.top = '16px'
  verify.style.maxWidth = '380px'
  verify.style.pointerEvents = 'none'
  viewport.append(verify)
}

export function renderFabricPage(groupId: string): HTMLElement {
  const root = h('div', { style: 'flex:1;display:flex;min-height:0' }, h('p', { class: 'muted' }, '场景加载中…'))
  void remount(groupId)
  return root
}
