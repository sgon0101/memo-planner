/**
 * Supabase Storage → Cloudflare R2 마이그레이션 스크립트
 * 실행: npx ts-node scripts/migrate-to-r2.ts
 *
 * 환경 변수 필요:
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *   CLOUDFLARE_R2_ACCOUNT_ID, CLOUDFLARE_R2_ACCESS_KEY_ID,
 *   CLOUDFLARE_R2_SECRET_ACCESS_KEY, CLOUDFLARE_R2_BUCKET_NAME,
 *   CLOUDFLARE_R2_PUBLIC_URL
 */

import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.CLOUDFLARE_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY!,
  },
})

const BUCKET = process.env.CLOUDFLARE_R2_BUCKET_NAME!
const PUBLIC_URL = process.env.CLOUDFLARE_R2_PUBLIC_URL!
const STORAGE_BUCKET = 'memo-images'

async function run() {
  console.log('Supabase Storage → R2 마이그레이션 시작')

  // 1. 파일 목록 조회
  const { data: files, error } = await supabase.storage.from(STORAGE_BUCKET).list('', { limit: 1000 })
  if (error) { console.error('목록 조회 실패:', error); return }
  if (!files?.length) { console.log('마이그레이션할 파일 없음'); return }

  console.log(`총 ${files.length}개 파일 마이그레이션 예정`)

  let success = 0, failed = 0

  for (const file of files) {
    if (file.name === '.emptyFolderPlaceholder') continue
    try {
      // 2. Supabase에서 다운로드
      const { data, error: dlErr } = await supabase.storage.from(STORAGE_BUCKET).download(file.name)
      if (dlErr || !data) throw dlErr ?? new Error('다운로드 실패')

      const buffer = Buffer.from(await data.arrayBuffer())
      const key = `migrated/${file.name}`

      // 3. R2에 업로드
      await r2.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: buffer,
        ContentType: file.metadata?.mimetype ?? 'application/octet-stream',
        CacheControl: 'public, max-age=31536000',
      }))

      const newUrl = `${PUBLIC_URL}/${key}`

      // 4. memos 테이블 URL 업데이트 (content_text 내 URL 교체는 별도 처리 필요)
      const oldUrl = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(file.name).data.publicUrl
      console.log(`✓ ${file.name} → ${newUrl}`)
      console.log(`  (구 URL: ${oldUrl})`)

      success++
    } catch (err) {
      console.error(`✗ ${file.name}:`, err)
      failed++
    }
  }

  console.log(`\n완료: 성공 ${success}개, 실패 ${failed}개`)
  console.log('⚠️  memos.content 내 이미지 URL은 수동으로 업데이트해주세요.')
}

run().catch(console.error)
