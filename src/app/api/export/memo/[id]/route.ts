/**
 * 단일 메모 export — PR-5 A (v2 — 보호적 에러 처리).
 *
 * GET /api/export/memo/[id]?format=md|json
 */

import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { buildMemoMarkdown, safeFilename } from '@/lib/export/toMarkdown'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface MemoRow {
  id: string
  user_id: string
  folder_id: string | null
  title: string | null
  content: Record<string, unknown> | null
  content_text: string | null
  is_locked: boolean | null
  is_pinned: boolean | null
  is_starred: boolean | null
  tags: string[] | null
  wiki_links: string[] | null
  created_at: string
  updated_at: string
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params
    if (!id) {
      return Response.json({ error: 'id 필요' }, { status: 400 })
    }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return Response.json({ error: 'unauthorized' }, { status: 401 })
    }

    const format = new URL(req.url).searchParams.get('format') ?? 'md'

    const { data: memoRaw, error: fetchErr } = await supabase
      .from('memos')
      .select('id, user_id, folder_id, title, content, content_text, is_locked, is_pinned, is_starred, tags, wiki_links, created_at, updated_at')
      .eq('id', id)
      .eq('user_id', user.id)
      .maybeSingle()

    if (fetchErr) {
      console.error('[export/memo/id] fetch error:', fetchErr)
      return Response.json({ error: 'memo fetch 실패: ' + fetchErr.message }, { status: 500 })
    }
    if (!memoRaw) {
      return Response.json({ error: '메모를 찾을 수 없습니다.' }, { status: 404 })
    }

    const memo = memoRaw as MemoRow

    // 폴더 이름 lookup (옵션)
    let folderName: string | null = null
    if (memo.folder_id) {
      const { data: folder } = await supabase
        .from('folders')
        .select('name')
        .eq('id', memo.folder_id)
        .maybeSingle()
      folderName = (folder?.name as string | undefined) ?? null
    }

    const safeTitle = memo.title || '제목없음'

    // ─── JSON 응답 ─────────────────────────────────────────────
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

    // ─── Markdown 응답 ─────────────────────────────────────────
    let content: Record<string, unknown>
    if (memo.is_locked) {
      content = {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: '🔒 잠긴 메모 — 본문 export 제외' }] },
        ],
      }
    } else if (memo.content && typeof memo.content === 'object' && Object.keys(memo.content).length > 0) {
      content = memo.content
    } else if (memo.content_text) {
      content = {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: memo.content_text }] }],
      }
    } else {
      content = { type: 'doc', content: [{ type: 'paragraph' }] }
    }

    let mdContent: string
    try {
      mdContent = buildMemoMarkdown(
        {
          title: memo.title || '',
          createdAt: memo.created_at,
          updatedAt: memo.updated_at,
          folderName,
          tags: memo.tags ?? [],
          wikiLinks: memo.wiki_links ?? [],
          isStarred: memo.is_starred ?? false,
          isPinned: memo.is_pinned ?? false,
        },
        content,
      )
    } catch (e) {
      console.error('[export/memo/id] buildMemoMarkdown error:', e)
      return Response.json(
        { error: 'Markdown 변환 실패: ' + (e instanceof Error ? e.message : 'unknown') },
        { status: 500 }
      )
    }

    return new Response(mdContent, {
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename="${safeFilename(safeTitle)}"`,
      },
    })
  } catch (err) {
    console.error('[export/memo/id] unexpected:', err)
    return Response.json(
      { error: err instanceof Error ? err.message : 'unknown', stack: err instanceof Error ? err.stack?.slice(0, 500) : undefined },
      { status: 500 }
    )
  }
}
