import { idbAll, idbPut } from '../core/idb'
import { saveGroup, saveProject, saveSegment, newProject } from '../core/store'
import { buildDragonGroup } from './dragon'
import { buildLotusGroup } from './lotus'
import { buildFigureGroup } from './figure'
import type { LanternGroup, Project, Segment } from '../core/types'

// 首次启动播种：一个灯会项目 + 三个测试灯组
export async function seedSamples(): Promise<boolean> {
  const existing = await idbAll<LanternGroup>('groups')
  if (existing.length) return false

  const project = newProject('第三十二届自贡国际恐龙灯会', '自贡中华彩灯大世界')
  await saveProject(project)

  const builders = [buildDragonGroup, buildLotusGroup, buildFigureGroup]
  for (const build of builders) {
    const { group, segments } = build()
    group.projectId = project.id
    await saveGroup(group)
    for (const seg of segments) await saveSegment(seg)
  }
  return true
}

export async function reseedSamples(): Promise<Project> {
  const project = newProject(`测试灯组 ${new Date().toLocaleDateString('zh-CN')}`, '测试场地')
  await idbPut('projects', project.id, project)
  const builders = [buildDragonGroup, buildLotusGroup, buildFigureGroup]
  for (const build of builders) {
    const { group, segments }: { group: LanternGroup; segments: Segment[] } = build()
    group.projectId = project.id
    await saveGroup(group)
    for (const seg of segments) await saveSegment(seg)
  }
  return project
}
