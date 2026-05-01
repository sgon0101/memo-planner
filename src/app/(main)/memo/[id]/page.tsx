import { Suspense } from 'react'
import MemoEditorClient from './_client'

export default function MemoEditorPage() {
  return (
    <Suspense>
      <MemoEditorClient />
    </Suspense>
  )
}
