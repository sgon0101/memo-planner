import 'server-only'
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

/**
 * 외부 OAuth 토큰(Google Drive·Calendar) 저장용 AES-256-GCM.
 *
 * 저장 형식: `v1:<iv b64>:<tag b64>:<ciphertext b64>`
 * 키: env TOKEN_ENCRYPTION_KEY (32바이트를 base64로) — 서버 시작이 아니라 **호출 시점**에 검사한다.
 *
 * `decryptToken`은 `v1:` 접두사가 없으면 평문으로 보고 그대로 돌려준다 —
 * 기존 행을 scripts/encrypt-existing-tokens.cjs로 옮기는 동안 끊기지 않게 하기 위함.
 * (그 스크립트에 같은 형식의 암호화가 JS로 복제돼 있다 — 형식을 바꾸면 둘 다 바꿀 것)
 */

const PREFIX = 'v1'
const IV_BYTES = 12

function getKey(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY
  if (!raw) throw new Error('[tokenCipher] TOKEN_ENCRYPTION_KEY가 설정되지 않았습니다.')
  const key = Buffer.from(raw, 'base64')
  if (key.length !== 32) {
    throw new Error(`[tokenCipher] TOKEN_ENCRYPTION_KEY는 32바이트(base64)여야 합니다. 현재 ${key.length}바이트.`)
  }
  return key
}

export function isEncryptedToken(stored: string): boolean {
  return stored.startsWith(`${PREFIX}:`)
}

export function encryptToken(plain: string): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', getKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [PREFIX, iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join(':')
}

export function decryptToken(stored: string): string {
  if (!isEncryptedToken(stored)) return stored // 마이그레이션 전 평문 행
  const parts = stored.split(':')
  if (parts.length !== 4) throw new Error('[tokenCipher] 암호화 토큰 형식이 올바르지 않습니다.')
  const [, ivB64, tagB64, dataB64] = parts
  const decipher = createDecipheriv('aes-256-gcm', getKey(), Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8')
}
