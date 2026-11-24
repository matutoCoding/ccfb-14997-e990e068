import { idbGet } from '../core/idb'
import type { Project } from '../core/types'

// 项目实体读取（独立小模块避免 chrome 与 store 循环依赖）
export async function getProject(id: string): Promise<Project | undefined> {
  return idbGet('projects', id)
}
