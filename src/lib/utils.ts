import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// 이미지 캐시 버전 — 이미지 변형(full/md/thumb)을 같은 R2 키에 덮어써 재생성하면
// 클라이언트(특히 홈 화면 설치형 PWA)가 옛 저화질을 max-age 1년 캐시로 붙잡아
// 재생성·백필이 화면에 반영되지 않는다(안드로이드 PWA는 앱 캐시삭제로도 안 비워지는 케이스).
// 표시 URL에 이 버전 쿼리를 붙이면 URL이 바뀌어 모든 기기가 즉시 새로 받는다.
// ⚠️ 이미지를 대규모 재생성/백필한 뒤 이 값을 올리면(날짜 문자열) 전 기기가 갱신된다.
export const IMG_CACHE_VERSION = '20260711'

// R2 이미지 URL에 캐시 버전 쿼리(?cv=)를 붙여 클라이언트 캐시를 우회한다.
// data:/blob: (오프라인 임시 이미지)와 빈 값은 그대로 둔다.
export function withImgCacheVersion(url: string | null | undefined): string {
  if (!url || url.startsWith('data:') || url.startsWith('blob:')) return url ?? ''
  return url + (url.includes('?') ? '&' : '?') + 'cv=' + IMG_CACHE_VERSION
}
