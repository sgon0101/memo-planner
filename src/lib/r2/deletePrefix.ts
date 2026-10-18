import 'server-only'
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3'
import { r2Client, R2_BUCKET } from '@/lib/r2/client'

/**
 * 사용자 한 명의 R2 객체 전체 삭제 (계정 삭제용).
 *
 * ⚠️ prefix가 비면 버킷 전체가 지워진다 — userId는 반드시 userPrefix()를 거친다.
 *    UUID 형식만 허용하고 끝의 '/'를 강제해 `abc` 가 `abcdef/...` 를 지우는 일도 막는다.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** 검증된 `${userId}/` prefix. 형식이 다르면 throw (R2 호출 전). */
export function userPrefix(userId: unknown): string {
  if (typeof userId !== 'string' || !UUID_RE.test(userId)) {
    throw new Error('[deletePrefix] userId가 UUID 형식이 아님 — 삭제 중단')
  }
  return `${userId}/`
}

/** `${userId}/` 아래 객체를 끝까지 지우고 삭제 개수를 반환. 하나라도 실패하면 throw. */
export async function deleteUserObjects(userId: string): Promise<number> {
  const prefix = userPrefix(userId)
  let deleted = 0

  // 삭제하면서 목록이 줄어들므로 continuation token 대신 매번 처음부터 다시 연다.
  // 지워지지 않는 키가 남아 무한 반복하는 일을 막기 위해 라운드 상한을 둔다.
  for (let round = 0; round < 1000; round++) {
    const list = await r2Client.send(new ListObjectsV2Command({
      Bucket: R2_BUCKET, Prefix: prefix, MaxKeys: 1000,
    }))
    const keys = (list.Contents ?? [])
      .map((o) => o.Key)
      .filter((k): k is string => !!k && k.startsWith(prefix))
    if (keys.length === 0) return deleted

    await deleteBatch(keys)
    deleted += keys.length
  }
  throw new Error('[deletePrefix] 삭제 라운드 상한 초과')
}

async function deleteBatch(keys: string[]): Promise<void> {
  try {
    const res = await r2Client.send(new DeleteObjectsCommand({
      Bucket: R2_BUCKET,
      Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
    }))
    if (res.Errors && res.Errors.length > 0) {
      throw new Error(`[deletePrefix] 일부 삭제 실패 ${res.Errors.length}건: ${res.Errors[0]?.Code ?? ''}`)
    }
  } catch (err) {
    // 일괄 삭제가 거부되면(체크섬 헤더 호환 등) 한 개씩 지운다 — 느리지만 확실하다
    console.error('[deletePrefix] DeleteObjects 실패, 개별 삭제로 재시도:', err instanceof Error ? err.message : err)
    for (const Key of keys) {
      await r2Client.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key }))
    }
  }
}
