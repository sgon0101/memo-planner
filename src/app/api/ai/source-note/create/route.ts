/**
 * POST /api/ai/source-note/create — 검토를 마친 분석 결과로 요약 노트 생성
 *
 * 입력: { sourceAnalysisId, folderId, title, wikis: string[], tags: string[], includeRelated: boolean }
 *
 * 캐시된 분석(source_analyses)으로 본문만 만든다 — AI 재호출·한도 차감 없음.
 * 위키·태그는 서버에서 다시 대표 표기로 맞춘다 (클라이언트 입력을 믿지 않는다).
 *
 * 순서: memos insert(RLS 사용자 컨텍스트) → memo_sources(position 순) →
 *       uploaded_files.memo_id가 비어 있으면 채움(호환) → 임베딩 즉시 생성(실패 무시)
 */

import { NextRequest, NextResponse } from 'next/server'
import { format } from 'date-fns'
import { createClient } from '@/lib/supabase/server'
import { embedText, buildMemoEmbeddingInput } from '@/lib/ai/embeddings'
import { resolveToCanonical, tagKey, wikiKey } from '@/lib/wiki/normalize'
import { buildNoteDoc } from '@/lib/source-note/buildNoteDoc'
import { buildVocab, cleanTag, cleanWiki } from '@/lib/source-note/postprocess'
import type { StoredAnalysis } from '@/lib/source-note/types'

export const runtime = 'nodejs'
export const maxDuration = 60

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_ITEMS = 30

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })

  let body: {
    sourceAnalysisId?: unknown; folderId?: unknown; title?: unknown
    wikis?: unknown; tags?: unknown; includeRelated?: unknown
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: '잘못된 요청 형식입니다.' }, { status: 400 })
  }

  const analysisId = typeof body.sourceAnalysisId === 'string' && UUID_RE.test(body.sourceAnalysisId) ? body.sourceAnalysisId : null
  if (!analysisId) return NextResponse.json({ error: '분석 정보가 올바르지 않습니다.' }, { status: 400 })
  const folderId = typeof body.folderId === 'string' && UUID_RE.test(body.folderId) ? body.folderId : null
  const strList = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, MAX_ITEMS) : [])

  try {
    const { data: row, error: rowErr } = await supabase
      .from('source_analyses')
      .select('id, file_ids, analysis')
      .eq('id', analysisId)
      .eq('user_id', user.id)
      .maybeSingle()
    if (rowErr) throw new Error(rowErr.message)
    if (!row) return NextResponse.json({ error: '분석 결과를 찾을 수 없어요. 다시 분석해주세요.' }, { status: 404 })
    const stored = row.analysis as StoredAnalysis
    const fileIds = (row.file_ids as string[]) ?? []
    // 분할 경로에서 종합(②)이 아직 안 끝난 분석으로는 노트를 만들 수 없다
    if (stored.phase === 'extracted' || !stored.result) {
      return NextResponse.json({ error: '분석이 아직 끝나지 않았어요. 잠시 후 다시 시도해주세요.' }, { status: 409 })
    }
    const result = stored.result

    if (folderId) {
      const { data: folder } = await supabase.from('folders').select('id').eq('id', folderId).eq('user_id', user.id).maybeSingle()
      if (!folder) return NextResponse.json({ error: '폴더를 찾을 수 없어요.' }, { status: 400 })
    }

    // 위키·태그 재정규화 — 기존 어휘가 있으면 그 표기로
    const vocab = await buildVocab(supabase, user.id)
    const wikis = strList(body.wikis)
      .map((w) => resolveToCanonical(w.replace(/[[\]]/g, ''), vocab.wikiCanonical, wikiKey))
      .map((w) => (vocab.wikiCanonical.has(wikiKey(w)) ? w : cleanWiki(w)))
      .filter(Boolean)
    const tags = strList(body.tags)
      .map((t) => resolveToCanonical(t.replace(/^#+/, ''), vocab.tagCanonical, tagKey))
      .map(cleanTag)
      .filter(Boolean)

    const title = (typeof body.title === 'string' ? body.title.trim() : '').slice(0, 200) || result.title
    const built = buildNoteDoc({
      analysis: result,
      meta: stored.meta,
      date: format(new Date(), 'yyyy-MM-dd'),
      wikis,
      tags,
      related: stored.related ?? [],
      includeRelated: body.includeRelated !== false,
    })

    const { data: memo, error: insErr } = await supabase
      .from('memos')
      .insert({
        user_id: user.id,
        folder_id: folderId,
        title,
        content: built.content,
        content_text: built.contentText,
        wiki_links: built.wikiLinks,
        tags: built.tags,
      })
      .select('id')
      .single()
    if (insErr || !memo) throw new Error(`메모 저장 실패: ${insErr?.message}`)

    // 노트 ↔ 소스 파일 (순서 보존)
    if (fileIds.length) {
      const { error: linkErr } = await supabase.from('memo_sources').insert(
        fileIds.map((fid, position) => ({ memo_id: memo.id, file_id: fid, user_id: user.id, position })),
      )
      if (linkErr) {
        // 원본 연결이 없으면 GC 보호(가드 ⑧)도 없다 — 노트를 되돌리고 실패로 알린다
        await supabase.from('memos').delete().eq('id', memo.id)
        throw new Error(`원본 연결 실패: ${linkErr.message}`)
      }
      // 호환용 1:1 연결 — 비어 있는 것만
      await supabase.from('uploaded_files').update({ memo_id: memo.id }).in('id', fileIds).is('memo_id', null)
    }

    // 임베딩 즉시 생성 (관련 메모·검색에 바로 잡히도록) — 실패 무시
    try {
      const input = buildMemoEmbeddingInput(title, built.contentText)
      if (input) {
        const vector = await embedText(input)
        await supabase.from('memos').update({
          embedding: vector as unknown as string,
          embedding_updated_at: new Date().toISOString(),
        }).eq('id', memo.id)
      }
    } catch (e) {
      console.error('[source-note] create 임베딩 건너뜀:', e instanceof Error ? e.message : e)
    }

    return NextResponse.json({ memoId: memo.id })
  } catch (e) {
    console.error('[source-note] create 실패:', e)
    return NextResponse.json({ error: '노트를 만들지 못했어요. 다시 시도해주세요.' }, { status: 500 })
  }
}
