import { h } from '../core/dom'
import { download, fmt, fmtInt } from '../core/dom'
import { go } from '../core/router'
import { getGroup, getSegment } from '../core/store'
import { getProject } from './project_cache'
import { buildCutList, mergeCutLists } from '../core/cutlist'
import type { CutList } from '../core/types'

function tile(k: string, v: string, unit = ''): HTMLElement {
  return h('div', { class: 'stat-tile' },
    h('span', { class: 'k' }, k),
    h('span', { class: 'v num' }, v, unit && h('span', { class: 'u' }, ` ${unit}`))
  )
}

function cutTable(cut: CutList): HTMLElement {
  return h('div', { class: 'col', style: 'gap:24px' },
    h('section', { class: 'card col' },
      h('h3', {}, '总量'),
      h('div', { class: 'grid cols-4' },
        tile('钢丝总长', fmt(cut.steelLengthM, 2), 'm'),
        tile('焊点数', fmtInt(cut.weldCount), '个'),
        tile('布料面积', fmt(cut.fabricAreaM2, 2), 'm²'),
        tile('灯带长度', fmt(cut.stripLengthM, 2), 'm')
      ),
      h('div', { class: 'grid cols-4' },
        tile('灯具数量', fmtInt(cut.lightCount), '个'),
        tile('总功率', fmt(cut.totalPowerW, 1), 'W'),
        tile('估算总重', fmt(cut.weightKg, 1), 'kg'),
        tile('外包尺寸', `${fmt(cut.bounds.size.x / 1000, 2)}×${fmt(cut.bounds.size.y / 1000, 2)}×${fmt(cut.bounds.size.z / 1000, 2)}`, 'm')
      ),
      cut.overTransport
        ? h('span', { class: 'badge bad', style: 'align-self:flex-start' }, '超出运输限界：该段必须拆分或现场组装')
        : h('span', { class: 'badge ok', style: 'align-self:flex-start' }, '运输尺寸合格')
    ),
    h('section', { class: 'card col' },
      h('h3', {}, '钢丝分档'),
      h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, '钢丝直径 (mm)'), h('th', { class: 'num' }, '根数'), h('th', { class: 'num' }, '合计长度 (m)'))),
        h('tbody', {}, ...cut.rods.map((r) => h('tr', {},
          h('td', { class: 'num' }, String(r.diameterMm)),
          h('td', { class: 'num' }, fmtInt(r.count)),
          h('td', { class: 'num' }, fmt(r.lengthM, 2))
        )))
      )
    ),
    h('section', { class: 'card col' },
      h('h3', {}, '布面明细'),
      h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, '布面编号'), h('th', { class: 'num' }, '顶点数'), h('th', { class: 'num' }, '面积 (m²)'))),
        h('tbody', {}, ...cut.panels.map((p, i) => h('tr', {},
          h('td', {}, `布面 ${i + 1}（${p.id.slice(-4)}）`),
          h('td', { class: 'num' }, fmtInt(p.vertexCount)),
          h('td', { class: 'num' }, fmt(p.areaM2, 3))
        )))
      )
    )
  )
}

function exportText(groupName: string, scope: string, cut: CutList): string {
  const lines = [
    `彩灯下料单 - ${groupName}（${scope}）`,
    `生成时间：${new Date().toLocaleString('zh-CN')}`,
    '',
    `钢丝总长：${fmt(cut.steelLengthM, 2)} m`,
    `焊点数：${cut.weldCount} 个`,
    `布料面积：${fmt(cut.fabricAreaM2, 2)} m²`,
    `灯带长度：${fmt(cut.stripLengthM, 2)} m`,
    `灯具数量：${cut.lightCount} 个`,
    `总功率：${fmt(cut.totalPowerW, 1)} W`,
    `估算总重：${fmt(cut.weightKg, 1)} kg`,
    `外包尺寸：${fmt(cut.bounds.size.x)} × ${fmt(cut.bounds.size.y)} × ${fmt(cut.bounds.size.z)} mm`,
    cut.overTransport ? '运输校验：超限！' : '运输校验：合格',
    '',
    '钢丝分档：'
  ]
  for (const r of cut.rods) lines.push(`  Φ${r.diameterMm}mm  ${r.count} 根  共 ${fmt(r.lengthM, 2)} m`)
  lines.push('', '布面明细：')
  cut.panels.forEach((p, i) => lines.push(`  布面 ${i + 1}: ${fmtInt(p.vertexCount)} 顶点, ${fmt(p.areaM2, 3)} m²`))
  return lines.join('\n')
}

export async function renderCutlistPage(groupId: string): Promise<HTMLElement> {
  const group = await getGroup(groupId)
  if (!group) { go('/'); return h('div', {}, '灯组不存在') }
  const project = await getProject(group.projectId)
  const segments = (await Promise.all(group.segmentIds.map((id) => getSegment(id)))).filter(Boolean) as NonNullable<Awaited<ReturnType<typeof getSegment>>>[]
  const perSeg = segments.map((s) => ({ seg: s, cut: buildCutList(s, project) }))
  const merged = mergeCutLists(perSeg.map((x) => x.cut), project)

  const root = h('div', { class: 'container col', style: 'gap:24px' },
    h('div', { class: 'row', style: 'justify-content:space-between' },
      h('div', {},
        h('h1', {}, `下料单 · ${group.name}`),
        h('p', { class: 'muted' }, project ? `${project.name} · 运输限界 ${fmtInt(project.transportMax.x)}×${fmtInt(project.transportMax.y)}×${fmtInt(project.transportMax.z)} mm` : '未关联项目')
      ),
      h('div', { class: 'row' },
        h('button', { onclick: () => window.print() }, '打印 / 另存 PDF'),
        h('button', { onclick: () => download(`${group.name}-整组下料单.txt`, exportText(group.name, '整组汇总', merged)) }, '导出 TXT'),
        h('button', { onclick: () => go(`/group/${groupId}/preview`) }, '← 回到预览')
      )
    ),
    h('section', { class: 'card col' },
      h('h2', {}, '整组汇总'),
      cutTable(merged)
    ),
    ...perSeg.map(({ seg, cut }) => h('section', { class: 'card col' },
      h('div', { class: 'row', style: 'justify-content:space-between' },
        h('h2', {}, seg.name),
        h('button', { onclick: () => download(`${group.name}-${seg.name}-下料单.txt`, exportText(group.name, seg.name, cut)) }, '导出本段')
      ),
      cutTable(cut)
    ))
  )
  return root
}
