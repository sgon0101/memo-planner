/**
 * 요약 노트 본문 빌더 — Tiptap JSON 직접 생성 (순수 함수)
 *
 * `fromMarkdown`은 인라인 서식·링크를 지원하지 않아 직접 만든다. 노드 구조는 기존 메모와
 * 동일한 StarterKit 기본형(heading/paragraph/bulletList>listItem>paragraph/blockquote)이라
 * CustomEnterExtension(Enter=hardBreak)과 충돌하지 않는다.
 *
 * ⚠️ `[[위키]]`·`#태그`는 본문에 리터럴로 기록한다 — 에디터가 저장 시 본문(content_text)에서
 * wiki_links/tags를 재추출하므로, 본문에 없으면 첫 편집에 링크가 사라진다.
 * 반대로 AI가 쓴 문장 속 우발적 `#단어`·`[[`는 재추출되면 원치 않는 태그·허브가 생기므로
 * 전각(＃)·공백 삽입으로 무력화한다 (사용자가 확정한 위키·태그 줄만 살아 있는 링크).
 */

import { tagKey, wikiKey } from '@/lib/wiki/normalize'
import type { RelatedMemoRef, SourceMeta, SourceNoteAnalysis } from './types'

type Mark = { type: string }
type TextNode = { type: 'text'; text: string; marks?: Mark[] }
type Node = { type: string; attrs?: Record<string, unknown>; content?: (Node | TextNode)[] }

/** MemoEditor.extractWikiLinks와 동일 */
export function extractWikiLinks(text: string): string[] {
  const matches = [...text.matchAll(/\[\[([^\]]+)\]\]/g)]
  return [...new Set(matches.map((m) => m[1]))]
}

/** MemoEditor.extractTags와 동일 */
export function extractTags(text: string): string[] {
  const matches = [...text.matchAll(/#([\w가-힣]+)/g)]
  return [...new Set(matches.map((m) => m[1]))]
}

/** AI·파일명 텍스트 속 우발적 위키·태그 문법 무력화 */
export function neutralize(s: string): string {
  return s
    .replace(/\[\[/g, '[ [')
    .replace(/\]\]/g, '] ]')
    .replace(/#(?=[\w가-힣])/g, '＃')
}

const text = (t: string, marks?: Mark[]): TextNode => (marks ? { type: 'text', text: t, marks } : { type: 'text', text: t })
const para = (...content: TextNode[]): Node => (content.filter((c) => c.text).length
  ? { type: 'paragraph', content: content.filter((c) => c.text) }
  : { type: 'paragraph' })
const heading = (level: 2 | 3, t: string): Node => ({ type: 'heading', attrs: { level }, content: [text(t)] })
const bullets = (items: Node[][]): Node => ({
  type: 'bulletList',
  content: items.map((content) => ({ type: 'listItem', content })),
})

export interface BuildNoteInput {
  analysis: SourceNoteAnalysis
  meta: SourceMeta
  /** YYYY-MM-DD */
  date: string
  /** 확정 위키 (대표 표기) */
  wikis: string[]
  /** 확정 태그 */
  tags: string[]
  related: RelatedMemoRef[]
  includeRelated: boolean
}

export interface BuiltNote {
  content: Node
  contentText: string
  wikiLinks: string[]
  tags: string[]
}

export function buildNoteDoc(input: BuildNoteInput): BuiltNote {
  const { analysis: a, meta, date, includeRelated, related } = input
  const wikis = dedupeBy(input.wikis.map((w) => w.replace(/[[\]]/g, '').trim()).filter(Boolean), wikiKey)
  const tags = dedupeBy(input.tags.map((t) => t.replace(/^#+/, '').replace(/[^\w가-힣]/g, '')).filter(Boolean), tagKey)
  const wikiByKey = new Map(wikis.map((w) => [wikiKey(w), w]))

  const blocks: Node[] = []

  // 원본 정보
  const names = meta.fileNames.map(neutralize)
  const sourceLine = meta.kind === 'pdf'
    ? `📄 원본: ${names[0] ?? 'PDF'}${meta.pageCount ? ` · ${meta.pageCount}쪽` : ''} · ${date}`
    : `🖼 원본: 이미지 ${names.length}장 (${names[0] ?? ''}${names.length > 1 ? ` 외 ${names.length - 1}장` : ''}) · ${date}`
  blocks.push({ type: 'blockquote', content: [para(text(sourceLine))] })

  if (a.oneLiner) {
    blocks.push(heading(2, '한 줄 요약'))
    blocks.push(para(text(neutralize(a.oneLiner))))
  }

  if (a.keyPoints.length) {
    blocks.push(heading(2, '핵심 요약'))
    blocks.push(bullets(a.keyPoints.map((p) => [para(text(neutralize(p)))])))
  }

  if (a.sections.length) {
    blocks.push(heading(2, '내용 정리'))
    for (const s of a.sections) {
      if (s.heading) blocks.push(heading(3, neutralize(s.heading)))
      if (s.bullets.length) blocks.push(bullets(s.bullets.map((b) => [para(text(neutralize(b)))])))
    }
  }

  if (a.concepts.length) {
    blocks.push(heading(2, '핵심 개념'))
    blocks.push(bullets(a.concepts.map((c) => {
      // 확정 위키에 포함된 개념만 [[ ]] — 나머지는 평문 (굵게)
      const confirmed = wikiByKey.get(wikiKey(c.name))
      const name = confirmed ? text(`[[${confirmed}]]`) : text(neutralize(c.name), [{ type: 'bold' }])
      return [para(name, text(c.definition ? ` — ${neutralize(c.definition)}` : ''))]
    })))
  }

  if (a.quotes.length) {
    blocks.push(heading(2, '기억할 문장'))
    for (const q of a.quotes) {
      blocks.push({ type: 'blockquote', content: [para(text(`${neutralize(q.text)}${q.loc ? ` — ${neutralize(q.loc)}` : ''}`))] })
    }
  }

  if (includeRelated && related.length) {
    blocks.push(heading(2, '연결된 메모'))
    blocks.push(bullets(related.map((r) => [para(text(neutralize(r.title || '제목 없음')))])))
  }

  if (wikis.length) blocks.push(para(text(`연결: ${wikis.map((w) => `[[${w}]]`).join(' ')}`)))
  if (tags.length) blocks.push(para(text(tags.map((t) => `#${t}`).join(' '))))

  const content: Node = { type: 'doc', content: blocks }
  const contentText = collectText(content).join('\n')
  return {
    content,
    contentText,
    // 저장값은 에디터와 같은 정규식으로 본문에서 뽑는다 — 첫 편집 후에도 불변
    wikiLinks: extractWikiLinks(contentText),
    tags: extractTags(contentText),
  }
}

/** 텍스트 블록(paragraph/heading)마다 한 줄 */
function collectText(node: Node | TextNode): string[] {
  if (node.type === 'text') return [(node as TextNode).text]
  const n = node as Node
  if (n.type === 'paragraph' || n.type === 'heading') {
    return [(n.content ?? []).map((c) => (c.type === 'text' ? (c as TextNode).text : '')).join('')]
  }
  return (n.content ?? []).flatMap(collectText)
}

function dedupeBy(items: string[], keyFn: (s: string) => string): string[] {
  const seen = new Set<string>()
  return items.filter((s) => {
    const k = keyFn(s)
    if (!k || seen.has(k)) return false
    seen.add(k)
    return true
  })
}
