import { h } from '../core/dom'
import { fmt, toast } from '../core/dom'
import { go, parseHash } from '../core/router'
import { saveSegment } from '../core/store'
import { loadGroupContext, segmentTabs, type GroupContext } from './group_chrome'
import { Editor3D } from '../three/editor3d'
import { expandEmitters } from '../core/optics'
import { evaluatePanels, suggestLights } from '../core/uniformity'
import type { LightItem } from '../core/types'

let editor: Editor3D | null = null
let currentCtx: GroupContext | null = null

function stat(seg: GroupContext['segment']): { count: number; power: number; beads: number; stripM: number } {
  let power = 0
  let stripM = 0
  for (const l of seg.lights) {
    power += l.powerW
    if (l.kind === 'strip' && l.p2) {
      stripM += Math.hypot(l.p2.x - l.p.x, l.p2.y - l.p.y, l.p2.z - l.p.z) / 1000
    }
  }
  return { count: seg.lights.length, power, beads: expandEmitters(seg.lights).length, stripM }
}

function lightInspector(light: LightItem, ctx: GroupContext): HTMLElement {
  const refresh = () => {
    void saveSegment(ctx.segment)
    editor?.rebuild()
    rerenderSide()
  }
  const num = (label: string, value: number, step: number, fn: (v: number) => void) =>
    h('label', { class: 'field' }, label,
      h('input', { type: 'number', value: String(value), step: String(step), oninput: (e: Event) => { fn(Number((e.target as HTMLInputElement).value)); refresh() } }))
  return h('div', { class: 'col' },
    h('label', { class: 'field' }, '名称',
      h('input', { value: light.name, oninput: (e: Event) => { light.name = (e.target as HTMLInputElement).value; void saveSegment(ctx.segment) } })),
    h('div', { class: 'row' },
      h('span', { class: 'badge' }, light.kind === 'point' ? '点光源' : '灯带')),
    num('功率 (W)', light.powerW, 0.5, (v) => { light.powerW = v }),
    num('色温 (K)', light.cctK, 100, (v) => { light.cctK = v }),
    num('发光效率 (lm/W)', light.efficacyLmW, 5, (v) => { light.efficacyLmW = v }),
    light.kind === 'strip'
      ? num('灯珠间距 (mm)', light.beadSpacingMm, 5, (v) => { light.beadSpacingMm = v })
      : h('p', { class: 'dim' }, '点光源按单珠全向发光计算。'),
    h('p', { class: 'dim num' }, `本灯光通量 ≈ ${fmt(light.powerW * light.efficacyLmW, 0)} lm`),
    h('button', { onclick: () => {
      ctx.segment.lights = ctx.segment.lights.filter((l) => l.id !== light.id)
      editor!.selectedLightId = null
      void saveSegment(ctx.segment)
      editor?.rebuild()
      rerenderSide()
      toast('灯具已删除')
    }, class: 'danger' }, '删除该灯具')
  )
}

function sidePanel(ctx: GroupContext): HTMLElement {
  const seg = ctx.segment
  const s = stat(seg)
  const selected = seg.lights.find((l) => l.id === editor?.selectedLightId)
  const bake = editor?.bake
  const uniformity = bake ? evaluatePanels(seg.panels, bake, { darkLux: 10, hotLux: 120 }) : []
  const suggestions = bake ? suggestLights(seg.panels, bake, seg.lights, { darkLux: 10, hotLux: 120 }) : []

  return h('aside', { class: 'sidepanel' },
    h('section', {},
      h('h4', {}, '实时统计'),
      h('div', { class: 'grid cols-2' },
        h('div', { class: 'stat-tile' }, h('span', { class: 'k' }, '灯具数量'), h('span', { class: 'v num' }, String(s.count))),
        h('div', { class: 'stat-tile' }, h('span', { class: 'k' }, '发光珠数'), h('span', { class: 'v num' }, String(s.beads))),
        h('div', { class: 'stat-tile' }, h('span', { class: 'k' }, '总功率'), h('span', { class: 'v num' }, fmt(s.power), h('span', { class: 'u' }, ' W'))),
        h('div', { class: 'stat-tile' }, h('span', { class: 'k' }, '灯带总长'), h('span', { class: 'v num' }, fmt(s.stripM, 1), h('span', { class: 'u' }, ' m')))
      )
    ),
    h('section', {},
      h('h4', {}, '灯具列表'),
      ...seg.lights.map((l) => h('button', {
        class: l.id === editor?.selectedLightId ? 'active' : '',
        onclick: () => {
          if (editor) {
            editor.selectedLightId = l.id
            editor.attachSelectedLight()
            editor.rebuild()
          }
          rerenderSide()
        }
      }, `${l.name} · ${l.powerW}W · ${l.cctK}K`)),
      h('div', { class: 'row' },
        h('button', { class: 'primary', onclick: () => editor?.setTool('add-light') }, '加点光源'),
        h('button', { class: 'primary', onclick: () => editor?.setTool('add-strip') }, '加灯带')
      ),
      h('p', { class: 'dim' }, '在场景中点击目标位置放置；选中后拖动三轴手柄移动，灯带终点随起点平移。')
    ),
    h('section', {},
      h('h4', {}, '灯具参数'),
      selected ? lightInspector(selected, ctx) : h('p', { class: 'dim' }, '点选场景中的灯或从列表选择。')
    ),
    h('section', {},
      h('h4', {}, '自动灯位建议'),
      ...(suggestions.length
        ? suggestions.map((sg) => h('div', { class: 'col', style: 'gap:4px' },
          h('span', { class: `badge ${sg.type === 'add' ? 'ok' : 'warn'}` }, sg.type === 'add' ? '建议补灯' : '建议挪灯'),
          h('span', { class: 'dim' }, sg.reason),
          h('button', { onclick: () => {
            editor?.setSuggestions([...editor.suggestionPoints, sg.position])
            toast('建议位置已在场景中标记（绿色线框球）')
          } }, '在场景中标记位置')
        ))
        : [h('p', { class: 'dim' }, bake ? '当前布面没有明显暗区或光斑。' : '先点工具栏「烘焙并评估」。')]),
      uniformity.length ? h('p', { class: 'dim num' },
        `布面平均 U(min/avg)=${fmt(uniformity.reduce((a, u) => a + u.uniformity, 0) / uniformity.length, 2)}`) : null
    ),
    h('section', {},
      h('h4', {}, '分段'),
      segmentTabs(ctx, 'light', (segId) => remount(ctx.group.id, segId))
    ),
    h('section', {},
      h('button', { onclick: () => go(`/group/${ctx.group.id}/preview`) }, '下一步：夜景预览 →')
    )
  )
}

function rerenderSide(): void {
  if (!currentCtx) return
  document.querySelector('.sidepanel')?.replaceWith(sidePanel(currentCtx))
}

async function remount(groupId: string, segId?: string): Promise<void> {
  editor?.dispose()
  editor = null
  const ctx = await loadGroupContext(groupId, segId ?? parseHash().query.seg)
  if (!ctx) { go('/'); return }
  currentCtx = ctx
  const viewport = h('div', { class: 'viewport' })
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
      }, m === 'fabric' ? '结构' : m === 'lit' ? '点亮' : '热力图')),
      h('span', { style: 'flex:1' }),
      h('button', { class: 'primary', onclick: () => {
        const bake = editor?.runBake()
        if (bake) toast(`烘焙完成：${bake.emitterCount} 个发光珠，${fmt(bake.elapsedMs, 0)} ms`)
        if (editor) { editor.setViewMode('lit'); editor.rebuild() }
        rerenderSide()
      } }, '烘焙并评估')
    ),
    h('div', { class: 'workspace' }, viewport, sidePanel(ctx))
  )
  editor = new Editor3D(viewport, ctx.segment, {
    mode: 'light', ambientLeakLux: 3, exposure: 1, darkLux: 10, hotLux: 120,
    onSelect: () => rerenderSide(),
    onChange: () => { void saveSegment(ctx.segment); rerenderSide() }
  })
  editor.setViewMode('lit')
}

export function renderLightPage(groupId: string): HTMLElement {
  const root = h('div', { style: 'flex:1;display:flex;min-height:0' }, h('p', { class: 'muted' }, '场景加载中…'))
  void remount(groupId)
  return root
}
