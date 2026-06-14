import type { Memo } from '@/types'

export const LIST_COLS =
  'id, user_id, title, content_preview, folder_id, is_pinned, is_starred, is_locked, is_deleted, deleted_at, tags, wiki_links, linked_plan_ids, thumbnail_url, created_at, updated_at'

export function toMemo(row: Record<string, unknown>): Memo {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    folderId: (row.folder_id as string) ?? null,
    title: (row.title as string) ?? '',
    content: (row.content as Record<string, unknown>) ?? {},
    contentText: (row.content_preview as string) ?? (row.content_text as string) ?? '',
    isPinned: (row.is_pinned as boolean) ?? false,
    isStarred: (row.is_starred as boolean) ?? false,
    isLocked: (row.is_locked as boolean) ?? false,
    lockedContent: (row.locked_content as string) ?? null,
    isDeleted: (row.is_deleted as boolean) ?? false,
    deletedAt: (row.deleted_at as string) ?? null,
    tags: (row.tags as string[]) ?? [],
    wikiLinks: (row.wiki_links as string[]) ?? [],
    linkedPlanIds: (row.linked_plan_ids as string[]) ?? [],
    thumbnailUrl: (row.thumbnail_url as string) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }
}


/**
 * 첫 이미지의 썸네일 URL을 반환.
 *
 * 우선순위: srcSm(R2 thumb_ 변환본) > srcMd > src(원본).
 * 카드 썸네일에 원본(수 MB)을 그대로 띄우던 회귀를 해결 — 큰 이미지일수록
 * 로딩이 느리고 placeholder가 오래 보여 "썸네일이 안 보임"으로 체감되던 케이스.
 *
 * data: URL(base64 fallback)은 DB 저장 부적합이라 null 처리.
 */
export function extractFirstImage(content: Record<string, unknown>): string | null {
  function traverse(node: Record<string, unknown>): string | null {
    if (node.type === 'image' && typeof node.attrs === 'object') {
      const attrs = node.attrs as Record<string, unknown>
      const pick = (k: string): string | null => {
        const v = attrs?.[k]
        return typeof v === 'string' && v && !v.startsWith('data:') ? v : null
      }
      const chosen = pick('srcSm') ?? pick('srcMd') ?? pick('src')
      if (chosen) return chosen
    }
    const children = node.content as Record<string, unknown>[] | undefined
    if (children) {
      for (const child of children) {
        const found = traverse(child)
        if (found) return found
      }
    }
    return null
  }
  return traverse(content)
}

