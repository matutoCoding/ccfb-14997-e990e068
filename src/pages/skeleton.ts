import { h } from '../core/dom'
import { toast } from '../core/dom'
import { go, parseHash } from '../core/router'
import { saveSegment } from '../core/store'
import { loadGroupContext, segmentTabs, structHud, type GroupContext } from './group_chrome'
import { Editor3D, type EditorTool } from '../three/editor3d'
import { loftTube, ringsToSkeleton, sampleCurve } from '../core/loft'
import type { Vec3 } from '../core/types'

let editor: Editor3D | null = null

function fieldNumber(label: string, value: number, step: number, onChange: (v: number) => void): HTMLElement {
  const input = h('input', { type: 'number', value: String(value), step: String(step), oninput: () => onChange(Number(input.value)) }) as HTMLInputElement
  return h('label', { class: 'field' }, label, input)
}

function loftDialog(ctx: GroupContext): HTMLElement {
  const rings = h('input', { type: 'number', value: '24', min: '6', max: '80' }) as HTMLInputElement
  const radial = h('input', { type: 'number', value: '16', min: '6', max: '32' }) as HTMLInputElement
  const radius = h('input', { type: 'number', value: '600' }) as HTMLInputElement
  const diameter = h('input', { type: 'number', value: '5', min: '1', step: '0.5' }) as HTMLInputElement
  const mask = h('div', { class: 'dialog-mask' },
    h('div', { class: 'dialog' },
      h('h3', {}, '截面放样（管状骨架）'),
      h('p', { class: 'muted' }, '沿当前节点顺序作为控制曲线，按环形截面快速生成龙身类管笼；无节点时使用默认 S 形曲线。'),
      h('div', { class: 'col' },
        h('label', { class: 'field' }, '环数（沿长度）', rings),
        h('label', { class: 'field' }, '每环节点数（截面）', radial),
        h('label', { class: 'field' }, '管半径 (mm)', radius),
        h('label', { class: 'field' }, '钢丝直径 (mm)', diameter)
      ),
      h('div', { class: 'actions' },
        h('button', { onclick: () => mask.remove() }, '取消'),
        h('button', { class: 'primary', onclick: () => {
          const seg = ctx.segment
          const controls: Vec3[] = seg.nodes.length >= 2
            ? seg.nodes.map((n) => n.p)
            : Array.from({ length: 6 }, (_, i) => {
                const t = i / 5
                return { x: -3000 + t * 6000, y: 1200 + Math.sin(t * Math.PI * 2) * 600, z: Math.sin(t * Math.PI) * 800 }
              })
          const curve = sampleCurve(controls, Number(rings.value))
          const r = Number(radius.value)
          const loft = loftTube(curve, {
            rings: curve.length,
            radial: Number(radial.value),
            radiusFn: () => r
          })
          const skel = ringsToSkeleton(loft.ringPoints, Number(diameter.value))
          seg.nodes.push(...skel.nodes)
          seg.rods.push(...skel.rods)
          toast(`放样完成：新增 ${skel.nodes.length} 个节点、${skel.rods.length} 根杆件`)
          mask.remove()
          await saveSegment(seg)
          void remount(ctx.group.id, seg.id)
        } }, '生成骨架')
      )
    )
  )
  return mask
}

function sidePanel(ctx: GroupContext): HTMLElement {
  const seg = ctx.segment
  return h('aside', { class: 'sidepanel' },
    h('section', {},
      h('h4', {}, '杆件工具'),
      h('div', { class: 'col' },
        h('button', { id: 't-select', onclick: () => editor?.setTool('select') }, '选择/拖拽节点'),
        h('button', { id: 't-add', onclick: () => editor?.setTool('add-node') }, '地面加节点'),
        h('button', { id: 't-connect', onclick: () => editor?.setTool('connect') }, '连杆（点两个节点）'),
        fieldNumber('新建杆件钢丝直径 (mm)', 4, 0.5, (v) => editor?.setRodDiameter(v)),
        h('button', { onclick: () => editor?.deleteSelected(), class: 'danger' }, '删除选中节点/灯具')
      )
    ),
    h('section', {},
      h('h4', {}, '快速放样'),
      h('button', { class: 'primary', onclick: () => document.body.append(loftDialog(ctx)) }, '截面放样生成管笼'),
      h('p', { class: 'dim' }, '适用于龙身、凤身、花枝等管状结构；放样后仍可逐节点拖拽微调。')
    ),
    h('section', {},
      h('h4', {}, '材料参数'),
      fieldNumber('钢丝密度 (kg/m³)', seg.steelDensityKgM3, 10, (v) => { seg.steelDensityKgM3 = v; void saveSegment(seg) }),
      h('p', { class: 'dim' }, '挠度按两端简支梁 δ=5qL⁴/(384EI) 粗算，超跨径 0.5% 会在左下角标黄提醒。')
    ),
    h('section', {},
      h('h4', {}, '分段'),
      segmentTabs(ctx, 'skeleton', (segId) => remount(ctx.group.id, segId))
    ),
    h('section', {},
      h('button', { onclick: () => go(`/group/${ctx.group.id}/fabric`) }, '下一步：蒙布 →')
    )
  )
}

function toolbar(): HTMLElement {
  const tools: { key: EditorTool; label: string }[] = [
    { key: 'select', label: '选择' },
    { key: 'add-node', label: '加节点' },
    { key: 'connect', label: '连杆' }
  ]
  return h('div', { class: 'toolbar' },
    h('span', { class: 'group-label' }, '工具：'),
    ...tools.map((t) => h('button', {
      id: `tool-${t.key}`,
      onclick: () => {
        editor?.setTool(t.key)
        document.querySelectorAll('.toolbar button').forEach((b) => b.classList.remove('active'))
        ;(document.getElementById(`tool-${t.key}`) as HTMLButtonElement)?.classList.add('active')
      }
    }, t.label)),
    h('span', { class: 'spacer', style: 'flex:1' }),
    h('span', { class: 'muted' }, '滚轮缩放 · 右键平移 · 点选节点后出现三轴手柄')
  )
}

async function remount(groupId: string, segId?: string): Promise<void> {
  editor?.dispose()
  editor = null
  const query = parseHash().query
  const ctx = await loadGroupContext(groupId, segId ?? query.seg)
  if (!ctx) { go('/'); return }
  const viewport = h('div', { class: 'viewport' })
  const root = h('div', { class: 'workspace' },
    viewport,
    sidePanel(ctx)
  )
  const page = document.querySelector('.page')
  page?.replaceChildren(toolbar(), root)
  editor = new Editor3D(viewport, ctx.segment, {
    mode: 'skeleton',
    ambientLeakLux: 3,
    exposure: 1,
    darkLux: 10,
    hotLux: 120,
    onChange: () => void saveSegment(ctx.segment)
  })
  viewport.append(structHud(ctx.segment, ctx.project))
}

export function renderSkeletonPage(groupId: string): HTMLElement {
  const root = h('div', { style: 'flex:1;display:flex;min-height:0' }, h('p', { class: 'muted' }, '场景加载中…'))
  void remount(groupId)
  return root
}
