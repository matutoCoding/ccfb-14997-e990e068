import type { AppSettings, LanternGroup, Project, Segment, ID } from './types'
import { idbAll, idbDelete, idbGet, idbPut, uid } from './idb'

const DEFAULT_SETTINGS: AppSettings = {
  id: 'singleton',
  defaultEfficacyLmW: 90,
  defaultBeadSpacingMm: 50,
  ambientLeakLux: 3,
  exposure: 1
}

export async function getSettings(): Promise<AppSettings> {
  const s = await idbGet<AppSettings>('settings', 'singleton')
  return s ?? DEFAULT_SETTINGS
}

export function saveSettings(s: AppSettings): Promise<void> {
  return idbPut('settings', 'singleton', s)
}

export async function listProjects(): Promise<Project[]> {
  const all = await idbAll<Project>('projects')
  return all.sort((a, b) => b.createdAt - a.createdAt)
}

export async function saveProject(p: Project): Promise<void> {
  await idbPut('projects', p.id, p)
}

export async function deleteProject(id: ID): Promise<void> {
  const groups = await idbAll<LanternGroup>('groups')
  for (const g of groups.filter((x) => x.projectId === id)) await deleteGroup(g.id)
  await idbDelete('projects', id)
}

export async function listGroups(projectId?: ID): Promise<LanternGroup[]> {
  const all = await idbAll<LanternGroup>('groups')
  return all.filter((g) => !projectId || g.projectId === projectId).sort((a, b) => b.createdAt - a.createdAt)
}

export async function getGroup(id: ID): Promise<LanternGroup | undefined> {
  return idbGet<LanternGroup>('groups', id)
}

export async function saveGroup(g: LanternGroup): Promise<void> {
  await idbPut('groups', g.id, g)
}

export async function deleteGroup(id: ID): Promise<void> {
  const g = await getGroup(id)
  if (g) for (const sid of g.segmentIds) await idbDelete('segments', sid)
  await idbDelete('groups', id)
}

export async function getSegment(id: ID): Promise<Segment | undefined> {
  return idbGet<Segment>('segments', id)
}

export async function saveSegment(s: Segment): Promise<void> {
  s.updatedAt = Date.now()
  await idbPut('segments', s.id, s)
}

export async function deleteSegment(groupId: ID, segId: ID): Promise<void> {
  const g = await getGroup(groupId)
  if (g) {
    g.segmentIds = g.segmentIds.filter((x) => x !== segId)
    await saveGroup(g)
  }
  await idbDelete('segments', segId)
}

export function newProject(name: string, venue: string): Project {
  return {
    id: uid('proj'),
    name,
    venue,
    date: new Date().toISOString().slice(0, 10),
    // 默认 4.2m 货车板限界
    transportMax: { x: 4200, y: 2400, z: 2400 },
    createdAt: Date.now()
  }
}

export function newGroup(projectId: ID, name: string, kind: LanternGroup['kind']): LanternGroup {
  return { id: uid('grp'), projectId, name, kind, segmentIds: [], createdAt: Date.now() }
}

export function newSegment(groupId: ID, name: string): Segment {
  return {
    id: uid('seg'),
    groupId,
    name,
    nodes: [],
    rods: [],
    panels: [],
    lights: [],
    steelDensityKgM3: 7850,
    updatedAt: Date.now()
  }
}

export { uid }
