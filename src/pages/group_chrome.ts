import { h } from '../core/dom'
import { fmt, fmtInt, toast } from '../core/dom'
import { getGroup, getSegment, newSegment, saveGroup, saveSegment } from '../core/store'
import { segmentStruct } from '../core/structure'
import { buildCutList } from '../core/cutlist'
import type { LanternGroup, Project, Segment } from '../core/types'
import { getProject } from './project_cache'

export interface GroupContext {
  group: LanternGroup
  project: Project | undefined
  segment: Segment
}

// 加载灯组与当前分段（query 可指定 seg，否则取第一段）
export async function loadGroupContext(groupId: string, segId?: string): Promise<GroupContext | null> {
  const group = await getGroup(groupId)
  if (!group) return null
  const project = await getProject(group.projectId)
  const target = segId && group.segmentIds.includes(segId)
    ? segId
    : group.segmentIds[0]
  if (!target) {
    const seg = newSegment(group.id, '第一段')
    group.segmentIds.push(seg.id)
    await saveSegment(seg)
    await saveGroup(group)
    return { group, project, segment: seg }
  }
  const segment = await getSegment(target)
  return segment ? { group, project, segment } : null
}

export function segmentTabs(ctx: GroupContext, page: string, onSwitch: (segId: string) => void): HTMLElement {
  return h('div', { class: 'seg-tabs' },
    ...ctx.group.segmentIds.map((id) =>
      h('button', {
        class: id === ctx.segment.id ? 'active' : '',
        onclick: () => onSwitch(id)
      }, id === ctx.segment.id ? ctx.segment.name : `分段 ${ctx.group.segmentIds.indexOf(id) + 1}`)
    ),
    h('button', {
      onclick: async () => {
        const seg = newSegment(ctx.group.id, `第 ${ctx.group.segmentIds.length + 1} 段`)
        ctx.group.segmentIds.push(seg.id)
        await saveSegment(seg)
        await saveGroup(ctx.group)
        toast('已新增分段')
        onSwitch(seg.id)
      }
    }, '+ 新增分段')
  )
}

export function structHud(seg: Segment, project?: Project): HTMLElement {
  const st = segmentStruct(seg)
  const cut = buildCutList(seg, project)
  const deflect = st.maxDeflection
  const deflectWarn = deflect && deflect.spanRatio > 0.005
  return h('div', { class: 'hud' },
    h('div', {}, `节点 <b>${fmtInt(seg.nodes.length)}</b> · 杆件 <b>${fmtInt(st.rodCount)}</b> · 钢丝总长 <b>${fmt(st.totalLengthM, 2)} m</b> · 自重 <b>${fmt(st.steelWeightKg, 1)} kg</b>`),
    h('div', {},
      '最大挠度 ',
      deflect
        ? h('b', { class: deflectWarn ? 'badge warn' : '' }, `${fmt(deflect.mm, 2)} mm`)
        : '—',
      deflect ? `（跨径 ${fmt(deflect.spanRatio * 100, 3)}%，L=${fmt(deflect.lengthMm)}mm）` : '',
      ' · 外包 ',
      h('b', { class: cut.overTransport ? 'badge bad' : '' },
        `${fmt(cut.bounds.size.x / 1000, 2)}×${fmt(cut.bounds.size.y / 1000, 2)}×${fmt(cut.bounds.size.z / 1000, 2)} m`)
    )
  )
}

