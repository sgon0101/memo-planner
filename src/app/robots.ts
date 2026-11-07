import type { MetadataRoute } from 'next'
import { SITE_URL } from '@/lib/site'

/** 공개 페이지(/, /about, /privacy, /terms)만 색인, 앱 내부 경로는 막는다 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: ['/$', '/about', '/privacy', '/terms'], disallow: '/' }],
    sitemap: `${SITE_URL}/sitemap.xml`,
  }
}
