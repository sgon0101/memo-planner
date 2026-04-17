interface MemoRow {
  title: string
  content_text: string
  tags: string[]
  is_pinned: boolean
  is_starred: boolean
  created_at: string
  updated_at: string
}

export function memoToMarkdown(memo: MemoRow): string {
  const lines: string[] = []
  lines.push(`# ${memo.title || '제목 없음'}`)
  lines.push('')

  const meta: string[] = []
  if (memo.is_pinned) meta.push('📌 고정됨')
  if (memo.is_starred) meta.push('⭐ 중요')
  if (memo.tags?.length) meta.push(`태그: ${memo.tags.join(', ')}`)
  meta.push(`작성: ${memo.created_at.slice(0, 10)}`)
  if (meta.length) { lines.push(meta.join(' · '), '') }

  lines.push(memo.content_text || '')
  return lines.join('\n')
}

export function memosToMarkdown(memos: MemoRow[]): string {
  return memos
    .map((m) => memoToMarkdown(m))
    .join('\n\n---\n\n')
}
