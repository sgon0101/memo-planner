/**
 * Tiptap JSON 본문 안 image node attrs 교체 헬퍼 (PR-M1-C).
 *
 *  - swapImageNodesInContent(content, imageMap)
 *      content 트리 순회 → image node의 attrs.localBlobId를 imageMap에서 찾아
 *      attrs.src / attrs.srcMd / attrs.srcSm로 교체, localBlobId attr 제거.
 *
 * 이 함수는:
 *  - 순수 함수 — content 자체를 수정하지 않고 새 객체 트리 반환
 *  - 메모 본문 (Tiptap JSON)뿐 아니라 다른 nested JSON도 안전
 *  - matched count도 함께 반환해 caller가 "변경 있음" 판단 가능
 */

'use client'

export interface ImageMappingEntry {
  src: string
  srcMd: string | null
  srcSm: string | null
}

export interface SwapResult<T> {
  content: T
  swappedCount: number
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Tiptap JSON 트리에서 image node를 찾아 attrs swap.
 * imageMap의 키는 localBlobId.
 */
export function swapImageNodesInContent<T>(
  content: T,
  imageMap: Map<string, ImageMappingEntry>,
): SwapResult<T> {
  if (imageMap.size === 0) return { content, swappedCount: 0 }
  let count = 0

  function walk(node: unknown): unknown {
    if (Array.isArray(node)) {
      return node.map(walk)
    }
    if (!isObj(node)) return node

    let next: Record<string, unknown> = node

    // image node 식별
    if (node.type === 'image' && isObj(node.attrs)) {
      const attrs = node.attrs as Record<string, unknown>
      const localBlobId = typeof attrs.localBlobId === 'string' ? attrs.localBlobId : null
      if (localBlobId && imageMap.has(localBlobId)) {
        const m = imageMap.get(localBlobId)!
        const newAttrs: Record<string, unknown> = {
          ...attrs,
          src: m.src,
          srcMd: m.srcMd,
          srcSm: m.srcSm,
          // localBlobId 제거 (남겨두면 ResizableImageView가 IDB 조회 시도해 noise)
          localBlobId: null,
        }
        next = { ...node, attrs: newAttrs }
        count++
      }
    }

    // 자식 노드 순회
    if (Array.isArray(next.content)) {
      const newContent = (next.content as unknown[]).map(walk)
      // 변경 있을 때만 새 객체 반환
      if (newContent.some((c, i) => c !== (next.content as unknown[])[i])) {
        next = { ...next, content: newContent }
      }
    }

    return next
  }

  const result = walk(content) as T
  return { content: result, swappedCount: count }
}
