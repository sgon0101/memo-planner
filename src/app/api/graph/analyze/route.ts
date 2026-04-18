import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// 한국어 불용어
const STOPWORDS = new Set([
  '이', '그', '저', '것', '수', '등', '및', '또', '의', '가', '이', '은', '는', '을', '를',
  '에', '에서', '로', '으로', '와', '과', '도', '만', '을', '를', '이다', '있다', '하다',
  '되다', '않다', '없다', '같다', '크다', '작다', '많다', '적다', '좋다', '나쁘다',
  'the', 'a', 'an', 'in', 'on', 'at', 'to', 'for', 'of', 'and', 'or', 'but', 'is', 'are',
  'was', 'were', 'be', 'been', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
  'could', 'should', 'may', 'might', 'can', 'that', 'this', 'these', 'those', 'it', 'its',
])

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w가-힣\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
}

function topKeywords(text: string, n = 10): Set<string> {
  const freq = new Map<string, number>()
  for (const t of tokenize(text)) {
    freq.set(t, (freq.get(t) ?? 0) + 1)
  }
  const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, n)
  return new Set(sorted.map(([w]) => w))
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: memos } = await supabase
    .from('memos')
    .select('id, title, content_text, tags, wiki_links')
    .eq('user_id', user.id)
    .eq('is_deleted', false)
    .eq('is_locked', false)

  if (!memos) return NextResponse.json({ links: [] })

  // 키워드 맵 구성
  const keywordMap = new Map<string, Set<string>>() // memoId → keywords
  for (const m of memos) {
    if (m.content_text) {
      keywordMap.set(m.id, topKeywords(m.content_text))
    }
  }

  // 유사도 링크 생성 (공통 키워드 2개 이상)
  const links: { source: string; target: string; type: 'similarity' }[] = []
  const ids = [...keywordMap.keys()]
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = keywordMap.get(ids[i])!
      const b = keywordMap.get(ids[j])!
      let common = 0
      for (const kw of a) { if (b.has(kw)) common++ }
      if (common >= 2) {
        links.push({ source: ids[i], target: ids[j], type: 'similarity' })
      }
    }
  }

  return NextResponse.json({ links })
}
