/**
 * Markdown → Tiptap JSON 역변환 + frontmatter 파싱 (PR-5 E).
 *
 * 입력: buildMemoMarkdown으로 만든 .md 파일 내용
 * 출력: 메모 복원에 필요한 필드들
 */

export interface ParsedMarkdown {
  title: string
  content: Record<string, unknown>
  contentText: string
  tags: string[]
  wikiLinks: string[]
  isStarred: boolean
  isPinned: boolean
  folderName: string | null
  createdAt: string | null
  updatedAt: string | null
}

function parseHeader(lines: string[]): { meta: Partial<ParsedMarkdown>; bodyStart: number } {
  const meta: Partial<ParsedMarkdown> = {}

  if (lines[0]?.startsWith('# ')) {
    meta.title = lines[0].slice(2).trim()
  } else if (lines[0]) {
    meta.title = lines[0].trim()
  } else {
    meta.title = ''
  }

  let i = 1
  for (; i < Math.min(lines.length, 15); i++) {
    const ln = lines[i].trim()
    if (!ln) continue
    if (ln === '---') {
      i++
      while (i < lines.length && !lines[i].trim()) i++
      break
    }

    const dateM = ln.match(/^\*\*날짜\*\*:\s*(.+)$/)
    if (dateM) { meta.createdAt = dateM[1].trim(); continue }
    const updM = ln.match(/^\*\*최종\s*수정\*\*:\s*(.+)$/)
    if (updM) { meta.updatedAt = updM[1].trim(); continue }
    const folderM = ln.match(/^\*\*폴더\*\*:\s*(.+)$/)
    if (folderM) {
      const v = folderM[1].trim()
      meta.folderName = (v === '없음' || v === '-') ? null : v
      continue
    }
    const tagM = ln.match(/^\*\*태그\*\*:\s*(.+)$/)
    if (tagM) {
      const v = tagM[1].trim()
      if (v === '없음' || v === '-') meta.tags = []
      else meta.tags = v.split(/\s+/).map((t) => t.replace(/^#/, '')).filter(Boolean)
      continue
    }
    const wikiM = ln.match(/^\*\*위키링크\*\*:\s*(.+)$/)
    if (wikiM) {
      const v = wikiM[1].trim()
      if (v === '없음' || v === '-') meta.wikiLinks = []
      else meta.wikiLinks = (v.match(/\[\[([^\]]+)\]\]/g) ?? []).map((m) => m.slice(2, -2))
      continue
    }
    const starM = ln.match(/^\*\*중요\*\*:\s*(.+)$/)
    if (starM) {
      meta.isStarred = starM[1].includes('중요 메모') || starM[1].includes('★')
      continue
    }
    const pinM = ln.match(/^\*\*고정\*\*:\s*(.+)$/)
    if (pinM) {
      meta.isPinned = pinM[1].includes('고정됨') || pinM[1].includes('📌')
      continue
    }
  }

  return { meta, bodyStart: i }
}

function bodyToTiptap(lines: string[]): { content: Record<string, unknown>; contentText: string } {
  const blocks: Record<string, unknown>[] = []
  const textParts: string[] = []
  let i = 0

  while (i < lines.length) {
    const ln = lines[i]
    const trimmed = ln.trim()

    if (!trimmed) { i++; continue }

    if (trimmed === '---' && lines[i + 1]?.trim().includes('Weave에서 내보낸')) break

    const hM = trimmed.match(/^(#{1,6})\s+(.+)$/)
    if (hM) {
      const level = hM[1].length
      const text = hM[2]
      blocks.push({ type: 'heading', attrs: { level }, content: [{ type: 'text', text }] })
      textParts.push(text)
      i++
      continue
    }

    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      const items: Record<string, unknown>[] = []
      while (i < lines.length && (lines[i].trim().startsWith('- ') || lines[i].trim().startsWith('* '))) {
        const item = lines[i].trim().slice(2)
        items.push({ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: item }] }] })
        textParts.push(item)
        i++
      }
      blocks.push({ type: 'bulletList', content: items })
      continue
    }

    if (trimmed.match(/^\d+\.\s/)) {
      const items: Record<string, unknown>[] = []
      while (i < lines.length && lines[i].trim().match(/^\d+\.\s/)) {
        const item = lines[i].trim().replace(/^\d+\.\s/, '')
        items.push({ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: item }] }] })
        textParts.push(item)
        i++
      }
      blocks.push({ type: 'orderedList', content: items })
      continue
    }

    if (trimmed.startsWith('```')) {
      const lang = trimmed.slice(3).trim()
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i])
        i++
      }
      i++
      const code = codeLines.join('\n')
      blocks.push({ type: 'codeBlock', attrs: lang ? { language: lang } : {}, content: [{ type: 'text', text: code }] })
      textParts.push(code)
      continue
    }

    if (trimmed.startsWith('> ')) {
      const quoteLines: string[] = []
      while (i < lines.length && lines[i].trim().startsWith('> ')) {
        quoteLines.push(lines[i].trim().slice(2))
        i++
      }
      const text = quoteLines.join(' ')
      blocks.push({ type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
      textParts.push(text)
      continue
    }

    if (trimmed === '---' || trimmed === '***') {
      blocks.push({ type: 'horizontalRule' })
      i++
      continue
    }

    const paraLines: string[] = []
    while (i < lines.length && lines[i].trim()) {
      const t = lines[i].trim()
      if (t === '---' || t.startsWith('#') || t.startsWith('```') || t.startsWith('> ')) break
      paraLines.push(t)
      i++
    }
    const text = paraLines.join(' ')
    if (text) {
      blocks.push({ type: 'paragraph', content: [{ type: 'text', text }] })
      textParts.push(text)
    }
  }

  if (blocks.length === 0) blocks.push({ type: 'paragraph' })

  return {
    content: { type: 'doc', content: blocks },
    contentText: textParts.join('\n'),
  }
}

export function parseMarkdownMemo(md: string): ParsedMarkdown {
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  const { meta, bodyStart } = parseHeader(lines)
  const bodyLines = lines.slice(bodyStart)
  const { content, contentText } = bodyToTiptap(bodyLines)

  return {
    title: meta.title ?? '',
    content,
    contentText,
    tags: meta.tags ?? [],
    wikiLinks: meta.wikiLinks ?? [],
    isStarred: meta.isStarred ?? false,
    isPinned: meta.isPinned ?? false,
    folderName: meta.folderName ?? null,
    createdAt: meta.createdAt ?? null,
    updatedAt: meta.updatedAt ?? null,
  }
}
