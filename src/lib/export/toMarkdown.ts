type TNode = {
  type: string
  attrs?: Record<string, unknown>
  content?: TNode[]
  marks?: { type: string; attrs?: Record<string, unknown> }[]
  text?: string
}

function inlineNode(node: TNode): string {
  if (node.type === 'hardBreak') return '  \n'
  if (node.type === 'image') {
    const src = (node.attrs?.src as string) ?? ''
    const alt = (node.attrs?.alt as string) ?? ''
    return `![${alt}](${src})`
  }
  if (node.type === 'text') {
    let text = node.text ?? ''
    const marks = node.marks ?? []
    const codeM = marks.find((m) => m.type === 'code')
    if (codeM) return `\`${text}\``
    const linkM = marks.find((m) => m.type === 'link')
    for (const m of marks) {
      switch (m.type) {
        case 'bold':      text = `**${text}**`; break
        case 'italic':    text = `*${text}*`; break
        case 'strike':    text = `~~${text}~~`; break
        case 'underline': text = `<u>${text}</u>`; break
        case 'highlight': text = `==${text}==`; break
      }
    }
    if (linkM) text = `[${text}](${(linkM.attrs?.href as string) ?? ''})`
    return text
  }
  if (node.content) return node.content.map(inlineNode).join('')
  return ''
}

function inlineContent(nodes: TNode[]): string {
  return nodes.map(inlineNode).join('')
}

function listItemText(item: TNode): { text: string; nested: string } {
  const paragraphs = (item.content ?? []).filter(
    (n) => n.type !== 'bulletList' && n.type !== 'orderedList' && n.type !== 'taskList'
  )
  const nested = (item.content ?? []).filter(
    (n) => n.type === 'bulletList' || n.type === 'orderedList' || n.type === 'taskList'
  )
  const text = paragraphs.map((n) => inlineContent(n.content ?? [])).join(' ')
  const nestedMd = nested.map((n) => blockNode(n, 1)).join('\n')
  return { text, nested: nestedMd }
}

function blockNode(node: TNode, depth = 0): string {
  const pad = '  '.repeat(depth)

  switch (node.type) {
    case 'paragraph': {
      if (!node.content?.length) return ''
      return inlineContent(node.content)
    }

    case 'heading': {
      const lvl = Math.min((node.attrs?.level as number) ?? 1, 6)
      return `${'#'.repeat(lvl)} ${inlineContent(node.content ?? [])}`
    }

    case 'bulletList': {
      return (node.content ?? [])
        .map((item) => {
          const { text, nested } = listItemText(item)
          const line = `${pad}- ${text}`
          return nested ? `${line}\n${nested}` : line
        })
        .join('\n')
    }

    case 'orderedList': {
      const start = (node.attrs?.start as number) ?? 1
      return (node.content ?? [])
        .map((item, i) => {
          const { text, nested } = listItemText(item)
          const line = `${pad}${start + i}. ${text}`
          return nested ? `${line}\n${nested}` : line
        })
        .join('\n')
    }

    case 'taskList': {
      return (node.content ?? [])
        .map((item) => {
          const checked = item.attrs?.checked ? 'x' : ' '
          const text = (item.content ?? [])
            .filter((n) => n.type === 'paragraph')
            .map((n) => inlineContent(n.content ?? []))
            .join(' ')
          return `${pad}- [${checked}] ${text}`
        })
        .join('\n')
    }

    case 'codeBlock': {
      const lang = (node.attrs?.language as string) ?? ''
      const code = (node.content ?? []).map((n) => n.text ?? '').join('')
      return `\`\`\`${lang}\n${code}\n\`\`\``
    }

    case 'blockquote': {
      const inner = (node.content ?? []).map((n) => blockNode(n)).join('\n')
      return inner
        .split('\n')
        .map((l) => `> ${l}`)
        .join('\n')
    }

    case 'image': {
      const src = (node.attrs?.src as string) ?? ''
      const alt = (node.attrs?.alt as string) ?? ''
      if (!src) return ''
      return `![${alt}](${src})`
    }

    case 'horizontalRule':
      return '---'

    case 'table': {
      const rows = node.content ?? []
      if (!rows.length) return ''
      const firstRow = rows[0]
      const headers = (firstRow.content ?? []).map((cell) =>
        inlineContent(cell.content?.[0]?.content ?? [])
      )
      const sep = headers.map(() => '---')
      const bodyRows = rows.slice(1).map((row) =>
        (row.content ?? []).map((cell) =>
          inlineContent(cell.content?.[0]?.content ?? [])
        )
      )
      return [
        `| ${headers.join(' | ')} |`,
        `| ${sep.join(' | ')} |`,
        ...bodyRows.map((r) => `| ${r.join(' | ')} |`),
      ].join('\n')
    }

    default:
      if (node.content) {
        return node.content
          .map((n) => blockNode(n, depth))
          .filter(Boolean)
          .join('\n')
      }
      return ''
  }
}

export function tiptapToMarkdown(doc: Record<string, unknown>): string {
  const root = doc as TNode
  if (!root.content) return ''
  return root.content
    .map((n) => blockNode(n))
    .filter((s) => s !== null && s !== undefined && s !== '')
    .join('\n\n')
    .trim()
}

export interface MemoMeta {
  title: string
  createdAt: string
  updatedAt: string
  folderName: string | null
  tags: string[]
  wikiLinks?: string[]
  isStarred: boolean
  isPinned: boolean
}

export function buildMemoMarkdown(meta: MemoMeta, content: Record<string, unknown>): string {
  const fmt = (d: string) => d.replace('T', ' ').slice(0, 16)
  const lines = [
    `# ${meta.title || '제목 없음'}`,
    '',
    `**날짜**: ${fmt(meta.createdAt)}`,
    `**최종 수정**: ${fmt(meta.updatedAt)}`,
    `**폴더**: ${meta.folderName ?? '없음'}`,
    `**태그**: ${meta.tags.length ? meta.tags.map((t) => `#${t}`).join(' ') : '없음'}`,
    `**위키링크**: ${meta.wikiLinks?.length ? meta.wikiLinks.map((w) => `[[${w}]]`).join(' ') : '없음'}`,
    `**중요**: ${meta.isStarred ? '★ 중요 메모' : '-'}`,
    `**고정**: ${meta.isPinned ? '📌 고정됨' : '-'}`,
    '',
    '---',
    '',
    tiptapToMarkdown(content),
    '',
    '---',
    '*메모 플래너에서 내보낸 메모입니다*',
  ]
  return lines.join('\n')
}

export function safeFilename(title: string, _date?: string): string {
  const safe = (title || '제목없음')
    .replace(/[<>:"/\\|?*\[\]\n\r]/g, '')
    .replace(/\s+/g, '_')
    .trim()
    .slice(0, 50) || 'untitled'
  return `${safe}.md`
}

export function safeFilenameUnique(title: string, existingNames: Set<string>): string {
  const safe = (title || '제목없음')
    .replace(/[<>:"/\\|?*\[\]\n\r]/g, '')
    .replace(/\s+/g, '_')
    .trim()
    .slice(0, 50) || 'untitled'
  let fileName = `${safe}.md`
  let counter = 1
  while (existingNames.has(fileName)) {
    fileName = `${safe}_${counter}.md`
    counter++
  }
  existingNames.add(fileName)
  return fileName
}
