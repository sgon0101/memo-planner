'use client'

/**
 * 하루 마감 일지 저장 (2026-11). '일지' 폴더(없으면 생성)에 하루 1개 메모.
 *
 * 같은 날 다시 마감하면 기존 본문은 건드리지 않고 '다시 마감' 섹션을 **덧붙인다**
 * (처음 쓴 회고·사용자가 직접 고친 내용을 지우지 않기 위해 — 독립 리뷰 지적 반영).
 * 덧붙일 때 content_text·wiki_links·tags는 다시 계산하지 않고 기존 값에 합친다
 * (에디터가 저장한 값에는 이 모듈이 모르는 노드의 텍스트·링크가 있을 수 있다).
 * 그사이 다른 곳에서 고쳐졌으면(updated_at 불일치) 덮어쓰지 않고 실패로 알린다.
 * 잠금 메모는 본문이 암호화돼 있어 건드리지 않는다.
 */

import { createClient } from '@/lib/supabase/client'
import {
  JOURNAL_FOLDER_NAME, journalTitle, buildJournalBlocks, finalizeJournal, type JournalInput,
} from '@/lib/planner/journal'

export type JournalSaveResult =
  | { status: 'created' | 'appended'; memoId: string }
  | { status: 'locked'; memoId: string }

async function ensureJournalFolder(userId: string): Promise<string> {
  const supabase = createClient()
  const { data: found, error } = await supabase
    .from('folders')
    .select('id')
    .eq('name', JOURNAL_FOLDER_NAME)
    .is('parent_id', null)
    .limit(1)
  if (error) throw error
  if (found && found.length > 0) return found[0].id as string
  // 폴더 목록 맨 뒤에 붙인다 (useFolders.createFolder와 같은 규칙: 최상위 max(order_index)+1, 기본 색)
  const { data: last } = await supabase
    .from('folders')
    .select('order_index')
    .is('parent_id', null)
    .order('order_index', { ascending: false })
    .limit(1)
  const nextOrder = ((last?.[0]?.order_index as number | null) ?? -1) + 1
  const { data: created, error: insErr } = await supabase
    .from('folders')
    .insert({ user_id: userId, name: JOURNAL_FOLDER_NAME, parent_id: null, order_index: nextOrder, color_h: 260, color_s: 60, color_l: 80 })
    .select('id')
    .single()
  if (insErr) throw insErr
  return created.id as string
}

export async function saveJournal(input: JournalInput, nowLabel: string): Promise<JournalSaveResult> {
  const supabase = createClient()
  const { data: { session } } = await supabase.auth.getSession()
  const userId = session?.user?.id
  if (!userId) throw new Error('로그인 세션이 만료되었어요. 다시 로그인해주세요.')

  const folderId = await ensureJournalFolder(userId)
  const title = journalTitle(input.day)

  const { data: rows, error: findErr } = await supabase
    .from('memos')
    .select('id, content, content_text, wiki_links, tags, updated_at, is_locked')
    .eq('folder_id', folderId)
    .eq('title', title)
    .eq('is_deleted', false)
    .order('created_at', { ascending: true })
    .limit(1)
  if (findErr) throw findErr
  const existing = rows?.[0]

  if (!existing) {
    const doc = finalizeJournal(buildJournalBlocks(input))
    const { data: row, error } = await supabase
      .from('memos')
      .insert({
        user_id: userId, folder_id: folderId, title,
        content: doc.content, content_text: doc.contentText,
        wiki_links: doc.wikiLinks, tags: doc.tags,
      })
      .select('id')
      .single()
    if (error) throw error
    return { status: 'created', memoId: row.id as string }
  }

  const memoId = existing.id as string
  if (existing.is_locked) return { status: 'locked', memoId }

  // 이미 적힌 항목은 다시 적지 않는다 (같은 날 여러 번 마감해도 목록이 불어나지 않게)
  const prevText = (existing.content_text as string | null) ?? ''
  const add = finalizeJournal(buildJournalBlocks({
    ...input,
    appendLabel: nowLabel,
    done: input.done.filter((d) => !prevText.includes(d.title)),
    moved: input.moved.filter((m) => !prevText.includes(`${m.title} → ${m.to}`)),
    memos: input.memos.filter((m) => !prevText.includes(m.title)),
  }))
  const merged = finalizeJournal(add.blocks as never[], existing.content as never)
  const union = (a: unknown, b: string[]) => [...new Set([...(((a as string[] | null) ?? [])), ...b])]
  const { data: updated, error } = await supabase
    .from('memos')
    .update({
      content: merged.content,
      content_text: prevText ? `${prevText}\n${add.contentText}` : add.contentText,
      wiki_links: union(existing.wiki_links, add.wikiLinks),
      tags: union(existing.tags, add.tags),
    })
    .eq('id', memoId)
    .eq('updated_at', existing.updated_at as string) // 그사이 다른 기기·에디터가 고쳤으면 덮어쓰지 않는다
    .select('id')
  if (error) throw error
  if (!updated || updated.length === 0) {
    throw new Error('일지가 방금 다른 곳에서 바뀌었어요. 잠시 후 다시 마감해주세요.')
  }
  return { status: 'appended', memoId }
}
