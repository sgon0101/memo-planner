import { Suspense } from 'react'
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import MemoEditor from '@/components/memo/MemoEditor'

interface Props {
  params: Promise<{ id: string }>
  searchParams: Promise<{ folder?: string }>
}

export default async function MemoEditorPage({ params, searchParams }: Props) {
  const { id } = await params
  const { folder } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // 신규 메모: 빈 에디터 렌더링 (클라이언트에서 저장 시 레코드 생성)
  if (id === 'new') {
    return (
      <Suspense>
        <MemoEditor
          memoId="new"
          initialTitle=""
          initialContent={{}}
          initialFolderId={folder ?? null}
          isNew
        />
      </Suspense>
    )
  }

  const { data: memo } = await supabase
    .from('memos')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .eq('is_deleted', false)
    .single()

  if (!memo) notFound()

  return (
    <Suspense>
      <MemoEditor
        memoId={memo.id}
        initialTitle={memo.title ?? ''}
        initialContent={(memo.content as Record<string, unknown>) ?? {}}
        initialIsStarred={memo.is_starred ?? false}
        initialIsPinned={memo.is_pinned ?? false}
        initialFolderId={memo.folder_id ?? null}
      />
    </Suspense>
  )
}
