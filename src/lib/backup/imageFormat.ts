/**
 * 백업용 이미지 포맷 변환 (2026-08-02).
 *
 * 왜 필요한가:
 *   업로드 시 이미지는 WebP로 압축돼 R2에 저장되는데(lib/r2/upload.ts), 백업은
 *   그 객체를 그대로 Drive에 올려서 백업본이 전부 WebP가 된다. WebP는 일반
 *   뷰어·문서 편집기에서 바로 열리지 않는 경우가 있어 "열어볼 수 있는 사본"이라는
 *   백업의 목적을 반쯤 잃는다.
 *
 * 설계 판단 (실제 데이터 11장 측정 근거):
 *   - JPG(q90): 전체 용량 0.92배, 평균 109ms — 원본이 jpg인 것은 오히려 줄어듦
 *   - PNG: 전체 용량 3.46배, 평균 276ms — R2 원본이 이미 손실 압축이라
 *          무손실로 재인코딩해도 화질 이득 없이 용량만 폭증 (최대 5.1배 관측)
 *   → 기본은 JPG. 단 알파 채널이 있으면 투명도가 흰 배경으로 뭉개지므로 그 장만 PNG.
 *
 * 변환 대상은 WebP뿐이다:
 *   - jpg/png : 이미 어디서나 열리므로 재인코딩하면 화질만 손해
 *   - gif     : 변환하면 애니메이션이 죽음
 *   - svg     : 벡터라 래스터화하면 확대 품질 손실
 *   - mp4/pdf : 이미지가 아님
 */

import sharp from 'sharp'

/** 백업본 이미지 포맷 정책 */
export type BackupImageFormat = 'original' | 'jpg' | 'png'

export const DEFAULT_BACKUP_IMAGE_FORMAT: BackupImageFormat = 'jpg'

export function normalizeBackupImageFormat(v: unknown): BackupImageFormat {
  return v === 'original' || v === 'png' || v === 'jpg' ? v : DEFAULT_BACKUP_IMAGE_FORMAT
}

/** 확장자를 뗀 파일명 — 포맷이 바뀌어도 같은 이미지로 인식하기 위한 증분 판정 키 */
export function backupImageKey(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '')
}

const JPEG_QUALITY = 90

export interface ConvertedImage {
  buffer: Buffer
  fileName: string
  mimeType: string
  /** 변환이 실제로 일어났는지 (원본 그대로면 false) */
  converted: boolean
}

/**
 * 백업 직전 이미지 변환. 변환 대상이 아니거나 실패하면 원본을 그대로 돌려준다
 * (백업이 통째로 실패하는 것보다 원본이라도 올라가는 편이 낫다).
 */
export async function convertImageForBackup(
  buffer: Buffer,
  sourceMimeType: string,
  fileName: string,
  format: BackupImageFormat,
): Promise<ConvertedImage> {
  const asIs: ConvertedImage = { buffer, fileName, mimeType: sourceMimeType, converted: false }

  if (format === 'original') return asIs
  // WebP만 변환 — 나머지는 이미 호환 포맷이거나 변환 시 손해
  if (!/^image\/webp$/i.test(sourceMimeType)) return asIs

  const base = backupImageKey(fileName)

  try {
    // 알파 채널이 있으면 JPG로 가면 투명 영역이 뭉개지므로 그 장만 PNG로 뺀다
    const meta = await sharp(buffer).metadata()
    const usePng = format === 'png' || meta.hasAlpha === true

    if (usePng) {
      const out = await sharp(buffer).png({ compressionLevel: 9 }).toBuffer()
      return { buffer: out, fileName: `${base}.png`, mimeType: 'image/png', converted: true }
    }

    const out = await sharp(buffer)
      .flatten({ background: '#ffffff' })  // 알파 없는 이미지에도 안전 (no-op)
      .jpeg({ quality: JPEG_QUALITY })
      .toBuffer()
    return { buffer: out, fileName: `${base}.jpg`, mimeType: 'image/jpeg', converted: true }
  } catch (e) {
    console.warn('[backup:imageFormat] 변환 실패 — 원본으로 백업:', fileName, e instanceof Error ? e.message : e)
    return asIs
  }
}
