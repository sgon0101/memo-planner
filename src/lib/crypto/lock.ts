/**
 * AES-GCM 잠금 메모 암호화 (PR-2 강화).
 *
 * 변경 사항:
 *   - PBKDF2 600,000 iter (OWASP 2024 권장) — 기존 100,000에서 6배 강화
 *   - v2 ciphertext에 prefix `v2|` 추가 → 옛 v1 자동 detect 가능
 *   - 옛 v1(prefix 없음)은 100k iter로 복호화 — 호환성 유지
 *   - decryptAndMaybeUpgrade: 옛 ciphertext 복호화 후 v2로 자동 재암호화 신호
 */

const VERSION_PREFIX_V2 = 'v2|'
const ITER_V1 = 100_000
const ITER_V2 = 600_000

function randomBuffer(bytes: number): ArrayBuffer {
  const buf = new ArrayBuffer(bytes)
  crypto.getRandomValues(new Uint8Array(buf))
  return buf
}

async function deriveKey(password: string, salt: ArrayBuffer, iterations: number): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

/** 신규 암호화 — 항상 v2 (600k iter) */
export async function encryptContent(plaintext: string, password: string): Promise<string> {
  const saltBuf = randomBuffer(16)
  const ivBuf   = randomBuffer(12)
  const key     = await deriveKey(password, saltBuf, ITER_V2)

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: ivBuf },
    key,
    new TextEncoder().encode(plaintext)
  )

  const combined = new Uint8Array(16 + 12 + ciphertext.byteLength)
  combined.set(new Uint8Array(saltBuf), 0)
  combined.set(new Uint8Array(ivBuf), 16)
  combined.set(new Uint8Array(ciphertext), 28)

  const b64 = btoa(String.fromCharCode(...combined))
  return VERSION_PREFIX_V2 + b64
}

/** 복호화 — v1/v2 자동 detect */
export async function decryptContent(encrypted: string, password: string): Promise<string> {
  const { plaintext } = await decryptInternal(encrypted, password)
  return plaintext
}

/** 복호화 + 옛 v1이면 v2로 업그레이드된 새 ciphertext도 같이 반환.
 *  사용 예 — 잠금 해제 시:
 *    const { plaintext, upgraded } = await decryptAndMaybeUpgrade(locked_content, pw)
 *    if (upgraded) await supabase.from('memos').update({ locked_content: upgraded }).eq('id', ...)
 */
export interface DecryptResult {
  plaintext: string
  version: 1 | 2
  upgraded?: string  // v1을 v2로 재암호화한 신규 ciphertext (v1일 때만)
}

export async function decryptAndMaybeUpgrade(
  encrypted: string,
  password: string
): Promise<DecryptResult> {
  const { plaintext, version } = await decryptInternal(encrypted, password)
  if (version === 1) {
    // 자동 업그레이드 — 같은 비번으로 v2 ciphertext 생성
    try {
      const upgraded = await encryptContent(plaintext, password)
      return { plaintext, version: 1, upgraded }
    } catch {
      return { plaintext, version: 1 }
    }
  }
  return { plaintext, version: 2 }
}

async function decryptInternal(
  encrypted: string,
  password: string
): Promise<{ plaintext: string; version: 1 | 2 }> {
  let version: 1 | 2 = 1
  let b64 = encrypted
  if (encrypted.startsWith(VERSION_PREFIX_V2)) {
    version = 2
    b64 = encrypted.slice(VERSION_PREFIX_V2.length)
  }
  const iterations = version === 2 ? ITER_V2 : ITER_V1

  const combined = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
  // slice는 view를 반환할 수 있으므로 명시적 copy
  const saltFixed = combined.slice(0, 16).buffer.slice(0)
  const ivFixed   = combined.slice(16, 28).buffer.slice(0)
  const data      = combined.slice(28)

  const key       = await deriveKey(password, saltFixed, iterations)
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ivFixed }, key, data)
  return { plaintext: new TextDecoder().decode(plaintext), version }
}
