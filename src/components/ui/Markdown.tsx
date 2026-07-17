'use client'

/**
 * 경량 마크다운 렌더러 — AI 채팅 답변용 (외부 의존성 0)
 *
 * 지원: **굵게**, *기울임*, `인라인 코드`, # ~ ### 제목, - / * 불릿, 1. 번호 목록,
 *       ``` 코드 블록, 구분선(---)
 * 미지원(그대로 텍스트 표시): 링크, 이미지, 테이블 — 채팅 답변에서 드묾
 *
 * react-markdown 등 신규 의존성 없이 XSS-safe (dangerouslySetInnerHTML 미사용,
 * 전부 React 엘리먼트로 조립).
 */

import React from 'react'

/** 인라인 서식: **bold**, *italic*, `code` */
function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  // 우선순위: 코드 → 굵게 → 기울임 (겹침은 단순 처리)
  const re = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*\n]+\*)/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index))
    const tok = m[0]
    if (tok.startsWith('`')) {
      nodes.push(
        <code key={`${keyPrefix}-c${i}`} className="px-1 py-0.5 rounded bg-gray-100 dark:bg-gray-700/60 text-[0.9em] font-mono">
          {tok.slice(1, -1)}
        </code>
      )
    } else if (tok.startsWith('**')) {
      nodes.push(<strong key={`${keyPrefix}-b${i}`}>{tok.slice(2, -2)}</strong>)
    } else {
      nodes.push(<em key={`${keyPrefix}-i${i}`}>{tok.slice(1, -1)}</em>)
    }
    last = m.index + tok.length
    i++
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

interface Block {
  type: 'p' | 'h1' | 'h2' | 'h3' | 'ul' | 'ol' | 'code' | 'hr'
  lines: string[]
}

function parseBlocks(text: string): Block[] {
  const lines = text.split('\n')
  const blocks: Block[] = []
  let cur: Block | null = null
  let inCode = false

  const flush = () => { if (cur) { blocks.push(cur); cur = null } }

  for (const line of lines) {
    if (line.trimStart().startsWith('```')) {
      if (inCode) { inCode = false; flush() }
      else { flush(); inCode = true; cur = { type: 'code', lines: [] } }
      continue
    }
    if (inCode) { cur!.lines.push(line); continue }

    const trimmed = line.trim()
    if (!trimmed) { flush(); continue }

    if (/^---+$/.test(trimmed)) { flush(); blocks.push({ type: 'hr', lines: [] }); continue }

    const h = trimmed.match(/^(#{1,3})\s+(.*)/)
    if (h) {
      flush()
      blocks.push({ type: h[1].length === 1 ? 'h1' : h[1].length === 2 ? 'h2' : 'h3', lines: [h[2]] })
      continue
    }

    const ul = trimmed.match(/^[-*•]\s+(.*)/)
    if (ul) {
      if (cur?.type !== 'ul') { flush(); cur = { type: 'ul', lines: [] } }
      cur.lines.push(ul[1])
      continue
    }

    const ol = trimmed.match(/^\d+[.)]\s+(.*)/)
    if (ol) {
      if (cur?.type !== 'ol') { flush(); cur = { type: 'ol', lines: [] } }
      cur.lines.push(ol[1])
      continue
    }

    if (cur?.type !== 'p') { flush(); cur = { type: 'p', lines: [] } }
    cur.lines.push(line)
  }
  flush()
  return blocks
}

export default function Markdown({ text }: { text: string }) {
  const blocks = parseBlocks(text)
  return (
    <div className="space-y-2 leading-relaxed [&>*:first-child]:mt-0">
      {blocks.map((b, bi) => {
        switch (b.type) {
          case 'h1':
            return <p key={bi} className="font-bold text-[1.05em] mt-3">{renderInline(b.lines[0], `h${bi}`)}</p>
          case 'h2':
            return <p key={bi} className="font-bold mt-3">{renderInline(b.lines[0], `h${bi}`)}</p>
          case 'h3':
            return <p key={bi} className="font-semibold mt-2">{renderInline(b.lines[0], `h${bi}`)}</p>
          case 'ul':
            return (
              <ul key={bi} className="space-y-1 pl-1">
                {b.lines.map((l, li) => (
                  <li key={li} className="flex gap-1.5">
                    <span className="flex-shrink-0 select-none">•</span>
                    <span className="min-w-0">{renderInline(l, `u${bi}-${li}`)}</span>
                  </li>
                ))}
              </ul>
            )
          case 'ol':
            return (
              <ol key={bi} className="space-y-1 pl-1">
                {b.lines.map((l, li) => (
                  <li key={li} className="flex gap-1.5">
                    <span className="flex-shrink-0 select-none tabular-nums">{li + 1}.</span>
                    <span className="min-w-0">{renderInline(l, `o${bi}-${li}`)}</span>
                  </li>
                ))}
              </ol>
            )
          case 'code':
            return (
              <pre key={bi} className="p-2.5 rounded-lg bg-gray-100 dark:bg-gray-800/80 text-[0.85em] font-mono overflow-x-auto whitespace-pre-wrap">
                {b.lines.join('\n')}
              </pre>
            )
          case 'hr':
            return <hr key={bi} className="border-gray-200 dark:border-gray-700" />
          default:
            return <p key={bi} className="whitespace-pre-wrap">{renderInline(b.lines.join('\n'), `p${bi}`)}</p>
        }
      })}
    </div>
  )
}
