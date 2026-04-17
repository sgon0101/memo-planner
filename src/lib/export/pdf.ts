// 브라우저 print API를 사용해 PDF 저장 (클라이언트 전용)
export function printToPdf(html: string, title: string) {
  const win = window.open('', '_blank')
  if (!win) return

  win.document.write(`<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
  <style>
    body { font-family: 'Malgun Gothic', sans-serif; margin: 40px; color: #111; line-height: 1.7; }
    h1 { font-size: 22px; border-bottom: 2px solid #7F77DD; padding-bottom: 8px; }
    h2 { font-size: 18px; margin-top: 32px; }
    h3 { font-size: 15px; }
    hr { border: none; border-top: 1px solid #e5e7eb; margin: 24px 0; }
    p { margin: 8px 0; }
    pre { background: #f3f4f6; padding: 12px; border-radius: 6px; overflow-x: auto; }
    code { background: #f3f4f6; padding: 2px 4px; border-radius: 3px; font-size: 13px; }
    @media print { body { margin: 20px; } }
  </style>
</head>
<body>${html}</body>
</html>`)
  win.document.close()
  win.focus()
  setTimeout(() => { win.print() }, 500)
}

export function markdownToHtml(md: string): string {
  return md
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/^---$/gm, '<hr>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/^(?!<[h|p|h|d|u|o|l|b|i|c])(.+)$/gm, '<p>$1</p>')
}
