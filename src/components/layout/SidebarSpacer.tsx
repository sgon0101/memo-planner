'use client'

import { useUIStore } from '@/store/uiStore'

export default function SidebarSpacer() {
  const { sidebarOpen } = useUIStore()
  return <div className={`hidden md:block flex-shrink-0 transition-all duration-200 ${sidebarOpen ? 'w-56' : 'w-14'}`} />
}
