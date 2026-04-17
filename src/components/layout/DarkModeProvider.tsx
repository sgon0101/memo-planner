'use client'

import { useEffect } from 'react'
import { useUIStore } from '@/store/uiStore'

export default function DarkModeProvider({ children }: { children: React.ReactNode }) {
  const { darkMode } = useUIStore()

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  }, [darkMode])

  return <>{children}</>
}
