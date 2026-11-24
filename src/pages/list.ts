import { h, toast, fmt, fmtInt } from '../core/dom'
import { go } from '../core/router'
import {
  deleteGroup, deleteProject, listGroups, listProjects,
  newGroup, newProject, saveGroup, saveProject, getSegment
} from '../core/store'
import { buildCutList } from '../core/cutlist'
import { reseedSamples } from '../samples/seed'
import type { LanternGroup, Project } from '../core/types'

const KIND_LABEL: Record<LanternGroup['kind'], string> = {
  dragon: '龙形', lotus: '荷花', figure: '人物', custom: '自定义'
}

function dialog(title: string, body: HTMLElement, onOk: () => void): HTMLElement {
  return h('div', { class: 'dialog-mask', onclick: (e: Event) => { if (e.target === e.currentTarget) (e.currentTarget as HTMLElement).remove() } },
    h('div', { class: 'dialog' },
      h('h3', {}, title),
      body,
      h('div', { class: 'actions' },
        h('button', { onclick: (e: Event) => (e.target as HTMLElement).closest('.dialog-mask')!.remove() }, '取消'),
        h('button', { class: 'primary', onclick: () => { onOk(); document.querySelector('.dialog-mask')?.remove() } }, '确定')
      )
    )
  )
}

function projectDialog(existing?: Project): HTMLElement {
  const name = h('input', { value: existing?.name ?? '' }) as HTMLInputElement
  const venue = h('input', { value: existing?.venue ?? '' }) as HTMLInputElement
  const tx = h('input', { type: 'number', value: String(existing?.transportMax.x ?? 4200) }) as HTMLInputElement
  const ty = h('input', { type: 'number', value: String(existing?.transportMax.y ?? 2400) }) as HTMLInputElement
  const tz = h('input', { type: 'number', value: String(existing?.transportMax.z ?? 2400) }) as HTMLInputElement
  return dialog(existing ? '编辑灯会项目' : '新建灯会项目',
    h('div', { class: 'col' },
      h('label', { class: 'field' }, '项目名称', name),
      h('label', { class: 'field' }, '举办场地', venue),
      h('label', { class: 'field' }, '运输限界 长×宽×高 (mm)', h('div', { class: 'row' }, tx, ty, tz))
    ),
    async () => {
      const p = existing ?? newProject(name.value || '未命名灯会', venue.value)
      p.name = name.value
      p.venue = venue.value
      p.transportMax = { x: Number(tx.value), y: Number(ty.value), z: Number(tz.value) }
      await saveProject(p)
      toast('项目已保存')
      void refresh()
    }
  )
}

async function groupStats(g: LanternGroup, project?: Project) {
  let power = 0
  let lights = 0
  let over = false
  let boundsText = '—'
  for (const sid of g.segmentIds) {
    const seg = await getSegment(sid)
    if (!seg) continue
    const cut = buildCutList(seg, project)
    power += cut.totalPowerW
    lights += cut.lightCount
    if (cut.overTransport) over = true
    const s = cut.bounds.size
    boundsText = `${fmt(s.x / 1000, 2)}×${fmt(s.y / 1000, 2)}×${fmt(s.z / 1000, 2)} m`
  }
  return { power, lights, over, boundsText }
}

async function groupCard(g: LanternGroup, project?: Project): Promise<HTMLElement> {
  const stats = await groupStats(g, project)
  return h('div', { class: 'card col' },
    h('div', { class: 'row', style: 'justify-content:space-between' },
      h('h3', {}, g.name),
      h('span', { class: 'badge' }, KIND_LABEL[g.kind])
    ),
    h('div', { class: 'grid cols-2' },
      h('div', { class: 'stat-tile' }, h('span', { class: 'k' }, '分段数'), h('span', { class: 'v num' }, String(g.segmentIds.length))),
      h('div', { class: 'stat-tile' }, h('span', { class: 'k' }, '灯具数'), h('span', { class: 'v num' }, String(stats.lights))),
      h('div', { class: 'stat-tile' }, h('span', { class: 'k' }, '总功率'), h('span', { class: 'v num' }, fmt(stats.power), h('span', { class: 'u' }, ' W'))),
      h('div', { class: 'stat-tile' }, h('span', { class: 'k' }, '外包尺寸'), h('span', { class: 'v', style: 'font-size:16px' }, stats.boundsText))
    ),
    stats.over
      ? h('span', { class: 'badge bad' }, '超出运输限界，需拆分运输')
      : h('span', { class: 'badge ok' }, '运输尺寸合格'),
    h('div', { class: 'row' },
      h('button', { class: 'primary', onclick: () => go(`/group/${g.id}/skeleton`) }, '打开编辑'),
      h('button', { class: 'danger', onclick: async () => {
        if (!confirm(`确定删除灯组「${g.name}」？其分段数据会一并删除。`)) return
        await deleteGroup(g.id)
        toast('灯组已删除')
        void refresh()
      } }, '删除')
    )
  )
}

async function refresh(): Promise<void> {
  const [projects, groups] = await Promise.all([listProjects(), listGroups()])
  const root = h('div', { class: 'container col', style: 'gap:32px' },
    h('div', { class: 'row', style: 'justify-content:space-between' },
      h('div', {}, h('h1', {}, '灯会项目与灯组'), h('p', { class: 'muted' }, '按灯会项目管理灯组，每个灯组可拆分为多段独立扎制与运输')),
      h('div', { class: 'row' },
        h('button', { onclick: async () => {
          const p = await reseedSamples()
          toast(`已重新生成三个测试灯组（项目：${p.name}）`)
          void refresh()
        } }, '重新生成测试灯组'),
        h('button', { class: 'primary', onclick: () => document.body.append(projectDialog()) }, '新建灯会项目')
      )
    )
  )

  if (!projects.length) {
    root.append(h('div', { class: 'empty-state card' },
      h('div', { class: 'icon-box' }, '◇'),
      h('h3', {}, '还没有灯会项目'),
      h('p', {}, '新建一个项目，或重新生成内置的龙、荷花、人物三个测试灯组')
    ))
  }

  for (const project of projects) {
    const pGroups = groups.filter((g) => g.projectId === project.id)
    const cards = await Promise.all(pGroups.map((g) => groupCard(g, project)))
    root.append(
      h('section', { class: 'card col' },
        h('div', { class: 'row', style: 'justify-content:space-between' },
          h('div', {},
            h('h2', {}, project.name),
            h('p', { class: 'muted' }, `${project.venue} · ${project.date} · 运输限界 ${fmtInt(project.transportMax.x)}×${fmtInt(project.transportMax.y)}×${fmtInt(project.transportMax.z)} mm`)
          ),
          h('div', { class: 'row' },
            h('button', { onclick: () => document.body.append(projectDialog(project)) }, '编辑项目'),
            h('button', { onclick: async () => {
              const ng = newGroup(project.id, '未命名灯组', 'custom')
              await saveGroup(ng)
              toast('已创建空灯组')
              void refresh()
            } }, '新增灯组'),
            h('button', { class: 'danger', onclick: async () => {
              if (!confirm(`删除项目「${project.name}」将同时删除其下所有灯组，确定？`)) return
              await deleteProject(project.id)
              toast('项目已删除')
              void refresh()
            } }, '删除项目')
          )
        ),
        cards.length
          ? h('div', { class: 'grid cols-3' }, ...cards)
          : h('div', { class: 'empty-state' }, h('p', {}, '该项目下暂无灯组，点右上角「新增灯组」'))
      )
    )
  }
  const page = document.querySelector('.page')
  if (page) page.replaceChildren(root)
}

export function renderListPage(): HTMLElement {
  const root = h('div', {}, h('p', { class: 'muted' }, '加载中…'))
  void refresh()
  return root
}
