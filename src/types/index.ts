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
  /** 이 플랜에 대해 알림을 발송할지 (기본 true) — false면 #6-A scheduler / #6-B cron 모두 skip */
  notifyEnabled: boolean
  /** 알림 시점 — 시작 시간 N분 전 (0=정시, 5/10/30/60). 기본 10. */
  notifyLeadMin: number
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
  // 확장 필드 (optional — 기존 코드 호환)
  description?: string | null
  rruleStr?: string | null
  notifyEnabled?: boolean
  notifyLeadMin?: number | null
  useCount?: number
  lastUsedAt?: string | null
  createdAt?: string
}
