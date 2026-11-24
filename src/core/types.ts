// 领域模型：所有长度单位毫米(mm)，重量千克(kg)，功率瓦(W)，照度勒克斯(lx)

export type ID = string

export interface Project {
  id: ID
  name: string
  venue: string
  date: string
  transportMax: { x: number; y: number; z: number }
  createdAt: number
}

export interface LanternGroup {
  id: ID
  projectId: ID
  name: string
  kind: 'dragon' | 'lotus' | 'figure' | 'custom'
  segmentIds: ID[]
  createdAt: number
}

export interface Vec3 { x: number; y: number; z: number }

export interface Node3 { id: ID; p: Vec3 }

export interface Rod {
  id: ID
  a: ID
  b: ID
  diameterMm: number
}

// 蒙布面板：三角网格顶点位置与共享节点对应关系
export interface Panel {
  id: ID
  // 每 3 个顶点组成一个三角形
  positions: Float32Array
  // 未下垂前的基准位置，调整 sagMm 时据此重建
  basePositions: Float32Array
  // 顶点对应的骨架节点 id（无对应为空串），用于下垂时边缘固定
  anchorNode: string[]
  // 颜料浓度 0~1，与顶点一一对应
  paint: Float32Array
  paintColor: string
  color: string
  thicknessMm: number
  transmittance: number
  scatter: number
  sagMm: number
}

export type LightKind = 'point' | 'strip'

export interface LightItem {
  id: ID
  kind: LightKind
  name: string
  // point: p 为灯位；strip: p->p2 为灯带走向
  p: Vec3
  p2?: Vec3
  powerW: number
  cctK: number
  // 灯带灯珠间距(mm)，点光源忽略
  beadSpacingMm: number
  // 发光效率 lm/W
  efficacyLmW: number
}

export interface Segment {
  id: ID
  groupId: ID
  name: string
  nodes: Node3[]
  rods: Rod[]
  panels: Panel[]
  lights: LightItem[]
  steelDensityKgM3: number
  updatedAt: number
}

export interface AppSettings {
  id: 'singleton'
  defaultEfficacyLmW: number
  defaultBeadSpacingMm: number
  ambientLeakLux: number
  exposure: number
}

// 离散发光珠（灯带按 beadSpacing 展开后的采样点）
export interface EmitterInput {
  id: ID
  p: Vec3
  lm: number
  cctK: number
}

export interface BakeResult {
  // 每顶点透射后照度（散射前），与面板 positions 顶点对齐
  raw: Float32Array[]
  // 散射混合后照度
  scattered: Float32Array[]
  emitterCount: number
  elapsedMs: number
}

export interface PanelUniformity {
  panelId: ID
  minLux: number
  maxLux: number
  avgLux: number
  uniformity: number
  darkRatio: number
  hotRatio: number
}

export interface CutList {
  steelLengthM: number
  weldCount: number
  fabricAreaM2: number
  stripLengthM: number
  lightCount: number
  totalPowerW: number
  weightKg: number
  bounds: { min: Vec3; max: Vec3; size: Vec3 }
  overTransport: boolean
  panels: { id: ID; areaM2: number; vertexCount: number }[]
  rods: { diameterMm: number; lengthM: number; count: number }[]
}
