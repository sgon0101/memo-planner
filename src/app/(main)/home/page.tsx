import { Suspense } from 'react'
import HomePageClient from './_client'

export default function HomePage() {
  return (
    <Suspense>
      <HomePageClient />
    </Suspense>
  )
}
