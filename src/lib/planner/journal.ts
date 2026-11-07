/**
 * 하루 마감 일지 메모 — 본문 생성(순수 함수) (2026-11 플래너 개선 — Arch 벤치마크 ④).
 *
 * '일지' 폴더에 하루 1개('YYYY-MM-DD 일지'). 본문의 [[위키]]·#태그는 에디터와 같은 규칙으로
 * wiki_links/tags가 되어 그래프에 엮인다. 플랜 제목 속 [[위키]]·#태그는 사용자가 직접 쓴
 * 것이라 살리고, 메모 제목처럼 우발적일 수 있는 문자열은 neutralize로 무력화한다.
 */

import { extractWikiLinks, extractTags, neutralize, collectText } from '@/lib/source-note/buildNoteDoc'

export const JOURNAL_FOLDER_NAME = '일지'
export const JOURNAL_TAG = '일지'

export function journalTitle(day: string): string {
  return `${day} 일지`
}

/** 'YYYY-MM-DD 일지' 제목들 → 오늘(또는 어제)까지 이어진 연속 일수 */
export function journalStreak(titles: string[], today: string): number {
  const days = new Set(titles.map((t) => /^(\d{4}-\d{2}-\d{2}) 일지$/.exec(t.trim())?.[1]).filter(Boolean) as string[])
  const step = (d: string, n: number) => {
    const x = new Date(`${d}T12:00:00Z`)
    x.setUTCDate(x.getUTCDate() + n)
    return x.toISOString().slice(0, 10)
  }
  let cur = days.has(today) ? today : step(today, -1)
  let n = 0
  while (days.has(cur)) { n++; cur = step(cur, -1) }
  return n
}

type TextNode = { type: 'text'; text: string }
type Node = { type: string; attrs?: Record<string, unknown>; content?: (Node | TextNode)[] }
const text = (t: string): TextNode => ({ type: 'text', text: t })
const para = (t: string): Node => (t ? { type: 'paragraph', content: [text(t)] } : { type: 'paragraph' })
const heading = (t: string): Node => ({ type: 'heading', attrs: { level: 2 }, content: [text(t)] })
const bullets = (items: string[]): Node => ({
  type: 'bulletList',
  content: items.map((t) => ({ type: 'listItem', content: [para(t)] })),
})

export interface JournalInput {
  day: string            // YYYY-MM-DD
  dayLabel: string       // '11월 7일 (토)'
  reflection: string
  done: { title: string; time?: string | null }[]
  moved: { title: string; to: string }[]   // to: '내일' | '인박스' | '11/9' …
  memos: { title: string }[]
  /** 그날 메모에서 모은 위키 (대표 표기) — 일지를 허브에 엮는다 */
  memoWikis: string[]
  /** 다시 마감(덧붙이기) 섹션이면 시각 라벨 */
  appendLabel?: string
}

export interface JournalDoc {
  blocks: Node[]
  contentText: string
  wikiLinks: string[]
  tags: string[]
}

export function buildJournalBlocks(input: JournalInput): Node[] {
  const b: Node[] = []
  if (input.appendLabel) {
    b.push({ type: 'horizontalRule' })
    b.push(heading(`다시 마감 · ${input.appendLabel}`))
  } else {
    // 인용 블록은 prose 스타일이 따옴표를 붙여 '누가 한 말'처럼 보여서 일반 문단으로 둔다
    b.push(para(`${input.dayLabel} 하루 마감 · 플래너에서 자동으로 작성했어요`))
  }
  const reflection = input.reflection.trim()
  if (reflection) {
    if (!input.appendLabel) b.push(heading('한 줄 회고'))
    b.push(para(reflection))
  }
  if (input.done.length) {
    b.push(heading(`완료한 일 ${input.done.length}`))
    // 플랜 제목의 [[위키]]·#태그는 사용자가 쓴 것 — 그대로 살린다
    b.push(bullets(input.done.map((d) => (d.time ? `${d.time} ${d.title}` : d.title))))
  }
  if (input.moved.length) {
    b.push(heading('미룬 일'))
    b.push(bullets(input.moved.map((m) => `${m.title} → ${m.to}`)))
  }
  if (input.memos.length) {
    b.push(heading('오늘 쓴 메모'))
    b.push(bullets(input.memos.map((m) => neutralize(m.title || '제목 없음'))))
  }
  const wikis = [...new Set(input.memoWikis.map((w) => w.replace(/[[\]]/g, '').trim()).filter(Boolean))].slice(0, 8)
  const tail = [...wikis.map((w) => `[[${w}]]`), `#${JOURNAL_TAG}`].join(' ')
  if (!input.appendLabel) b.push(para(tail))
  else if (wikis.length) b.push(para(wikis.map((w) => `[[${w}]]`).join(' ')))
  return b
}

/** 새 일지 또는 기존 본문 뒤에 덧붙인 결과 → 저장할 content/content_text/wiki_links/tags */
export function finalizeJournal(blocks: Node[], existing?: Node | null): JournalDoc & { content: Node } {
  const prev = existing && Array.isArray(existing.content) ? (existing.content as Node[]) : []
  const content: Node = { type: 'doc', content: [...prev, ...blocks] }
  const contentText = collectText(content as never).join('\n')
  return {
    content,
    blocks,
    contentText,
    wikiLinks: extractWikiLinks(contentText),
    tags: extractTags(contentText),
  }
}
