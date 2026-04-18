'use client'

import { NodeViewWrapper, NodeViewContent } from '@tiptap/react'
import { useState } from 'react'
import type { NodeViewProps } from '@tiptap/react'

const LANGUAGES = [
  { value: '', label: 'Auto' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'python', label: 'Python' },
  { value: 'java', label: 'Java' },
  { value: 'c', label: 'C' },
  { value: 'cpp', label: 'C++' },
  { value: 'csharp', label: 'C#' },
  { value: 'go', label: 'Go' },
  { value: 'rust', label: 'Rust' },
  { value: 'css', label: 'CSS' },
  { value: 'html', label: 'HTML' },
  { value: 'xml', label: 'XML' },
  { value: 'json', label: 'JSON' },
  { value: 'bash', label: 'Bash' },
  { value: 'shell', label: 'Shell' },
  { value: 'sql', label: 'SQL' },
  { value: 'yaml', label: 'YAML' },
  { value: 'markdown', label: 'Markdown' },
]

export default function CodeBlockView({ node, updateAttributes }: NodeViewProps) {
  const [copied, setCopied] = useState(false)
  const language = (node.attrs.language as string) || ''

  function handleCopy() {
    navigator.clipboard.writeText(node.textContent).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <NodeViewWrapper className="relative my-4 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700">
      <div
        className="flex items-center justify-between bg-gray-100 dark:bg-gray-800 px-3 py-1.5"
        contentEditable={false}
      >
        <select
          value={language}
          onChange={(e) => updateAttributes({ language: e.target.value || null })}
          className="text-xs text-gray-600 dark:text-gray-400 bg-transparent border-0 outline-none cursor-pointer"
        >
          {LANGUAGES.map((l) => (
            <option key={l.value} value={l.value}>{l.label}</option>
          ))}
        </select>
        <button
          onMouseDown={(e) => { e.preventDefault(); handleCopy() }}
          className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors px-2 py-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
        >
          {copied ? '✓ 복사됨' : '복사'}
        </button>
      </div>
      <pre className="!m-0 !rounded-none !border-0 !rounded-b-lg bg-gray-50 dark:bg-gray-950 overflow-x-auto text-sm leading-relaxed">
        <NodeViewContent className={language ? `language-${language} hljs` : 'hljs'} />
      </pre>
    </NodeViewWrapper>
  )
}
