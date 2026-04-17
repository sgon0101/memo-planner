function randomBuffer(bytes: number): ArrayBuffer {
  const buf = new ArrayBuffer(bytes)
  crypto.getRandomValues(new Uint8Array(buf))
  return buf
}

async function deriveKey(password: string, salt: ArrayBuffer): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

export async function encryptContent(plaintext: string, password: string): Promise<string> {
  const saltBuf = randomBuffer(16)
  const ivBuf   = randomBuffer(12)
  const key     = await deriveKey(password, saltBuf)

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: ivBuf },
    key,
    new TextEncoder().encode(plaintext)
  )

  const combined = new Uint8Array(16 + 12 + ciphertext.byteLength)
  combined.set(new Uint8Array(saltBuf), 0)
  combined.set(new Uint8Array(ivBuf), 16)
  combined.set(new Uint8Array(ciphertext), 28)

  return btoa(String.fromCharCode(...combined))
}

export async function decryptContent(encryptedBase64: string, password: string): Promise<string> {
  const combined = Uint8Array.from(atob(encryptedBase64), (c) => c.charCodeAt(0))
  const saltBuf  = combined.slice(0, 16).buffer as ArrayBuffer
  const ivBuf    = combined.slice(16, 28).buffer as ArrayBuffer
  // slice가 전체 buffer를 공유할 수 있으므로 복사
  const saltFixed = saltBuf.slice(combined.byteOffset, combined.byteOffset + 16)
  const ivFixed   = ivBuf.slice(combined.byteOffset + 16, combined.byteOffset + 28)
  const data      = combined.slice(28)

  const key       = await deriveKey(password, saltFixed)
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ivFixed }, key, data)
  return new TextDecoder().decode(plaintext)
}
