import { create } from 'zustand'

export interface GraphNode {
  id: string
  type: 'memo' | 'wiki' | 'tag'
  label: string
  // D3 simulation fields
  x?: number
  y?: number
  vx?: number
  vy?: number
  fx?: number | null
  fy?: number | null
  // memo fields
  isStarred?: boolean
  folderId?: string | null
  createdAt?: string
  contentText?: string
  // computed
  linkCount: number
}

export interface GraphLink {
  source: string | GraphNode
  target: string | GraphNode
  type: 'wiki' | 'tag' | 'similarity'
}

export interface GraphSettings {
  nodeSize: number          // 1–10 (시각 전용)
  linkWidth: number         // 1–10
  centerTension: number     // 1–10 → forceCenter strength = v*0.01
  repulsion: number         // 1–10 → charge = -(v*30)
  linkDistance: number      // 1–10 → distance = v*20px
  showIsolated: boolean
  showWiki: boolean
  showTag: boolean
  folderFilter: string | null
  tagFilter: string
}

interface GraphStore {
  nodes: GraphNode[]
  links: GraphLink[]
  settings: GraphSettings
  selectedNodeId: string | null
  highlightNodeId: string | null
  /** 프리셋 적용 시 증가 — GraphView가 감지해 원형 재배치 + alpha 재시작 */
  presetVersion: number
  setNodes: (nodes: GraphNode[]) => void
  setLinks: (links: GraphLink[]) => void
  setSettings: (patch: Partial<GraphSettings>) => void
  resetSettings: () => void
  applyPreset: (key: PresetKey) => void
  setSelectedNode: (id: string | null) => void
  setHighlightNode: (id: string | null) => void
}

const DEFAULT_SETTINGS: GraphSettings = {
  nodeSize: 4,
  linkWidth: 2,
  centerTension: 2,      // 3 → 2: 중앙 뭉침 완화 (Obsidian 스타일 근접)
  repulsion: 5,          // 4 → 5: 노드 간격 기본 확대
  linkDistance: 5,
  showIsolated: true,
  showWiki: true,
  showTag: true,
  folderFilter: null,
  tagFilter: '',
}

// 프리셋 — GraphSettings의 원클릭 버튼에서 사용
export type PresetKey = 'spread' | 'balanced' | 'cluster'
export const GRAPH_PRESETS: Record<PresetKey, Partial<GraphSettings>> = {
  spread:   { centerTension: 1, repulsion: 7, linkDistance: 7 }, // 분산형 (Obsidian)
  balanced: { centerTension: 2, repulsion: 5, linkDistance: 5 }, // 균형형 (기본)
  cluster:  { centerTension: 6, repulsion: 2, linkDistance: 2 }, // 응집형 (중앙 뭉침) — 체감 조밀도 강화
}

export const useGraphStore = create<GraphStore>((set) => ({
  nodes: [],
  links: [],
  settings: DEFAULT_SETTINGS,
  selectedNodeId: null,
  highlightNodeId: null,
  presetVersion: 0,
  setNodes: (nodes) => set({ nodes }),
  setLinks: (links) => set({ links }),
  setSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
  resetSettings: () => set((s) => ({ settings: DEFAULT_SETTINGS, presetVersion: s.presetVersion + 1 })),
  applyPreset: (key) => set((s) => ({
    settings: { ...s.settings, ...GRAPH_PRESETS[key] },
    presetVersion: s.presetVersion + 1,
  })),
  setSelectedNode: (id) => set({ selectedNodeId: id }),
  setHighlightNode: (id) => set({ highlightNodeId: id }),
}))
