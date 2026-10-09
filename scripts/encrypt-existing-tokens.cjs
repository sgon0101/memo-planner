/**
 * user_integrations의 평문 OAuth 토큰을 암호화한다 (멱등 — `v1:`로 시작하는 값은 건너뜀).
 *
 *   node scripts/encrypt-existing-tokens.cjs            # dry-run (기본): 바뀔 행 수만 출력
 *   node scripts/encrypt-existing-tokens.cjs --apply    # 실제 update
 *
 * 필요한 env (.env.local 또는 셸): NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 * TOKEN_ENCRYPTION_KEY — **운영(Vercel)과 같은 키**여야 한다. 다르면 운영이 복호화하지 못한다.
 *
 * 형식은 src/lib/crypto/tokenCipher.ts와 동일해야 한다 (v1:<iv b64>:<tag b64>:<ciphertext b64>, AES-256-GCM, IV 12바이트).
 * 토큰 값은 절대 출력하지 않는다.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- 빌드 없이 node로 바로 도는 CommonJS 스크립트 */
const path = require('path')
const crypto = require('crypto')
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') })
const { createClient } = require('@supabase/supabase-js')

const APPLY = process.argv.includes('--apply')
const TOKEN_COLUMNS = ['access_token', 'refresh_token']

function getKey() {
  const raw = process.env.TOKEN_ENCRYPTION_KEY
  if (!raw) throw new Error('TOKEN_ENCRYPTION_KEY가 설정되지 않았습니다.')
  const key = Buffer.from(raw, 'base64')
  if (key.length !== 32) throw new Error(`TOKEN_ENCRYPTION_KEY는 32바이트(base64)여야 합니다. 현재 ${key.length}바이트.`)
  return key
}

function encryptToken(plain, key) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), ciphertext.toString('base64')].join(':')
}

function decryptToken(stored, key) {
  const [, iv, tag, data] = stored.split(':')
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'))
  d.setAuthTag(Buffer.from(tag, 'base64'))
  return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8')
}

async function main() {
  const key = getKey()
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY가 필요합니다.')
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

  const { data: rows, error } = await supabase
    .from('user_integrations')
    .select('id, provider, access_token, refresh_token')
  if (error) throw new Error(`조회 실패: ${error.message}`)

  let total = 0, toUpdate = 0, alreadyEncrypted = 0, updated = 0, failed = 0
  for (const row of rows ?? []) {
    total++
    const patch = {}
    for (const col of TOKEN_COLUMNS) {
      const v = row[col]
      if (!v) continue
      if (v.startsWith('v1:')) {
        // 이미 암호화된 값이 이 키로 풀리는지 확인 (키 불일치 조기 발견)
        try { decryptToken(v, key) } catch { console.warn(`  ! ${row.id} (${row.provider}) ${col}: 이 키로 복호화되지 않음 — 다른 키로 암호화된 값`) }
        continue
      }
      patch[col] = encryptToken(v, key)
    }
    const cols = Object.keys(patch)
    if (!cols.length) { alreadyEncrypted++; continue }
    toUpdate++
    console.log(`  - ${row.id} (${row.provider}): ${cols.join(', ')} 암호화 대상`)
    if (!APPLY) continue

    // 동시에 OAuth 재연결로 값이 바뀌었을 수 있으니, 읽은 평문 그대로일 때만 update
    let q = supabase.from('user_integrations').update(patch).eq('id', row.id)
    for (const col of cols) q = q.eq(col, row[col])
    const { data: res, error: updErr } = await q.select('id')
    if (updErr || !res?.length) {
      failed++
      console.warn(`  ! ${row.id}: update 실패 ${updErr ? updErr.message : '(값이 그사이 바뀜 — 다시 실행하세요)'}`)
    } else {
      updated++
    }
  }

  console.log('')
  console.log(`전체 ${total}행 · 암호화 대상 ${toUpdate}행 · 이미 암호화/토큰 없음 ${alreadyEncrypted}행`)
  if (APPLY) console.log(`적용: 성공 ${updated}행 · 실패 ${failed}행`)
  else console.log('dry-run — 실제로 바꾸려면 --apply')
  if (failed) process.exitCode = 1
}

main().catch((e) => { console.error(e.message); process.exit(1) })
