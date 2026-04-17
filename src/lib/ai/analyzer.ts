export function extractMemoTexts(memos: Array<{ title: string; content_text: string; tags: string[] }>) {
  return memos.map((m) => {
    const parts = [m.title, m.content_text?.slice(0, 200)].filter(Boolean)
    return parts.join(' — ')
  })
}

export function extractTopTags(memos: Array<{ tags: string[] }>, topN = 5): string[] {
  const counts: Record<string, number> = {}
  for (const memo of memos) {
    for (const tag of memo.tags ?? []) {
      counts[tag] = (counts[tag] ?? 0) + 1
    }
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([tag]) => tag)
}
