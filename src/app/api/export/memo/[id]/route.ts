/**
 * 단일 메모 export — PR-5 A.
 *
 * GET /api/export/memo/[id]?format=md|json
 *
 * - md: buildMemoMarkdown으로 frontmatter 포함 Markdown
 * - json: 원본 row(메모 1개) + folderName 포함 메타
 * - 본인 메모만 (RLS + user_id 검증)
 * - 잠금 메모는 본문 대신 [잠긴 메모] placeholder
 */

import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { buildMemoMarkdown, safeFilename } from '@/lib/export/toMarkdown'

export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  const format = new URL(req.url).searchParams.get('format') ?? 'md'

  const { data: memo, error } = await supabase
    .from('memos')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (error || !memo) {
    return new Response('메모를 찾을 수 없습니다.', { status: 404 })
  }

  // 폴더 이름 lookup (옵션)
  let folderName: string | null = null
  if (memo.folder_id) {
    const { data: folder } = await supabase
      .from('folders')
      .select('name')
      .eq('id', memo.folder_id)
      .maybeSingle()
    folderName = folder?.name ?? null
  }

  const isLocked = memo.is_locked
  const safeTitle = memo.title || '제목없음'

  if (format === 'json') {
    const payload = {
      exportedAt: new Date().toISOString(),
      type: 'single-memo',
      version: '2.0',
      memo: {
        ...memo,
        folder_name: folderName,
      },
    }
    return new Response(JSON.stringify(payload, null, 2), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${safeFilename(safeTitle)}.json"`,
      },
    })
  }

  // md (default)
  let mdContent: string
  if (isLocked) {
    mdContent = buildMemoMarkdown(
      {
        title: memo.title || '',
        createdAt: memo.created_at,
        updatedAt: memo.updated_at,
        folderName,
        tags: memo.tags ?? [],
        wikiLinks: memo.wiki_links ?? [],
        isStarred: memo.is_starred,
        isPinned: memo.is_pinned,
      },
      {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: '🔒 잠긴 메모 — 본문 export 제외' }] },
        ],
      },
    )
  } else {
    const content = (memo.content && typeof memo.content === 'object' && Object.keys(memo.content).length > 0)
      ? memo.content as Record<string, unknown>
      : memo.content_text
        ? { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: memo.content_text }] }] }
        : { type: 'doc', content: [{ type: 'paragraph' }] }

    mdContent = buildMemoMarkdown(
      {
        title: memo.title || '',
        createdAt: memo.created_at,
        updatedAt: memo.updated_at,
        folderName,
        tags: memo.tags ?? [],
        wikiLinks: memo.wiki_links ?? [],
        isStarred: memo.is_starred,
        isPinned: memo.is_pinned,
      },
      content,
    )
  }

  return new Response(mdContent, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="${safeFilename(safeTitle)}"`,
    },
  })
}
