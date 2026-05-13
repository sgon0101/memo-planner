import type { Memo } from '@/types'

export const LIST_COLS =
  'id, user_id, title, content_text, folder_id, is_pinned, is_starred, is_locked, is_deleted, deleted_at, tags, wiki_links, linked_plan_ids, thumbnail_url, created_at, updated_at'

export function toMemo(row: Record<string, unknown>): Memo {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    folderId: (row.folder_id as string) ?? null,
    title: (row.title as string) ?? '',
    content: (row.content as Record<string, unknown>) ?? {},
    contentText: (row.content_text as string) ?? '',
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

// 원본 R2 URL → thumb_ 소형 버전 URL 변환
// 기존 이미지처럼 thumb_가 없으면 MemoCard onError에서 원본으로 fallback
export function toThumbnailUrl(originalUrl: string | null): string | null {
  if (!originalUrl) return null
  const base = process.env.NEXT_PUBLIC_CLOUDFLARE_R2_PUBLIC_URL
  if (!base || !originalUrl.startsWith(base)) return null
  const path = originalUrl.slice(base.length + 1)
  const segments = path.split('/')
  const filename = segments[segments.length - 1]
  if (filename.startsWith('thumb_')) return originalUrl
  segments[segments.length - 1] = `thumb_${filename}`
  return `${base}/${segments.join('/')}`
}

export function extractFirstImage(content: Record<string, unknown>): string | null {
  function traverse(node: Record<string, unknown>): string | null {
    if (node.type === 'image' && typeof node.attrs === 'object') {
      const src = (node.attrs as Record<string, unknown>)?.src
      if (typeof src === 'string' && src) return src
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
