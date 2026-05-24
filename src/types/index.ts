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
  wikiLinks: string[]
  linkedPlanIds: string[]
  thumbnailUrl: string | null
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
  repeatEndDate: string | null       // 반복 종료일
  /** RFC 5545 RRULE 문자열 (예: "RRULE:FREQ=WEEKLY;BYDAY=MO,WE;INTERVAL=2")
   *  존재하면 repeatType보다 우선. legacy(repeatType) 호환을 위해 둘 다 유지. */
  rruleStr: string | null
  ddayTarget: string | null
  googleEventId: string | null
  linkedMemoIds: string[]
  createdAt: string
  updatedAt: string
  // 클라이언트 전개 시 추가되는 가상 필드
  isRecurringInstance?: boolean
  originalPlanId?: string
}

export interface MemoVersion {
  id: string
  memoId: string
  content: Record<string, unknown>
  contentText: string
  title: string
  createdAt: string
}

export interface PlanTemplate {
  id: string
  userId: string
  title: string
  color: string
  startTime: string | null
  endTime: string | null
  isAllDay: boolean
  linkedMemoIds: string[]
}
