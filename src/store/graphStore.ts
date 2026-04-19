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
  setNodes: (nodes: GraphNode[]) => void
  setLinks: (links: GraphLink[]) => void
  setSettings: (patch: Partial<GraphSettings>) => void
  setSelectedNode: (id: string | null) => void
  setHighlightNode: (id: string | null) => void
}

const DEFAULT_SETTINGS: GraphSettings = {
  nodeSize: 4,
  linkWidth: 2,
  centerTension: 3,
  repulsion: 4,
  linkDistance: 5,
  showIsolated: true,
  showWiki: true,
  showTag: true,
  folderFilter: null,
  tagFilter: '',
}

export const useGraphStore = create<GraphStore>((set) => ({
  nodes: [],
  links: [],
  settings: DEFAULT_SETTINGS,
  selectedNodeId: null,
  highlightNodeId: null,
  setNodes: (nodes) => set({ nodes }),
  setLinks: (links) => set({ links }),
  setSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
  setSelectedNode: (id) => set({ selectedNodeId: id }),
  setHighlightNode: (id) => set({ highlightNodeId: id }),
}))
