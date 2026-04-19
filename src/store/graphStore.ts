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
  nodeSize: number       // 6–28, default 14
  linkWidth: number      // 1–6, default 2
  tension: number        // 1–10, default 4
  repulsion: number      // 1–10, default 5
  linkDistance: number   // 40–200, default 90
  labelMinLinks: number  // show label when linkCount >= N, default 1
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
  nodeSize: 14,
  linkWidth: 2,
  tension: 4,
  repulsion: 5,
  linkDistance: 90,
  labelMinLinks: 0,
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
