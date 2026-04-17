export interface Folder {
  id: string
  userId: string
  name: string
  colorH: number
  colorS: number
  colorL: number
  parentId: string | null
  orderIndex: number
  createdAt: string
  updatedAt: string
}

export interface Memo {
  id: string
  userId: string
  folderId: string | null
  title: string
  content: Record<string, unknown>
  contentText: string
  isPinned: boolean
  isStarred: boolean
  isLocked: boolean
  lockedContent: string | null
  isDeleted: boolean
  deletedAt: string | null
  tags: string[]
  linkedPlanIds: string[]
  createdAt: string
  updatedAt: string
}

export interface Plan {
  id: string
  userId: string
  title: string
  description: string
  color: string
  date: string | null
  startDate: string | null
  endDate: string | null
  startTime: string | null
  endTime: string | null
  isAllDay: boolean
  isCompleted: boolean
  repeatType: 'daily' | 'weekly' | 'monthly' | null
  ddayTarget: string | null
  googleEventId: string | null
  linkedMemoIds: string[]
  createdAt: string
  updatedAt: string
}

export interface PlanTemplate {
  id: string
  userId: string
  title: string
  color: string
}
